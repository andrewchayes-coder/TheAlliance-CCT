import { ServerClient } from 'postmark';
import { encryptEmailBody, tokenEmailTypes } from './server/email-payload';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { pool, usersTable, notificationLogTable, insertNotificationLogSchema, type NotificationLog } from '@workspace/db';
import { logger } from './lib/logger';
import { currentJobBudget } from './server/job-budget';
import { isUncertainDelivery, uncertainDelivery, providerRejected } from './server/delivery-state';
import { emailIdentity } from './server/email-identity';

export { createEmailTemplate, emailFooter, type EmailTemplateOptions } from './email-template';

export interface SendEmailOptions {
  /** Internal retry target. Never accept this field from an email composition request. */
  retryLogId?: string;
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
  uncertain?: true;
  deferred?: true;
  suppressed?: true;
}
interface DeliveryMessage {
  From: string; To: string; Subject: string; HtmlBody: string; TextBody: string; MessageStream: 'outbound';
  ReplyTo?: string;
}
interface DeliveryClient {
  sendEmail(message: DeliveryMessage): Promise<{ MessageID: string; ErrorCode: number; Message: string }>;
}

const emailLogger = logger.child({ component: 'email' }, { level: 'info' });
const defaults = {
  connect: () => pool.connect(),
  settings: (): { token?: string; from?: string; replyTo?: string } => ({
    token: process.env.POSTMARK_SERVER_TOKEN?.trim(),
    from: process.env.EMAIL_FROM?.trim(),
    replyTo: process.env.EMAIL_REPLY_TO?.trim(),
  }),
  deliveryClient: (token: string): DeliveryClient => new ServerClient(token, { timeout: currentJobBudget() ? 4 : 15 }),
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
    let providerAttempted = false;
    let providerMessageId: string | undefined;
    try {
      const budget = currentJobBudget();
      if (budget && !budget.canStart(8_000)) return { ok: false, deferred: true, error: 'Deferred to the next scheduled check.' };
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
        // Scheduled checks never wait behind another delivery. Preserve the
        // existing wait-and-deduplicate contract for interactive email callers.
        const claim = budget
          ? await client.query('SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired', [lockKey])
          : (await client.query('SELECT pg_advisory_lock(hashtextextended($1, 0))', [lockKey]), { rows: [{ acquired: true }] });
        if (!claim.rows[0]?.acquired) {
          lockKey = undefined;
          if (budget) budget.deferred = true;
          return { ok: false, deferred: true, error: 'Another worker is handling this email. Check again shortly.' };
        }
        const [handled] = await database.select({ id: notificationLogTable.id }).from(notificationLogTable)
          .where(and(keyCondition, inArray(notificationLogTable.status, ['sent', 'logged', 'suppressed']))).limit(1);
        if (handled) return { ok: true, skipped: true };
      }

      const [retryTarget] = options.retryLogId ? await database.select().from(notificationLogTable)
        .where(eq(notificationLogTable.id, options.retryLogId)).limit(1) : [];
      if (options.retryLogId && (!retryTarget || retryTarget.type !== values.type ||
        retryTarget.recipientEmail !== values.recipientEmail || retryTarget.recipientUserId !== values.recipientUserId))
        return { ok: false, error: 'The original email no longer matches this retry.' };
      if (retryTarget && retryTarget.status !== 'failed') return { ok: true, skipped: true };
      const [previousFailure] = keyed ? await database.select({ id: notificationLogTable.id, error: notificationLogTable.error }).from(notificationLogTable)
        .where(and(keyCondition, eq(notificationLogTable.status, 'failed')))
        .orderBy(desc(notificationLogTable.updatedAt)).limit(1) : [];
      const uncertain = [retryTarget, previousFailure].find(row => isUncertainDelivery(row?.error));
      if (uncertain) return { ok: false, skipped: true, uncertain: true, error: uncertain.error! };
      // Match both identity and address so an omitted/incorrect toUserId cannot
      // bypass suppression. The envelope still has its own validated audit row.
      const recipients = await database.select({ id: usersTable.id, email: usersTable.email, isTestAccount: usersTable.isTestAccount })
        .from(usersTable).where(eq(usersTable.email, values.recipientEmail)).limit(1);
      const [byId] = values.recipientUserId ? await database.select({ isTestAccount: usersTable.isTestAccount }).from(usersTable)
        .where(eq(usersTable.id, values.recipientUserId)).limit(1) : [];
      if (recipients[0]?.isTestAccount || byId?.isTestAccount) {
        const suppressed = { ...values, status: 'suppressed' as const, error: null, providerMessageId: null,
          sentAt: null, retryPayload: null, updatedAt: new Date() };
        const target = retryTarget ?? previousFailure;
        if (target) await database.update(notificationLogTable).set(suppressed).where(eq(notificationLogTable.id, target.id));
        else await database.insert(notificationLogTable).values(suppressed);
        if (process.env.NODE_ENV !== 'production') dependencies.log.info(
          `========== QA EMAIL SUPPRESSED — NO EMAIL SENT ==========\nTo: ${values.recipientEmail}\nSubject: ${values.subject}\n\n${options.text}\n\nLinks:\n${emailLinks(options.html ?? '', options.text ?? '').join('\n')}\n========== END QA EMAIL ==========`);
        return { ok: true, suppressed: true };
      }
      // Persist the audit BEFORE any external side effect. A crash remains visibly unconfirmed.
      let retryPayload: string | null = null;
      let payloadFailure: string | undefined;
      if (!tokenEmailTypes.has(values.type) && options.html?.trim() && options.text?.trim()) {
        try { retryPayload = encryptEmailBody({ html: options.html, text: options.text }); }
        catch { payloadFailure = 'Email retry content could not be saved. Check the server encryption configuration before sending again.'; }
      }
      const pending = {
        ...values, status: 'failed' as const, error: uncertainDelivery('Delivery started but has not been confirmed.'),
        providerMessageId: null, sentAt: null,
        updatedAt: new Date(),
        retryPayload,
      };
      const target = retryTarget ?? previousFailure;
      const [audit] = target
        ? await database.update(notificationLogTable).set(pending).where(eq(notificationLogTable.id, target.id))
          .returning({ id: notificationLogTable.id })
        : await database.insert(notificationLogTable).values(pending).returning({ id: notificationLogTable.id });
      auditId = audit!.id;

      try {
        if (payloadFailure) throw new Error(payloadFailure);
        if (!validation.success) {
          throw new Error(validation.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; '));
        }
        if (!options.text?.trim()) throw new Error('A non-empty plain-text email body is required.');
        if (!options.html?.trim()) throw new Error('A non-empty HTML email body is required.');

        if (settings.token && settings.from) {
          const identity = emailIdentity({ EMAIL_FROM: settings.from, EMAIL_REPLY_TO: settings.replyTo });
          providerAttempted = true;
          const response = await dependencies.deliveryClient(settings.token).sendEmail({
            From: identity.from!.header, To: values.recipientEmail, Subject: values.subject,
            HtmlBody: options.html, TextBody: options.text, MessageStream: 'outbound',
            ReplyTo: identity.replyTo!,
          });
          if (response.ErrorCode !== 0 || !response.MessageID) {
            if (response.ErrorCode > 0) providerAttempted = false;
            throw new Error(`Postmark did not confirm delivery: ${response.Message || response.ErrorCode}`);
          }
          deliveryConfirmed = true;
          providerMessageId = response.MessageID;
          await database.update(notificationLogTable).set({
            status: 'sent', providerMessageId: response.MessageID, error: null, sentAt: new Date(),
          }).where(eq(notificationLogTable.id, auditId));
        } else {
          if (process.env.NODE_ENV === 'production') {
            throw new Error('Email delivery is unavailable: configure both Postmark and the sender address. No email content was logged.');
          }
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
        const uncertain = providerAttempted && !providerRejected(error);
        const message = uncertain ? uncertainDelivery(failure) : failure;
        await database.update(notificationLogTable).set({
          status: 'failed', error: message, providerMessageId: null, sentAt: null,
        }).where(eq(notificationLogTable.id, auditId));
        safeLog('error', `Email failed (${values.type}); notification ${auditId}: ${message}`);
        return { ok: false, error: message, ...(uncertain ? { uncertain: true as const } : {}) };
      }
    } catch (error) {
      const failure = errorMessage(error, token);
      const message = deliveryConfirmed
        ? `Postmark accepted this email (${providerMessageId}), but the notification log could not be finalized. Review before retrying. ${failure}`
        : failure;
      // With an unavailable/invalid audit store, fail closed: never send unrecorded mail.
      safeLog('error', `Email could not complete${auditId ? ` (notification ${auditId})` : ''}: ${message}`);
      return { ok: false, error: message, ...(providerAttempted ? { uncertain: true as const } : {}) };
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

const deliverEmail = createEmailService();
export const sendEmail = async (options: SendEmailOptions): Promise<SendEmailResult> => {
  const result = await deliverEmail(options);
  if (result.ok && !result.skipped && !result.suppressed && !currentJobBudget() && !options.relatedId?.startsWith('monthly-limit:')) {
    try { await (await import('./server/monthly-email-limit')).checkMonthlyEmailLimit(); }
    catch { try { emailLogger.error('Monthly email limit check could not complete; the next send or staff dashboard visit will retry it.'); } catch { /* Never reject callers after delivery. */ } }
  }
  return result;
};
