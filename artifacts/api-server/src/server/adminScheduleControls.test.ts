import { beforeAll, afterAll, it, expect, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { db, pool, usersTable, volunteerProfilesTable, shiftSlotsTable, shiftAssignmentsTable, shiftSkipsTable,
  activityLogTable, notificationLogTable, sessionsTable, appSettingsTable } from '@workspace/db';
import { slotInstant, pacificDay } from './scheduleService';
import * as repository from './scheduleRepository';
process.env.NODE_ENV = 'development'; process.env.POSTMARK_SERVER_TOKEN = ''; process.env.EMAIL_FROM = '';
type Client = (path: string, method?: string, body?: unknown) => Promise<{ status: number; data: any }>;
const tag = `override-${randomUUID()}`, ids: string[] = [], profiles: string[] = [], slots: string[] = [], sessions: string[] = [];
let base: string, origin: string, server: Server, admin: Client, vol: Client, anon: Client;
let adminScheduleAction: typeof import('./adminScheduleControls').adminScheduleAction;
let coverage: typeof import('./coverageAlerts'), savedSettings: typeof appSettingsTable.$inferSelect;
const now = slotInstant('2026-10-05', '07:00');
async function client(id?: string): Promise<Client> {
  const boot = await fetch(`${base}/api/auth/session`, { headers: { 'x-forwarded-proto': 'https' } });
  const cookie = boot.headers.get('set-cookie')!.split(';')[0]!, { csrfToken } = await boot.json() as { csrfToken: string };
  const sid = decodeURIComponent(cookie.split('=').slice(1).join('=')).slice(2).split('.')[0]!;
  sessions.push(sid);
  if (id) { const { rows } = await pool.query('SELECT sess FROM sessions WHERE sid=$1', [sid]);
    await pool.query('UPDATE sessions SET sess=$1 WHERE sid=$2', [JSON.stringify({ ...rows[0]!.sess, userId: id, authVersion: 0 }), sid]); }
  return async (path, method = 'GET', body) => {
    const r = await fetch(`${base}/api${path}`, { method, headers: { cookie, Origin: origin, 'x-forwarded-proto': 'https',
      'X-CSRF-Token': csrfToken, 'Content-Type': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    return { status: r.status, data: await r.json() };
  };
}
beforeAll(async () => {
  const { default: app } = await import('../app'); origin = (await import('../auth/session')).appOrigin;
  ({ adminScheduleAction } = await import('./adminScheduleControls')); coverage = await import('./coverageAlerts');
  [savedSettings] = await db.select().from(appSettingsTable).where(eq(appSettingsTable.id, 'schedule'));
  server = createServer(app); await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  for (const role of ['admin', 'volunteer', 'volunteer', 'volunteer'] as const) {
    const [u] = await db.insert(usersTable).values({ role, email: `${tag}-${ids.length}@example.invalid`,
      firstName: 'Jordan', lastName: 'Review', emailVerifiedAt: new Date(), passwordHash: 'not-usable' }).returning();
    ids.push(u!.id);
    if (role === 'volunteer') {
      const [p] = await db.insert(volunteerProfilesTable).values({ userId: u!.id, status: 'active',
        agreementAcknowledgedAt: new Date(), onboardingCompletedAt: new Date(), certificationStatus: 'complete',
        backgroundCheckStatus: 'cleared' }).returning(); profiles.push(p!.id);
    }
  }
  for (const day of [1, 2, 3, 4]) {
    const [s] = await db.insert(shiftSlotsTable).values({ dayOfWeek: day, startTime: '21:00', endTime: '22:00',
      capacity: 1, label: tag }).returning(); slots.push(s!.id);
  }
  admin = await client(ids[0]); vol = await client(ids[1]); anon = await client();
});
afterAll(async () => {
  vi.restoreAllMocks();
  if (savedSettings) await db.update(appSettingsTable).set(savedSettings).where(eq(appSettingsTable.id, 'schedule'));
  const activities = await db.select({ id: activityLogTable.id }).from(activityLogTable).where(inArray(activityLogTable.volunteerProfileId, profiles));
  if (activities.length) await db.delete(notificationLogTable).where(inArray(notificationLogTable.relatedId, activities.map(a => a.id)));
  await db.delete(notificationLogTable).where(inArray(notificationLogTable.recipientUserId, ids));
  await db.delete(activityLogTable).where(inArray(activityLogTable.volunteerProfileId, profiles));
  await db.delete(shiftAssignmentsTable).where(inArray(shiftAssignmentsTable.volunteerProfileId, profiles));
  await db.delete(shiftSlotsTable).where(inArray(shiftSlotsTable.id, slots));
  await db.delete(volunteerProfilesTable).where(inArray(volunteerProfilesTable.id, profiles));
  await db.delete(sessionsTable).where(inArray(sessionsTable.sid, sessions));
  await db.delete(usersTable).where(inArray(usersTable.id, ids));
  await new Promise<void>((r, j) => server.close(e => e ? j(e) : r())); await pool.end();
});
it('guards all new API methods and persists the staff digest setting', async () => {
  const paths: [string, string][] = [['/admin/schedule/controls', 'GET'], ['/admin/schedule/assignments', 'POST'],
    [`/admin/schedule/assignments/${randomUUID()}/remove`, 'POST'], [`/admin/schedule/assignments/${randomUUID()}/skips`, 'POST'],
    [`/admin/schedule/assignments/${randomUUID()}/skips/${randomUUID()}`, 'DELETE'], ['/admin/schedule/alerts', 'GET'],
    ['/admin/schedule/alerts', 'PATCH']];
  for (const [p, method] of paths) {
    expect((await anon(p, method, method === 'GET' ? undefined : {})).status).toBe(401);
    expect((await vol(p, method, method === 'GET' ? undefined : {})).status).toBe(403);
  }
  const list = await admin(`/admin/schedule/controls?q=${tag}`); expect(list.status).toBe(200);
  expect(list.data.volunteers).toHaveLength(3);
  expect((await admin('/admin/schedule/alerts', 'PATCH', { dailyDigestEnabled: false })).data.dailyDigestEnabled).toBe(false);
  expect((await admin('/admin/schedule/alerts')).data.dailyDigestEnabled).toBe(false);
});
it('requires an explicit reason for either override, audits both, and never bypasses eligibility or overlap', async () => {
  const actor = { id: ids[0]!, sessionVersion: 0 }, target = ids[1]!;
  for (const slotId of slots.slice(0, 2)) await adminScheduleAction(actor, { kind: 'assign', userId: target, slotId, override: false }, now);
  await expect(adminScheduleAction(actor, { kind: 'assign', userId: target, slotId: slots[2]!, override: false }, now)).rejects.toMatchObject({ status: 422 });
  await expect(adminScheduleAction(actor, { kind: 'assign', userId: target, slotId: slots[2]!, override: true, reason: ' ' }, now)).rejects.toMatchObject({ status: 422 });
  const over = await adminScheduleAction(actor, { kind: 'assign', userId: target, slotId: slots[2]!, override: true, reason: 'Cover the referral surge' }, now);
  const [activity] = await db.select().from(activityLogTable).where(and(eq(activityLogTable.volunteerProfileId, profiles[0]!),
    eq(activityLogTable.action, 'admin_shift_assign'))).orderBy(activityLogTable.createdAt);
  expect(activity).toBeDefined();
  const all = await db.select().from(activityLogTable).where(eq(activityLogTable.volunteerProfileId, profiles[0]!));
  expect(all.some(a => a.details?.reason === 'Cover the referral surge' && JSON.stringify(a.details.overrides).includes('volunteer_shift_limit'))).toBe(true);
  await expect(adminScheduleAction(actor, { kind: 'assign', userId: ids[2]!, slotId: slots[0]!, override: false }, now)).rejects.toMatchObject({ status: 422 });
  await adminScheduleAction(actor, { kind: 'assign', userId: ids[2]!, slotId: slots[0]!, override: true, reason: 'Train alongside Jordan' }, now);
  await db.update(volunteerProfilesTable).set({ backgroundCheckStatus: 'pending' }).where(eq(volunteerProfilesTable.id, profiles[2]!));
  await expect(adminScheduleAction(actor, { kind: 'assign', userId: ids[3]!, slotId: slots[3]!, override: true, reason: 'Cannot bypass clearance' }, now))
    .rejects.toMatchObject({ status: 422 });
  const [overlap] = await db.insert(shiftSlotsTable).values({ dayOfWeek: 3, startTime: '21:30', endTime: '22:30', capacity: 1, label: tag }).returning();
  slots.push(overlap!.id);
  await expect(adminScheduleAction(actor, { kind: 'assign', userId: target, slotId: overlap!.id, override: true, reason: 'Still cannot overlap' }, now))
    .rejects.toMatchObject({ status: 422 });
  expect(over.assignmentId).toBeTruthy();
});
it('supports close-in week off and undo, logs removals, and sends one combined deduplicated gap alert per active admin', async () => {
  const actor = { id: ids[0]!, sessionVersion: 0 };
  const [a] = await db.select().from(shiftAssignmentsTable).where(and(eq(shiftAssignmentsTable.volunteerProfileId, profiles[0]!),
    eq(shiftAssignmentsTable.shiftSlotId, slots[2]!)));
  // Admins can record an absence within 24 hours; the occurrence is not closed.
  const at = slotInstant('2026-10-07', '20:45');
  await adminScheduleAction(actor, { kind: 'skip', assignmentId: a!.id, date: '2026-10-07' }, at);
  const [skip] = await db.select().from(shiftSkipsTable).where(eq(shiftSkipsTable.shiftAssignmentId, a!.id));
  expect(skip).toBeDefined();
  const [event] = await db.select().from(activityLogTable).where(and(eq(activityLogTable.volunteerProfileId, profiles[0]!),
    eq(activityLogTable.action, 'admin_shift_skip')));
  const activeAdmins = await db.select({ id: usersTable.id }).from(usersTable).where(and(eq(usersTable.role, 'admin'), eq(usersTable.isActive, true)));
  const delivered = await db.select().from(notificationLogTable).where(eq(notificationLogTable.relatedId, event!.id));
  expect(delivered).toHaveLength(activeAdmins.length); expect(delivered.every(m => m.status === 'logged')).toBe(true);
  expect(delivered[0]!.subject).toContain('Jordan R. took the week off');
  await coverage.alertReleasedAssignments({ volunteerProfileId: profiles[0]!, assignmentIds: [a!.id], shiftSlotIds: [slots[2]!],
    effectiveDate: '2026-10-07', activityId: event!.id }, at);
  expect((await db.select().from(notificationLogTable).where(eq(notificationLogTable.relatedId, event!.id)))).toHaveLength(activeAdmins.length);
  await adminScheduleAction(actor, { kind: 'undo', assignmentId: a!.id, skipId: skip!.id }, at);
  const removed = await adminScheduleAction(actor, { kind: 'remove', assignmentId: a!.id, emailVolunteer: false }, at);
  expect(removed.message).toContain('released');
  const [ended] = await db.select().from(shiftAssignmentsTable).where(eq(shiftAssignmentsTable.id, a!.id));
  expect(ended!.endedReason).toBe('admin_removed');
  const ownMails = await db.select().from(notificationLogTable).where(eq(notificationLogTable.recipientUserId, ids[1]!));
  expect(ownMails).toHaveLength(3); // Assignment confirmations only; optional removal email stayed off.
});
it('processes an empty digest without email and deduplicates a nonempty digest by date', async () => {
  const at = slotInstant('2027-01-04', '07:00'), date = pacificDay(at);
  const mock = vi.spyOn(repository, 'readScheduleData');
  const priorLogs = await db.select({ id: notificationLogTable.id }).from(notificationLogTable)
    .where(and(eq(notificationLogTable.type, 'admin_alert'), eq(notificationLogTable.relatedId, date)));
  expect(priorLogs).toHaveLength(0);
  try {
    await db.update(appSettingsTable).set({ dailyDigestEnabled: true, lastDigestDate: null }).where(eq(appSettingsTable.id, 'schedule'));
    mock.mockResolvedValue({ slots: [], assignments: [], skips: [], closedDates: [] });
    await coverage.runDailyDigest(at);
    expect((await coverage.alertSettings()).lastDigestDate).toBe(date);
    expect((await db.select().from(notificationLogTable).where(eq(notificationLogTable.relatedId, date)))).toHaveLength(0);
    await db.update(appSettingsTable).set({ lastDigestDate: null }).where(eq(appSettingsTable.id, 'schedule'));
    const [s] = await db.select().from(shiftSlotsTable).where(eq(shiftSlotsTable.id, slots[0]!));
    mock.mockResolvedValue({ slots: [s!], assignments: [], skips: [], closedDates: [] });
    await coverage.runDailyDigest(at); await coverage.runDailyDigest(at);
    const messages = await db.select().from(notificationLogTable).where(eq(notificationLogTable.relatedId, date));
    const admins = await db.select().from(usersTable).where(and(eq(usersTable.role, 'admin'), eq(usersTable.isActive, true)));
    expect(messages).toHaveLength(admins.length); expect(messages.every(m => m.status === 'logged')).toBe(true);
    await db.update(appSettingsTable).set({ lastDigestDate: null }).where(eq(appSettingsTable.id, 'schedule'));
    await coverage.runDailyDigest(at); // Even if a worker retries the run, per-recipient notification history wins.
    expect((await db.select().from(notificationLogTable).where(eq(notificationLogTable.relatedId, date)))).toHaveLength(admins.length);
  } finally {
    mock.mockRestore();
    await db.delete(notificationLogTable).where(and(eq(notificationLogTable.type, 'admin_alert'), eq(notificationLogTable.relatedId, date)));
    await db.update(appSettingsTable).set(savedSettings).where(eq(appSettingsTable.id, 'schedule'));
  }
});
it('account deactivation ends reservations, invalidates sessions, and checks the resulting coverage', async () => {
  const actor = { id: ids[0]!, sessionVersion: 0 }, target = ids[2]!;
  await adminScheduleAction(actor, { kind: 'assign', userId: target, slotId: slots[3]!, override: false });
  const { setAccountActive } = await import('../auth/admin-management');
  await setAccountActive(actor, target, false);
  const rows = await db.select().from(shiftAssignmentsTable).where(eq(shiftAssignmentsTable.volunteerProfileId, profiles[1]!));
  expect(rows.every(a => a.endedReason === 'admin_removed')).toBe(true);
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, target));
  expect(user!.isActive).toBe(false); expect(user!.sessionVersion).toBe(1);
  const [activity] = await db.select().from(activityLogTable).where(and(eq(activityLogTable.volunteerProfileId, profiles[1]!),
    eq(activityLogTable.action, 'account_deactivated')));
  expect((activity!.details!.previousAssignments as unknown[]).length).toBe(2);
  const mail = await db.select().from(notificationLogTable).where(eq(notificationLogTable.relatedId, activity!.id));
  expect(mail.some(m => m.subject.includes('became inactive') && m.status === 'logged')).toBe(true);
});
