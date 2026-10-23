import { Router, type RequestHandler } from 'express';
import { z } from 'zod/v4';
import { takeLimit } from '../auth/security';
import { calendarNotFound, findCalendar, renderCalendar, recordCalendarFetch, volunteerCalendar } from '../server/calendarFeed';

export const calendarFeedRouter = Router();
export const volunteerCalendarRouter = Router();
const feed: RequestHandler = async (req, res) => {
  const file = String(req.params.file);
  const valid = /^[A-Za-z0-9_-]{43}\.ics$/.test(file);
  // A lookup also happens for malformed URLs, avoiding an early-return timing oracle.
  const calendar = await findCalendar(valid ? file.slice(0, -4) : '');
  const limit = calendar
    ? await takeLimit('calendar-token', calendar.tokenHash, 3600, 120)
    : await takeLimit('calendar-unknown-ip', req.ip ?? 'unknown', 3600, 30);
  if (!limit.allowed) {
    res.setHeader('Retry-After', limit.retryAfterSeconds);
    res.status(429).type('text/plain').send('Please wait before checking this calendar again.'); return;
  }
  if (!valid || !calendar) { res.status(404).type('text/plain').send(calendarNotFound); return; }
  const body = await renderCalendar(calendar);
  if (req.method !== 'HEAD') await recordCalendarFetch(calendar.id, req.get('User-Agent'));
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', 'inline; filename="cct-shifts.ics"');
  res.send(body); // Express suppresses the body for HEAD, retaining identical headers.
};
calendarFeedRouter.head('/calendar/:file', feed);
calendarFeedRouter.get('/calendar/:file', feed);
volunteerCalendarRouter.get('/calendar', async (req, res) => {
  res.json(await volunteerCalendar(req.authUser!.id));
});
volunteerCalendarRouter.post('/calendar/reset', async (req, res) => {
  if (!z.object({}).strict().safeParse(req.body ?? {}).success) {
    res.status(400).json({ error: 'No fields are needed to reset your calendar link.' }); return;
  }
  res.json(await volunteerCalendar(req.authUser!.id, true));
});
