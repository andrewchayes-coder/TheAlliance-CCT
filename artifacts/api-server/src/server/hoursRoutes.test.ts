import { beforeAll, afterAll, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { db, usersTable as users, volunteerProfilesTable as profiles, shiftSlotsTable as slots,
  shiftAssignmentsTable as assignments, customShiftsTable as customs, customShiftAssignmentsTable as claims,
  volunteerHoursTable as hours, activityLogTable as activity } from '@workspace/db';
import { apiAccessPolicy } from '../auth/access-policy';
import hoursRouter from '../routes/hours';
import { saveHours } from './hoursRepository';
vi.hoisted(() => { process.env.NODE_ENV = 'development'; process.env.APP_ORIGIN = 'https://hours-fixture.example.invalid'; });
let server: Server, base: string;
let volunteer: string, other: string, admin: string, profile: string, otherProfile: string, slot: string, custom: string;
const clock = '2026-10-20T21:00:00Z';
const tag = `hours-${randomUUID()}`;
async function call(userId: string, method = 'GET', path = '/volunteer/hours', data?: unknown, at = clock) {
  const response = await fetch(`${base}/api${path}${path.includes('?') ? '&' : '?'}at=${encodeURIComponent(at)}`, {
    method, headers: { 'x-fixture-user': userId, 'content-type': 'application/json' },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
  return { status: response.status, body: response.status === 204 ? null : await response.json() as any };
}
const standing = (amount: number) => ({ date: '2026-10-20', source: 'standing', shiftSlotId: slot, hours: amount });
beforeAll(async () => {
  const people = await db.insert(users).values(['vol', 'other', 'admin'].map((kind, i) => ({
    email: `${tag}-${kind}@example.invalid`, passwordHash: 'unusable-fixture-hash', firstName: i === 2 ? 'Staff' : 'Private', lastName: kind,
    role: i === 2 ? 'admin' as const : 'volunteer' as const, emailVerifiedAt: new Date(),
  }))).returning();
  [volunteer, other, admin] = people.map(p => p.id);
  const ps = await db.insert(profiles).values([volunteer, other].map(userId => ({ userId, status: 'active' as const }))).returning();
  [profile, otherProfile] = ps.map(p => p.id);
  const [s] = await db.insert(slots).values({ dayOfWeek: 2, startTime: '10:00', endTime: '12:00', capacity: 2 }).returning();
  slot = s!.id;
  await db.insert(assignments).values({ volunteerProfileId: profile, shiftSlotId: slot, startDate: '2026-09-01', createdByUserId: admin });
  const [c] = await db.insert(customs).values({ date: '2026-10-20', startTime: '12:00', endTime: '13:30',
    label: tag, capacity: 1, createdByUserId: admin }).returning();
  custom = c!.id;
  await db.insert(claims).values({ customShiftId: custom, volunteerProfileId: profile, createdByUserId: admin });
  const app = express();
  app.use(express.json());
  // Fixture authentication identity only; actual production role guards still execute.
  app.use((req, _res, next) => { req.session = { userId: req.get('x-fixture-user'), authVersion: 0 } as typeof req.session; next(); });
  app.use('/api', apiAccessPolicy, hoursRouter);
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(async () => {
  if (server) await new Promise<void>(resolve => server.close(() => resolve()));
  if (!profile) return;
  await db.delete(hours).where(inArray(hours.volunteerProfileId, [profile, otherProfile]));
  await db.delete(activity).where(inArray(activity.volunteerProfileId, [profile, otherProfile]));
  await db.delete(claims).where(eq(claims.customShiftId, custom));
  await db.delete(customs).where(eq(customs.id, custom));
  await db.delete(assignments).where(inArray(assignments.volunteerProfileId, [profile, otherProfile]));
  await db.delete(slots).where(eq(slots.id, slot));
  await db.delete(profiles).where(inArray(profiles.id, [profile, otherProfile]));
  await db.delete(users).where(inArray(users.id, [volunteer, other, admin]));
});
it('confirms two hours, changes to 1.5 and 3, and upserts one row with activity and numeric responses', async () => {
  for (const n of [2, 1.5, 3]) {
    const r = await call(volunteer, 'PUT', '/volunteer/hours', standing(n));
    expect(r.status).toBe(200);
    expect(r.body.hours).toBe(n);
  }
  const rows = await db.select().from(hours).where(eq(hours.volunteerProfileId, profile));
  expect(rows).toHaveLength(1);
  const actions = await db.select().from(activity).where(eq(activity.volunteerProfileId, profile)).orderBy(activity.createdAt, activity.id);
  expect(actions.map(a => a.action)).toEqual(['hours_logged', 'hours_updated', 'hours_updated']);
  expect(actions[2]!.details).toMatchObject({ shiftDate: '2026-10-20', hours: 3, by: 'volunteer' });
});
it.each([0, 0.3, 12.25])('refuses invalid quarter-hour amount %s with a clear message', async n => {
  const r = await call(volunteer, 'PUT', '/volunteer/hours', standing(n));
  expect(r.status).toBe(422); expect(r.body.error).toContain('quarter hours');
});
it('refuses future, old, another person’s and made-up shifts, other time, excess notes and foreign fields', async () => {
  for (const data of [
    { ...standing(2), date: '2026-10-27' }, { ...standing(2), date: '2026-10-05' },
    { ...standing(2), shiftSlotId: randomUUID() }, { ...standing(2), note: 'x'.repeat(301) },
    { date: '2026-10-20', source: 'other', hours: 1, note: 'Not allowed' },
    { ...standing(2), volunteerProfileId: otherProfile },
  ]) expect((await call(volunteer, 'PUT', '/volunteer/hours', data)).status).toBe(422);
  expect((await call(other, 'PUT', '/volunteer/hours', standing(2))).status).toBe(422);
});
it('returns only own rows with no names, staff names, other counts or adminNotes', async () => {
  const own = await call(volunteer);
  expect(own.status).toBe(200);
  expect(own.body.monthTotal).toBe(3);
  expect(own.body.shifts.find((s: { date: string; source: string }) => s.date === '2026-10-20' && s.source === 'standing').logged).toMatchObject({ hours: 3, enteredBy: 'volunteer' });
  expect((await call(other)).body).toEqual({ windowDays: 14, monthTotal: 0, hasLoggedHours: false, shifts: [] });
  for (const value of ['Private', 'Staff admin', 'adminNotes', otherProfile]) expect(JSON.stringify(own.body)).not.toContain(value);
});
it('staff add scheduled and Other hours, refuse missing notes/future/duplicates, correct and delete', async () => {
  const path = `/admin/volunteers/${volunteer}/hours`;
  const scheduled = { date: '2026-10-20', source: 'one_time', customShiftId: custom, hours: 1.5 };
  const created = await call(admin, 'POST', path, scheduled);
  expect(created.status).toBe(201); expect(created.body.enteredBy).toBe('Staff admin');
  expect((await call(admin, 'POST', path, scheduled)).body.error).toBe('Hours are already logged for that shift. Edit the existing entry instead.');
  expect((await call(admin, 'POST', path, { date: '2026-10-21', source: 'other', hours: 2, note: 'Training' })).body.error).toContain('future date');
  expect((await call(admin, 'POST', path, { date: '2026-10-01', source: 'other', hours: 2 })).body.error).toBe('What was this time for?');
  const otherTime = await call(admin, 'POST', path, { date: '2026-10-01', source: 'other', hours: 2, note: 'Training' });
  expect(otherTime.status).toBe(201);
  const older = await call(admin, 'POST', path, { date: '2026-09-01', source: 'standing', shiftSlotId: slot, hours: 2 });
  expect(older.status).toBe(201);
  expect((await call(admin, 'GET', path)).body.lastMonthTotal).toBe(2);
  expect((await call(admin, 'PATCH', `${path}/${created.body.id}`, { ...scheduled, hours: 3 })).body.hours).toBe(3);
  expect((await call(admin, 'GET', path)).body.rows.some((r: { id: string }) => r.id === otherTime.body.id)).toBe(true);
  expect((await call(admin, 'DELETE', `${path}/${otherTime.body.id}`)).status).toBe(204);
  // Query immediately after the response: the activity must already be committed.
  const removed = await db.select().from(activity).where(and(eq(activity.volunteerProfileId, profile), eq(activity.action, 'hours_deleted')));
  expect(removed).toHaveLength(1);
  expect(removed[0]!.details).toMatchObject({ by: 'staff', hours: 2 });
  expect(await db.select().from(hours).where(eq(hours.id, otherTime.body.id))).toHaveLength(0);
  expect((await call(admin, 'DELETE', `${path}/${otherTime.body.id}`)).status).toBe(404);
  expect(await db.select().from(activity).where(and(eq(activity.volunteerProfileId, profile), eq(activity.action, 'hours_deleted')))).toHaveLength(1);
});
it('volunteers get 403 on every admin hours route and cannot delete any hours', async () => {
  const path = `/admin/volunteers/${volunteer}/hours`;
  for (const [method, url] of [['GET', path], ['POST', path], ['PATCH', `${path}/${randomUUID()}`], ['DELETE', `${path}/${randomUUID()}`]])
    expect((await call(volunteer, method!, url!, method === 'POST' || method === 'PATCH' ? standing(2) : undefined)).status).toBe(403);
  expect((await call(volunteer, 'DELETE', '/volunteer/hours')).status).toBe(403);
});
it('staff-entered scheduled hours remain volunteer-editable, including before inactivation inside the window', async () => {
  const [a] = await db.select().from(assignments).where(eq(assignments.volunteerProfileId, profile));
  await db.update(assignments).set({ endDate: '2026-10-20', endedReason: 'admin_removed', updatedAt: new Date('2026-10-20T20:00:00Z') }).where(eq(assignments.id, a!.id));
  await db.update(profiles).set({ status: 'inactive' }).where(eq(profiles.id, profile));
  expect((await call(volunteer, 'PUT', '/volunteer/hours', standing(2))).status).toBe(200);
  const [row] = await db.select().from(hours).where(and(eq(hours.volunteerProfileId, profile), eq(hours.customShiftId, custom)));
  expect(row).toBeTruthy();
  expect((await call(volunteer, 'PUT', '/volunteer/hours', { date: '2026-10-20', source: 'one_time', customShiftId: custom, hours: 1.5 })).status).toBe(200);
  await db.update(profiles).set({ status: 'onboarding' }).where(eq(profiles.id, profile));
  expect((await call(volunteer)).body).toEqual({ windowDays: 14, monthTotal: 0, hasLoggedHours: false, shifts: [] });
});
