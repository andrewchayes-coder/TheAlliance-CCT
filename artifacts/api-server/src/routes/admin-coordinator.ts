import { Router } from 'express';
import { z } from 'zod';
import { coordinatorSnapshot } from '../server/coordinatorRepository';
import { calendarDay } from '../server/scheduleService';
import { logger } from '../lib/logger';
const router = Router();
router.get(['/overview', '/schedule/week'], async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const week = req.path === '/schedule/week' ? z.string().min(1).parse(req.query.weekStart) : undefined;
    if (week) calendarDay(week);
    res.json(await coordinatorSnapshot(week));
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof RangeError) { res.status(400).json({ error: 'Choose a valid calendar date for the week.' }); return; }
    logger.error({ err: error }, 'Coordinator schedule read failed');
    res.status(500).json({ error: 'The schedule could not be loaded. Please try again.' });
  }
});
export default router;
