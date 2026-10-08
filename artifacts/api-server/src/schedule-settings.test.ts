import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { db, pool, usersTable, volunteerProfilesTable, shiftSlotsTable, shiftAssignmentsTable,
  closedDatesTable, notificationLogTable, activityLogTable, sessionsTable } from '@workspace/db';
import { pacificDay, addCalendarDays } from './server/scheduleService';
import { loadScheduleService } from './server/scheduleRepository';
if (process.env.NODE_ENV === 'production') throw new Error('Run schedule fixture tests against development only.');
process.env.NODE_ENV = 'development';
// Fixture requests must stay logged even after a developer connects real Postmark credentials.
process.env.POSTMARK_SERVER_TOKEN = '';
process.env.EMAIL_FROM = '';
const tag = `schedule-${randomUUID()}`, today = pacificDay(new Date());
const userIds: string[] = [], profileIds: string[] = [], slotIds: string[] = [], assignmentIds: string[] = [], closureIds: string[] = [], sessionIds: string[] = [];
let adminId: string, volId: string, inactiveAdmin: string, unverifiedAdmin: string, slotId: string, server: Server, base: string, origin: string;
type Caller = (path: string, method?: string, body?: unknown) => Promise<{ status: number; data: any }>;
let staff: Caller;
async function client(userId?: string): Promise<Caller> {
  const boot = await fetch(`${base}/api/auth/session`, { headers: { 'x-forwarded-proto': 'https' } });
  const cookie = boot.headers.get('set-cookie')!.split(';')[0]!;
  const { csrfToken } = await boot.json() as { csrfToken: string };
  const sid = decodeURIComponent(cookie.split('=').slice(1).join('=')).slice(2).split('.')[0]!;
  sessionIds.push(sid);
  if (userId) {
    const { rows } = await pool.query<{ sess: Record<string, unknown> }>('SELECT sess FROM sessions WHERE sid=$1', [sid]);
    await pool.query('UPDATE sessions SET sess=$1 WHERE sid=$2', [JSON.stringify({ ...rows[0]!.sess, userId, authVersion: 0 }), sid]);
  }
  return async (path, method = 'GET', body) => {
    const r = await fetch(`${base}/api${path}`, { method, headers: { cookie, 'x-forwarded-proto': 'https',
      Origin: origin, 'X-CSRF-Token': csrfToken, 'Content-Type': 'application/json' },
      ...(body === undefined || method === 'GET' || method === 'HEAD' ? {} : { body: JSON.stringify(body) }) });
    return { status: r.status, data: await r.json() };
  };
}
async function user(role: 'admin' | 'volunteer', verified = true, active = true) {
  const [u] = await db.insert(usersTable).values({ email: `${tag}-${userIds.length}@example.org`, firstName: 'Schedule QA',
    lastName: 'Owned fixture', role, passwordHash: 'unusable-fixture', emailVerifiedAt: verified ? new Date() : null, isActive: active }).returning();
  userIds.push(u!.id);
  if (role === 'volunteer') {
    const [p] = await db.insert(volunteerProfilesTable).values({ userId: u!.id, status: 'active',
      county: 'Placer', certificationStatus: 'complete', backgroundCheckStatus: 'cleared',
      onboardingCompletedAt: new Date(), agreementAcknowledgedAt: new Date() }).returning();
    profileIds.push(p!.id);
  }
  return u!.id;
}
beforeAll(async () => {
  const { default: app } = await import('./app');
  origin = (await import('./auth/session')).appOrigin;
  server = createServer(app); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  adminId = await user('admin'); volId = await user('volunteer'); await user('volunteer');
  inactiveAdmin = await user('admin', true, false); unverifiedAdmin = await user('admin', false);
  const [slot] = await db.insert(shiftSlotsTable).values({ dayOfWeek: 1, startTime: '22:00', endTime: '23:00',
    label: tag, capacity: 2 }).returning();
  slotId = slot!.id; slotIds.push(slotId);
  for (const profileId of profileIds) {
    const [a] = await db.insert(shiftAssignmentsTable).values({ shiftSlotId: slotId, volunteerProfileId: profileId,
      startDate: today, createdByUserId: adminId }).returning(); assignmentIds.push(a!.id);
  }
  const [future] = await db.insert(shiftAssignmentsTable).values({ shiftSlotId: slotId, volunteerProfileId: profileIds[0]!,
    startDate: addCalendarDays(today, 14), createdByUserId: adminId }).returning(); assignmentIds.push(future!.id);
  staff = await client(adminId);
});
afterAll(async () => {
  if (sessionIds.length) await db.delete(sessionsTable).where(inArray(sessionsTable.sid, sessionIds));
  if (profileIds.length) await db.delete(activityLogTable).where(inArray(activityLogTable.volunteerProfileId, profileIds));
  if (userIds.length) await db.delete(notificationLogTable).where(inArray(notificationLogTable.recipientUserId, userIds));
  if (assignmentIds.length) await db.delete(shiftAssignmentsTable).where(inArray(shiftAssignmentsTable.id, assignmentIds));
  if (slotIds.length) await db.delete(shiftSlotsTable).where(inArray(shiftSlotsTable.id, slotIds));
  if (closureIds.length) await db.delete(closedDatesTable).where(inArray(closedDatesTable.id, closureIds));
  if (profileIds.length) await db.delete(volunteerProfilesTable).where(inArray(volunteerProfilesTable.id, profileIds));
  if (userIds.length) await db.delete(usersTable).where(inArray(usersTable.id, userIds));
  if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  await pool.end();
});
const current = async () => (await staff('/admin/schedule/settings')).data.slots.find((s: any) => s.id === slotId);
const body = (slot: any, extra = {}) => ({
  dayOfWeek: slot.dayOfWeek, startTime: slot.startTime, endTime: slot.endTime, capacity: slot.capacity,
  label: slot.label, isActive: slot.isActive, expectedUpdatedAt: slot.updatedAt, expectedAssignmentIds: slot.assignmentIds, ...extra,
});
describe('Admin schedule settings API', () => {
  it('declares an admin guard for every read/write; volunteers/unverified/deactivated cannot access them', async () => {
    const actions: [string, string][] = [['/admin/schedule/settings', 'GET'], ['/admin/schedule/slots', 'POST'],
      ['/admin/overview', 'GET'], ['/admin/schedule/week?weekStart=2026-10-05', 'GET'],
      [`/admin/schedule/slots/${slotId}`, 'PATCH'], ['/admin/schedule/copy-monday', 'POST'],
      ['/admin/schedule/closed-dates', 'POST'], [`/admin/schedule/closed-dates/${randomUUID()}`, 'DELETE']];
    for (const [id, code] of [[undefined, 401], [volId, 403], [inactiveAdmin, 403], [unverifiedAdmin, 403]] as const) {
      const c = await client(id);
      for (const [path, method] of actions) expect((await c(path, method, {})).status).toBe(code);
    }
  });
  it('coordinator endpoints are fresh admin-only DTOs with validated date inputs and no notes or answer blobs', async () => {
    const home = await staff('/admin/overview');
    expect(home.status).toBe(200); expect(home.data.updatedAt).toBeTruthy(); expect(home.data.recentActivity).toBeInstanceOf(Array);
    const week = await staff('/admin/schedule/week?weekStart=2026-10-07');
    expect(week.status).toBe(200); expect(week.data.weekStart).toBe('2026-10-05'); expect(week.data.days).toHaveLength(5);
    expect(JSON.stringify(week.data)).not.toContain('adminNotes'); expect(JSON.stringify(home.data)).not.toContain('onboardingAnswers');
    expect((await staff('/admin/schedule/week?weekStart=2026-02-30')).status).toBe(400);
    expect((await staff('/admin/schedule/week')).status).toBe(400);
    expect((await staff('/admin/schedule/week?weekStart=')).status).toBe(400);
    expect((await staff('/admin/schedule/week?weekStart[]=2026-10-05')).status).toBe(400);
  });
  it('counts people including future holds, blocks capacity floor, invalid time/range and stale assignment confirmations', async () => {
    const slot = await current();
    expect(slot.assignedCount).toBe(2); expect(slot.assignmentIds).toHaveLength(3);
    const reduced = await staff(`/admin/schedule/slots/${slotId}`, 'PATCH', body(slot, { capacity: 1 }));
    expect(reduced.status).toBe(422); expect(reduced.data.error).toContain('2 volunteers');
    expect((await staff('/admin/schedule/slots', 'POST', {
      dayOfWeek: 1, startTime: '09:00', endTime: '11:00', capacity: 11, label: tag, isActive: true,
    })).status).toBe(400);
    expect((await staff(`/admin/schedule/slots/${slotId}`, 'PATCH', body(slot, { endTime: '21:00' }))).status).toBe(400);
    expect((await staff(`/admin/schedule/slots/${slotId}`, 'PATCH', body(slot, { expectedAssignmentIds: [] }))).status).toBe(409);
    expect((await staff(`/admin/schedule/slots/${slotId}`, 'PATCH', body(slot, { isActive: false }))).status).toBe(400);
    expect((await current()).isActive).toBe(true);
  });
  it('allows overlaps, edits persist, and revision conflict never silently forces a change', async () => {
    await db.update(shiftSlotsTable).set({ updatedAt: new Date(Date.now() + 60_000) }).where(eq(shiftSlotsTable.id, slotId));
    const slot = await current();
    const edited = await staff(`/admin/schedule/slots/${slotId}`, 'PATCH', body(slot, { label: `${tag}-edited` }));
    expect(edited.status).toBe(200);
    expect(new Date((await current()).updatedAt).getTime()).toBeGreaterThan(new Date(slot.updatedAt).getTime());
    expect((await staff(`/admin/schedule/slots/${slotId}`, 'PATCH', body(slot, { capacity: 3 }))).status).toBe(409);
    const added = await staff('/admin/schedule/slots', 'POST', { dayOfWeek: 1, startTime: '22:30', endTime: '23:30',
      capacity: 1, label: `${tag}-overlap`, isActive: true });
    expect(added.status).toBe(200);
    const own = added.data.slots.find((s: any) => s.label === `${tag}-overlap`);
    slotIds.push(own.id); expect(own.overlaps.some((s: any) => s.id === slotId)).toBe(true);
  });
  it('closed dates persist, duplicates/invalid days are rejected, removing restores occurrences and coverage', async () => {
    let date = '2040-01-02';
    while (new Date(`${date}T00:00:00Z`).getUTCDay() !== 1 ||
      (await db.select().from(closedDatesTable).where(eq(closedDatesTable.date, date))).length) date = addCalendarDays(date, 1);
    expect((await (await loadScheduleService(profileIds[0])).getOccurrences(date, date)).some(o => o.slot.id === slotId)).toBe(true);
    const added = await staff('/admin/schedule/closed-dates', 'POST', { date, reason: tag });
    expect(added.status).toBe(200);
    const closed = added.data.closedDates.find((c: any) => c.reason === tag); closureIds.push(closed.id);
    expect((await staff('/admin/schedule/closed-dates', 'POST', { date, reason: tag })).status).toBe(409);
    expect((await staff('/admin/schedule/closed-dates', 'POST', { date: '2040-02-30', reason: tag })).status).toBe(400);
    const service = await loadScheduleService(profileIds[0]);
    expect(service.getOccurrences(date, date)).toEqual([]); expect(service.getCoverage(date).some(o => o.date === date)).toBe(false);
    expect((await staff(`/admin/schedule/closed-dates/${closed.id}`, 'DELETE')).status).toBe(200);
    expect((await loadScheduleService(profileIds[0])).getOccurrences(date, date).some(o => o.slot.id === slotId)).toBe(true);
  });
  it('keep-through schedules inclusive retirement, cancels impossible future starts, does not resurrect them on reactivation', async () => {
    const keepUntilDate = addCalendarDays(today, 7), slot = await current();
    expect((await staff(`/admin/schedule/slots/${slotId}`, 'PATCH', body(slot, {
      isActive: false, deactivation: { mode: 'keep_until', keepUntilDate: '2026-02-30' },
    }))).status).toBe(400);
    const kept = await staff(`/admin/schedule/slots/${slotId}`, 'PATCH', body(slot, {
      isActive: false, deactivation: { mode: 'keep_until', keepUntilDate },
    }));
    expect(kept.status).toBe(200); expect(kept.data.releasedAssignmentCount).toBe(1); expect(kept.data.emailSummary).toEqual({ sent: 0, logged: 1, failed: 0 });
    const retired = await current(); expect(retired.retireAfterDate).toBe(keepUntilDate); expect(retired.isActive).toBe(true);
    const rows = await db.select().from(shiftAssignmentsTable).where(inArray(shiftAssignmentsTable.id, assignmentIds));
    expect(rows.filter(a => a.endedReason === 'admin_removed')).toHaveLength(1);
    expect(rows.filter(a => a.endedReason !== 'admin_removed').every(a => a.endDate === keepUntilDate)).toBe(true);
    expect((await loadScheduleService(profileIds[0])).getOccurrences(addCalendarDays(keepUntilDate, 1), addCalendarDays(keepUntilDate, 7)).some(o => o.slot.id === slotId)).toBe(false);
    expect((await staff(`/admin/schedule/slots/${slotId}`, 'PATCH', body(retired, { isActive: true, cancelRetirement: true }))).status).toBe(200);
    expect((await current()).retireAfterDate).toBeNull(); expect((await current()).assignmentIds).toHaveLength(2);
  });
  it('end-now releases all remaining seats, logs one email per volunteer, retries stale version cannot resend', async () => {
    const slot = await current(), request = body(slot, { isActive: false, deactivation: { mode: 'now' } });
    const ended = await staff(`/admin/schedule/slots/${slotId}`, 'PATCH', request);
    expect(ended.status).toBe(200); expect(ended.data.releasedAssignmentCount).toBe(2);
    expect(ended.data.emailSummary).toEqual({ sent: 0, logged: 2, failed: 0 }); expect((await current()).assignedCount).toBe(0);
    const rows = await db.select().from(shiftAssignmentsTable).where(inArray(shiftAssignmentsTable.id, assignmentIds));
    expect(rows.every(a => a.endDate === today && a.endedReason === 'admin_removed')).toBe(true);
    const logs = await db.select().from(notificationLogTable).where(inArray(notificationLogTable.recipientUserId, userIds));
    expect(logs).toHaveLength(3); expect(logs.every(l => l.status === 'logged')).toBe(true);
    expect((await staff(`/admin/schedule/slots/${slotId}`, 'PATCH', request)).status).toBe(409);
    expect((await db.select().from(notificationLogTable).where(inArray(notificationLogTable.recipientUserId, userIds)))).toHaveLength(3);
  });
  it('Monday copies are additive, preserve duplicate-slot multiplicity, and idempotent without changing existing rows', async () => {
    for (let i = 0; i < 2; i++) {
      const [s] = await db.insert(shiftSlotsTable).values({ dayOfWeek: 1, startTime: '21:01', endTime: '21:31',
        label: `${tag}-copy`, capacity: 1 }).returning(); slotIds.push(s!.id);
    }
    const before = await db.select().from(shiftSlotsTable);
    const first = await staff('/admin/schedule/copy-monday', 'POST'); expect(first.status).toBe(200);
    slotIds.push(...first.data.addedSlotIds);
    const copies = await db.select().from(shiftSlotsTable).where(eq(shiftSlotsTable.label, `${tag}-copy`));
    expect(copies).toHaveLength(10);
    expect((await staff('/admin/schedule/copy-monday', 'POST')).data.addedSlotIds).toEqual([]);
    const after = await db.select().from(shiftSlotsTable).where(inArray(shiftSlotsTable.id, before.map(s => s.id)));
    expect(after.sort((a, b) => a.id.localeCompare(b.id))).toEqual(before.sort((a, b) => a.id.localeCompare(b.id)));
  });
});
