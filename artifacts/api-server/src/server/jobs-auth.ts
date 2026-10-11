import { createHash, timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';

/** Machine caller only. Not a session or CSRF exemption for any other route. */
export const requireJobsSecret: RequestHandler = (req, res, next) => {
  const expected = process.env.JOBS_SECRET;
  if (!expected || expected.length < 32) {
    res.status(503).json({ error: 'The scheduled trigger is not configured.' }); return;
  }
  const supplied = req.get('X-Jobs-Secret');
  if (!supplied || supplied.length > 1024 ||
    !timingSafeEqual(createHash('sha256').update(expected).digest(), createHash('sha256').update(supplied).digest())) {
    res.status(401).json({ error: 'Unauthorized.' }); return;
  }
  next();
};
