import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { and, eq, inArray } from 'drizzle-orm';
import { db, pool, withJobDatabase, usersTable, volunteerProfilesTable, shiftSlotsTable, shiftAssignmentsTable,
  shiftSkipsTable, notificationLogTable, reminderJobRunsTable } from '@workspace/db';
import { slotInstant } from './scheduleService';
import { JobBudget, withJobBudget } from './job-budget';
import * as email from '../email';

// All reminder enumerations are restricted to this file's fixture scope.
vi.mock('./scheduleRepository', async original => {
  const repo = await original<typeof import('./scheduleRepository')>();
  return { ...repo, readScheduleData: async (...args: Parameters<typeof repo.readScheduleData>) => {
    const data = await repo.readScheduleData(...args);
    return { ...data, slots: data.slots.filter(s => s.label === tag),
      assignments: data.assignments.filter(a => profiles.includes(a.volunteerProfileId)) };
  } };
});
vi.mock('./coverageAlerts', async original => ({ ...await original<typeof import('./coverageAlerts')>(), runDailyDigest: vi.fn() }));
vi.mock('./monthly-email-limit', async original => ({ ...await original<typeof import('./monthly-email-limit')>(), checkMonthlyEmailLimit: vi.fn() }));

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
  const [slot] = await db.insert(shiftSlotsTable).values({ dayOfWeek: 2, startTime: '23:07', endTime: '23:37', capacity: 10, label: tag }).returning();
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
  return fetch(`${base}/api${path}`, { method, headers: { Origin: (await import('../auth/session')).appOrigin, 'content-type': 'application/json', ...headers },
    ...(method !== 'GET' ? { body: JSON.stringify(data ?? {}) } : {}) });
}
describe('Reminder job persistence, safeguards and delivery', () => {
  it('defaults automatic scheduling off and configures exactly one Pacific quarter-hour task when enabled', async () => {
    const cron = (await import('node-cron')).default;
    const schedule = vi.spyOn(cron, 'schedule').mockReturnValue({} as ReturnType<typeof cron.schedule>);
    expect(jobs.startReminderJobs({})).toBeNull();
    expect(jobs.startReminderJobs({ RUN_JOBS: 'false' })).toBeNull();
    expect(jobs.startReminderJobs({ NODE_ENV: 'production', RUN_JOBS: 'true' })).toBeNull();
    const coverage = await import('./coverageAlerts');
    expect(coverage.startCoverageDigest({ NODE_ENV: 'production', RUN_JOBS: 'true' })).toBeNull();
    expect(coverage.startCoverageDigest({ RUN_JOBS: 'false' })).toBeNull();
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
    expect(first.run?.counts).toEqual({ eligible: 1, sent: 0, logged: 1, failed: 0, skipped: 0, suppressed: 0, deferred: 0, uncertain: 0 });
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
    const response = await request('/jobs/run', 'POST', { 'X-Jobs-Secret': testSecret });
    expect(response.status).toBe(200);
    expect(await response.clone().json()).toMatchObject({ budgetMs: 20000, incomplete: false, elapsedMs: expect.any(Number) });
    const result = await response.json() as Awaited<ReturnType<typeof jobs.runReminderCheck>>; if (result.run) runs.push(result.run.id);
    const overrides = await request(`/jobs/run?at=${fakeAt.toISOString()}`, 'POST', { JOBS_SECRET: testSecret });
    expect(overrides.status).toBe(400);
  });
  it('resumes unsent recipients 15 minutes late without a queue or repeated deliveries', async () => {
    let retryId: string | undefined;
    for (let i = 0; i < 6; i++) {
      const volunteer = await person('volunteer');
      const [assignment] = await db.insert(shiftAssignmentsTable).values({ shiftSlotId: slots[0]!,
        volunteerProfileId: volunteer.profileId, startDate: '2030-01-01', createdByUserId: admin }).returning();
      assignments.push(assignment!.id);
      if (i === 0) {
        const to = (await db.select().from(usersTable).where(eq(usersTable.id, volunteer.userId)))[0]!.email;
        const send = email.createEmailService({ settings: () => ({ token: 'synthetic', from: 'fixture@example.invalid' }),
          deliveryClient: () => ({ sendEmail: async () => { throw Object.assign(new Error('Provider rejected'), { statusCode: 429 }); } }),
          log: { info() {}, warn() {}, error() {} } });
        await send({ type: 'reminder', to, toUserId: volunteer.userId,
          relatedId: `${assignment!.id}:2030-01-08:24h`, subject: 'Retry fixture', html: '<p>Test</p>', text: 'Test' });
        retryId = (await db.select().from(notificationLogTable).where(
          eq(notificationLogTable.relatedId, `${assignment!.id}:2030-01-08:24h`)))[0]!.id;
      }
    }
    let elapsed = 0;
    const original = email.sendEmail;
    const delivery = vi.spyOn(email, 'sendEmail').mockImplementation(async options => {
      const result = await original(options);
      elapsed += 1500; // Five settled deliveries consume the next batch's reserve.
      return result;
    });
    try {
      const budget = new JobBudget(() => elapsed);
      const result = await withJobDatabase(() => withJobBudget(() => jobs.runReminderCheck({
        at: new Date(fakeAt.getTime() + 15 * 60000), source: 'external' }), budget));
      if (result.run) runs.push(result.run.id);
      expect(result.run?.counts).toMatchObject({ logged: 5, skipped: 1, deferred: 1 });
      expect(budget.deferred).toBe(true);
    } finally { delivery.mockRestore(); }
    const result = await jobs.runReminderCheck({ at: new Date(fakeAt.getTime() + 30 * 60000), source: 'external' });
    if (result.run) runs.push(result.run.id);
    expect(result.run?.counts).toMatchObject({ logged: 1, skipped: 6, deferred: 0 });
    const again = await jobs.runReminderCheck({ at: new Date(fakeAt.getTime() + 45 * 60000) });
    if (again.run) runs.push(again.run.id);
    expect(again.run?.counts).toMatchObject({ logged: 0, skipped: 7 });
    expect((await db.select().from(notificationLogTable).where(eq(notificationLogTable.id, retryId!)))[0]!.status).toBe('logged');
  });
  it('blocks uncertain delivery on every later catch-up run', async () => {
    const volunteer = await person('volunteer');
    const [assignment] = await db.insert(shiftAssignmentsTable).values({ shiftSlotId: slots[0]!,
      volunteerProfileId: volunteer.profileId, startDate: '2030-01-01', createdByUserId: admin }).returning();
    assignments.push(assignment!.id);
    const to = (await db.select().from(usersTable).where(eq(usersTable.id, volunteer.userId)))[0]!.email;
    const provider = vi.fn(async () => { throw new Error('Provider connection timed out'); });
    const send = email.createEmailService({ settings: () => ({ token: 'synthetic', from: 'fixture@example.invalid' }),
      deliveryClient: () => ({ sendEmail: provider }), log: { info() {}, warn() {}, error() {} } });
    const options = { type: 'reminder' as const, to, toUserId: volunteer.userId,
      relatedId: `${assignment!.id}:2030-01-08:24h`, subject: 'Fixture reminder', html: '<p>Test</p>', text: 'Test' };
    expect(await send(options)).toMatchObject({ ok: false, uncertain: true });
    expect(await send(options)).toMatchObject({ skipped: true, uncertain: true });
    expect(provider).toHaveBeenCalledTimes(1);
    const result = await jobs.runReminderCheck({ at: new Date(fakeAt.getTime() + 60 * 60000) });
    if (result.run) runs.push(result.run.id);
    expect(result.run?.counts).toMatchObject({ uncertain: 1, logged: 0, skipped: 7 });
  });
});
