import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { volunteerSchedule, volunteerScheduleAction } from '../server/volunteerSchedule';
import { WorkflowError } from '../admin-volunteer-detail';
import { logger } from '../lib/logger';
import { db, volunteerProfilesTable } from '@workspace/db';
import { eq } from 'drizzle-orm';
import { agreementVersion } from '../server/agreements';
const router = Router();
router.use(async (req, res, next) => {
  const [profile] = await db.select({ completedAt: volunteerProfilesTable.onboardingCompletedAt,
    version: volunteerProfilesTable.agreementVersion, acknowledgedAt: volunteerProfilesTable.agreementAcknowledgedAt })
    .from(volunteerProfilesTable).where(eq(volunteerProfilesTable.userId, req.authUser!.id));
  if (profile?.completedAt && (!profile.acknowledgedAt || profile.version !== await agreementVersion())) {
    res.status(403).json({ error: 'Please review and acknowledge the updated agreements before using shifts.',
      code: 'AGREEMENT_REQUIRED', nextPath: '/agreements' }); return;
  }
  next();
});
const booking = z.object({ slotId: z.string().uuid(), startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).strict();
const skip = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).strict();
router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
router.get('/schedule', async (req, res) => {
  try { res.json(await volunteerSchedule(req.authUser!.id)); } catch (error) {
    logger.error({ err: error }, 'Volunteer schedule read failed');
    res.status(500).json({ error: 'Your schedule could not be loaded. Please try again.' });
  }
});
const changeAssignment: RequestHandler = async (req, res) => {
  try {
    const assignmentId = req.params.assignmentId ? z.string().uuid().parse(req.params.assignmentId) : undefined;
    const actor = req.authUser!;
    const path = req.path.replace(/\/+$/, '');
    const result = !assignmentId ? await volunteerScheduleAction(actor, { kind: 'book', ...booking.parse(req.body) })
      : req.params.skipId ? await volunteerScheduleAction(actor, { kind: 'undo', assignmentId, skipId: z.string().uuid().parse(req.params.skipId) })
      : path.endsWith('/change') ? await volunteerScheduleAction(actor, { kind: 'change', assignmentId, ...booking.parse(req.body) })
      : path.endsWith('/drop') ? await volunteerScheduleAction(actor, { kind: 'drop', assignmentId })
      : await volunteerScheduleAction(actor, { kind: 'skip', assignmentId, ...skip.parse(req.body) });
    res.json(result);
  } catch (error) {
    if (error instanceof WorkflowError) { res.status(error.status).json({ error: error.message }); return; }
    if (error instanceof z.ZodError || error instanceof RangeError) { res.status(400).json({ error: 'Please choose a valid shift and calendar date.' }); return; }
    logger.error({ err: error }, 'Volunteer schedule change failed');
    res.status(500).json({ error: 'Your schedule was not changed. Please try again.' });
  }
};
router.post('/assignments', changeAssignment);
router.post('/assignments/:assignmentId/change', changeAssignment);
router.post('/assignments/:assignmentId/drop', changeAssignment);
router.post('/assignments/:assignmentId/skips', changeAssignment);
router.delete('/assignments/:assignmentId/skips/:skipId', changeAssignment);
export default router;
