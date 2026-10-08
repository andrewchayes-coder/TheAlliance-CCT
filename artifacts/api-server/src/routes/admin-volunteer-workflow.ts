import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { and, eq, inArray } from 'drizzle-orm';
import { db, volunteerProfilesTable, shiftAssignmentsTable, activityLogTable, notificationLogTable } from '@workspace/db';
import {
  GetAdminVolunteerParams, ChangeVolunteerStatusBody, UpdateVolunteerTrackingBody, UpdateVolunteerNotesBody,
  ChangeVolunteerStatusResponse,
} from '@workspace/api-zod';
import { approvalRequirements, checkRevision, lockedVolunteer, loadAdminVolunteerDetail, releasePreview, WorkflowError } from '../admin-volunteer-detail';
import { pacificDay } from '../volunteer-shifts';
import { sendEmail, createEmailTemplate } from '../email';
import { appOrigin } from '../auth/session';
import { onAssignmentsReleased } from '../uncovered-shifts';
import { logger } from '../lib/logger';
import { lockSchedule } from '../server/scheduleMutations';

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
      if (profile.status === input.status) return { user, profile, activityId: null, released: [] as Awaited<ReturnType<typeof releasePreview>> };
      if (input.status === 'active') {
        const missing = approvalRequirements(user, profile).filter(check => !check.met);
        if (missing.length) throw new WorkflowError(422, 'Approval is not ready. Complete each missing requirement first.', missing);
      }
      const released = input.status === 'inactive' ? await releasePreview(tx, profile.id, today) : [];
      if (input.status === 'inactive') {
        const actual = released.map(row => row.assignmentId).sort();
        const confirmed = [...new Set(input.releaseAssignmentIds ?? [])].sort();
        if (input.releaseAssignmentIds === undefined || JSON.stringify(actual) !== JSON.stringify(confirmed))
          throw new WorkflowError(409, 'The shifts to release have changed. Reload and review the shift list before confirming.');
        if (released.length) await tx.update(shiftAssignmentsTable).set({ endDate: today, endedReason: 'admin_removed', updatedAt: new Date() })
          .where(inArray(shiftAssignmentsTable.id, actual));
      }
      await tx.update(volunteerProfilesTable).set({ status: input.status, updatedAt: new Date() }).where(eq(volunteerProfilesTable.id, profile.id));
      const [event] = await tx.insert(activityLogTable).values({ volunteerProfileId: profile.id, actorUserId: req.authUser!.id, action: 'status_changed',
        details: { from: profile.status, to: input.status, releasedAssignmentIds: released.map(row => row.assignmentId),
          releasedShifts: released.map(row => ({ dayOfWeek: row.dayOfWeek, startTime: row.startTime, endTime: row.endTime })),
          previousAssignments: released.map(row => ({ id: row.assignmentId, shiftSlotId: row.shiftSlotId,
            volunteerProfileId: profile.id, startDate: row.startDate, endDate: row.endDate, endedReason: null })) } }).returning();
      return { user, profile, activityId: event!.id, released };
    });
    // Side effects happen only after the status, released assignments, and audit commit.
    if (result.activityId && input.status === 'inactive') {
      try {
        await onAssignmentsReleased({ volunteerProfileId: result.profile.id, assignmentIds: result.released.map(row => row.assignmentId),
          shiftSlotIds: [...new Set(result.released.map(row => row.shiftSlotId))], effectiveDate: today, activityId: result.activityId });
      } catch (error) { logger.error({ err: error, activityId: result.activityId }, 'Uncovered-shift integration hook failed after committed release.'); }
    }
    let emailDelivery = null;
    if (result.activityId && input.status === 'active') {
      const copy = createEmailTemplate({ heading: "You're approved! Choose your weekly shift", firstName: result.user.firstName,
        paragraphs: ["Thank you for preparing to support local families. You're approved to volunteer with The Alliance's Resource Coordination Program.",
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
  certificationCompletedAt: z.string().nullable(), certificationExpiresAt: z.string().nullable(),
  backgroundCheckSubmittedAt: z.string().nullable(), backgroundCheckClearedAt: z.string().nullable(),
}).strict();
router.patch('/volunteers/:userId/tracking', async (req, res) => {
  try {
    const id = userId(req), parsed = trackingInput.safeParse(req.body);
    if (!parsed.success) throw new WorkflowError(400, 'Enter valid training and background-check fields.');
    const { expectedUpdatedAt, ...fields } = parsed.data;
    [fields.certificationCompletedAt, fields.certificationExpiresAt, fields.backgroundCheckSubmittedAt, fields.backgroundCheckClearedAt].forEach(calendar);
    if (fields.certificationCompletedAt && fields.certificationExpiresAt && fields.certificationExpiresAt < fields.certificationCompletedAt)
      throw new WorkflowError(400, 'Certification expiry cannot be before completion.');
    if (fields.backgroundCheckSubmittedAt && fields.backgroundCheckClearedAt && fields.backgroundCheckClearedAt < fields.backgroundCheckSubmittedAt)
      throw new WorkflowError(400, 'Background-check clearance cannot be before submission.');
    await db.transaction(async tx => {
      const { profile } = await lockedVolunteer(tx, id);
      checkRevision(profile, expectedUpdatedAt);
      const changes = Object.fromEntries(Object.entries(fields).filter(([key, value]) => value !== profile[key as keyof typeof profile])
        .map(([key, value]) => [key, { from: profile[key as keyof typeof profile], to: value }]));
      if (!Object.keys(changes).length) return;
      await tx.update(volunteerProfilesTable).set({ ...fields, updatedAt: new Date() }).where(eq(volunteerProfilesTable.id, profile.id));
      await tx.insert(activityLogTable).values({ volunteerProfileId: profile.id, actorUserId: req.authUser!.id, action: 'tracking_updated', details: { changes } });
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
