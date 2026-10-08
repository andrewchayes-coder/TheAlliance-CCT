import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { db, pool, usersTable, volunteerProfilesTable, shiftSlotsTable, shiftAssignmentsTable,
  shiftSkipsTable, activityLogTable, notificationLogTable, sessionsTable } from '@workspace/db';
import { addCalendarDays, slotInstant, pacificDay } from './scheduleService';
if (process.env.NODE_ENV === 'production') throw new Error('Development fixture tests only.');
process.env.NODE_ENV = 'development'; process.env.POSTMARK_SERVER_TOKEN = ''; process.env.EMAIL_FROM = '';
const tag = `booking-${randomUUID()}`, ids: string[] = [], profiles: string[] = [], slots: string[] = [], sessions: string[] = [];
type Client = (path: string, method?: string, body?: unknown) => Promise<{ status: number; data: any }>;
let server: Server, base: string, origin: string, clients: Client[], admin: Client, anon: Client, unverified: Client, inactive: Client;
let blocked: Client, noAgreement: Client, winner: number, heldId: string, replacementId: string;
let volunteerScheduleAction: typeof import('./volunteerSchedule').volunteerScheduleAction;
const post = (c: Client, path: string, body?: unknown) => c(path, 'POST', body);
async function client(id?: string): Promise<Client> {
  const boot = await fetch(`${base}/api/auth/session`, { headers: { 'x-forwarded-proto': 'https' } });
  const cookie = boot.headers.get('set-cookie')!.split(';')[0]!, { csrfToken } = await boot.json() as { csrfToken: string };
  const sid = decodeURIComponent(cookie.split('=').slice(1).join('=')).slice(2).split('.')[0]!;
  sessions.push(sid);
  if (id) {
    const { rows } = await pool.query('SELECT sess FROM sessions WHERE sid=$1', [sid]);
    await pool.query('UPDATE sessions SET sess=$1 WHERE sid=$2', [JSON.stringify({ ...rows[0]!.sess, userId: id, authVersion: 0 }), sid]);
  }
  return async (path, method = 'GET', body) => {
    const r = await fetch(`${base}/api${path}`, { method, headers: { cookie, Origin: origin,
      'x-forwarded-proto': 'https', 'X-CSRF-Token': csrfToken, 'Content-Type': 'application/json' },
      ...(method !== 'GET' && body !== undefined ? { body: JSON.stringify(body) } : {}) });
    return { status: r.status, data: await r.json() };
  };
}
async function person(role: 'admin' | 'volunteer', verified = true, active = true, approved = true, agreement = true) {
  const [u] = await db.insert(usersTable).values({ email: `${tag}-${ids.length}@example.invalid`, firstName: `Private-${tag}-${ids.length}`,
    lastName: 'Owned fixture', phone: '+15555550001', role, isActive: active, emailVerifiedAt: verified ? new Date() : null,
    passwordHash: 'not-a-login-password' }).returning();
  ids.push(u!.id);
  if (role === 'volunteer') {
    const [p] = await db.insert(volunteerProfilesTable).values({ userId: u!.id, status: approved ? 'active' : 'applicant',
      agreementAcknowledgedAt: agreement ? new Date() : null, onboardingCompletedAt: new Date(),
      adminNotes: `PRIVATE-NOTES-${tag}`, certificationStatus: 'complete', backgroundCheckStatus: 'cleared' }).returning();
    profiles.push(p!.id);
  }
  return u!.id;
}
const path = (id: string, action: string) => `/volunteer/assignments/${id}/${action}`;
async function view(c: Client) { return (await c('/volunteer/schedule')).data; }
async function first(c: Client, slotId: string) { return (await view(c)).slots.find((s: any) => s.id === slotId).startDates[0]; }
beforeAll(async () => {
  ({ volunteerScheduleAction } = await import('./volunteerSchedule'));
  const { default: app } = await import('../app'); origin = (await import('../auth/session')).appOrigin;
  server = createServer(app); await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const people = [await person('volunteer'), await person('volunteer'), await person('volunteer')];
  clients = await Promise.all(people.map(id => client(id))); admin = await client(await person('admin')); anon = await client();
  unverified = await client(await person('volunteer', false)); inactive = await client(await person('volunteer', true, false));
  blocked = await client(await person('volunteer', true, true, false)); noAgreement = await client(await person('volunteer', true, true, true, false));
  for (const [day, start, end] of [[2, '21:00', '22:00'], [2, '21:30', '22:30'], [2, '22:00', '23:00'],
    [4, '21:00', '22:00'], [5, '21:00', '22:00']] as const) {
    const [s] = await db.insert(shiftSlotsTable).values({ dayOfWeek: day, startTime: start, endTime: end, capacity: 1, label: tag }).returning();
    slots.push(s!.id);
  }
});
afterAll(async () => {
  if (sessions.length) await db.delete(sessionsTable).where(inArray(sessionsTable.sid, sessions));
  if (profiles.length) {
    const a = await db.select({ id: shiftAssignmentsTable.id }).from(shiftAssignmentsTable).where(inArray(shiftAssignmentsTable.volunteerProfileId, profiles));
    if (a.length) await db.delete(shiftSkipsTable).where(inArray(shiftSkipsTable.shiftAssignmentId, a.map(a => a.id)));
    await db.delete(activityLogTable).where(inArray(activityLogTable.volunteerProfileId, profiles));
    await db.delete(shiftAssignmentsTable).where(inArray(shiftAssignmentsTable.volunteerProfileId, profiles));
    await db.delete(volunteerProfilesTable).where(inArray(volunteerProfilesTable.id, profiles));
  }
  if (ids.length) { await db.delete(notificationLogTable).where(inArray(notificationLogTable.recipientUserId, ids));
    await db.delete(usersTable).where(inArray(usersTable.id, ids)); }
  if (slots.length) await db.delete(shiftSlotsTable).where(inArray(shiftSlotsTable.id, slots));
  if (server) await new Promise<void>((r, j) => server.close(e => e ? j(e) : r())); await pool.end();
});
describe('Volunteer standing schedule transactions', () => {
  it('guards every action and exposes eligibility reasons without personal data', async () => {
    const actions: [string, string][] = [['/volunteer/schedule', 'GET'], ['/volunteer/assignments', 'POST'],
      [path(randomUUID(), 'change'), 'POST'], [path(randomUUID(), 'drop'), 'POST'], [path(randomUUID(), 'skips'), 'POST'],
      [path(randomUUID(), `skips/${randomUUID()}`), 'DELETE']];
    for (const [c, expected] of [[anon, 401], [admin, 403], [unverified, 403], [inactive, 403]] as const)
      for (const [p, m] of actions) expect((await c(p, m, {})).status).toBe(expected);
    for (const c of [blocked, noAgreement]) {
      const v = await view(c); expect(v.canBook).toBe(false); expect(v.blockedReasons.length).toBeGreaterThan(0);
      expect((await post(c, '/volunteer/assignments', { slotId: slots[0] })).status).toBe(403);
    }
    const raw = JSON.stringify(await view(clients[0]!));
    expect(raw).not.toContain('Private-'); expect(raw).not.toContain('+15555550001'); expect(raw).not.toContain('PRIVATE-NOTES-');
    expect(raw).not.toContain(ids[1]!); expect(raw).not.toContain(profiles[1]!);
  });
  it('allows only one concurrent claim of the last seat and logs a branded confirmation', async () => {
    const answers = await Promise.all(clients.slice(0, 2).map(c => post(c, '/volunteer/assignments', { slotId: slots[0] })));
    expect(answers.map(a => a.status).sort()).toEqual([200, 409]);
    winner = answers.findIndex(a => a.status === 200); heldId = answers[winner]!.data.assignmentId;
    expect(answers[winner]!.data.message).toContain("You're on the schedule: Tuesdays");
    const bookings = await db.select().from(shiftAssignmentsTable).where(eq(shiftAssignmentsTable.shiftSlotId, slots[0]!));
    expect(bookings).toHaveLength(1);
    const mail = await db.select().from(notificationLogTable).where(eq(notificationLogTable.recipientUserId, ids[winner]!));
    expect(mail).toHaveLength(1); expect(mail[0]!.status).toBe('logged');
    const otherView = await view(clients[1 - winner]!);
    expect(otherView.slots.find((s: any) => s.id === slots[0]).openSpots).toBe(0);
    expect(JSON.stringify(otherView)).not.toContain(heldId);
    expect((await post(clients[1 - winner]!, path(heldId, 'drop'))).status).toBe(404);
  });
  it('enforces minimum, max, overlaps, chosen dates, and agreement ownership on the server', async () => {
    const c = clients[winner]!;
    expect((await post(c, path(heldId, 'drop'))).status).toBe(422);
    expect((await post(c, '/volunteer/assignments', { slotId: slots[1] })).status).toBe(422);
    expect((await post(c, '/volunteer/assignments', { slotId: slots[2] })).status).toBe(200); // Adjacent is not overlapping.
    expect((await post(c, '/volunteer/assignments', { slotId: slots[3] })).status).toBe(422);
    const fresh = clients[2]!, date = await first(fresh, slots[3]!);
    expect((await post(fresh, '/volunteer/assignments', { slotId: slots[3], startDate: addCalendarDays(date, 1) })).status).toBe(422);
    expect((await post(fresh, '/volunteer/assignments', { slotId: slots[3], startDate: addCalendarDays(date, 35) })).status).toBe(422);
    expect((await post(fresh, '/volunteer/assignments', { slotId: slots[3], startDate: '2026-02-30' })).status).toBe(400);
    expect((await post(fresh, '/volunteer/assignments', { slotId: slots[3], volunteerProfileId: profiles[winner] })).status).toBe(400);
  });
  it('changes at the maximum atomically, and a full replacement cannot release the old shift', async () => {
    const c = clients[winner]!, own = (await view(c)).assignments;
    const adjacent = own.find((a: any) => a.slotId === slots[2]);
    const changed = await post(c, path(adjacent.id, 'change'), { slotId: slots[3], startDate: await first(c, slots[3]!) });
    expect(changed.status).toBe(200); replacementId = changed.data.assignmentId;
    const [ended] = await db.select().from(shiftAssignmentsTable).where(eq(shiftAssignmentsTable.id, adjacent.id));
    expect(ended!.endedReason).toBe('changed'); expect(ended!.endDate! < ended!.startDate).toBe(true);
    expect((await view(c)).assignments).toHaveLength(2);
    expect((await post(clients[2]!, '/volunteer/assignments', { slotId: slots[4] })).status).toBe(200);
    expect((await post(c, path(heldId, 'change'), { slotId: slots[4] })).status).toBe(409);
    const [unchanged] = await db.select().from(shiftAssignmentsTable).where(eq(shiftAssignmentsTable.id, heldId));
    expect(unchanged!.endedReason).toBeNull(); expect(unchanged!.endDate).toBeNull();
  });
  it('drops only above minimum, frees capacity, and safely rebooks a cancelled future reservation', async () => {
    const c = clients[winner]!;
    const future = (await view(c)).assignments.find((a: any) => a.id === replacementId).startDate;
    await db.insert(shiftSkipsTable).values({ shiftAssignmentId: replacementId, skipDate: future });
    expect((await post(c, path(replacementId, 'drop'))).status).toBe(200);
    expect((await view(c)).assignments).toHaveLength(1);
    expect((await post(c, path(heldId, 'drop'))).status).toBe(422);
    const rebooked = await post(c, '/volunteer/assignments', { slotId: slots[3] });
    expect(rebooked.status).toBe(200); expect(rebooked.data.assignmentId).toBe(replacementId);
    expect((await view(c)).assignments.find((a: any) => a.id === replacementId).weeksOff).toHaveLength(0);
    const mail = await db.select().from(notificationLogTable).where(eq(notificationLogTable.recipientUserId, ids[winner]!));
    expect(mail).toHaveLength(4); expect(new Set(mail.map(m => m.relatedId)).size).toBe(4);
  });
  it('uses the exact 24-hour cutoff, never frees standing capacity on a skip, and permits timely undo', async () => {
    const c = clients[winner]!, standing = (await view(c)).assignments.find((a: any) => a.id === heldId);
    const date = standing.nextDates[0].date, starts = slotInstant(date, standing.startTime);
    const actor = { id: ids[winner]!, sessionVersion: 0 };
    await expect(volunteerScheduleAction(actor, { kind: 'skip', assignmentId: heldId, date },
      new Date(starts.getTime() - 24 * 3600000 + 1))).rejects.toMatchObject({ status: 422 });
    await volunteerScheduleAction(actor, { kind: 'skip', assignmentId: heldId, date }, new Date(starts.getTime() - 24 * 3600000));
    await volunteerScheduleAction(actor, { kind: 'skip', assignmentId: heldId, date }, new Date(starts.getTime() - 25 * 3600000));
    const skips = await db.select().from(shiftSkipsTable).where(eq(shiftSkipsTable.shiftAssignmentId, heldId));
    expect(skips).toHaveLength(1);
    expect((await view(c)).slots.find((s: any) => s.id === slots[0]).openSpots).toBe(0);
    const dashboard = await c('/volunteer/dashboard');
    expect(dashboard.data.upcomingShifts.some((s: any) => s.assignmentId === heldId && s.date === date)).toBe(false);
    expect((await post(clients[1 - winner]!, path(heldId, 'skips'), { date })).status).toBe(404);
    await volunteerScheduleAction(actor, { kind: 'undo', assignmentId: heldId, skipId: skips[0]!.id }, new Date(starts.getTime() - 1000));
    expect((await c('/volunteer/dashboard')).data.upcomingShifts.some((s: any) => s.assignmentId === heldId && s.date === date)).toBe(true);
    expect((await view(c)).assignments.find((a: any) => a.id === heldId).weeksOff).toHaveLength(0);
  });
  it('serializes two different bookings by the same caller at their maximum', async () => {
    // The third caller has one Friday shift. Two simultaneous non-overlapping choices cannot both become their second.
    const answers = await Promise.all([slots[1], slots[2]].map(slotId => post(clients[2]!, '/volunteer/assignments', { slotId })));
    expect(answers.map(a => a.status).sort()).toEqual([200, 422]);
    expect((await view(clients[2]!)).assignments).toHaveLength(2);
  });
  it('can rebook an admin-cancelled future reservation without a unique-key failure or lost confirmation', async () => {
    const index = 1 - winner, c = clients[index]!, v = await view(c);
    const free = v.slots.find((s: any) => slots.includes(s.id) && s.openSpots > 0 && s.startDates.length > 0);
    const [old] = await db.insert(shiftAssignmentsTable).values({ volunteerProfileId: profiles[index]!,
      shiftSlotId: free.id, startDate: free.startDates[0], endDate: pacificDay(new Date()),
      endedReason: 'admin_removed', createdByUserId: ids[3]! }).returning();
    const booked = await post(c, '/volunteer/assignments', { slotId: free.id, startDate: free.startDates[0] });
    expect(booked.status).toBe(200); expect(booked.data.assignmentId).toBe(old!.id);
    expect((await view(c)).assignments).toHaveLength(1);
    const log = await db.select().from(notificationLogTable).where(eq(notificationLogTable.recipientUserId, ids[index]!));
    expect(log).toHaveLength(1); expect(log[0]!.status).toBe('logged');
  });
});
