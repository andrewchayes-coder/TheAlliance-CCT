import { and, desc, eq, gte, inArray, isNull, ne, or } from 'drizzle-orm';
import { db, usersTable, volunteerProfilesTable, shiftAssignmentsTable, shiftSlotsTable, shiftSkipsTable, activityLogTable } from '@workspace/db';
import { GetAdminVolunteerResponse } from '@workspace/api-zod';
import { rosterEntry, rosterSnapshot } from './admin-roster';
import { pacificDay } from './volunteer-shifts';
import { appConfig } from '@workspace/shared/appConfig';
import { missingProfileFields } from '@workspace/shared/profileFields';

export type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export class WorkflowError extends Error {
  constructor(public status: number, message: string, public missing?: ReturnType<typeof approvalRequirements>) { super(message); }
}
export const ongoingAssignments = (profileId: string, today: string) => and(
  eq(shiftAssignmentsTable.volunteerProfileId, profileId),
  or(isNull(shiftAssignmentsTable.endedReason), ne(shiftAssignmentsTable.endedReason, 'admin_removed')),
  or(isNull(shiftAssignmentsTable.endDate), gte(shiftAssignmentsTable.endDate, today)),
);
export function approvalRequirements(user: typeof usersTable.$inferSelect, profile: typeof volunteerProfilesTable.$inferSelect) {
  return [
    { key: 'email_verified' as const, label: 'Email verified', met: !!user.emailVerifiedAt },
    ...missingProfileFields(user, profile),
    ...(appConfig.requireAgreementAcknowledgment ? [{ key: 'agreement_acknowledged', label: 'Agreement acknowledged', met: !!profile.agreementAcknowledgedAt }] : []),
    ...(appConfig.trackCertificationInApp ? [{ key: 'certification_complete', label: 'Certification complete', met: profile.certificationStatus === 'complete' }] : []),
    ...(appConfig.trackBackgroundCheckInApp ? [{ key: 'background_cleared', label: 'Background check cleared', met: profile.backgroundCheckStatus === 'cleared' }] : []),
  ];
}
/** Match the lock order used by volunteer profile editing: user, then profile. */
export async function lockedVolunteer(tx: Transaction, userId: string) {
  const [user] = await tx.select().from(usersTable).where(and(eq(usersTable.id, userId), eq(usersTable.role, 'volunteer'))).for('update');
  if (!user) throw new WorkflowError(404, 'Volunteer not found.');
  const [profile] = await tx.select().from(volunteerProfilesTable).where(eq(volunteerProfilesTable.userId, userId)).for('update');
  if (!profile) throw new WorkflowError(404, 'Volunteer profile not found.');
  return { user, profile };
}
export function checkRevision(profile: typeof volunteerProfilesTable.$inferSelect, expected: Date | string) {
  if (profile.updatedAt.getTime() !== new Date(expected).getTime()) throw new WorkflowError(409, 'This volunteer was updated by another save. Reload and review the latest information before trying again.');
}
export async function releasePreview(tx: Pick<Transaction, 'select'>, profileId: string, today: string) {
  return tx.select({
    assignmentId: shiftAssignmentsTable.id, shiftSlotId: shiftAssignmentsTable.shiftSlotId,
    dayOfWeek: shiftSlotsTable.dayOfWeek, startTime: shiftSlotsTable.startTime, endTime: shiftSlotsTable.endTime,
    label: shiftSlotsTable.label, startDate: shiftAssignmentsTable.startDate, endDate: shiftAssignmentsTable.endDate,
  }).from(shiftAssignmentsTable).innerJoin(shiftSlotsTable, eq(shiftSlotsTable.id, shiftAssignmentsTable.shiftSlotId))
    .where(ongoingAssignments(profileId, today)).orderBy(shiftSlotsTable.dayOfWeek, shiftSlotsTable.startTime, shiftAssignmentsTable.id);
}
export async function loadAdminVolunteerDetail(userId: string) {
  const person = (await rosterSnapshot()).find(row => row.user.id === userId);
  if (!person) throw new WorkflowError(404, 'Volunteer not found.');
  const today = pacificDay(new Date());
  const releases = await releasePreview(db, person.profile.id, today);
  const skips = releases.length ? await db.select().from(shiftSkipsTable)
    .where(and(inArray(shiftSkipsTable.shiftAssignmentId, releases.map(row => row.assignmentId)), gte(shiftSkipsTable.skipDate, today))).orderBy(shiftSkipsTable.skipDate) : [];
  const activity = await db.select({
    id: activityLogTable.id, actorUserId: activityLogTable.actorUserId, firstName: usersTable.firstName,
    lastName: usersTable.lastName, action: activityLogTable.action, details: activityLogTable.details, createdAt: activityLogTable.createdAt,
  }).from(activityLogTable).innerJoin(usersTable, eq(usersTable.id, activityLogTable.actorUserId))
    .where(eq(activityLogTable.volunteerProfileId, person.profile.id)).orderBy(desc(activityLogTable.createdAt), desc(activityLogTable.id)).limit(50);
  return GetAdminVolunteerResponse.parse({
    entry: rosterEntry(person), adminNotes: person.profile.adminNotes, shifts: person.shifts,
    assignmentsToRelease: releases.map(({ shiftSlotId: _, ...shift }) => ({
      ...shift, upcomingSkipDates: skips.filter(skip => skip.shiftAssignmentId === shift.assignmentId &&
        skip.skipDate >= shift.startDate && (!shift.endDate || skip.skipDate <= shift.endDate)).map(skip => skip.skipDate),
    })),
    approvalRequirements: approvalRequirements(person.user, person.profile),
    activity: activity.map(({ firstName, lastName, ...event }) => ({ ...event, actorName: `${firstName} ${lastName}` })),
  });
}
