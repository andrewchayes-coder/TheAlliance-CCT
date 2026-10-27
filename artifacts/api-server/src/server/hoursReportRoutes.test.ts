import { beforeAll, afterAll, expect, it, vi } from 'vitest';
import express from 'express';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { eq, inArray } from 'drizzle-orm';
import { db, usersTable as users, volunteerProfilesTable as profiles, volunteerHoursTable as hours,
  shiftSlotsTable as slots, shiftAssignmentsTable as assignments } from '@workspace/db';
import { apiAccessPolicy } from '../auth/access-policy';
import reportsRouter from '../routes/reports';
import { GetAdminHoursReportResponse } from '@workspace/api-zod';
import ExcelJS from 'exceljs';

vi.hoisted(() => { process.env.NODE_ENV = 'development'; });
let server: Server, base: string, admin: string, volunteer: string, testUser: string, profile: string, testProfile: string;
let adminProfile: string, staffSlot: string;
const tag = `report-${randomUUID()}`;
const at = '2026-11-01T01:00:00Z';
beforeAll(async () => {
  const created = await db.insert(users).values(['admin', 'volunteer', 'test'].map(kind => ({
    firstName: kind === 'volunteer' ? '=CSV' : 'Report', lastName: kind, passwordHash: 'unusable',
    email: `${tag}-${kind}@example.invalid`, emailVerifiedAt: new Date(),
    role: kind === 'admin' ? 'admin' as const : 'volunteer' as const, isTestAccount: kind === 'test',
  }))).returning();
  [admin, volunteer, testUser] = created.map(p => p.id) as [string, string, string];
  const ps = await db.insert(profiles).values([volunteer, testUser].map(userId => ({
    userId, status: 'inactive' as const,
  }))).returning();
  [profile, testProfile] = ps.map(p => p.id) as [string, string];
  const [staffProfile] = await db.insert(profiles).values({ userId: admin, status: 'active' }).returning();
  adminProfile = staffProfile!.id;
  const [slot] = await db.insert(slots).values({ dayOfWeek: 5, startTime: '14:00', endTime: '16:00', capacity: 2 }).returning();
  staffSlot = slot!.id;
  await db.insert(assignments).values({ volunteerProfileId: adminProfile, shiftSlotId: staffSlot, startDate: '2026-10-01', createdByUserId: admin });
  await db.insert(hours).values([{ volunteerProfileId: profile, shiftDate: '2026-10-31', source: 'other',
    hours: '2.25', note: '=DANGER', enteredByUserId: admin },
  { volunteerProfileId: testProfile, shiftDate: '2026-10-31', source: 'other',
    hours: '3.5', note: 'Test entry', enteredByUserId: admin },
  { volunteerProfileId: adminProfile, shiftDate: '2026-10-31', source: 'other',
    hours: '9', note: 'STAFF-REPORT-EXCLUDED', enteredByUserId: admin }]);
  const app = express();
  app.use('/api', (req, _res, next) => {
    req.session = { userId: String(req.headers['x-fixture-user'] || ''), authVersion: 0 } as any; next();
  }, apiAccessPolicy, reportsRouter);
  server = await new Promise<Server>(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/admin/reports`;
});
afterAll(async () => {
  if (server) await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve()));
  if (profile && testProfile) {
    await db.delete(hours).where(inArray(hours.volunteerProfileId, [profile, testProfile, adminProfile]));
    await db.delete(assignments).where(eq(assignments.volunteerProfileId, adminProfile));
    await db.delete(profiles).where(inArray(profiles.id, [profile, testProfile, adminProfile]));
    await db.delete(slots).where(eq(slots.id, staffSlot));
  }
  if (admin) await db.delete(users).where(inArray(users.id, [admin, volunteer, testUser]));
});
async function call(path: string, user = admin, query = 'month=2026-10') {
  return fetch(`${base}/${path}?${query}&at=${encodeURIComponent(at)}`, { headers: { 'x-fixture-user': user } });
}
it.each(['hours', 'hours.csv', 'hour-entries.csv', 'hours.xlsx', 'hour-entries.xlsx'])('requires an active verified admin on %s', async path => {
  expect((await call(path, '')).status).toBe(401);
  expect((await call(path, volunteer)).status).toBe(403);
});
it('returns numeric hours, includes inactive users and opt-in test accounts using the same JSON contract', async () => {
  const response = await call('hours');
  expect(response.status).toBe(200);
  const body = GetAdminHoursReportResponse.parse(await response.json());
  expect(body.month).toBe('2026-10');
  expect(body.currentMonth).toBe('2026-10');
  expect(body.volunteers.find((v: any) => v.userId === volunteer)).toMatchObject({
    hours: 2.25, otherEntries: 1, shiftsLogged: 0, status: 'inactive', isTestAccount: false });
  expect(body.volunteers.some((v: any) => v.userId === testUser)).toBe(false);
  const included = GetAdminHoursReportResponse.parse(await (await call('hours', admin, 'month=2026-10&includeTest=true')).json());
  expect(included.volunteers.find((v: any) => v.userId === testUser)).toMatchObject({ hours: 3.5, isTestAccount: true });
});
it.each(['hours', 'hours.csv', 'hour-entries.csv', 'hours.xlsx', 'hour-entries.xlsx'])('rejects future/invalid months and flags with 400 for %s', async path => {
  expect((await call(path, admin, 'month=2026-11')).status).toBe(400);
  expect((await call(path, admin, 'month=2026-99')).status).toBe(400);
  expect((await call(path, admin, 'includeTest=no')).status).toBe(400);
  for (const query of ['startDate=2026-10-01', 'endDate=2026-10-31',
    'startDate=2026-02-30&endDate=2026-10-31', 'startDate=2026-10-31&endDate=2026-10-01',
    'startDate=2026-10-01&endDate=2026-11-01', 'month=2026-10&startDate=2026-10-01&endDate=2026-10-31']) {
    const response = await call(path, admin, query);
    expect(response.status).toBe(400);
    expect(response.headers.get('cache-control')).toBe('no-store');
  }
});
it('CSV filenames, headers, formula escaping and total row match the selected month', async () => {
  const summary = await call('hours.csv');
  expect(summary.status).toBe(200);
  expect(summary.headers.get('content-disposition')).toBe('attachment; filename="alliance-hours-by-volunteer-2026-10-01-to-2026-10-31.csv"');
  expect(summary.headers.get('content-type')).toContain('text/csv');
  expect(summary.headers.get('cache-control')).toBe('no-store');
  const text = await summary.text();
  expect(text).toContain('"Volunteer","Email","Status","Hours logged"');
  expect(text).toContain("\"'=CSV volunteer\"");
  expect(text).toContain('"Team total"');
  expect(text).not.toContain(`${tag}-test@`);
  const details = await call('hour-entries.csv');
  expect(details.headers.get('content-disposition')).toBe('attachment; filename="alliance-hour-entries-2026-10-01-to-2026-10-31.csv"');
  const csv = await details.text();
  expect(csv).toContain('"Date","Volunteer","Shift","Hours","Entered by","Note","Last changed"');
  expect(csv).toContain("\"'=DANGER\"");
  expect(csv).toContain('"Report admin"');
});
it('uses inclusive service dates and identical records across JSON, CSV and Excel, with test opt-in', async () => {
  for (const includeTest of [false, true]) {
    const query = `startDate=2026-10-30&endDate=2026-10-31&includeTest=${includeTest}`;
    const response = await call('hours', admin, query);
    const body = GetAdminHoursReportResponse.parse(await response.json());
    expect(body.volunteers.some(v => v.userId === admin)).toBe(false);
    expect(body.totals.teamHours).toBe(includeTest ? 5.75 : 2.25);
    expect(body.totals.shiftsNotLogged).toBe(0);
    expect(body.period).toMatchObject({ startDate: '2026-10-30', endDate: '2026-10-31', timezone: 'America/Los_Angeles', mode: 'range' });
    expect(body.trend).toHaveLength(1);
    expect(body.trend[0]!.partial).toBe(true);
    for (const [kind, filename] of [['hours', 'hours-by-volunteer'], ['hour-entries', 'hour-entries']]) {
      const xlsx = await call(`${kind}.xlsx`, admin, query);
      expect(xlsx.status).toBe(200);
      expect(xlsx.headers.get('cache-control')).toBe('no-store');
      expect(xlsx.headers.get('content-type')).toContain('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      expect(xlsx.headers.get('content-disposition')).toBe(`attachment; filename="alliance-${filename}-2026-10-30-to-2026-10-31.xlsx"`);
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(await xlsx.arrayBuffer());
      const sheet = workbook.worksheets[0]!;
      const rows = sheet.getSheetValues().slice(1) as unknown[][];
      const flat = rows.flat();
      expect(flat).not.toContain('STAFF-REPORT-EXCLUDED');
      if (kind === 'hours') expect(flat).not.toContain('Report admin');
      expect(flat).toContain('=CSV volunteer');
      expect(flat.includes('Report test')).toBe(includeTest);
      expect(flat).toContain(2.25);
      sheet.eachRow(row => row.eachCell(cell => expect(cell.formula).toBeUndefined()));
      if (kind === 'hours') {
        expect(sheet.getCell(sheet.rowCount, 4).value).toBe(body.totals.teamHours);
        expect(sheet.rowCount).toBe(body.volunteers.length + 2);
      } else {
        expect(flat).toContain('=DANGER');
        expect(sheet.rowCount).toBe(body.totals.otherEntries + body.totals.shiftsLogged + 1);
      }
      const csv = await (await call(`${kind}.csv`, admin, query)).text();
      expect(csv).not.toContain('STAFF-REPORT-EXCLUDED');
      if (kind === 'hours') expect(csv).not.toContain('Report admin');
      expect(csv).toContain("\"'=CSV volunteer\"");
      expect(csv.includes('Report test')).toBe(includeTest);
    }
  }
  const empty = await call('hours', admin, 'startDate=2026-09-01&endDate=2026-09-01');
  expect(GetAdminHoursReportResponse.parse(await empty.json()).volunteers.some(v => v.userId === volunteer)).toBe(false);
});
it('rejects the development clock outside development without executing a report query', async () => {
  const prior = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try { expect((await call('hours')).status).toBe(400); }
  finally { process.env.NODE_ENV = prior; }
});
