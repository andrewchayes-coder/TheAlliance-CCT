import { beforeAll, afterAll, expect, it, vi } from 'vitest';
import express from 'express';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { eq, inArray } from 'drizzle-orm';
import { db, usersTable as users, volunteerProfilesTable as profiles, volunteerHoursTable as hours } from '@workspace/db';
import { apiAccessPolicy } from '../auth/access-policy';
import reportsRouter from '../routes/reports';
import { GetAdminHoursReportResponse } from '@workspace/api-zod';

vi.hoisted(() => { process.env.NODE_ENV = 'development'; });
let server: Server, base: string, admin: string, volunteer: string, testUser: string, profile: string, testProfile: string;
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
  await db.insert(hours).values([{ volunteerProfileId: profile, shiftDate: '2026-10-31', source: 'other',
    hours: '2.25', note: '=DANGER', enteredByUserId: admin },
  { volunteerProfileId: testProfile, shiftDate: '2026-10-31', source: 'other',
    hours: '3.5', note: 'Test entry', enteredByUserId: admin }]);
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
    await db.delete(hours).where(inArray(hours.volunteerProfileId, [profile, testProfile]));
    await db.delete(profiles).where(inArray(profiles.id, [profile, testProfile]));
  }
  if (admin) await db.delete(users).where(inArray(users.id, [admin, volunteer, testUser]));
});
async function call(path: string, user = admin, query = 'month=2026-10') {
  return fetch(`${base}/${path}?${query}&at=${encodeURIComponent(at)}`, { headers: { 'x-fixture-user': user } });
}
it.each(['hours', 'hours.csv', 'hour-entries.csv'])('requires an active verified admin on %s', async path => {
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
it.each(['hours', 'hours.csv', 'hour-entries.csv'])('rejects future/invalid months and flags with 400 for %s', async path => {
  expect((await call(path, admin, 'month=2026-11')).status).toBe(400);
  expect((await call(path, admin, 'month=2026-99')).status).toBe(400);
  expect((await call(path, admin, 'includeTest=no')).status).toBe(400);
});
it('CSV filenames, headers, formula escaping and total row match the selected month', async () => {
  const summary = await call('hours.csv');
  expect(summary.status).toBe(200);
  expect(summary.headers.get('content-disposition')).toBe('attachment; filename="alliance-hours-by-volunteer-2026-10.csv"');
  expect(summary.headers.get('content-type')).toContain('text/csv');
  expect(summary.headers.get('cache-control')).toBe('no-store');
  const text = await summary.text();
  expect(text).toContain('"Volunteer","Email","Status","Hours logged"');
  expect(text).toContain("\"'=CSV volunteer\"");
  expect(text).toContain('"Team total"');
  expect(text).not.toContain(`${tag}-test@`);
  const details = await call('hour-entries.csv');
  expect(details.headers.get('content-disposition')).toBe('attachment; filename="alliance-hour-entries-2026-10.csv"');
  const csv = await details.text();
  expect(csv).toContain('"Date","Volunteer","Shift","Hours","Entered by","Note","Last changed"');
  expect(csv).toContain("\"'=DANGER\"");
  expect(csv).toContain('"Report admin"');
});
it('rejects the development clock outside development without executing a report query', async () => {
  const prior = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try { expect((await call('hours')).status).toBe(400); }
  finally { process.env.NODE_ENV = prior; }
});
