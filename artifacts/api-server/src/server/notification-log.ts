import { randomUUID } from 'node:crypto';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { db, pool, notificationLogTable, usersTable, volunteerProfilesTable, notificationType } from '@workspace/db';
import { sendEmail, createEmailTemplate } from '../email';
import { decryptEmailBody, tokenEmailTypes } from './email-payload';
import { monthRange, emailSettings, checkMonthlyEmailLimit } from './monthly-email-limit';
import { appOrigin } from '../auth/session';
import { mintToken, verificationEmail, passwordResetEmail } from '../auth/accounts';
import { readScheduleData } from './scheduleRepository';
import { createScheduleService } from './scheduleService';
import { slotInstant } from './schedule-time';
import { isUncertainDelivery } from './delivery-state';

export class NotificationError extends Error { constructor(public status: number, message: string) { super(message); } }
export async function notificationSummary() {
  const at = new Date();
  await checkMonthlyEmailLimit(at);
  const range = monthRange(at);
  const settings = await emailSettings();
  const first = monthRange(at, -5);
  const { rows } = await pool.query<{ month: string; type: string; count: string }>(`
    SELECT to_char(coalesce(sent_at,created_at) AT TIME ZONE 'America/Los_Angeles','YYYY-MM') AS month,
      type,count(*)::text AS count FROM notification_log
    WHERE status IN ('sent','logged') AND coalesce(sent_at,created_at)>=$1 AND coalesce(sent_at,created_at)<$2
    GROUP BY month,type`, [first.from, range.to]);
  const months = Array.from({ length: 6 }, (_, i) => {
    const month = monthRange(at, i - 5).month;
    const byType = notificationType.enumValues.map(type => ({ type, count: Number(rows.find(r => r.month === month && r.type === type)?.count ?? 0) }));
    return { month, total: byType.reduce((n, r) => n + r.count, 0), byType };
  });
  const current = months[5]!;
  return { month: range.month, total: current.total, byType: current.byType, monthlyLimit: settings.postmarkMonthlyLimit,
    percent: current.total / settings.postmarkMonthlyLimit * 100, months,
    postmark: { tokenConfigured: Boolean(process.env.POSTMARK_SERVER_TOKEN?.trim()), emailFrom: process.env.EMAIL_FROM?.trim() || null,
      deliveryEnabled: Boolean(process.env.POSTMARK_SERVER_TOKEN?.trim() && process.env.EMAIL_FROM?.trim()) } };
}
export async function listNotifications(filters: { type?: string; status?: string; from?: string; to?: string; search?: string; page: number }) {
  const clauses: string[] = [];
  const params: (string | number | Date)[] = [];
  const add = (clause: string, value: string | Date) => { params.push(value); clauses.push(clause.replace('?', `$${params.length}`)); };
  if (filters.type) add('type=?', filters.type);
  if (filters.status) add('status=?', filters.status);
  if (filters.from) add('coalesce(sent_at,updated_at)>=?', slotInstant(filters.from, '00:00'));
  if (filters.to) {
    const next = new Date(`${filters.to}T12:00:00Z`); next.setUTCDate(next.getUTCDate() + 1);
    add('coalesce(sent_at,updated_at)<?', slotInstant(next.toISOString().slice(0, 10), '00:00'));
  }
  if (filters.search) add("recipient_email ILIKE ? ESCAPE '\\'", `%${filters.search.replace(/[\\%_]/g, '\\$&')}%`);
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const { rows: totals } = await pool.query<{ count: string }>(`SELECT count(*)::text AS count FROM notification_log ${where}`, params);
  const { rows } = await pool.query(`SELECT id,coalesce(sent_at,updated_at) AS time,type,recipient_email AS recipient,subject,status,error,
    (status='failed' AND (retry_payload IS NOT NULL OR type IN ('verification','password_reset','invite'))) AS "canRetry"
    FROM notification_log ${where} ORDER BY coalesce(sent_at,updated_at) DESC,id DESC LIMIT 30 OFFSET $${params.length + 1}`,
  [...params, (filters.page - 1) * 30]);
  return { rows: rows.map(row => ({ ...row, time: row.time.toISOString(),
    deliveryUncertain: isUncertainDelivery(row.error), canRetry: row.canRetry && !isUncertainDelivery(row.error) })),
    total: Number(totals[0]!.count), page: filters.page, pageSize: 30 };
}
export async function retryNotification(id: string) {
  const client = await pool.connect();
  let locked = false;
  try {
    const { rows } = await client.query<{ locked: boolean }>('SELECT pg_try_advisory_lock(hashtextextended($1,17)) AS locked', [`notification-retry:${id}`]);
    locked = rows[0]!.locked;
    if (!locked) throw new NotificationError(409, 'This email is already being retried. Refresh the log shortly.');
    const [row] = await db.select().from(notificationLogTable).where(eq(notificationLogTable.id, id));
    if (!row) throw new NotificationError(404, 'Email not found.');
    if (row.status !== 'failed') return { ok: true, skipped: true, status: row.status, error: null };
    if (isUncertainDelivery(row.error))
      throw new NotificationError(409, 'Delivery is uncertain. Resending is disabled to avoid a duplicate. Review this email in Postmark.');
    const [user] = row.recipientUserId ? await db.select().from(usersTable).where(eq(usersTable.id, row.recipientUserId)) : [];
    if (row.recipientUserId && (!user?.isActive || user.email !== row.recipientEmail))
      throw new NotificationError(409, 'The recipient is inactive or their email has changed. Send a new email from the original feature.');
    let result;
    if (tokenEmailTypes.has(row.type)) {
      if (!user) throw new NotificationError(409, 'The original account is unavailable.');
      if (row.type === 'verification') {
        if (user.emailVerifiedAt) throw new NotificationError(409, 'This email is already verified.');
        result = await verificationEmail(user, row.id);
      } else if (row.type === 'password_reset') result = await passwordResetEmail(user, row.id);
      else {
        if (user.role !== 'admin' || user.emailVerifiedAt) throw new NotificationError(409, 'This administrator invitation is no longer pending.');
        const token = await mintToken(user.id, 'admin_invite');
        result = await sendEmail({ type: 'invite', to: user.email, toUserId: user.id, retryLogId: row.id, relatedId: token.id,
          subject: row.subject, ...createEmailTemplate({ heading: 'You’re invited to join The Alliance', firstName: user.firstName,
            paragraphs: ['Your care and coordination help volunteers connect local families with the support they need.',
              'Set your password to accept this invitation and verify your email. Your new link is valid for seven days.'],
            cta: { label: 'Accept admin invitation', url: `${appOrigin}/accept-invite?token=${token.raw}` } }) });
      }
    } else {
      if (!row.retryPayload) throw new NotificationError(409, 'The original content was not stored for this older email. Resend it from the original feature.');
      if (row.type === 'reminder' && row.relatedId && !row.relatedId.startsWith('test:')) {
        const match = /^([0-9a-f-]{36}):(\d{4}-\d\d-\d\d):(24h|am)$/.exec(row.relatedId);
        if (match) {
          const data = await db.transaction(tx => readScheduleData(tx, undefined, { from: match[2]!, to: match[2]! }));
          const occurrences = createScheduleService(data).getOccurrences(match[2]!, match[2]!);
          const [profile] = user ? await db.select().from(volunteerProfilesTable).where(eq(volunteerProfilesTable.userId, user.id)) : [];
          if (profile?.status !== 'active' || !user?.emailVerifiedAt || !occurrences.some(o => o.startsAt > new Date() &&
            o.assignedVolunteers.some(v => v.assignmentId === match[1] && v.volunteerProfileId === profile.id)))
            throw new NotificationError(409, 'This shift has passed, is closed, or the volunteer is no longer assigned. The reminder cannot be retried.');
        }
      }
      let content;
      try { content = decryptEmailBody(row.retryPayload); }
      catch { throw new NotificationError(409, 'Stored content cannot be decrypted. The encryption key may have changed; resend from the original feature.'); }
      result = await sendEmail({ type: row.type, to: row.recipientEmail, toUserId: row.recipientUserId ?? undefined,
        subject: row.subject, relatedId: row.relatedId ?? undefined, retryLogId: row.id, ...content });
    }
    const [updated] = await db.select({ status: notificationLogTable.status }).from(notificationLogTable).where(eq(notificationLogTable.id, row.id));
    if (result.skipped && updated!.status === 'failed' && row.relatedId) {
      const [confirmed] = await db.select({ status: notificationLogTable.status }).from(notificationLogTable).where(and(
        eq(notificationLogTable.type, row.type), eq(notificationLogTable.relatedId, row.relatedId),
        row.recipientUserId ? eq(notificationLogTable.recipientUserId, row.recipientUserId) : isNull(notificationLogTable.recipientUserId),
        inArray(notificationLogTable.status, ['sent','logged'])));
      if (confirmed) return { ok: true, skipped: true, status: confirmed.status, error: null };
    }
    return { ok: result.ok, skipped: result.skipped ?? false, status: updated!.status, error: result.error ?? null };
  } finally {
    let discard = false;
    try { if (locked) await client.query('SELECT pg_advisory_unlock(hashtextextended($1,17))', [`notification-retry:${id}`]); }
    catch { discard = true; }
    finally { client.release(discard); }
  }
}
export async function testProviderEmail(userId: string, requestId: string = randomUUID()) {
  const [user] = await db.select().from(usersTable).where(and(eq(usersTable.id, userId), eq(usersTable.role, 'admin'), eq(usersTable.isActive, true)));
  if (!user?.emailVerifiedAt) throw new NotificationError(403, 'A verified, active administrator is required.');
  const relatedId = `provider-test:${user.id}:${requestId}`;
  const result = await sendEmail({ type: 'admin_alert', to: user.email, toUserId: user.id, relatedId,
    subject: '[Test] Community Care Team Volunteer Portal email', ...createEmailTemplate({ heading: 'Your email service test', firstName: user.firstName,
      paragraphs: ['Thank you for keeping our volunteer communications reliable. This test was requested from the notification log.',
        'When Postmark is configured this email is delivered to you. Otherwise it is logged only; no email is delivered.'],
      cta: { label: 'Return to notification log', url: `${appOrigin}/admin/notifications` } }) });
  const [row] = await db.select({ status: notificationLogTable.status }).from(notificationLogTable)
    .where(and(eq(notificationLogTable.relatedId, relatedId), eq(notificationLogTable.recipientUserId, user.id), inArray(notificationLogTable.status, ['sent', 'logged', 'failed'])));
  return { ok: result.ok, skipped: result.skipped ?? false, status: row?.status ?? 'failed', error: result.error ?? null };
}
