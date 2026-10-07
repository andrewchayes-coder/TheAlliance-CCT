import { Router } from 'express';
import {
  ListVolunteerRosterQueryParams, ListVolunteerRosterResponse, GetAdminVolunteerParams, GetAdminVolunteerResponse,
  ExportVolunteerRosterQueryParams, ExportVolunteerScheduleQueryParams,
} from '@workspace/api-zod';
import { rosterSnapshot, filterRoster, rosterEntry, rosterSummary, rosterCsv, scheduleCsv } from '../admin-roster';
import { pacificDay } from '../volunteer-shifts';

const router = Router();
router.get('/volunteers', async (req, res): Promise<void> => {
  const parsed = ListVolunteerRosterQueryParams.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: 'Choose valid roster filters and pagination.' }); return; }
  const { limit = 25, offset = 0, ...filters } = parsed.data;
  const people = await rosterSnapshot();
  const matched = filterRoster(people, filters);
  res.set('Cache-Control', 'no-store').json(ListVolunteerRosterResponse.parse({
    volunteers: matched.slice(offset, offset + limit).map(rosterEntry),
    total: matched.length, limit, offset, summary: rosterSummary(people),
  }));
});
for (const kind of ['roster', 'schedule'] as const) {
  router.get(`/volunteers/${kind}.csv`, async (req, res): Promise<void> => {
    const schema = kind === 'roster' ? ExportVolunteerRosterQueryParams : ExportVolunteerScheduleQueryParams;
    const parsed = schema.safeParse(req.query);
    if (!parsed.success) { res.status(400).json({ error: 'Choose valid export filters.' }); return; }
    const now = new Date();
    const matched = filterRoster(await rosterSnapshot(now), parsed.data);
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'no-store',
      'Content-Disposition': `attachment; filename="alliance-${kind}-${pacificDay(now)}.csv"`,
      'X-Content-Type-Options': 'nosniff' });
    res.send(kind === 'roster' ? rosterCsv(matched) : scheduleCsv(matched));
  });
}
router.get('/volunteers/:userId', async (req, res): Promise<void> => {
  const parsed = GetAdminVolunteerParams.safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: 'Choose a valid volunteer.' }); return; }
  const person = (await rosterSnapshot()).find(row => row.user.id === parsed.data.userId);
  if (!person) { res.status(404).json({ error: 'Volunteer not found.' }); return; }
  res.set('Cache-Control', 'no-store').json(GetAdminVolunteerResponse.parse({
    entry: rosterEntry(person), adminNotes: person.profile.adminNotes, shifts: person.shifts,
  }));
});
export default router;
