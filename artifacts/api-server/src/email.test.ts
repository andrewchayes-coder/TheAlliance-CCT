import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { eq, inArray } from 'drizzle-orm';
import { db, pool, notificationLogTable, usersTable } from '@workspace/db';
import { createEmailService, createEmailTemplate, emailFooter, type SendEmailOptions } from './email';

if (process.env.NODE_ENV === 'production') throw new Error('Email integration tests are development-only.');

const runId = randomUUID();
const to = `email-probe-${runId}@example.org`;
const invalidTo = `invalid-email-${runId}`;
const userIds = [randomUUID(), randomUUID()];
const messages = { info: [] as string[], warn: [] as string[], error: [] as string[] };
const log = {
  info: (message: string) => { messages.info.push(message); },
  warn: (message: string) => { messages.warn.push(message); },
  error: (message: string) => { messages.error.push(message); },
};
const body = createEmailTemplate({
  firstName: 'Maya',
  heading: 'Confirm your email',
  paragraphs: [
    'Thank you for joining the community care team. Please confirm your email so we can keep you informed about your volunteer journey.',
    "If you didn't request this, you can leave this message as it is.",
  ],
  cta: { label: 'Confirm my email', url: 'https://example.org/verify?token=dummy-test-link&source=email' },
});
function input(name: string, overrides: Partial<SendEmailOptions> = {}): SendEmailOptions {
  return { type: 'verification', to, subject: 'Confirm your email with The Alliance', ...body, relatedId: `${runId}:${name}`, ...overrides };
}
function service(overrides: NonNullable<Parameters<typeof createEmailService>[0]> = {}) {
  return createEmailService({
    settings: () => ({}), log,
    deliveryClient: () => { throw new Error('Tests must never use a real delivery client.'); },
    ...overrides,
  });
}
async function rows(relatedId: string) {
  return db.select().from(notificationLogTable).where(eq(notificationLogTable.relatedId, relatedId));
}
const successResponse = { MessageID: 'postmark-test-message', ErrorCode: 0, Message: 'OK' };

test('production fails closed without complete delivery settings and never logs recovery credentials', async () => {
  const previous = process.env.NODE_ENV;
  const start = messages.info.length;
  try {
    process.env.NODE_ENV = 'production';
    for (const [i, settings] of [{}, { token: 'synthetic-test-token' }, { from: 'synthetic@example.invalid' }].entries()) {
      const options = input(`production-missing-${i}`);
      const result = await service({ settings: () => settings })(options);
      assert.equal(result.ok, false);
      const [row] = await rows(options.relatedId!);
      assert.equal(row?.status, 'failed');
      assert.match(row?.error ?? '', /No email content was logged/);
    }
    assert.deepEqual(messages.info.slice(start), []);
    assert.equal(messages.error.some(m => m.includes('dummy-test-link')), false);
  } finally { if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous; }
});

before(async () => {
  await db.insert(usersTable).values(userIds.map((id, index) => ({
    id, email: `email-probe-${runId}-user${index}@example.org`, firstName: 'Email', lastName: 'Test',
    passwordHash: 'unusable-email-test-fixture-hash', isActive: false,
  })));
});
after(async () => {
  try {
    await db.delete(notificationLogTable).where(inArray(notificationLogTable.recipientEmail, [to, invalidTo]));
    await db.delete(usersTable).where(inArray(usersTable.id, userIds));
  } finally { await pool.end(); }
});

test('template is branded, escaped, mobile-friendly, and has the same CTA in plain text', () => {
  assert.ok(body.html.includes('ALLIANCE VOLUNTEER PORTAL'));
  assert.ok(body.html.includes('#06365D') && body.html.includes('#027A77'));
  assert.ok(body.html.includes('font-size:17px') && body.html.includes('font-size:28px'));
  assert.ok(body.html.includes("'Open Sans',Arial,sans-serif"));
  assert.ok(body.html.includes('role="presentation"') && body.html.includes('max-width:600px'));
  assert.ok(body.text.includes('Hi Maya,') && body.text.includes(emailFooter));
  assert.ok(body.text.includes('https://example.org/verify?token=dummy-test-link&source=email'));
  assert.ok(body.html.includes('dummy-test-link&amp;source=email'));
  const escaped = createEmailTemplate({ heading: '<script>Bad</script>', paragraphs: ['A & B'], firstName: '<Maya>' });
  assert.ok(!escaped.html.includes('<script>Bad'));
  assert.ok(escaped.html.includes('&lt;Maya&gt;') && escaped.html.includes('A &amp; B'));
  assert.throws(() => createEmailTemplate({ heading: 'Test', paragraphs: [], cta: { label: 'Bad', url: 'javascript:alert(1)' } }));
});

test('development mode logs the full text, subject, recipient, and HTML-only links', async () => {
  const options = input('logged', { html: `${body.html}<a href="https://example.org/html-only?a=1&amp;b=2">Another link</a>` });
  assert.deepEqual(await service()(options), { ok: true });
  const [row] = await rows(options.relatedId!);
  assert.equal(row!.status, 'logged');
  assert.equal(row!.providerMessageId, null);
  assert.equal(row!.error, null);
  const output = messages.info.at(-1)!;
  for (const value of [to, options.subject, options.text, 'https://example.org/html-only?a=1&b=2']) assert.ok(output.includes(value));
  assert.ok(output.includes('NO EMAIL SENT'));
});

test('either missing Postmark setting means logged-only, never an external send', async () => {
  for (const [name, settings] of [['token-only', { token: 'fake-token' }], ['from-only', { from: 'alliance@example.org' }]] as const) {
    const options = input(name);
    assert.deepEqual(await service({ settings: () => settings })(options), { ok: true });
    assert.equal((await rows(options.relatedId!))[0]!.status, 'logged');
  }
  assert.ok(messages.warn.some(message => message.includes('Both POSTMARK_SERVER_TOKEN and EMAIL_FROM')));
});

test('Postmark-ready transport sends both bodies on outbound and records its message ID', async () => {
  const options = input('sent', { toUserId: userIds[0], to: ` ${to.toUpperCase()} ` });
  let deliveries = 0;
  const send = service({
    settings: () => ({ token: 'fake-token', from: 'alliance@example.org' }),
    deliveryClient: token => {
      assert.equal(token, 'fake-token');
      return { sendEmail: async message => {
        deliveries++;
        assert.deepEqual(message, {
          From: 'alliance@example.org', To: to, Subject: options.subject,
          HtmlBody: options.html, TextBody: options.text, MessageStream: 'outbound',
        });
        // An audit record is durable before the external side effect begins.
        assert.equal((await rows(options.relatedId!))[0]!.status, 'failed');
        return successResponse;
      }};
    },
  });
  assert.deepEqual(await send(options), { ok: true });
  const [row] = await rows(options.relatedId!);
  assert.equal(row!.status, 'sent');
  assert.equal(row!.providerMessageId, successResponse.MessageID);
  assert.ok(row!.sentAt);
  assert.equal(row!.error, null);
  assert.deepEqual(await send(options), { ok: true, skipped: true });
  assert.equal(deliveries, 1);
  assert.equal((await rows(options.relatedId!)).length, 1);
});

test('already logged keyed emails skip without another console log or row', async () => {
  const options = input('logged-skip');
  const send = service();
  await send(options);
  const count = messages.info.length;
  assert.deepEqual(await send(options), { ok: true, skipped: true });
  assert.equal(messages.info.length, count);
  assert.equal((await rows(options.relatedId!)).length, 1);
});

test('a transient final audit failure retries the log update, not delivery', async () => {
  const options = input('audit-recovery');
  let deliveries = 0;
  let interrupted = false;
  const send = service({
    connect: async () => {
      const client = await pool.connect();
      return new Proxy(client, {
        get(target, property) {
          if (property === 'query') return async (...args: unknown[]) => {
            const query = args[0] as string | { text?: string };
            const text = typeof query === 'string' ? query : query.text ?? '';
            const parameters = args[1];
            if (!interrupted && text.startsWith('update') && Array.isArray(parameters) && parameters.includes('sent')) {
              interrupted = true;
              throw new Error('Transient audit update failure');
            }
            return Reflect.apply(target.query, target, args);
          };
          const value = Reflect.get(target, property);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    },
    settings: () => ({ token: 'fake-token', from: 'alliance@example.org' }),
    deliveryClient: () => ({ sendEmail: async () => { deliveries++; return successResponse; } }),
  });
  assert.deepEqual(await send(options), { ok: true });
  assert.equal(interrupted, true);
  assert.equal(deliveries, 1);
  const [row] = await rows(options.relatedId!);
  assert.equal(row!.status, 'sent');
  assert.equal(row!.providerMessageId, successResponse.MessageID);
});

test('provider failures resolve normally, record errors, redact the token, and allow retries', async () => {
  const options = input('retry', { type: 'reminder', toUserId: userIds[0] });
  let deliveries = 0;
  const send = service({
    settings: () => ({ token: 'fake-secret-token', from: 'alliance@example.org' }),
    deliveryClient: () => ({ sendEmail: async () => {
      deliveries++;
      if (deliveries === 1) throw new Error('Provider rejected fake-secret-token');
      return successResponse;
    }}),
  });
  const failed = await send(options);
  assert.equal(failed.ok, false);
  assert.ok(failed.error?.includes('[REDACTED]'));
  const [first] = await rows(options.relatedId!);
  assert.equal(first!.status, 'failed');
  assert.ok(first!.error && !first!.error.includes('fake-secret-token'));
  assert.deepEqual(await send(options), { ok: true });
  const retried = await rows(options.relatedId!);
  assert.equal(retried.length, 1);
  assert.equal(retried[0]!.id, first!.id);
  assert.equal(retried[0]!.status, 'sent');
  assert.equal(deliveries, 2);
});

test('an unconfirmed provider response records failure rather than false success', async () => {
  const options = input('bad-response');
  const send = service({
    settings: () => ({ token: 'fake-token', from: 'alliance@example.org' }),
    deliveryClient: () => ({ sendEmail: async () => ({ MessageID: '', ErrorCode: 422, Message: 'Invalid message' }) }),
  });
  assert.equal((await send(options)).ok, false);
  assert.equal((await rows(options.relatedId!))[0]!.status, 'failed');
});

test('simultaneous keyed requests deliver only once across independent service instances', async () => {
  const options = input('concurrent', { type: 'reminder', toUserId: userIds[0] });
  let deliveries = 0;
  const overrides = {
    settings: () => ({ token: 'fake-token', from: 'alliance@example.org' }),
    deliveryClient: () => ({ sendEmail: async () => {
      deliveries++;
      await new Promise(resolve => setTimeout(resolve, 25));
      return successResponse;
    }}),
  };
  const results = await Promise.all(Array.from({ length: 8 }, () => service(overrides)(options)));
  assert.ok(results.every(result => result.ok));
  assert.equal(results.filter(result => result.skipped).length, 7);
  assert.equal(deliveries, 1);
  assert.equal((await rows(options.relatedId!)).length, 1);
});

test('deduplication uses type and nullable user identity, not just relatedId', async () => {
  const send = service();
  const base = input('key-dimensions');
  for (const options of [
    base, { ...base, type: 'welcome' as const },
    { ...base, toUserId: userIds[0] }, { ...base, toUserId: userIds[1] },
  ]) assert.deepEqual(await send(options), { ok: true });
  assert.equal((await rows(base.relatedId!)).length, 4);
});

test('email-only keyed reminders deduplicate, and unkeyed reminders may repeat', async () => {
  const send = service();
  const keyed = input('email-only-reminder', { type: 'reminder' });
  assert.deepEqual(await send(keyed), { ok: true });
  assert.deepEqual(await send(keyed), { ok: true, skipped: true });
  assert.equal((await rows(keyed.relatedId!)).length, 1);
  const unkeyed = input('unused-key', { type: 'reminder', relatedId: undefined });
  assert.deepEqual(await send(unkeyed), { ok: true });
  assert.deepEqual(await send(unkeyed), { ok: true });
});

test('missing plain text or HTML is a recorded failure, not an attempted delivery', async () => {
  for (const [name, override] of [['no-text', { text: '' }], ['no-html', { html: '' }]] as const) {
    const options = input(name, override);
    const result = await service()(options);
    assert.equal(result.ok, false);
    assert.equal((await rows(options.relatedId!))[0]!.status, 'failed');
  }
});

test('an invalid recipient is audited as failed', async () => {
  const options = input('invalid-recipient', { to: invalidTo });
  assert.equal((await service()(options)).ok, false);
  assert.equal((await rows(options.relatedId!))[0]!.status, 'failed');
});

test('console failures are audited, and database/logging outages never throw or send', async () => {
  const options = input('logger-failure');
  const badLogger = { info: () => { throw new Error('Logger unavailable'); }, warn: log.warn, error: log.error };
  assert.equal((await service({ log: badLogger })(options)).ok, false);
  assert.equal((await rows(options.relatedId!))[0]!.status, 'failed');
  let externalCalls = 0;
  const unavailable = service({
    connect: async () => { throw new Error('Database unavailable'); },
    settings: () => ({ token: 'fake-token', from: 'alliance@example.org' }),
    deliveryClient: () => { externalCalls++; throw new Error('Should not send'); },
    log: { info: () => {}, warn: () => {}, error: () => { throw new Error('Logger unavailable'); } },
  });
  assert.deepEqual(await unavailable(input('database-outage')), { ok: false, error: 'Database unavailable' });
  assert.equal(externalCalls, 0);
});
