import { Router, type RequestHandler } from 'express';
import { z } from 'zod/v4';
import { isQuickLoginEnabled, resetTestAccounts, testAccountList } from '../server/testAccounts';
import { WorkflowError } from '../admin-volunteer-detail';
import { enforceLimit } from '../auth/security';
const router = Router();
const handle = (fn: RequestHandler): RequestHandler => async (req, res, next) => {
  try { await fn(req, res, next); }
  catch (error) {
    if (error instanceof z.ZodError) { res.status(400).json({ error: 'Please send an empty reset request.' }); return; }
    if (error instanceof WorkflowError) { res.status(error.status).json({ error: error.message }); return; }
    next(error);
  }
};
router.get('/test-accounts', handle(async (_req, res) => {
  res.set('Cache-Control', 'no-store').json(await testAccountList());
}));
router.post('/test-accounts/reset', handle(async (req, res) => {
  if (!isQuickLoginEnabled()) { res.status(404).json({ error: 'Test accounts are not enabled.' }); return; }
  z.object({}).strict().parse(req.body);
  if (!await enforceLimit(req, res, 'qa-reset', req.authUser!.id, 60, 2)) return;
  await resetTestAccounts(req.authUser!.id);
  res.json(await testAccountList());
}));
export default router;
