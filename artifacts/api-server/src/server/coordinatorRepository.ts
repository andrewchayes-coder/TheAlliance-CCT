import { eq, desc } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db, usersTable, volunteerProfilesTable, activityLogTable } from '@workspace/db';
import { readScheduleData } from './scheduleRepository';
import { coordinatorProjection, mondayOf } from './coordinatorSchedule';
import { pacificDay, addCalendarDays } from './scheduleService';

export async function coordinatorSnapshot(weekStart?: string, now = new Date()) {
  return db.transaction(async tx => {
    const from = weekStart ? mondayOf(weekStart) : mondayOf(pacificDay(now));
    const data = await readScheduleData(tx, undefined, { from, ...(weekStart ? { to: addCalendarDays(from, 4) } : {}) });
    const rows = await tx.select({ userId: usersTable.id, firstName: usersTable.firstName, lastName: usersTable.lastName,
      email: usersTable.email, phone: usersTable.phone, accountActive: usersTable.isActive, isTestAccount: usersTable.isTestAccount, profileId: volunteerProfilesTable.id,
      profile: { status: volunteerProfilesTable.status, certificationExpiresAt: volunteerProfilesTable.certificationExpiresAt,
        backgroundCheckStatus: volunteerProfilesTable.backgroundCheckStatus, backgroundCheckSubmittedAt: volunteerProfilesTable.backgroundCheckSubmittedAt,
        onboardingCompletedAt: volunteerProfilesTable.onboardingCompletedAt } })
      .from(volunteerProfilesTable).innerJoin(usersTable, eq(usersTable.id, volunteerProfilesTable.userId))
      .where(eq(usersTable.role, 'volunteer'));
    const projection = coordinatorProjection(data, rows, now);
    if (weekStart) return projection.week(weekStart);
    const actor = alias(usersTable, 'activity_actor'), volunteer = alias(usersTable, 'activity_volunteer');
    const events = await tx.select({ id: activityLogTable.id, userId: volunteer.id, firstName: volunteer.firstName,
      lastName: volunteer.lastName, actorFirst: actor.firstName, actorLast: actor.lastName,
      action: activityLogTable.action, createdAt: activityLogTable.createdAt }).from(activityLogTable)
      .innerJoin(volunteerProfilesTable, eq(volunteerProfilesTable.id, activityLogTable.volunteerProfileId))
      .innerJoin(volunteer, eq(volunteer.id, volunteerProfilesTable.userId))
      .innerJoin(actor, eq(actor.id, activityLogTable.actorUserId))
      .orderBy(desc(activityLogTable.createdAt), desc(activityLogTable.id)).limit(15);
    return { ...projection.overview(), recentActivity: events.map(e => ({ id: e.id, userId: e.userId,
      volunteerName: `${e.firstName} ${e.lastName}`, actorName: `${e.actorFirst} ${e.actorLast}`,
      action: e.action, createdAt: e.createdAt.toISOString() })) };
  }, { isolationLevel: 'repeatable read' });
}
