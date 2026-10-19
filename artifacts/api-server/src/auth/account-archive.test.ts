import { beforeAll, afterAll, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { db, usersTable as users, volunteerProfilesTable as profiles, volunteerHoursTable as hours,
  shiftSlotsTable as slots, shiftAssignmentsTable as assignments, customShiftsTable as customs,
  customShiftAssignmentsTable as claims, activityLogTable as activity, authTokensTable as tokens,
  sessionsTable as sessions } from '@workspace/db';
import { apiAccessPolicy } from './access-policy';
import adminRouter from '../routes/admin';
import rosterRouter from '../routes/admin-roster';
import reportsRouter from '../routes/reports';
import { findMessageVolunteers } from '../server/messaging';
import { pacificDay } from '../server/scheduleService';
vi.mock('../uncovered-shifts', () => ({ onAssignmentsReleased: vi.fn() }));
vi.hoisted(() => { process.env.NODE_ENV = 'development'; });

let server: Server, base: string, admin: string, secondAdmin: string, qaAdmin: string, volunteer: string, profile: string, slot: string, custom: string;
const owned: string[] = [];
const today = pacificDay(new Date()), month = today.slice(0, 7);
async function call(actor: string | undefined, path: string, method = 'GET', data?: unknown) {
  const response = await fetch(`${base}/api${path}`, { method,
    headers: { 'content-type': 'application/json', ...(actor ? { 'x-fixture-user': actor } : {}) },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
  return { status: response.status, body: await response.json() as Record<string, any> };
}
beforeAll(async () => {
  for (const [role, test] of [['admin', false], ['admin', false], ['admin', true], ['volunteer', false]] as const) {
    const [u] = await db.insert(users).values({ email: `archive-${randomUUID()}@example.invalid`, firstName: 'Archive', lastName: 'Fixture',
      role, isTestAccount: test, passwordHash: 'fixture-only', emailVerifiedAt: new Date() }).returning();
    owned.push(u!.id);
  }
  [admin, secondAdmin, qaAdmin, volunteer] = owned as [string, string, string, string];
  const [p] = await db.insert(profiles).values({ userId: volunteer, status: 'active' }).returning(); profile = p!.id;
  const [s] = await db.insert(slots).values({ dayOfWeek: 1, startTime: '09:00', endTime: '11:00', capacity: 2 }).returning(); slot = s!.id;
  await db.insert(assignments).values({ volunteerProfileId: profile, shiftSlotId: slot, startDate: today, createdByUserId: admin });
  const [c] = await db.insert(customs).values({ date: '2099-10-20', startTime: '13:00', endTime: '15:00', capacity: 1,
    label: 'Archive fixture', openToVolunteers: true, createdByUserId: admin }).returning(); custom = c!.id;
  await db.insert(claims).values({ volunteerProfileId: profile, customShiftId: custom, createdByUserId: admin });
  await db.insert(hours).values({ volunteerProfileId: profile, shiftDate: today, source: 'other', hours: '1.50',
    note: 'Preserve this history', enteredByUserId: admin });
  await db.insert(tokens).values({ userId: volunteer, type: 'password_reset', tokenHash: randomUUID(), expiresAt: new Date(Date.now() + 3600000) });
  await db.insert(sessions).values({ sid: `archive-${volunteer}`, sess: { userId: volunteer }, expire: new Date(Date.now() + 3600000) });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.session = { userId: req.get('x-fixture-user'), authVersion: 0 } as typeof req.session; next(); });
  app.use('/api', apiAccessPolicy);
  app.use('/api/admin', adminRouter, rosterRouter);
  app.use('/api', reportsRouter);
  app.get('/api/me', (req, res) => res.json({ id: req.authUser!.id }));
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(async () => {
  if (server) await new Promise<void>(resolve => server.close(() => resolve()));
  if (!owned.length) return;
  await db.delete(sessions).where(eq(sessions.sid, `archive-${volunteer}`));
  await db.delete(tokens).where(inArray(tokens.userId, owned));
  await db.delete(activity).where(eq(activity.volunteerProfileId, profile));
  await db.delete(hours).where(eq(hours.volunteerProfileId, profile));
  await db.delete(claims).where(eq(claims.customShiftId, custom));
  await db.delete(customs).where(eq(customs.id, custom));
  await db.delete(assignments).where(eq(assignments.volunteerProfileId, profile));
  await db.delete(slots).where(eq(slots.id, slot));
  await db.delete(profiles).where(eq(profiles.id, profile));
  await db.delete(users).where(inArray(users.id, owned));
});
it('requires admin, validates input and protects self and built-in QA accounts', async () => {
  const path = `/users/${volunteer}/archive`;
  expect((await call(undefined, `/admin${path}`, 'PATCH', { archived: true })).status).toBe(401);
  expect((await call(volunteer, `/admin${path}`, 'PATCH', { archived: true })).status).toBe(403);
  for (const data of [{}, { archived: 'true' }, { archived: true, isActive: true }])
    expect((await call(admin, `/admin${path}`, 'PATCH', data)).status).toBe(400);
  expect((await call(admin, `/admin/users/${admin}/archive`, 'PATCH', { archived: true })).body.code).toBe('SELF_DEACTIVATION');
  expect((await call(admin, `/admin/users/${qaAdmin}/archive`, 'PATCH', { archived: true })).body.code).toBe('TEST_ACCOUNT');
});
it('archives atomically, revokes access, releases future assignments and preserves hours/profile', async () => {
  expect((await call(volunteer, '/me')).status).toBe(200);
  const result = await call(admin, `/admin/users/${volunteer}/archive`, 'PATCH', { archived: true });
  expect(result.status).toBe(200);
  expect(result.body).toMatchObject({ id: volunteer, isActive: false });
  expect(result.body.archivedAt).toBeTruthy();
  expect((await call(volunteer, '/me')).status).toBe(401);
  expect(await db.select().from(sessions).where(eq(sessions.sid, `archive-${volunteer}`))).toHaveLength(0);
  expect((await db.select().from(tokens).where(eq(tokens.userId, volunteer))).every(t => !!t.usedAt)).toBe(true);
  expect(await db.select().from(hours).where(eq(hours.volunteerProfileId, profile))).toHaveLength(1);
  expect(await db.select().from(profiles).where(eq(profiles.id, profile))).toHaveLength(1);
  expect((await db.select().from(assignments).where(eq(assignments.volunteerProfileId, profile)))[0]).toMatchObject({ endedReason: 'admin_removed', endDate: today });
  expect((await db.select().from(claims).where(eq(claims.customShiftId, custom)))[0]!.cancelledAt).toBeTruthy();
  expect((await call(admin, `/admin/users/${volunteer}/status`, 'PATCH', { isActive: true })).body.code).toBe('ACCOUNT_ARCHIVED');
  expect((await call(admin, `/admin/users/${volunteer}/archive`, 'PATCH', { archived: true })).status).toBe(200);
  expect(await db.select().from(activity).where(and(eq(activity.volunteerProfileId, profile), eq(activity.action, 'account_archived')))).toHaveLength(1);
});
it('hides archived accounts from default team/roster/CSV/messaging, exposes filters and retains reporting', async () => {
  const directory = async (archive: string) => (await call(admin, `/admin/users?role=volunteer&archive=${archive}`)).body.users;
  expect((await directory('current')).some((u: { id: string }) => u.id === volunteer)).toBe(false);
  expect((await directory('archived')).some((u: { id: string }) => u.id === volunteer)).toBe(true);
  const roster = (await call(admin, '/admin/volunteers?archive=archived')).body;
  expect(roster.volunteers.some((v: { user: { id: string } }) => v.user.id === volunteer)).toBe(true);
  expect((await call(admin, '/admin/volunteers')).body.volunteers.some((v: { user: { id: string } }) => v.user.id === volunteer)).toBe(false);
  expect((await findMessageVolunteers({ ids: [volunteer] }))).toHaveLength(0);
  const report = (await call(admin, `/admin/reports/hours?month=${month}`)).body;
  expect(report.volunteers.find((v: { userId: string }) => v.userId === volunteer)?.hours).toBe(1.5);
  const [u] = await db.select().from(users).where(eq(users.id, volunteer));
  const csv = await fetch(`${base}/api/admin/volunteers/roster.csv`, { headers: { 'x-fixture-user': admin } });
  expect(await csv.text()).not.toContain(u!.email);
  expect((await call(admin, '/admin/users?role=volunteer&archive=bad')).status).toBe(400);
});
it('restores visibility without reactivating access or resurrecting released shifts', async () => {
  const result = await call(admin, `/admin/users/${volunteer}/archive`, 'PATCH', { archived: false });
  expect(result.status).toBe(200);
  expect(result.body).toMatchObject({ archivedAt: null, isActive: false });
  expect((await call(admin, '/admin/users?role=volunteer')).body.users.some((u: { id: string }) => u.id === volunteer)).toBe(true);
  expect((await call(volunteer, '/me')).status).toBe(401);
  expect((await db.select().from(assignments).where(eq(assignments.volunteerProfileId, profile)))[0]!.endedReason).toBe('admin_removed');
  expect(await db.select().from(hours).where(eq(hours.volunteerProfileId, profile))).toHaveLength(1);
  expect((await call(admin, `/admin/users/${volunteer}/status`, 'PATCH', { isActive: true })).status).toBe(200);
  expect((await call(admin, `/admin/users/${volunteer}/archive`, 'PATCH', { archived: false })).body.isActive).toBe(true);
});
it('protects the last real administrator even when the actor is a QA admin', async () => {
  await db.update(users).set({ isActive: false }).where(eq(users.id, secondAdmin));
  const active = await db.select().from(users).where(and(eq(users.role, 'admin'), eq(users.isActive, true), eq(users.isTestAccount, false)));
  expect(active).toHaveLength(1);
  expect((await call(qaAdmin, `/admin/users/${admin}/archive`, 'PATCH', { archived: true })).body.code).toBe('LAST_ADMIN');
});
it('archiving an already-inactive account still revokes pending authentication tokens', async () => {
  expect((await call(admin, `/admin/users/${volunteer}/status`, 'PATCH', { isActive: false })).status).toBe(200);
  await db.insert(tokens).values({ userId: volunteer, type: 'password_reset', tokenHash: randomUUID(), expiresAt: new Date(Date.now() + 3600000) });
  expect((await call(admin, `/admin/users/${volunteer}/archive`, 'PATCH', { archived: true })).status).toBe(200);
  expect((await db.select().from(tokens).where(eq(tokens.userId, volunteer))).every(t => !!t.usedAt)).toBe(true);
});
