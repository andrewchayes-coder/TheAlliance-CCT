import cron from 'node-cron';
import { z } from 'zod/v4';
import { and, count, desc, eq, gte, inArray, isNotNull, sql } from 'drizzle-orm';
import { db, pool, withJobDatabase, reminderJobRunsTable, notificationLogTable, resourcesTable, usersTable, volunteerProfilesTable } from '@workspace/db';
import { appConfig } from '@workspace/shared/appConfig';
import { appOrigin } from '../auth/session';
import { sendEmail } from '../email';
import { logger } from '../lib/logger';
import { readScheduleData } from './scheduleRepository';
import { addCalendarDays, pacificDay, slotInstant, type Occurrence, TIME_ZONE } from './scheduleService';
import { reminderRange, selectReminders, reminderEmail, type ReminderSnapshot, type ReminderCandidate } from './reminders';
import { automaticJobsEnabled, currentJobBudget, withJobBudget } from './job-budget';
import { isUncertainDelivery } from './delivery-state';

export const REMINDER_JOB_LOCK = 91847312;
export const emptyCounts = () => ({ eligible: 0, sent: 0, logged: 0, failed: 0, skipped: 0, suppressed: 0, deferred: 0, uncertain: 0 });
type Counts = ReturnType<typeof emptyCounts>;
type Source = 'cron' | 'admin' | 'external' | 'command';
async function quickLinks() {
  const rows = await db.select({ label: resourcesTable.title, url: resourcesTable.url }).from(resourcesTable)
    .where(and(eq(resourcesTable.type, 'link'), eq(resourcesTable.isPublished, true), eq(resourcesTable.isQuickLink, true)))
    .orderBy(resourcesTable.sortOrder);
  return rows.filter((r): r is { label: string; url: string } => !!r.url);
}
async function snapshot(from: string, to: string, profileId?: string): Promise<ReminderSnapshot> {
  return db.transaction(async tx => {
    const schedule = await readScheduleData(tx, profileId, { from, to });
    const ids = [...new Set([...schedule.assignments,...schedule.customAssignments].map(a => a.volunteerProfileId))];
    const people = ids.length ? await tx.select({ profileId: volunteerProfilesTable.id, userId: usersTable.id,
      email: usersTable.email, firstName: usersTable.firstName, status: volunteerProfilesTable.status,
      isActive: usersTable.isActive, verifiedAt: usersTable.emailVerifiedAt }).from(volunteerProfilesTable)
      .innerJoin(usersTable, eq(usersTable.id, volunteerProfilesTable.userId))
      .where(and(inArray(volunteerProfilesTable.id, ids), eq(usersTable.role, 'volunteer'))) : [];
    return { schedule, people: people.map(p => ({ ...p, verified: !!p.verifiedAt })), links: [] };
  }, { isolationLevel: 'repeatable read' });
}
const serialize = (r: typeof reminderJobRunsTable.$inferSelect) => ({
  ...r, counts: { ...emptyCounts(), ...r.counts },
  startedAt: r.startedAt.toISOString(), checkedAt: r.checkedAt.toISOString(), finishedAt: r.finishedAt?.toISOString() ?? null,
});
async function recordDelivery(candidate: ReminderCandidate, links: ReminderSnapshot['links'], now: Date, counts: Counts) {
  // Refresh immediately before delivery: a newly skipped, closed, released or inactive shift is suppressed.
  const fresh = await snapshot(candidate.occurrence.date, candidate.occurrence.date, candidate.person.profileId);
  const freshNow = new Date(now.getTime() + (currentJobBudget()?.elapsedMs ?? 0));
  const valid = selectReminders(fresh, freshNow, appConfig, true).find(c => c.relatedId === candidate.relatedId);
  if (!valid) { counts.suppressed++; return; }
  const copy = reminderEmail(valid, links, freshNow, appOrigin);
  const result = await sendEmail({ type: 'reminder', to: valid.person.email, toUserId: valid.person.userId,
    relatedId: valid.relatedId, ...copy,
    ...(z.email().safeParse(appConfig.adminContact?.trim()).success ? { replyTo: appConfig.adminContact!.trim() } : {}) });
  if (result.uncertain) { counts.uncertain++; return; }
  if (result.deferred) { counts.deferred++; return; }
  if (result.skipped) { counts.skipped++; return; }
  if (!result.ok) { counts.failed++; return; }
  const [delivery] = await db.select({ status: notificationLogTable.status }).from(notificationLogTable)
    .where(and(eq(notificationLogTable.type, 'reminder'), eq(notificationLogTable.relatedId, valid.relatedId),
      eq(notificationLogTable.recipientUserId, valid.person.userId))).orderBy(desc(notificationLogTable.createdAt)).limit(1);
  if (delivery?.status === 'sent') counts.sent++;
  else if (delivery?.status === 'logged') counts.logged++;
  else if (delivery?.status === 'suppressed') counts.suppressed++;
  else throw new Error('Reminder delivery did not have a confirmed audit row.');
}
/** RUN_JOBS gates the automatic scheduler, not authorized manual/external checks. */
export async function runReminderCheck({ at = new Date(), source = 'admin' as Source } = {}): Promise<{
  skippedRun: boolean; run: ReturnType<typeof serialize> | null;
}> {
  if (!currentJobBudget()) return withJobDatabase(() => withJobBudget(() => runReminderCheck({ at, source })));
  const budget = currentJobBudget()!;
  if (!budget.canStart()) return { skippedRun: true, run: null };
  const range = reminderRange(at, appConfig);
  const connection = await pool.connect();
  let locked = false;
  let runId: string | undefined;
  const counts = emptyCounts();
  try {
    const claim = await connection.query('select pg_try_advisory_lock($1) as acquired', [REMINDER_JOB_LOCK]);
    locked = claim.rows[0].acquired;
    if (!locked) return { skippedRun: true, run: null };
    await db.update(reminderJobRunsTable).set({ status: 'failed', finishedAt: new Date(),
      error: 'Interrupted before completion. Safe to retry; confirmed deliveries are deduplicated.' })
      .where(eq(reminderJobRunsTable.status, 'running'));
    const [record] = await db.insert(reminderJobRunsTable).values({ source, status: 'running', checkedAt: at }).returning();
    runId = record!.id;
    const data = await snapshot(range.fromDate, range.toDate);
    const eligible = selectReminders(data, at, appConfig, true);
    counts.eligible = eligible.length;
    // Filter handled recipients before batching, so repeat calls don't spend
    // their budget on already-delivered rows and starve remaining volunteers.
    const previous = eligible.length ? await db.select({
      relatedId: notificationLogTable.relatedId, recipientUserId: notificationLogTable.recipientUserId,
      status: notificationLogTable.status, error: notificationLogTable.error,
    }).from(notificationLogTable).where(and(eq(notificationLogTable.type, 'reminder'),
      inArray(notificationLogTable.relatedId, eligible.map(c => c.relatedId)))) : [];
    const candidates = eligible.filter(c => {
      const rows = previous.filter(r => r.relatedId === c.relatedId && r.recipientUserId === c.person.userId);
      if (rows.some(r => r.status === 'sent' || r.status === 'logged' || r.status === 'suppressed')) { counts.skipped++; return false; }
      if (rows.some(r => isUncertainDelivery(r.error))) { counts.uncertain++; return false; }
      return true;
    });
    const links = await quickLinks();
    for (let i = 0; i < candidates.length; i += 5) {
      if (!budget.canStart()) { counts.deferred += candidates.length - i; break; }
      const batch = await Promise.allSettled(candidates.slice(i, i + 5).map(c => recordDelivery(c, links, at, counts)));
      const failure = batch.find(r => r.status === 'rejected');
      if (failure?.status === 'rejected') throw failure.reason;
    }
    const [finished] = await db.update(reminderJobRunsTable).set({ status: 'completed', finishedAt: new Date(), counts,
      error: counts.deferred ? 'Time budget reached. Unsent reminders remain eligible for the next catch-up check.' : null })
      .where(eq(reminderJobRunsTable.id, runId)).returning();
    logger.info({ runId, source, counts }, 'Shift reminder check completed.');
    return { skippedRun: false, run: serialize(finished!) };
  } catch (err) {
    if (runId) {
      try { await db.update(reminderJobRunsTable).set({ status: 'failed', finishedAt: new Date(), counts,
        error: 'The check was interrupted. Check server logs and retry; confirmed deliveries will not be repeated.' })
        .where(eq(reminderJobRunsTable.id, runId)); } catch { /* Database outage; retained running row is recovered on the next check. */ }
    }
    logger.error({ err, runId }, 'Shift reminder check failed.');
    throw err;
  } finally {
    try { if (locked) await connection.query('select pg_advisory_unlock($1)', [REMINDER_JOB_LOCK]); }
    finally { connection.release(); }
  }
}
export async function reminderJobStatus() {
  const [lastRun] = await db.select().from(reminderJobRunsTable).orderBy(desc(reminderJobRunsTable.startedAt)).limit(1);
  const totals = await db.select({ status: notificationLogTable.status, total: count() }).from(notificationLogTable)
    .where(and(eq(notificationLogTable.type, 'reminder'), gte(notificationLogTable.createdAt, new Date(Date.now() - 7 * 86400000)),
      sql`(${notificationLogTable.relatedId} ~ '^[0-9a-f-]{36}:[0-9]{4}-[0-9]{2}-[0-9]{2}:(24h|am)$' or ${notificationLogTable.relatedId} ~ '^custom:[0-9a-f-]{36}:[0-9a-f-]{36}:(24h|am)$')`))
    .groupBy(notificationLogTable.status);
  return { lastRun: lastRun ? serialize(lastRun) : null, schedulerEnabled: automaticJobsEnabled(),
    externalTriggerConfigured: (process.env.JOBS_SECRET?.length ?? 0) >= 32, timezone: TIME_ZONE, cron: '*/15 * * * *',
    reminderHoursBefore: appConfig.reminderHoursBefore, sameMorningReminder: appConfig.sameMorningReminder as boolean,
    sameMorningReminderHour: appConfig.sameMorningReminderHour,
    last7Days: { sent: Number(totals.find(t => t.status === 'sent')?.total ?? 0),
      logged: Number(totals.find(t => t.status === 'logged')?.total ?? 0), failed: Number(totals.find(t => t.status === 'failed')?.total ?? 0) } };
}
export async function sendTestReminder(adminId: string, requestId: string) {
  const [admin] = await db.select().from(usersTable).where(and(eq(usersTable.id, adminId), eq(usersTable.role, 'admin'),
    eq(usersTable.isActive, true), isNotNull(usersTable.emailVerifiedAt)));
  if (!admin) throw new Error('The test recipient is not an active, verified administrator.');
  const at = new Date(), date = addCalendarDays(pacificDay(at), 1);
  const occurrence: Occurrence = { slot: { id: 'test', dayOfWeek: new Date(`${date}T12:00Z`).getUTCDay(),
    startTime: '09:00', endTime: '11:00', capacity: 1, label: null, isActive: true },
    date, startsAt: slotInstant(date, '09:00'), endsAt: slotInstant(date, '11:00'), assignedVolunteers: [] };
  const candidate: ReminderCandidate = { occurrence, assignmentId: 'test', variant: '24h', relatedId: `test:${admin.id}:${requestId}`,
    person: { profileId: 'test', userId: admin.id, email: admin.email, firstName: admin.firstName, status: 'active', isActive: true, verified: true } };
  const result = await sendEmail({ type: 'reminder', to: admin.email, toUserId: admin.id, relatedId: candidate.relatedId,
    ...reminderEmail(candidate, await quickLinks(), at, appOrigin, true) });
  const [audit] = await db.select({ status: notificationLogTable.status }).from(notificationLogTable)
    .where(and(eq(notificationLogTable.type, 'reminder'), eq(notificationLogTable.relatedId, candidate.relatedId),
      eq(notificationLogTable.recipientUserId, admin.id))).orderBy(desc(notificationLogTable.createdAt)).limit(1);
  return { ok: result.ok, skipped: !!result.skipped, status: audit?.status ?? 'failed', error: result.error ?? null };
}
export function startReminderJobs(env: NodeJS.ProcessEnv = process.env) {
  if (!automaticJobsEnabled(env)) { logger.info('Automatic reminder jobs disabled; production uses an external trigger.'); return null; }
  return cron.schedule('*/15 * * * *', async () => {
    try { await runReminderCheck({ source: 'cron' }); } catch { /* recorded by runner */ }
  }, { timezone: TIME_ZONE, noOverlap: true, name: 'alliance-shift-reminders' });
}
