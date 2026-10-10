import { Router, type RequestHandler } from 'express';
import { z } from 'zod/v4';
import { runScheduledCheck } from '../server/scheduled-check';
import { reminderJobStatus, runReminderCheck, sendTestReminder } from '../server/jobs';
import { logger } from '../lib/logger';

const handle = (fn: RequestHandler): RequestHandler => async (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  try { await fn(req, res, next); }
  catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ error: err.issues[0]?.message ?? 'Invalid input.' }); return; }
    logger.error({ err }, 'Reminder job request failed.');
    res.status(500).json({ error: 'The reminder check did not finish. It is safe to retry; confirmed reminders will not be repeated.' });
  }
};
function clock(query: unknown) {
  const input = z.object({ at: z.string().optional() }).strict().parse(query);
  if (!input.at) return new Date();
  if (process.env.NODE_ENV !== 'development') throw new z.ZodError([{ code: 'custom', input: input.at, path: ['at'], message: 'Clock overrides are development-only.' }]);
  const at = new Date(input.at);
  if (!Number.isFinite(at.getTime()) || !/T.*(?:Z|[+-]\d\d:\d\d)$/.test(input.at))
    throw new z.ZodError([{ code: 'custom', input: input.at, path: ['at'], message: 'Use an ISO timestamp with an explicit time zone.' }]);
  return at;
}
export const jobsTriggerRouter = Router();
jobsTriggerRouter.post('/jobs/run', handle(async (req, res) => {
  z.object({}).strict().parse(req.body ?? {});
  z.object({}).strict().parse(req.query);
  res.json(await runScheduledCheck());
}));
const router = Router();
router.get('/admin/notifications/jobs', handle(async (_req, res) => { res.json(await reminderJobStatus()); }));
router.post('/admin/notifications/jobs/run', handle(async (req, res) => {
  z.object({}).strict().parse(req.body ?? {});
  res.json(await runReminderCheck({ at: clock(req.query), source: 'admin' }));
}));
router.post('/admin/notifications/jobs/test', handle(async (req, res) => {
  const input = z.object({ requestId: z.uuid() }).strict().parse(req.body);
  res.json(await sendTestReminder(req.authUser!.id, input.requestId.toLowerCase()));
}));
export default router;
