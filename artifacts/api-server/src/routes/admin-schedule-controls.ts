import { Router } from 'express';
import { z } from 'zod';
import { adminScheduleAction, adminScheduleControls } from '../server/adminScheduleControls';
import { alertSettings, setAlertSettings } from '../server/coverageAlerts';
import { WorkflowError } from '../admin-volunteer-detail';
import { logger } from '../lib/logger';
const router = Router(), uuid = z.string().uuid();
const assign = z.object({ userId: uuid, slotId: uuid, startDate: z.string().optional(),
  override: z.boolean(), reason: z.string().trim().max(2000).optional() }).strict();
router.get('/schedule/controls', async (req, res) => {
  try { const filter = z.object({ userId: uuid.optional(), slotId: uuid.optional(), q: z.string().max(120).optional() }).strict().parse(req.query);
    res.set('Cache-Control', 'no-store').json(await adminScheduleControls(filter));
  } catch (err) { failure(err, res); }
});
router.get('/schedule/alerts', async (_req, res) => {
  try { res.set('Cache-Control', 'no-store').json(await alertSettings()); } catch (err) { failure(err, res); }
});
router.patch('/schedule/alerts', async (req, res) => {
  try { const body = z.object({ dailyDigestEnabled: z.boolean() }).strict().parse(req.body);
    res.json(await setAlertSettings(body.dailyDigestEnabled)); } catch (err) { failure(err, res); }
});
router.post('/schedule/assignments', async (req, res) => {
  try { res.json(await adminScheduleAction(req.authUser!, { kind: 'assign', ...assign.parse(req.body) })); }
  catch (err) { failure(err, res); }
});
router.post('/schedule/assignments/:assignmentId/:action', async (req, res) => {
  try {
    const assignmentId = uuid.parse(req.params.assignmentId);
    if (req.params.action === 'remove') {
      const body = z.object({ emailVolunteer: z.boolean() }).strict().parse(req.body);
      res.json(await adminScheduleAction(req.authUser!, { kind: 'remove', assignmentId, ...body }));
    } else if (req.params.action === 'skips') {
      const body = z.object({ date: z.string() }).strict().parse(req.body);
      res.json(await adminScheduleAction(req.authUser!, { kind: 'skip', assignmentId, ...body }));
    } else res.status(404).json({ error: 'Unknown scheduling action.' });
  } catch (err) { failure(err, res); }
});
router.delete('/schedule/assignments/:assignmentId/skips/:skipId', async (req, res) => {
  try { res.json(await adminScheduleAction(req.authUser!, { kind: 'undo',
    assignmentId: uuid.parse(req.params.assignmentId), skipId: uuid.parse(req.params.skipId) })); }
  catch (err) { failure(err, res); }
});
function failure(err: unknown, res: import('express').Response) {
  if (err instanceof WorkflowError) { res.status(err.status).json({ error: err.message }); return; }
  if (err instanceof z.ZodError || err instanceof RangeError) { res.status(400).json({ error: 'Enter valid scheduling fields and calendar dates.' }); return; }
  logger.error({ err }, 'Staff scheduling request failed');
  res.status(500).json({ error: 'We could not complete this request. Please try again.' });
}
export default router;
