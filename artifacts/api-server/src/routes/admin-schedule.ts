import { Router } from 'express';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db, shiftSlotsTable, closedDatesTable } from '@workspace/db';
import { scheduleSettings } from '../server/scheduleRepository';
import { updateSlot, copyMonday, lockSchedule } from '../server/scheduleMutations';
import { calendarDay } from '../server/scheduleService';
import { WorkflowError } from '../admin-volunteer-detail';
import { logger } from '../lib/logger';
const router = Router();
const time = z.string().regex(/^(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$/);
const fields = { dayOfWeek: z.number().int().min(1).max(5), startTime: time, endTime: time,
  capacity: z.number().int().min(1).max(10), label: z.string().trim().max(120).nullable(), isActive: z.boolean() };
const create = z.object(fields).strict().refine(v => v.endTime > v.startTime, { message: 'End time must be after start time on the same day.' });
const update = z.object({ ...fields, expectedUpdatedAt: z.string().datetime(), expectedAssignmentIds: z.array(z.string().uuid()).max(500),
  cancelRetirement: z.boolean().optional(), deactivation: z.object({
    mode: z.enum(['now', 'keep_until']), keepUntilDate: z.string().optional(),
  }).strict().optional() }).strict().refine(v => v.endTime > v.startTime, { message: 'End time must be after start time on the same day.' });
type AsyncHandler = (req: import('express').Request, res: import('express').Response) => Promise<void>;
const handle = (fn: AsyncHandler) => async (req: import('express').Request, res: import('express').Response) => {
  try { await fn(req, res); }
  catch (error) {
    if (error instanceof z.ZodError) { res.status(400).json({ error: error.issues[0]?.message ?? 'Check the entered fields.' }); return; }
    if (error instanceof RangeError) { res.status(400).json({ error: error.message }); return; }
    if (error instanceof WorkflowError) { res.status(error.status).json({ error: error.message }); return; }
    if ((error as { cause?: { code?: string } })?.cause?.code === '23505') { res.status(409).json({ error: 'That closed date already exists.' }); return; }
    logger.error({ err: error }, 'Schedule settings request failed');
    res.status(500).json({ error: 'We could not save the schedule. Please try again.' });
  }
};
router.get('/schedule/settings', handle(async (_req, res) => { res.json(await scheduleSettings()); }));
router.post('/schedule/slots', handle(async (req, res) => {
  const input = create.parse(req.body);
  await db.transaction(async tx => { await lockSchedule(tx); await tx.insert(shiftSlotsTable).values(input); });
  res.json(await scheduleSettings());
}));
router.patch('/schedule/slots/:slotId', handle(async (req, res) => {
  const id = z.string().uuid().parse(req.params.slotId), input = update.parse(req.body);
  const effect = await updateSlot(id, input, req.authUser!.id);
  res.json({ ...await scheduleSettings(), ...effect });
}));
router.post('/schedule/copy-monday', handle(async (_req, res) => {
  const addedSlotIds = await copyMonday();
  res.json({ ...await scheduleSettings(), addedSlotIds });
}));
router.post('/schedule/closed-dates', handle(async (req, res) => {
  const input = z.object({ date: z.string(), reason: z.string().trim().min(1).max(300) }).strict().parse(req.body);
  calendarDay(input.date);
  await db.insert(closedDatesTable).values(input);
  res.json(await scheduleSettings());
}));
router.delete('/schedule/closed-dates/:closedDateId', handle(async (req, res) => {
  const id = z.string().uuid().parse(req.params.closedDateId);
  const deleted = await db.delete(closedDatesTable).where(eq(closedDatesTable.id, id)).returning();
  if (!deleted.length) throw new WorkflowError(404, 'This closed date was already removed. Refresh the list.');
  res.json(await scheduleSettings());
}));
export default router;
