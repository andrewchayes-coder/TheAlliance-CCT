import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { pool } from '@workspace/db';
import { createReadinessCheck } from '../server/readiness';

const router: IRouter = Router();
const readiness = createReadinessCheck(
  () => pool.query('SELECT 1'),
  () => Boolean(process.env.POSTMARK_SERVER_TOKEN?.trim() && process.env.EMAIL_FROM?.trim()),
);
router.get('/health', async (_req, res) => {
  const result = await readiness();
  res.set('Cache-Control', 'no-store').status(result.status === 'ok' ? 200 : 503).json(result);
});

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

export default router;
