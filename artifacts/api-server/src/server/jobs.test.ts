import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { and, eq, inArray } from 'drizzle-orm';
import { db, pool, usersTable, volunteerProfilesTable, shiftSlotsTable, shiftAssignmentsTable,
  shiftSkipsTable, notificationLogTable, reminderJobRunsTable } from '@workspace/db';
import { slotInstant } from './scheduleService';

process.env.NODE_ENV = 'development';
process.env.POSTMARK_SERVER_TOKEN = '';
process.env.EMAIL_FROM = '';
const testSecret = `unit-only-${randomUUID()}`;
process.env.JOBS_SECRET = testSecret;
let jobs: typeof import('./jobs');
let server: Server;
let base: string;
const tag = `reminder-${randomUUID()}`;
const users: string[] = [], profiles: string[] = [], slots: string[] = [], assignments: string[] = [], runs: string[] = [], sids: string[] = [];
let admin: string, active: string, volunteer: string, inactive: string, unverified: string;
let activeAssignment: string;
const fakeAt = slotInstant('2030-01-07', '23:07'); // Tuesday's unusual time cannot match seeded daytime slots.
async function person(role: 'admin' | 'volunteer', status = 'active', verified = true) {
  const [u] = await db.insert(usersTable).values({ email: `${tag}-${users.length}@example.invalid`, firstName: 'Reminder', lastName: tag,
    passwordHash: 'unused', role, emailVerifiedAt: verified ? new Date() : null }).returning();
  users.push(u!.id);
  if (role === 'volunteer') {
    const [p] = await db.insert(volunteerProfilesTable).values({ userId: u!.id, status: status as 'active' | 'inactive',
      onboardingCompletedAt: new Date(), agreementAcknowledgedAt: new Date() }).returning();
    profiles.push(p!.id);
    return { userId: u!.id, profileId: p!.id };
  }
  return { userId: u!.id, profileId: '' };
}
async function session(userId: string) {
  const id = randomUUID(); sids.push(id);
  const csrf = randomUUID();
  await pool.query('insert into "sessions" (sid,sess,expire) values($1,$2,now()+interval \'1 hour\')',
    [id, JSON.stringify({ cookie: { originalMaxAge: 3600000, expires: new Date(Date.now() + 3600000).toISOString(), httpOnly: true, secure: true, sameSite: 'lax' },
      userId, authVersion: 0, csrfToken: csrf })]);
  // Sign the session as middleware does, without inspecting or printing the workspace secret.
  const { createHmac } = await import('node:crypto');
  const signature = createHmac('sha256', process.env.SESSION_SECRET!).update(id).digest('base64').replace(/=+$/, '');
  return { cookie: `alliance.sid=${encodeURIComponent(`s:${id}.${signature}`)}`, 'x-csrf-token': csrf };
}
beforeAll(async () => {
  jobs = await import('./jobs');
  const app = (await import('../app')).default;
  server = await new Promise<Server>(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  admin = (await person('admin')).userId;
  const a = await person('volunteer'); active = a.profileId; volunteer = a.userId;
  inactive = (await person('volunteer', 'inactive')).profileId;
  unverified = (await person('volunteer', 'active', false)).userId;
  const skipped = await person('volunteer');
  const [slot] = await db.insert(shiftSlotsTable).values({ dayOfWeek: 2, startTime: '23:07', endTime: '23:37', capacity: 3, label: tag }).returning();
  slots.push(slot!.id);
  for (const profile of [active, inactive, skipped.profileId]) {
    const [a] = await db.insert(shiftAssignmentsTable).values({ shiftSlotId: slot!.id, volunteerProfileId: profile, startDate: '2030-01-01', createdByUserId: admin }).returning();
    assignments.push(a!.id);
    if (profile === active) activeAssignment = a!.id;
    if (profile === skipped.profileId) await db.insert(shiftSkipsTable).values({ shiftAssignmentId: a!.id, skipDate: '2030-01-08' });
  }
});
afterAll(async () => {
  if (server) await new Promise<void>(resolve => server.close(() => resolve()));
  if (users.length) await db.delete(notificationLogTable).where(inArray(notificationLogTable.recipientUserId, users));
  if (runs.length) await db.delete(reminderJobRunsTable).where(inArray(reminderJobRunsTable.id, runs));
  if (assignments.length) {
    await db.delete(shiftSkipsTable).where(inArray(shiftSkipsTable.shiftAssignmentId, assignments));
    await db.delete(shiftAssignmentsTable).where(inArray(shiftAssignmentsTable.id, assignments));
  }
  if (slots.length) await db.delete(shiftSlotsTable).where(inArray(shiftSlotsTable.id, slots));
  if (profiles.length) await db.delete(volunteerProfilesTable).where(inArray(volunteerProfilesTable.id, profiles));
  if (sids.length) await pool.query('delete from "sessions" where sid=any($1::text[])', [sids]);
  if (users.length) await db.delete(usersTable).where(inArray(usersTable.id, users));
  await pool.end();
});
async function request(path: string, method = 'GET', headers: Record<string, string> = {}, data?: unknown) {
  return fetch(`${base}/api${path}`, { method, headers: { 'content-type': 'application/json', ...headers },
    ...(method !== 'GET' ? { body: JSON.stringify(data ?? {}) } : {}) });
}
describe('Reminder job persistence, safeguards and delivery', () => {
  it('defaults automatic scheduling off and configures exactly one Pacific quarter-hour task when enabled', async () => {
    const cron = (await import('node-cron')).default;
    const schedule = vi.spyOn(cron, 'schedule').mockReturnValue({} as ReturnType<typeof cron.schedule>);
    expect(jobs.startReminderJobs({})).toBeNull();
    expect(jobs.startReminderJobs({ RUN_JOBS: 'false' })).toBeNull();
    expect(schedule).not.toHaveBeenCalled();
    jobs.startReminderJobs({ RUN_JOBS: 'true' });
    expect(schedule).toHaveBeenCalledWith('*/15 * * * *', expect.any(Function),
      { timezone: 'America/Los_Angeles', noOverlap: true, name: 'alliance-shift-reminders' });
    schedule.mockRestore();
  });
  it('serializes checks across processes through a database lock', async () => {
    const c = await pool.connect();
    try {
      await c.query('select pg_advisory_lock($1)', [jobs.REMINDER_JOB_LOCK]);
      expect(await jobs.runReminderCheck({ at: fakeAt })).toEqual({ skippedRun: true, run: null });
    } finally { await c.query('select pg_advisory_unlock($1)', [jobs.REMINDER_JOB_LOCK]); c.release(); }
  });
  it('sends only the eligible occurrence, persists results and safely deduplicates a rerun', async () => {
    const first = await jobs.runReminderCheck({ at: fakeAt, source: 'command' });
    if (first.run) runs.push(first.run.id);
    expect(first.run?.status).toBe('completed');
    expect(first.run?.counts).toEqual({ eligible: 1, sent: 0, logged: 1, failed: 0, skipped: 0, suppressed: 0 });
    const second = await jobs.runReminderCheck({ at: fakeAt, source: 'command' });
    if (second.run) runs.push(second.run.id);
    expect(second.run?.counts.skipped).toBe(1);
    const audits = await db.select().from(notificationLogTable).where(eq(notificationLogTable.relatedId, `${activeAssignment}:2030-01-08:24h`));
    expect(audits).toHaveLength(1); expect(audits[0]?.recipientUserId).toBe(volunteer); expect(audits[0]?.status).toBe('logged');
    expect((await jobs.reminderJobStatus()).lastRun?.id).toBe(second.run?.id);
  });
  it('protects staff actions with admin authentication and CSRF and derives the test recipient on the server', async () => {
    expect((await request('/admin/notifications/jobs')).status).toBe(401);
    const vol = await session(volunteer), uv = await session(unverified), staff = await session(admin);
    expect((await request('/admin/notifications/jobs', 'GET', vol)).status).toBe(403);
    expect((await request('/admin/notifications/jobs', 'GET', uv)).status).toBe(403);
    expect((await request('/admin/notifications/jobs/run', 'POST', { cookie: staff.cookie })).status).toBe(403);
    expect((await request('/admin/notifications/jobs/run?at=not-a-time', 'POST', staff)).status).toBe(400);
    expect((await request('/admin/notifications/jobs/test', 'POST', staff, { requestId: randomUUID(), to: 'outsider@example.invalid' })).status).toBe(400);
    const id = randomUUID();
    const first = await request('/admin/notifications/jobs/test', 'POST', staff, { requestId: id });
    expect(first.status).toBe(200); expect(await first.json()).toMatchObject({ ok: true, status: 'logged', skipped: false });
    const second = await request('/admin/notifications/jobs/test', 'POST', staff, { requestId: id });
    expect(await second.json()).toMatchObject({ ok: true, status: 'logged', skipped: true });
    const audit = await db.select().from(notificationLogTable).where(eq(notificationLogTable.relatedId, `test:${admin}:${id}`));
    expect(audit).toHaveLength(1); expect(audit[0]?.recipientUserId).toBe(admin); expect(audit[0]?.subject).toContain('[Test]');
    const response = await request(`/admin/notifications/jobs/run?at=${encodeURIComponent(fakeAt.toISOString())}`, 'POST', staff);
    expect(response.status).toBe(200); const result = await response.json() as Awaited<ReturnType<typeof jobs.runReminderCheck>>; runs.push(result.run!.id);
    expect(result.run!.counts.skipped).toBe(1);
  });
  it('accepts the dedicated machine header without a session/CSRF, never a query secret or admin cookie alone', async () => {
    delete process.env.JOBS_SECRET;
    expect((await request('/jobs/run', 'POST')).status).toBe(503);
    process.env.JOBS_SECRET = testSecret;
    expect((await request('/jobs/run', 'POST')).status).toBe(401);
    expect((await request('/jobs/run', 'POST', { JOBS_SECRET: 'wrong' })).status).toBe(401);
    expect((await request('/jobs/run', 'POST', await session(admin))).status).toBe(401);
    const response = await request('/jobs/run', 'POST', { JOBS_SECRET: testSecret });
    expect(response.status).toBe(200);
    const result = await response.json() as Awaited<ReturnType<typeof jobs.runReminderCheck>>; if (result.run) runs.push(result.run.id);
    const overrides = await request(`/jobs/run?at=${fakeAt.toISOString()}`, 'POST', { JOBS_SECRET: testSecret });
    expect(overrides.status).toBe(400);
  });
});
