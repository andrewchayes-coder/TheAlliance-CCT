import { ServerClient } from 'postmark';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { pool, notificationLogTable, insertNotificationLogSchema, type NotificationLog } from '@workspace/db';
import { logger } from './lib/logger';

export { createEmailTemplate, emailFooter, type EmailTemplateOptions } from './email-template';

export interface SendEmailOptions {
  type: NotificationLog['type'];
  to: string;
  toUserId?: string;
  subject: string;
  html: string;
  text: string;
  relatedId?: string;
}
export interface SendEmailResult {
  ok: boolean;
  error?: string;
  skipped?: true;
}
interface DeliveryMessage {
  From: string; To: string; Subject: string; HtmlBody: string; TextBody: string; MessageStream: 'outbound';
}
interface DeliveryClient {
  sendEmail(message: DeliveryMessage): Promise<{ MessageID: string; ErrorCode: number; Message: string }>;
}

const emailLogger = logger.child({ component: 'email' }, { level: 'info' });
const defaults = {
  connect: () => pool.connect(),
  settings: (): { token?: string; from?: string } => ({
    token: process.env.POSTMARK_SERVER_TOKEN?.trim(),
    from: process.env.EMAIL_FROM?.trim(),
  }),
  deliveryClient: (token: string): DeliveryClient => new ServerClient(token, { timeout: 15 }),
  log: {
    info: (message: string) => emailLogger.info(message),
    warn: (message: string) => emailLogger.warn(message),
    error: (message: string) => emailLogger.error(message),
  },
};

function errorMessage(error: unknown, token?: string): string {
  const message = error instanceof Error ? error.message : 'An unexpected email error occurred.';
  return token ? message.split(token).join('[REDACTED]') : message;
}
function htmlDecode(value: string): string {
  return value.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}
function emailLinks(html: string, text: string): string[] {
  const links = Array.from(html.matchAll(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi))
    .map(match => htmlDecode(match[1] ?? match[2] ?? match[3] ?? ''));
  links.push(...Array.from(text.matchAll(/https?:\/\/[^\s<>"']+/gi)).map(match => match[0].replace(/[.,;!?)\]]+$/, '')));
  return [...new Set(links)].filter(Boolean);
}

/** Test seam only. Application features import sendEmail from this file. */
export function createEmailService(overrides: Partial<typeof defaults> = {}) {
  const dependencies = { ...defaults, ...overrides };
  const safeLog = (level: 'error' | 'warn', message: string) => {
    try { dependencies.log[level](message); } catch { /* Logging must never reject the caller's promise. */ }
  };

  return async function send(options: SendEmailOptions): Promise<SendEmailResult> {
    let client: Awaited<ReturnType<typeof defaults.connect>> | undefined;
    let lockKey: string | undefined;
    let auditId: string | undefined;
    let token: string | undefined;
    let deliveryConfirmed = false;
    let providerMessageId: string | undefined;
    try {
      const settings = dependencies.settings();
      token = settings.token;
      const draft = {
        type: options.type,
        recipientEmail: typeof options.to === 'string' ? options.to.trim().toLowerCase() : '',
        recipientUserId: options.toUserId?.toLowerCase() ?? null,
        subject: typeof options.subject === 'string' ? options.subject : '',
        relatedId: options.relatedId ?? null,
      };
      const validation = insertNotificationLogSchema.safeParse(draft);
      const values = validation.success ? validation.data : {
        ...draft,
        recipientUserId: validation.error.issues.some(issue => issue.path[0] === 'recipientUserId')
          ? null : draft.recipientUserId,
      };
      client = await dependencies.connect();
      const database = drizzle(client);
      const keyed = options.relatedId !== undefined;
      const keyCondition = and(
        eq(notificationLogTable.type, values.type),
        values.recipientUserId ? eq(notificationLogTable.recipientUserId, values.recipientUserId) : isNull(notificationLogTable.recipientUserId),
        eq(notificationLogTable.relatedId, values.relatedId ?? ''),
      );

      if (keyed) {
        lockKey = JSON.stringify([values.type, values.recipientUserId, values.relatedId]);
        // A session lock spans autocommitted audit writes and delivery. Other workers wait.
        await client.query('SELECT pg_advisory_lock(hashtextextended($1, 0))', [lockKey]);
        const [handled] = await database.select({ id: notificationLogTable.id }).from(notificationLogTable)
          .where(and(keyCondition, inArray(notificationLogTable.status, ['sent', 'logged']))).limit(1);
        if (handled) return { ok: true, skipped: true };
      }

      const [previousFailure] = keyed ? await database.select({ id: notificationLogTable.id }).from(notificationLogTable)
        .where(and(keyCondition, eq(notificationLogTable.status, 'failed')))
        .orderBy(desc(notificationLogTable.updatedAt)).limit(1) : [];
      // Persist the audit BEFORE any external side effect. A crash remains visibly unconfirmed.
      const pending = {
        ...values, status: 'failed' as const, error: 'Delivery started but has not been confirmed.',
        providerMessageId: null, sentAt: null,
      };
      const [audit] = previousFailure
        ? await database.update(notificationLogTable).set(pending).where(eq(notificationLogTable.id, previousFailure.id))
          .returning({ id: notificationLogTable.id })
        : await database.insert(notificationLogTable).values(pending).returning({ id: notificationLogTable.id });
      auditId = audit!.id;

      try {
        if (!validation.success) {
          throw new Error(validation.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; '));
        }
        if (!options.text?.trim()) throw new Error('A non-empty plain-text email body is required.');
        if (!options.html?.trim()) throw new Error('A non-empty HTML email body is required.');

        if (settings.token && settings.from) {
          const response = await dependencies.deliveryClient(settings.token).sendEmail({
            From: settings.from, To: values.recipientEmail, Subject: values.subject,
            HtmlBody: options.html, TextBody: options.text, MessageStream: 'outbound',
          });
          if (response.ErrorCode !== 0 || !response.MessageID) {
            throw new Error(`Postmark did not confirm delivery: ${response.Message || response.ErrorCode}`);
          }
          deliveryConfirmed = true;
          providerMessageId = response.MessageID;
          await database.update(notificationLogTable).set({
            status: 'sent', providerMessageId: response.MessageID, error: null, sentAt: new Date(),
          }).where(eq(notificationLogTable.id, auditId));
        } else {
          if (settings.token || settings.from || process.env.NODE_ENV === 'production') {
            safeLog('warn', 'Postmark is not fully configured. Both POSTMARK_SERVER_TOKEN and EMAIL_FROM are required; this email will only be logged, not delivered.');
          }
          dependencies.log.info([
            '========== EMAIL LOGGED — NO EMAIL SENT ==========',
            `Type: ${values.type}`, `To: ${values.recipientEmail}`, `Subject: ${values.subject}`,
            '', 'Plain-text body:', options.text, '', 'Links:',
            ...emailLinks(options.html, options.text),
            '========== END LOGGED EMAIL ==========',
          ].join('\n'));
          await database.update(notificationLogTable).set({
            status: 'logged', providerMessageId: null, error: null, sentAt: new Date(),
          }).where(eq(notificationLogTable.id, auditId));
        }
        return { ok: true };
      } catch (error) {
        const failure = errorMessage(error, token);
        // Retry only the audit update, never the provider call, after confirmed acceptance.
        if (deliveryConfirmed && providerMessageId) {
          await database.update(notificationLogTable).set({
            status: 'sent', providerMessageId, error: null, sentAt: new Date(),
          }).where(eq(notificationLogTable.id, auditId));
          safeLog('warn', `Email ${auditId} was accepted by Postmark; its notification log update recovered after an error.`);
          return { ok: true };
        }
        const message = failure;
        await database.update(notificationLogTable).set({
          status: 'failed', error: message, providerMessageId: null, sentAt: null,
        }).where(eq(notificationLogTable.id, auditId));
        safeLog('error', `Email failed (${values.type}); notification ${auditId}: ${message}`);
        return { ok: false, error: message };
      }
    } catch (error) {
      const failure = errorMessage(error, token);
      const message = deliveryConfirmed
        ? `Postmark accepted this email (${providerMessageId}), but the notification log could not be finalized. Review before retrying. ${failure}`
        : failure;
      // With an unavailable/invalid audit store, fail closed: never send unrecorded mail.
      safeLog('error', `Email could not complete${auditId ? ` (notification ${auditId})` : ''}: ${message}`);
      return { ok: false, error: message };
    } finally {
      if (client) {
        let destroyConnection = false;
        if (lockKey) {
          try { await client.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [lockKey]); }
          catch {
            destroyConnection = true;
            safeLog('error', 'Email deduplication lock cleanup failed; discarding the database connection.');
          }
        }
        try { client.release(destroyConnection); }
        catch { safeLog('error', 'Email database connection cleanup failed.'); }
      }
    }
  };
}

export const sendEmail = createEmailService();
