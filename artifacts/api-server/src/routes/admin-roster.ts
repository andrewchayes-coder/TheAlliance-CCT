import { Router } from 'express';
import {
  ListVolunteerRosterQueryParams, ListVolunteerRosterResponse, GetAdminVolunteerParams,
  ExportVolunteerRosterQueryParams, ExportVolunteerScheduleQueryParams,
} from '@workspace/api-zod';
import { rosterSnapshot, filterRoster, sortRoster, rosterEntry, rosterSummary, rosterCsv, scheduleCsv } from '../admin-roster';
import { pacificDay } from '../volunteer-shifts';
import { loadAdminVolunteerDetail, WorkflowError } from '../admin-volunteer-detail';

const router = Router();
router.get('/volunteers', async (req, res): Promise<void> => {
  const parsed = ListVolunteerRosterQueryParams.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: 'Choose valid roster filters and pagination.' }); return; }
  const { limit = 25, offset = 0, ...filters } = parsed.data;
  const people = await rosterSnapshot();
  const matched = sortRoster(filterRoster(people, filters),filters);
  const selectable = people.filter(person=>!person.user.isTestAccount || filters.showTestAccounts === 'true');
  res.set('Cache-Control', 'no-store').json(ListVolunteerRosterResponse.parse({
    volunteers: matched.slice(offset, offset + limit).map(rosterEntry),
    total: matched.length, limit, offset, summary: rosterSummary(people),
    cities:[...new Set(selectable.map(person=>person.profile.city).filter((value):value is string=>!!value))].sort(),
    counties:[...new Set(selectable.map(person=>person.profile.county).filter((value):value is string=>!!value))].sort(),
  }));
});
for (const kind of ['roster', 'schedule'] as const) {
  router.get(`/volunteers/${kind}.csv`, async (req, res): Promise<void> => {
    const schema = kind === 'roster' ? ExportVolunteerRosterQueryParams : ExportVolunteerScheduleQueryParams;
    const parsed = schema.safeParse(req.query);
    if (!parsed.success) { res.status(400).json({ error: 'Choose valid export filters.' }); return; }
    const now = new Date();
    const filtered = filterRoster(await rosterSnapshot(now), parsed.data);
    const matched = kind === 'roster' ? sortRoster(filtered,parsed.data) : filtered;
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'no-store',
      'Content-Disposition': `attachment; filename="alliance-${kind}-${pacificDay(now)}.csv"`,
      'X-Content-Type-Options': 'nosniff' });
    res.send(kind === 'roster' ? rosterCsv(matched) : scheduleCsv(matched));
  });
}
router.get('/volunteers/:userId', async (req, res): Promise<void> => {
  const parsed = GetAdminVolunteerParams.safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: 'Choose a valid volunteer.' }); return; }
  try { res.set('Cache-Control', 'no-store').json(await loadAdminVolunteerDetail(parsed.data.userId)); }
  catch (error) {
    if (error instanceof WorkflowError) { res.status(error.status).json({ error: error.message }); return; }
    throw error;
  }
});
export default router;
