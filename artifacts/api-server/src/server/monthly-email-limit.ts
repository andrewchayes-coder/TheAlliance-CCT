import { and, eq, isNotNull } from 'drizzle-orm';
import { db, pool, appSettingsTable, usersTable } from '@workspace/db';
import { createEmailTemplate, sendEmail } from '../email';
import { appOrigin } from '../auth/session';
import { pacificDay, slotInstant } from './schedule-time';

export function monthRange(at = new Date(), offset = 0) {
  const current = pacificDay(at).slice(0, 7);
  const day = new Date(`${current}-01T12:00:00Z`);
  day.setUTCMonth(day.getUTCMonth() + offset);
  const month = day.toISOString().slice(0, 7);
  day.setUTCMonth(day.getUTCMonth() + 1);
  return { month, from: slotInstant(`${month}-01`, '00:00'), to: slotInstant(`${day.toISOString().slice(0, 7)}-01`, '00:00') };
}
export async function emailSettings() {
  await db.insert(appSettingsTable).values({ id: 'schedule' }).onConflictDoNothing();
  const [settings] = await db.select().from(appSettingsTable).where(eq(appSettingsTable.id, 'schedule'));
  return settings!;
}
export async function monthlyCount(from: Date, to: Date) {
  const { rows } = await pool.query<{ count: string }>(`
    SELECT count(*)::text AS count FROM notification_log WHERE status IN ('sent','logged')
      AND coalesce(sent_at,created_at) >= $1 AND coalesce(sent_at,created_at) < $2`, [from, to]);
  return Number(rows[0]!.count);
}
const dependencies = {
  connect: () => pool.connect(),
  settings: emailSettings,
  count: monthlyCount,
  admins: async () => await db.select({ id: usersTable.id, email: usersTable.email, firstName: usersTable.firstName })
    .from(usersTable).where(and(eq(usersTable.role, 'admin'), eq(usersTable.isActive, true), isNotNull(usersTable.emailVerifiedAt))),
  send: sendEmail,
  acknowledge: async (month: string) => await db.update(appSettingsTable).set({ lastMonthlyAlertMonth: month, updatedAt: new Date() })
    .where(eq(appSettingsTable.id, 'schedule')),
};
/** Test seam isolates quota fixtures from real administrators and settings. */
export function createMonthlyLimitChecker(overrides: Partial<typeof dependencies> = {}) {
 const deps = { ...dependencies, ...overrides };
 return async (at = new Date()) => {
  const client = await deps.connect();
  let locked = false;
  try {
    const { rows } = await client.query<{ locked: boolean }>('SELECT pg_try_advisory_lock(91847313) AS locked');
    locked = rows[0]!.locked;
    if (!locked) return;
    const settings = await deps.settings();
    const range = monthRange(at);
    if (settings.lastMonthlyAlertMonth === range.month) return;
    const count = await deps.count(range.from, range.to);
    if (count < Math.ceil(settings.postmarkMonthlyLimit * .8)) return;
    const admins = await deps.admins();
    if (!admins.length) return;
    const subject = `Heads up: the volunteer app has sent ${count} of ${settings.postmarkMonthlyLimit} emails this month`;
    let complete = true;
    for (const admin of admins) {
      const result = await deps.send({ type: 'admin_alert', to: admin.email, toUserId: admin.id,
        subject, relatedId: `monthly-limit:${range.month}`, ...createEmailTemplate({
          heading: 'A quick update on monthly email use', firstName: admin.firstName,
          paragraphs: [`The volunteer app has sent ${count} of ${settings.postmarkMonthlyLimit} emails this month.`,
            'Thank you for keeping volunteers informed. We have reached 80% of the configured monthly limit; please review email use before sending a large group message.',
            'This count includes development log copies as well as delivered emails. This is a monitoring limit, not a delivery block.'],
          cta: { label: 'Review notification log', url: `${appOrigin}/admin/notifications` },
        }) });
      if (!result.ok) complete = false;
    }
    if (complete) await deps.acknowledge(range.month);
  } finally {
    let discard = false;
    try { if (locked) await client.query('SELECT pg_advisory_unlock(91847313)'); }
    catch { discard = true; }
    finally { client.release(discard); }
  }
 };
}
/** Called after confirmed sends, limit edits and staff visits; failed alert deliveries remain retryable. */
export const checkMonthlyEmailLimit = createMonthlyLimitChecker();
