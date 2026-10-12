import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db, volunteerProfilesTable, shiftAssignmentsTable, activityLogTable, notificationLogTable } from '@workspace/db';
import {
  GetAdminVolunteerParams, ChangeVolunteerStatusBody, UpdateVolunteerTrackingBody, UpdateVolunteerNotesBody,
  ChangeVolunteerStatusResponse,
} from '@workspace/api-zod';
import { approvalRequirements, checkRevision, lockedVolunteer, loadAdminVolunteerDetail, releasePreview, WorkflowError } from '../admin-volunteer-detail';
import {releaseCustomAssignments} from '../server/customShiftRelease';
import { pacificDay } from '../volunteer-shifts';
import { sendEmail, createEmailTemplate } from '../email';
import { appOrigin } from '../auth/session';
import { onAssignmentsReleased } from '../uncovered-shifts';
import { logger } from '../lib/logger';
import { lockSchedule } from '../server/scheduleMutations';
import { normalizeVolunteerStatus, profileCompletionSchema, profileDraftSchema, calendarDateSchema } from '@workspace/shared/profileFields';

const router = Router();
function errorResponse(error: unknown, res: Response) {
  if (error instanceof WorkflowError) {
    res.status(error.status).json({ error: error.message, ...(error.missing ? { missing: error.missing } : {}) }); return;
  }
  logger.error({ err: error }, 'Volunteer workflow save failed.');
  res.status(500).json({ error: 'We could not save this change. Please try again.' });
}
function userId(req: Request) {
  const parsed = GetAdminVolunteerParams.safeParse(req.params);
  if (!parsed.success) throw new WorkflowError(400, 'Choose a valid volunteer.');
  return parsed.data.userId;
}
router.post('/volunteers/:userId/status', async (req, res) => {
  try {
    const id = userId(req), parsed = ChangeVolunteerStatusBody.strict().safeParse(req.body);
    if (!parsed.success) throw new WorkflowError(400, 'Choose a valid status and confirmation.');
    const input = parsed.data, today = pacificDay(new Date());
    const result = await db.transaction(async tx => {
      await lockSchedule(tx);
      const { user, profile } = await lockedVolunteer(tx, id);
      checkRevision(profile, input.expectedUpdatedAt);
      if (normalizeVolunteerStatus(profile.status) === input.status) return { user, profile, activityId: null, released: [] as Awaited<ReturnType<typeof releasePreview>> };
      if (input.status === 'active') {
        const missing = approvalRequirements(user, profile).filter(check => !check.met);
        if (missing.length) throw new WorkflowError(422, 'Approval is not ready. Complete each missing requirement first.', missing);
      }
      const released = input.status === 'inactive' ? await releasePreview(tx, profile.id, today) : [];
      const customReleased=input.status==='inactive'?await releaseCustomAssignments(tx,profile.id):[];
      if (input.status === 'inactive') {
        const actual = released.map(row => row.assignmentId).sort();
        const confirmed = [...new Set(input.releaseAssignmentIds ?? [])].sort();
        if (input.releaseAssignmentIds === undefined || JSON.stringify(actual) !== JSON.stringify(confirmed))
          throw new WorkflowError(409, 'The shifts to release have changed. Reload and review the shift list before confirming.');
        if (released.length) await tx.update(shiftAssignmentsTable).set({ endDate: today, endedReason: 'admin_removed', updatedAt: new Date() })
          .where(inArray(shiftAssignmentsTable.id, actual));
      }
      const [previousActivation] = input.status === 'active' && !profile.startDate
        ? await tx.select({id:activityLogTable.id}).from(activityLogTable).where(and(
          eq(activityLogTable.volunteerProfileId,profile.id),eq(activityLogTable.action,'status_changed'),
          sql`${activityLogTable.details}->>'to' = 'active'`,
        )).limit(1) : [];
      const newStartDate = input.status === 'active' && !profile.startDate && !previousActivation ? today : undefined;
      await tx.update(volunteerProfilesTable).set({ status: input.status, ...(newStartDate ? { startDate:newStartDate } : {}), updatedAt: new Date() }).where(eq(volunteerProfilesTable.id, profile.id));
      if (newStartDate) await tx.insert(activityLogTable).values({ volunteerProfileId:profile.id,actorUserId:req.authUser!.id,
        action:'start_date_changed',details:{fields:['startDate'],reason:'first_activation'} });
      const [event] = await tx.insert(activityLogTable).values({ volunteerProfileId: profile.id, actorUserId: req.authUser!.id, action: 'status_changed',
        details: { from: normalizeVolunteerStatus(profile.status), to: input.status, releasedAssignmentIds: released.map(row => row.assignmentId),
          releasedShifts: released.map(row => ({ dayOfWeek: row.dayOfWeek, startTime: row.startTime, endTime: row.endTime })),
          previousCustomAssignments:customReleased,previousAssignments: released.map(row => ({ id: row.assignmentId, shiftSlotId: row.shiftSlotId,
            volunteerProfileId: profile.id, startDate: row.startDate, endDate: row.endDate, endedReason: null })) } }).returning();
      return { user, profile, activityId: event!.id, released,customReleased };
    });
    // Side effects happen only after the status, released assignments, and audit commit.
    if (result.activityId && input.status === 'inactive') {
      try {
        await onAssignmentsReleased({ volunteerProfileId: result.profile.id, assignmentIds: [...result.released.map(row => row.assignmentId),...(result.customReleased??[]).map(a=>a.id)],
          shiftSlotIds: [...new Set([...result.released.map(row => row.shiftSlotId),...(result.customReleased??[]).map(a=>a.customShiftId)])], effectiveDate: today, activityId: result.activityId });
      } catch (error) { logger.error({ err: error, activityId: result.activityId }, 'Uncovered-shift integration hook failed after committed release.'); }
    }
    let emailDelivery = null;
    if (result.activityId && input.status === 'active') {
      const copy = createEmailTemplate({ heading: "You're approved! Choose your weekly shift", firstName: result.user.firstName,
        paragraphs: ["Thank you for preparing to support local families. You're approved to serve as a Resource Coordinator with The Alliance's Community Care Team.",
          'Choose a weekly shift that works for you. We look forward to serving alongside you.'],
        cta: { label: 'Choose your weekly shift', url: `${appOrigin}/shifts` } });
      emailDelivery = await sendEmail({ type: 'welcome', to: result.user.email, toUserId: result.user.id,
        subject: "You're approved! Choose your weekly shift", ...copy, relatedId: result.activityId });
      try {
        const [delivery] = await db.select({ status: notificationLogTable.status }).from(notificationLogTable)
          .where(and(eq(notificationLogTable.recipientUserId, result.user.id), eq(notificationLogTable.relatedId, result.activityId),
            eq(notificationLogTable.type, 'welcome'))).limit(1);
        emailDelivery = { ...emailDelivery, ...(delivery ? { status: delivery.status } : {}) };
      } catch (error) { logger.warn({ err: error }, 'Approval completed; email audit status could not be read.'); }
    }
    res.set('Cache-Control', 'no-store').json(ChangeVolunteerStatusResponse.parse({
      detail: await loadAdminVolunteerDetail(id), emailDelivery, releasedAssignmentCount: result.released.length,
    }));
  } catch (error) { errorResponse(error, res); }
});
function calendar(value: string | null) {
  if (value !== null && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(`${value}T00:00:00Z`)) ||
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value))
    throw new WorkflowError(400, 'Enter valid calendar dates.');
}
// Orval coerces OpenAPI `format: date` to Date; these database columns are
// calendar strings, so preserve and validate the original day at this boundary.
const trackingInput = UpdateVolunteerTrackingBody.extend({
  certificationCompletedAt: z.string().nullable().optional(), certificationExpiresAt: z.string().nullable().optional(),
  backgroundCheckSubmittedAt: z.string().nullable().optional(), backgroundCheckClearedAt: z.string().nullable().optional(),
  dateOfBirth: z.string().nullable().optional(),
  startDate: z.string().nullable().optional(),
}).strict();
router.patch('/volunteers/:userId/tracking', async (req, res) => {
  try {
    const id = userId(req), parsed = trackingInput.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Enter valid profile details before saving.', fieldErrors: parsed.error.flatten().fieldErrors, issues: parsed.error.issues }); return;
    }
    const { expectedUpdatedAt, ...fields } = parsed.data;
    const profileInput = profileDraftSchema.omit({ firstName: true, lastName: true, phone: true });
    const checkedProfile = profileInput.safeParse(Object.fromEntries(Object.keys(profileInput.shape)
      .filter(key => Object.hasOwn(fields, key)).map(key => [key, fields[key as keyof typeof fields]])));
    if (!checkedProfile.success) {
      res.status(400).json({ error: 'Please check the profile fields.', fieldErrors: checkedProfile.error.flatten().fieldErrors, issues: checkedProfile.error.issues }); return;
    }
    Object.assign(fields, checkedProfile.data);
    for (const key of ['addressLine1','city','state','zip','emergencyContactName','emergencyContactRelationship','emergencyContactPhone'] as const) {
      if (fields[key] === undefined || fields[key] === null) continue;
      const checked = profileCompletionSchema.shape[key].safeParse(fields[key]);
      if (!checked.success) throw new WorkflowError(400, `Enter a valid ${key.replace(/([A-Z])/g,' $1').toLowerCase()}.`);
      fields[key] = checked.data;
    }
    if (fields.county !== undefined) {
      const county = z.string().trim().min(1).max(100).safeParse(fields.county ?? 'Placer');
      if (!county.success) throw new WorkflowError(400, 'Enter a county before saving.');
      fields.county = county.data;
    }
    if (fields.dateOfBirth != null && !profileCompletionSchema.shape.dateOfBirth.safeParse(fields.dateOfBirth).success)
      throw new WorkflowError(400, 'Date of birth must be a valid date in the past.');
    if (fields.startDate != null && !calendarDateSchema.safeParse(fields.startDate).success)
      throw new WorkflowError(400, 'Enter a valid start date.');
    [fields.certificationCompletedAt, fields.certificationExpiresAt, fields.backgroundCheckSubmittedAt, fields.backgroundCheckClearedAt]
      .filter((value): value is string | null => value !== undefined).forEach(calendar);
    if (fields.certificationCompletedAt && fields.certificationExpiresAt && fields.certificationExpiresAt < fields.certificationCompletedAt)
      throw new WorkflowError(400, 'Certification expiry cannot be before completion.');
    if (fields.backgroundCheckSubmittedAt && fields.backgroundCheckClearedAt && fields.backgroundCheckClearedAt < fields.backgroundCheckSubmittedAt)
      throw new WorkflowError(400, 'Background-check clearance cannot be before submission.');
    await db.transaction(async tx => {
      const { profile } = await lockedVolunteer(tx, id);
      checkRevision(profile, expectedUpdatedAt);
      const changes = Object.keys(fields).filter(key => fields[key as keyof typeof fields] !== profile[key as keyof typeof profile]);
      if (!changes.length) return;
      await tx.update(volunteerProfilesTable).set({ ...fields, county:fields.county ?? undefined, updatedAt: new Date() }).where(eq(volunteerProfilesTable.id, profile.id));
      if (changes.includes('startDate')) await tx.insert(activityLogTable).values({
        volunteerProfileId:profile.id,actorUserId:req.authUser!.id,action:'start_date_changed',details:{fields:['startDate']},
      });
      const trackingChanges = changes.filter(key => key !== 'startDate');
      if (trackingChanges.length) await tx.insert(activityLogTable).values({ volunteerProfileId: profile.id, actorUserId: req.authUser!.id, action: 'tracking_updated', details: { fields: trackingChanges } });
    });
    res.set('Cache-Control', 'no-store').json(await loadAdminVolunteerDetail(id));
  } catch (error) { errorResponse(error, res); }
});
router.patch('/volunteers/:userId/notes', async (req, res) => {
  try {
    const id = userId(req), parsed = UpdateVolunteerNotesBody.strict().safeParse(req.body);
    if (!parsed.success) throw new WorkflowError(400, 'Staff notes must be 20,000 characters or fewer.');
    await db.transaction(async tx => {
      const { profile } = await lockedVolunteer(tx, id);
      if (profile.adminNotes !== parsed.data.expectedAdminNotes)
        throw new WorkflowError(409, 'Another staff member changed these notes. Your draft has been kept; review the latest notes before saving over them.');
      if (profile.adminNotes === parsed.data.adminNotes) return;
      await tx.update(volunteerProfilesTable).set({ adminNotes: parsed.data.adminNotes, updatedAt: new Date() }).where(eq(volunteerProfilesTable.id, profile.id));
    });
    res.set('Cache-Control', 'no-store').json(await loadAdminVolunteerDetail(id));
  } catch (error) { errorResponse(error, res); }
});
export default router;
