import { Router, type Request, type Response } from 'express';
import { enforceLimit } from '../auth/security';
import { z } from 'zod/v4';
import { logger } from '../lib/logger';
import { WorkflowError } from '../admin-volunteer-detail';
import { findMessageVolunteers, listMessages, messageContext, messageDetail, messageDraftSchema, messageSendSchema,
  previewMessage, sendMessage } from '../server/messaging';
const router = Router();
function fail(error: unknown, res: Response) {
  if (error instanceof z.ZodError) { res.status(400).json({ error: error.issues[0]?.message ?? 'Please check your message.' }); return; }
  if (error instanceof WorkflowError) { res.status(error.status).json({ error: error.message }); return; }
  logger.error({ err: error }, 'Messaging request failed');
  res.status(500).json({ error: 'We could not complete this request. If you were sending, retry the same draft to avoid duplicates.' });
}
function handle(fn: (req: Request) => Promise<unknown>) {
  return async (req: Request, res: Response) => { try { res.set('Cache-Control', 'no-store').json(await fn(req)); } catch (error) { fail(error, res); } };
}
router.get('/admin/messages', handle(req => listMessages(z.object({ userId: z.uuid().optional() }).parse(req.query).userId)));
router.post('/admin/messages/preview', handle(req => previewMessage(messageDraftSchema.parse(req.body))));
router.post('/admin/messages', async (req, res, next) => {
  if (!await enforceLimit(req, res, 'message-send-user', req.authUser!.id, 3600, 20)) return;
  if (!await enforceLimit(req, res, 'message-send-ip', req.ip ?? 'unknown', 3600, 60)) return;
  next();
}, handle(req => sendMessage(req.authUser!, messageSendSchema.parse(req.body))));
router.get('/admin/messages/volunteers', handle(req => {
  const q = z.object({ q: z.string().trim().max(120).optional(), ids: z.string().max(18500).optional() }).strict().parse(req.query);
  const ids = q.ids ? z.array(z.uuid()).min(1).max(500).parse(q.ids.split(',')) : undefined;
  return findMessageVolunteers({ q: q.q, ids });
}));
router.get('/admin/messages/:messageId', handle(req => messageDetail(z.uuid().parse(req.params.messageId))));
router.get('/volunteer/messages/context', handle(req => messageContext(req.authUser!.id)));
export default router;
