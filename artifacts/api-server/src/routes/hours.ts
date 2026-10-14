import { Router } from 'express';
import { z } from 'zod';
import { appConfig } from '@workspace/shared/appConfig';
import { GetVolunteerHoursResponse, GetAdminVolunteerHoursResponse,
  PutVolunteerHoursResponse, AddAdminVolunteerHoursResponse, UpdateAdminVolunteerHoursResponse } from '@workspace/api-zod';
import { developmentClock } from '../server/development-clock';
import { addCalendarDays, pacificDay } from '../server/scheduleService';
import { adminHours, HoursError, removeHours, saveHours, volunteerHours } from '../server/hoursRepository';
import { logger } from '../lib/logger';

const router = Router();
router.use(['/volunteer/hours', '/admin/volunteers/:userId/hours'], (_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  if (!appConfig.hoursLogging) { res.status(404).json({ error: 'Hour logging is not available.' }); return; }
  next();
});
function uuid(value: unknown) { return z.string().uuid().parse(value); }
function fail(res: import('express').Response, error: unknown) {
  if (error instanceof HoursError) { res.status(error.status).json({ error: error.message }); return; }
  if (error instanceof z.ZodError || error instanceof RangeError) {
    res.status(422).json({ error: error instanceof RangeError ? error.message : 'Please check the hours request.' }); return;
  }
  logger.error({ err: error }, 'Hours request failed');
  res.status(500).json({ error: 'Your hours could not be saved or loaded. Please try again.' });
}
router.get('/volunteer/hours', async (req, res) => {
  try { res.json(GetVolunteerHoursResponse.parse(await volunteerHours(req.session.userId!, developmentClock(req.query.at)))); }
  catch (error) { fail(res, error); }
});
router.put('/volunteer/hours', async (req, res) => {
  try { res.json(PutVolunteerHoursResponse.parse(await saveHours(req.session.userId!, req.session.userId!, req.body, developmentClock(req.query.at)))); }
  catch (error) { fail(res, error); }
});
router.get('/admin/volunteers/:userId/hours', async (req, res) => {
  try {
    const now = developmentClock(req.query.at);
    const query = z.object({ from: z.string().optional(), to: z.string().optional() }).parse(req.query);
    const range = { from: query.from ?? addCalendarDays(pacificDay(now), -89), to: query.to ?? pacificDay(now) };
    res.json(GetAdminVolunteerHoursResponse.parse(await adminHours(uuid(req.params.userId), now, range)));
  } catch (error) { fail(res, error); }
});
router.post('/admin/volunteers/:userId/hours', async (req, res) => {
  try { res.status(201).json(AddAdminVolunteerHoursResponse.parse(await saveHours(uuid(req.params.userId), req.session.userId!, req.body, developmentClock(req.query.at), true))); }
  catch (error) { fail(res, error); }
});
router.patch('/admin/volunteers/:userId/hours/:id', async (req, res) => {
  try { res.json(UpdateAdminVolunteerHoursResponse.parse(await saveHours(uuid(req.params.userId), req.session.userId!, req.body, developmentClock(req.query.at), true, uuid(req.params.id)))); }
  catch (error) { fail(res, error); }
});
router.delete('/admin/volunteers/:userId/hours/:id', async (req, res) => {
  try {
    developmentClock(req.query.at);
    await removeHours(uuid(req.params.userId), req.session.userId!, uuid(req.params.id));
    res.status(204).end();
  } catch (error) { fail(res, error); }
});
export default router;
