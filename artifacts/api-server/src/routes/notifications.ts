import { Router, type RequestHandler } from 'express';
import { z } from 'zod/v4';
import { db, appSettingsTable } from '@workspace/db';
import { eq } from 'drizzle-orm';
import { notificationSummary, listNotifications, retryNotification, testProviderEmail, NotificationError } from '../server/notification-log';
import { checkMonthlyEmailLimit, emailSettings } from '../server/monthly-email-limit';
import { logger } from '../lib/logger';

const router = Router();
const handle = (fn: RequestHandler): RequestHandler => async (req, res, next) => {
  try { await fn(req, res, next); }
  catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ error: err.issues[0]?.message ?? 'Invalid input.' }); return; }
    if (err instanceof NotificationError) { res.status(err.status).json({ error: err.message }); return; }
    logger.error({ err }, 'Notification log request failed.');
    res.status(500).json({ error: 'The notification operation did not finish. Refresh before retrying.' });
  }
};
const day = z.string().regex(/^\d{4}-\d\d-\d\d$/).refine(value => {
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, 'Choose a valid date.');
router.get('/admin/notifications/summary', handle(async (_req, res) => { res.json(await notificationSummary()); }));
router.get('/admin/notifications', handle(async (req, res) => {
  const input = z.object({ type: z.enum(['verification','password_reset','welcome','reminder','message','admin_alert','invite']).optional(),
    status: z.enum(['sent','logged','failed']).optional(), from: day.optional(), to: day.optional(),
    search: z.string().trim().max(254).optional(), page: z.coerce.number().int().min(1).max(100000).default(1) }).strict()
    .refine(v => !v.from || !v.to || v.from <= v.to, 'The end date must be on or after the start date.').parse(req.query);
  res.json(await listNotifications(input));
}));
router.patch('/admin/notifications/settings', handle(async (req, res) => {
  const input = z.object({ monthlyLimit: z.number().int().min(1).max(1000000) }).strict().parse(req.body);
  await emailSettings();
  await db.update(appSettingsTable).set({ postmarkMonthlyLimit: input.monthlyLimit, updatedAt: new Date() }).where(eq(appSettingsTable.id, 'schedule'));
  await checkMonthlyEmailLimit();
  res.json({ monthlyLimit: input.monthlyLimit });
}));
router.post('/admin/notifications/:id/retry', handle(async (req, res) => {
  z.object({}).strict().parse(req.body ?? {});
  res.json(await retryNotification(z.uuid().parse(req.params.id)));
}));
router.post('/admin/notifications/test', handle(async (req, res) => {
  const input = z.object({ requestId: z.uuid() }).strict().parse(req.body);
  res.json(await testProviderEmail(req.authUser!.id, input.requestId.toLowerCase()));
}));
export default router;
