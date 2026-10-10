import { and, eq, sql } from 'drizzle-orm';
import { db, withJobDatabase, appSettingsTable, activityLogTable, volunteerProfilesTable, usersTable } from '@workspace/db';
import { readScheduleData } from './scheduleRepository';
import { addCalendarDays, createScheduleService, pacificDay, type ScheduleData, type ScheduleAssignment } from './scheduleService';
import { mondayOf } from './coordinatorSchedule';
import { sendEmail, createEmailTemplate } from '../email';
import { appOrigin } from '../auth/session';
import { logger } from '../lib/logger';
import type { ReleasedAssignments } from '../uncovered-shifts';
import { automaticJobsEnabled, currentJobBudget, withJobBudget } from './job-budget';
import { pendingRecipients } from './delivery-history';

export function gaps(data: ScheduleData, now: Date, days: number) {
  return createScheduleService(data).getOccurrences(pacificDay(now), addCalendarDays(pacificDay(now), days - 1))
    .filter(o => o.endsAt > now && o.assignedVolunteers.length < o.slot.capacity);
}
export function releaseGaps(data: ScheduleData, event: ReleasedAssignments,
  action: string, details: Record<string, unknown>, now: Date) {
  const skip = action === 'shift_skip' || action === 'admin_shift_skip';
  const date = typeof details.date === 'string' ? details.date : null;
  if (skip && !date) return [];
  const previous = Array.isArray(details.previousAssignments) ? details.previousAssignments as ScheduleAssignment[] : null;
  const before: ScheduleData = { ...data,
    assignments: data.assignments.map(a => {
      if (!event.assignmentIds.includes(a.id)) return a;
      if (skip) return a;
      const recorded = previous?.find(p => p.id === a.id);
      return recorded ?? { ...a, endDate: typeof details.oldEndDate === 'string' ? details.oldEndDate : null, endedReason: null };
    }),
    skips: skip ? data.skips.filter(s => !(event.assignmentIds.includes(s.shiftAssignmentId) && s.skipDate === date)) : data.skips,
  };
  const baseline = new Map(createScheduleService(before).getOccurrences(pacificDay(now), addCalendarDays(pacificDay(now), skip ? 6 : 13))
    .map(o => [`${o.slot.id}:${o.date}`, o.assignedVolunteers.length]));
  return gaps(data, now, skip ? 7 : 14).filter(o => event.shiftSlotIds.includes(o.slot.id)
    && (!skip || o.date === date) && o.assignedVolunteers.length < (baseline.get(`${o.slot.id}:${o.date}`) ?? 0));
}
const time = (s: string) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', hour: 'numeric', minute: '2-digit' })
  .format(new Date(`2000-01-01T${s}:00Z`));
export const gapLine = (o: ReturnType<typeof gaps>[number]) =>
  `${new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' })
    .format(new Date(`${o.date}T12:00:00Z`))}, ${time(o.slot.startTime)}–${time(o.slot.endTime)} now has ${o.assignedVolunteers.length} of ${o.slot.capacity} volunteers`;
async function notify(rows: ReturnType<typeof gaps>, relatedId: string, reason?: string) {
  const admins = await db.select({ id: usersTable.id, email: usersTable.email }).from(usersTable)
    .where(and(eq(usersTable.role, 'admin'), eq(usersTable.isActive, true)));
  const subject = reason ? `Coverage gap: ${gapLine(rows[0]!)} (${reason})${rows.length > 1 ? `; ${rows.length - 1} more` : ''}`
    : `Coverage digest: ${rows.length} shift${rows.length === 1 ? '' : 's'} need support`;
  const weeks = [...new Set(rows.map(o => mondayOf(o.date)))];
  const mail = createEmailTemplate({ heading: reason ? 'A shift needs coverage' : 'This week’s coverage',
    paragraphs: ['Thank you for helping keep support available to local families.',
      ...rows.map(o => `${gapLine(o)}${reason ? ` (${reason}).` : '.'}`),
      ...weeks.slice(1).map(w => `Also review the week of ${w}: ${appOrigin}/admin/schedule?weekStart=${w}`)],
    cta: { label: 'Review the master schedule', url: `${appOrigin}/admin/schedule?weekStart=${weeks[0]}` } });
  let ok = true;
  for (const admin of await pendingRecipients('admin_alert', relatedId, admins)) {
    if (currentJobBudget() && !currentJobBudget()!.canStart()) return false;
    const delivered = await sendEmail({ type: 'admin_alert', to: admin.email, toUserId: admin.id, subject, ...mail, relatedId });
    if (!delivered.ok && !delivered.uncertain) {
      ok = false;
      if (currentJobBudget()) currentJobBudget()!.retryNeeded = true;
    }
  }
  return ok;
}
export async function alertReleasedAssignments(event: ReleasedAssignments, now = new Date()) {
  const snapshot = await db.transaction(async tx => {
    const [activity] = await tx.select().from(activityLogTable).where(eq(activityLogTable.id, event.activityId));
    const [person] = await tx.select({ firstName: usersTable.firstName, lastName: usersTable.lastName })
      .from(volunteerProfilesTable).innerJoin(usersTable, eq(usersTable.id, volunteerProfilesTable.userId))
      .where(eq(volunteerProfilesTable.id, event.volunteerProfileId));
    return { data: await readScheduleData(tx), activity, person };
  }, { isolationLevel: 'repeatable read' });
  if (!snapshot.activity || !snapshot.person) return;
  const rows = releaseGaps(snapshot.data, event, snapshot.activity.action, snapshot.activity.details ?? {}, now);
  if (!rows.length) return;
  const name = `${snapshot.person.firstName} ${snapshot.person.lastName.slice(0, 1)}.`;
  const verb = snapshot.activity.action.includes('skip') ? 'took the week off' :
    snapshot.activity.action === 'shift_drop' ? 'dropped their shift' :
      snapshot.activity.action === 'status_changed' || snapshot.activity.action === 'account_deactivated' ? 'became inactive' :
        snapshot.activity.action === 'shift_change' ? 'changed their shift' : 'was removed from the shift';
  await notify(rows, event.activityId, `${name} ${verb}`);
}
export async function alertSettings() {
  const [s] = await db.select().from(appSettingsTable).where(eq(appSettingsTable.id, 'schedule'));
  return { dailyDigestEnabled: s?.dailyDigestEnabled ?? true, lastDigestDate: s?.lastDigestDate ?? null };
}
export async function setAlertSettings(enabled: boolean) {
  await db.insert(appSettingsTable).values({ id: 'schedule', dailyDigestEnabled: enabled }).onConflictDoUpdate({
    target: appSettingsTable.id, set: { dailyDigestEnabled: enabled, updatedAt: new Date() } });
  return alertSettings();
}
export function digestDue(now: Date) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short', hour: '2-digit',
    minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const value = (key: string) => parts.find(p => p.type === key)?.value!;
  // Catch up on restarts after 7 AM; the durable date and recipient log prevent repeat delivery.
  return !['Sat', 'Sun'].includes(value('weekday')) && Number(value('hour')) >= 7;
}
export async function runDailyDigest(now = new Date()): Promise<void> {
  if (!currentJobBudget()) return withJobDatabase(() => withJobBudget(() => runDailyDigest(now)));
  if (!digestDue(now)) return;
  if (!currentJobBudget()!.canStart()) return;
  await db.transaction(async tx => {
    const locked = await tx.execute(sql`select pg_try_advisory_xact_lock(91847311) as locked`);
    if (!locked.rows[0]?.locked) return;
    await tx.insert(appSettingsTable).values({ id: 'schedule' }).onConflictDoNothing();
    const [s] = await tx.select().from(appSettingsTable).where(eq(appSettingsTable.id, 'schedule')).for('update');
    const date = pacificDay(now);
    if (!s!.dailyDigestEnabled || s!.lastDigestDate === date) return;
    const rows = gaps(await readScheduleData(tx), now, 7);
    if (rows.length && !await notify(rows, date)) return; // Failed recipients retry; sent/logged recipients deduplicate.
    await tx.update(appSettingsTable).set({ lastDigestDate: date, updatedAt: new Date() }).where(eq(appSettingsTable.id, 'schedule'));
  });
}
export function startCoverageDigest(env: NodeJS.ProcessEnv = process.env) {
  if (!automaticJobsEnabled(env)) return null;
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try { await runDailyDigest(); } catch (err) { logger.error({ err }, 'Coverage digest failed; will retry.'); }
    finally { busy = false; }
  };
  const timer = setInterval(() => void tick(), 30_000); timer.unref();
  void tick();
  return () => clearInterval(timer);
}
