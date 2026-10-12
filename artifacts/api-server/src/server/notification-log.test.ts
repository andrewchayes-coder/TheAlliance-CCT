import { createHmac, randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { and, eq, inArray } from 'drizzle-orm';
import { db, pool, usersTable, notificationLogTable, authTokensTable } from '@workspace/db';
import { createEmailService } from '../email';
import { encryptEmailBody, decryptEmailBody } from './email-payload';
import { pendingRecipients } from './delivery-history';

const provider = vi.hoisted(() => ({ send: vi.fn(async (_message: { To: string }) => ({ MessageID: 'synthetic-provider-id', ErrorCode: 0, Message: 'OK' })) }));
vi.mock('postmark', () => ({ ServerClient: class { sendEmail = provider.send; } }));
vi.hoisted(() => { process.env.NODE_ENV = 'development'; process.env.APP_ORIGIN = 'https://portal.example.invalid';
  process.env.POSTMARK_SERVER_TOKEN = ''; process.env.EMAIL_FROM = ''; process.env.EMAIL_REPLY_TO = ''; });
// Never generate threshold alerts for unrelated development administrators.
vi.mock('./monthly-email-limit', async original => ({ ...await original<typeof import('./monthly-email-limit')>(),
  checkMonthlyEmailLimit: vi.fn() }));
const tag = randomUUID();
const userIds: string[] = [], ids: string[] = [], sids: string[] = [];
let admin: string, volunteer: string, unverified: string;
let base: string, server: import('node:http').Server;
let api: typeof import('./notification-log');
const csrf = `csrf-${tag}`;
async function cookie(userId: string) {
  const sid = randomUUID(); sids.push(sid);
  await pool.query('INSERT INTO sessions(sid,sess,expire) VALUES($1,$2,now()+interval \'1 hour\')',
    [sid, JSON.stringify({ userId, authVersion: 0, csrfToken: csrf,
      cookie: { originalMaxAge: 3600000, httpOnly: true, secure: true, sameSite: 'lax', path: '/', expires: new Date(Date.now() + 3600000).toISOString() } })]);
  const signature = createHmac('sha256', process.env.SESSION_SECRET!).update(sid).digest('base64').replace(/=+$/, '');
  return `alliance.sid=${encodeURIComponent(`s:${sid}.${signature}`)}`;
}
const transport = createEmailService({ settings: () => ({ token: 'synthetic-test-token', from: 'Test Team <program@example.invalid>' }),
  deliveryClient: () => ({ sendEmail: async () => { throw Object.assign(new Error('Synthetic rejection'), { statusCode: 422 }); } }),
  log: { info() {}, warn() {}, error() {} } });
async function failed(type: 'message' | 'verification' | 'password_reset' | 'invite' = 'message', owner = admin) {
  const [user] = await db.select({ email: usersTable.email }).from(usersTable).where(eq(usersTable.id, owner));
  const email = user!.email;
  const relatedId = `notification-test:${randomUUID()}`;
  await transport({ type, to: email, toUserId: owner, relatedId, subject: `QA ${tag}`,
    html: '<p>Original content <b>thank you</b></p>', text: 'Original content thank you' });
  const [row] = await db.select().from(notificationLogTable).where(eq(notificationLogTable.relatedId, relatedId));
  ids.push(row!.id); return row!;
}
beforeAll(async () => {
  for (const [i, role] of ['admin','volunteer','volunteer'].entries()) {
    const [user] = await db.insert(usersTable).values({ firstName: 'Notification test', lastName: 'Fixture',
      email: `${i === 0 ? 'admin' : i === 1 ? 'volunteer' : 'unverified'}-${tag}@example.invalid`, phone: '',
      passwordHash: 'not-a-login-password', role: role as 'admin' | 'volunteer', emailVerifiedAt: i === 2 ? null : new Date() }).returning();
    userIds.push(user!.id);
  }
  [admin, volunteer, unverified] = userIds as [string,string,string];
  api = await import('./notification-log');
  const app = (await import('../app')).default;
  server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  base = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}/api`;
});
afterAll(async () => {
  if (server) await new Promise<void>(resolve => server.close(() => resolve()));
  if (userIds.length) {
    await db.delete(notificationLogTable).where(inArray(notificationLogTable.recipientUserId, userIds));
    await db.delete(usersTable).where(inArray(usersTable.id, userIds));
  }
  if (sids.length) await pool.query('DELETE FROM sessions WHERE sid=any($1::text[])', [sids]);
  await pool.end();
});
describe('notification monitoring and safe retry', () => {
  it('PRD-06 production test sends require admin, target only that admin, and suppress QA email', async () => {
    const previous = process.env.NODE_ENV;
    const previousToken = process.env.POSTMARK_SERVER_TOKEN, previousFrom = process.env.EMAIL_FROM;
    const [owner] = await db.select().from(usersTable).where(eq(usersTable.id, admin));
    try {
      process.env.NODE_ENV = 'production';
      process.env.POSTMARK_SERVER_TOKEN = 'synthetic-production-test-token';
      process.env.EMAIL_FROM = 'Community Care Team <qa@example.invalid>';
      for (const path of ['/admin/notifications/test', '/admin/notifications/jobs/test']) {
        const callsBefore = provider.send.mock.calls.length;
        const requestId = randomUUID();
        const common = { Origin: process.env.APP_ORIGIN!, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf };
        const post = (headers: Record<string,string>, body: unknown) => fetch(`${base}${path}`, {method:'POST',headers,body:JSON.stringify(body)});
        expect((await post(common, {requestId})).status).toBe(401);
        expect((await post({...common,Cookie:await cookie(volunteer)}, {requestId})).status).toBe(403);
        const headers = {...common,Cookie:await cookie(admin)};
        expect((await post({Cookie:headers.Cookie,'Content-Type':'application/json'}, {requestId})).status).toBe(403);
        expect((await post(headers, {requestId,to:'outsider@example.invalid'})).status).toBe(400);
        const sent = await post(headers, {requestId});
        expect(sent.status).toBe(200);
        expect(await sent.json()).toMatchObject({ok:true,status:'sent'});
        expect(provider.send.mock.calls).toHaveLength(callsBefore + 1);
        expect(provider.send.mock.calls.at(-1)![0].To).toBe(owner!.email);
        const key = path.endsWith('/jobs/test') ? `test:${admin}:${requestId}` : `provider-test:${admin}:${requestId}`;
        const logs = await db.select().from(notificationLogTable).where(eq(notificationLogTable.relatedId,key));
        expect(logs).toHaveLength(1);
        expect(logs[0]).toMatchObject({recipientUserId:admin,recipientEmail:owner!.email,status:'sent'});
        await db.update(usersTable).set({isTestAccount:true}).where(eq(usersTable.id,admin));
        const suppressedId = randomUUID();
        const suppressed = await post(headers,{requestId:suppressedId});
        expect(suppressed.status).toBe(200);
        expect(await suppressed.json()).toMatchObject({ok:true,status:'suppressed'});
        const suppressedKey = path.endsWith('/jobs/test') ? `test:${admin}:${suppressedId}` : `provider-test:${admin}:${suppressedId}`;
        const blocked = await db.select().from(notificationLogTable).where(eq(notificationLogTable.relatedId,suppressedKey));
        expect(blocked).toHaveLength(1);
        expect(blocked[0]).toMatchObject({recipientUserId:admin,recipientEmail:owner!.email,status:'suppressed'});
        expect(provider.send.mock.calls).toHaveLength(callsBefore + 1);
        await db.update(usersTable).set({isTestAccount:false}).where(eq(usersTable.id,admin));
      }
    } finally {
      process.env.NODE_ENV = previous;
      process.env.POSTMARK_SERVER_TOKEN = previousToken;
      process.env.EMAIL_FROM = previousFrom;
      await db.update(usersTable).set({isTestAccount:owner!.isTestAccount}).where(eq(usersTable.id,admin));
    }
  });
  it('filters confirmed and uncertain admin recipients before a bounded digest batch', async () => {
    const key = `digest-history:${randomUUID()}`;
    await db.insert(notificationLogTable).values([
      { type: 'admin_alert', recipientUserId: admin, recipientEmail: 'fixture-a@example.invalid', relatedId: key,
        subject: 'Fixture', status: 'logged' },
      { type: 'admin_alert', recipientUserId: volunteer, recipientEmail: 'fixture-b@example.invalid', relatedId: key,
        subject: 'Fixture', status: 'failed', error: 'DELIVERY_UNCERTAIN: timeout' },
      { type: 'admin_alert', recipientUserId: unverified, recipientEmail: 'fixture-c@example.invalid', relatedId: key,
        subject: 'Fixture', status: 'failed', error: 'Provider rejected' },
    ]);
    expect(await pendingRecipients('admin_alert', key, [{ id: admin }, { id: volunteer }, { id: unverified }]))
      .toEqual([{ id: unverified }]);
  });
  it('shows uncertain delivery and refuses both manual and API retries', async () => {
    const row = await failed();
    await db.update(notificationLogTable).set({ error: 'DELIVERY_UNCERTAIN: Provider timed out; review in Postmark.' })
      .where(eq(notificationLogTable.id, row.id));
    const list = await api.listNotifications({ search: row.recipientEmail, page: 1 });
    expect(list.rows.find(r => r.id === row.id)).toMatchObject({ status: 'failed', deliveryUncertain: true, canRetry: false });
    await expect(api.retryNotification(row.id)).rejects.toMatchObject({ status: 409 });
    const headers = { Cookie: await cookie(admin), Origin: process.env.APP_ORIGIN!, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf };
    expect((await fetch(`${base}/admin/notifications/${row.id}/retry`, { method: 'POST', headers, body: '{}' })).status).toBe(409);
    expect((await db.select().from(notificationLogTable).where(eq(notificationLogTable.id, row.id)))[0]!.status).toBe('failed');
  });
  it('encrypts content and detects tampering without storing token email bodies', async () => {
    const encrypted = encryptEmailBody({ html: '<p>Private</p>', text: 'Private' });
    expect(encrypted).not.toContain('Private');
    expect(decryptEmailBody(encrypted).text).toBe('Private');
    const parts = encrypted.split('.'); parts[2] = Buffer.alloc(16).toString('base64');
    expect(() => decryptEmailBody(parts.join('.'))).toThrow();
    const row = await failed('verification', unverified);
    expect(row.retryPayload).toBeNull();
  });
  it('does not replay saved emails with a retired branded footer or alter their history', async () => {
    const row = await failed('message', volunteer);
    const oldText = "An older message.\n\nYou're receiving this because you volunteer with a previous program.";
    await db.update(notificationLogTable).set({ retryPayload: encryptEmailBody({ html: '<p>An older message.</p>', text: oldText }) })
      .where(eq(notificationLogTable.id, row.id));
    await expect(api.retryNotification(row.id)).rejects.toThrow('retired contact details');
    const [saved] = await db.select().from(notificationLogTable).where(eq(notificationLogTable.id, row.id));
    expect(saved!.status).toBe('failed');
    expect(decryptEmailBody(saved!.retryPayload!).text).toBe(oldText);
  });
  it('retries a saved failure in place once; recipient and content are not editable', async () => {
    const row = await failed();
    expect(row.status).toBe('failed'); expect(row.retryPayload).not.toContain('Original content');
    const headers = { Cookie: await cookie(admin), Origin: process.env.APP_ORIGIN!, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf };
    const spoof = await fetch(`${base}/admin/notifications/${row.id}/retry`, { method: 'POST', headers, body: JSON.stringify({ to: 'other@example.invalid' }) });
    expect(spoof.status).toBe(400);
    const first = await fetch(`${base}/admin/notifications/${row.id}/retry`, { method: 'POST', headers, body: '{}' });
    expect(first.status).toBe(200); expect(await first.json()).toMatchObject({ ok: true, status: 'logged', skipped: false });
    expect(await api.retryNotification(row.id)).toMatchObject({ ok: true, status: 'logged', skipped: true });
    const rows = await db.select().from(notificationLogTable).where(eq(notificationLogTable.relatedId, row.relatedId!));
    expect(rows).toHaveLength(1); expect(rows[0]!.id).toBe(row.id);
    expect(decryptEmailBody(rows[0]!.retryPayload!).text).toBe('Original content thank you');
  });
  it('regenerates hash-only verification tokens, not old/expired links', async () => {
    const row = await failed('verification', unverified);
    expect(await api.retryNotification(row.id)).toMatchObject({ ok: true, status: 'logged' });
    const [updated] = await db.select().from(notificationLogTable).where(eq(notificationLogTable.id, row.id));
    const [token] = await db.select().from(authTokensTable).where(eq(authTokensTable.id, updated!.relatedId!));
    expect(token!.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(token!.expiresAt.getTime() - Date.now()).toBeGreaterThan(47 * 3600000);
    expect(updated!.retryPayload).toBeNull();
    expect((await api.retryNotification(row.id)).skipped).toBe(true);
  });
  it('filters metadata by recipient/type/status/date without exposing content', async () => {
    const now = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const page = await api.listNotifications({ page: 1, search: `admin-${tag}@example.invalid`, type: 'message', status: 'logged', from: now, to: now });
    expect(page.rows).toHaveLength(1); expect(page.total).toBe(1);
    expect(JSON.stringify(page)).not.toContain('retryPayload'); expect(JSON.stringify(page)).not.toContain('Original content');
    const summary = await api.notificationSummary();
    expect(summary.months).toHaveLength(6);
    for (const month of summary.months) expect(month.total).toBe(month.byType.reduce((n, x) => n + x.count, 0));
    expect(summary.postmark).toEqual({ tokenConfigured: false, emailFrom: null, fromName: null, fromAddress: null, replyTo: null, deliveryEnabled: false });
  });
  it('locks concurrent retries, rejects legacy/unknown attempts and deactivated recipients', async () => {
    const row = await failed();
    const client = await pool.connect();
    await client.query('SELECT pg_advisory_lock(hashtextextended($1,17))', [`notification-retry:${row.id}`]);
    try { await expect(api.retryNotification(row.id)).rejects.toThrow('already being retried'); }
    finally { await client.query('SELECT pg_advisory_unlock(hashtextextended($1,17))', [`notification-retry:${row.id}`]); client.release(); }
    await db.update(notificationLogTable).set({ retryPayload: null }).where(eq(notificationLogTable.id, row.id));
    await expect(api.retryNotification(row.id)).rejects.toThrow('original content');
    await db.update(notificationLogTable).set({ error: 'Delivery started but has not been confirmed.' }).where(eq(notificationLogTable.id, row.id));
    await expect(api.retryNotification(row.id)).rejects.toThrow('uncertain');
    const other = await failed();
    await db.update(usersTable).set({ isActive: false }).where(eq(usersTable.id, admin));
    await expect(api.retryNotification(other.id)).rejects.toThrow('inactive');
    await db.update(usersTable).set({ isActive: true }).where(eq(usersTable.id, admin));
  });
  it('enforces admin/CSRF guards, validates settings/dates, and sends tests only to the current admin', async () => {
    expect((await fetch(`${base}/admin/notifications`)).status).toBe(401);
    expect((await fetch(`${base}/admin/notifications`, { headers: { Cookie: await cookie(volunteer) } })).status).toBe(403);
    const headers = { Cookie: await cookie(admin), Origin: process.env.APP_ORIGIN!, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf };
    expect((await fetch(`${base}/admin/notifications/settings`, { method: 'PATCH', headers: { Cookie: headers.Cookie, 'Content-Type': 'application/json' }, body: '{"monthlyLimit":100}' })).status).toBe(403);
    expect((await fetch(`${base}/admin/notifications/settings`, { method: 'PATCH', headers, body: '{"monthlyLimit":0}' })).status).toBe(400);
    expect((await fetch(`${base}/admin/notifications?from=2026-02-31`, { headers })).status).toBe(400);
    expect((await fetch(`${base}/admin/notifications?from=2026-10-10&to=2026-10-01`, { headers })).status).toBe(400);
    const requestId = randomUUID();
    expect((await fetch(`${base}/admin/notifications/test`, { method: 'POST', headers, body: JSON.stringify({ requestId, to: 'other@example.invalid' }) })).status).toBe(400);
    for (let i = 0; i < 2; i++) {
      const response = await fetch(`${base}/admin/notifications/test`, { method: 'POST', headers, body: JSON.stringify({ requestId }) });
      expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ ok: true, status: 'logged', skipped: i === 1 });
    }
    const rows = await db.select().from(notificationLogTable).where(and(eq(notificationLogTable.relatedId, `provider-test:${admin}:${requestId}`), eq(notificationLogTable.recipientUserId, admin)));
    expect(rows).toHaveLength(1); expect(rows[0]!.subject).toContain('[Test]');
  });
  it('does not resend or double-count when another historical record already confirms this key', async () => {
    const row = await failed();
    await db.insert(notificationLogTable).values({ type: row.type, recipientEmail: row.recipientEmail,
      recipientUserId: row.recipientUserId, relatedId: row.relatedId, subject: row.subject, status: 'logged', sentAt: new Date() });
    expect(await api.retryNotification(row.id)).toMatchObject({ ok: true, skipped: true, status: 'logged' });
    const records = await db.select().from(notificationLogTable).where(eq(notificationLogTable.relatedId, row.relatedId!));
    expect(records).toHaveLength(2); expect(records.filter(r => r.status === 'logged')).toHaveLength(1);
  });
  it('audits encryption failures and fails closed before delivery', async () => {
    vi.stubEnv('SESSION_SECRET', '');
    try {
      const row = await failed();
      expect(row.status).toBe('failed'); expect(row.error).toContain('encryption configuration');
      expect(row.retryPayload).toBeNull();
    } finally { vi.unstubAllEnvs(); }
  });
  it('renews reset and pending-admin invitation links with their correct expiry', async () => {
    const [pending] = await db.insert(usersTable).values({ firstName: 'Pending', lastName: 'Fixture', phone: '',
      email: `pending-${tag}@example.invalid`, role: 'admin', isActive: true, passwordHash: 'not-a-login-password' }).returning();
    userIds.push(pending!.id);
    for (const [type, owner, hours, tokenType] of [
      ['password_reset', unverified, 1, 'password_reset'], ['invite', pending!.id, 168, 'admin_invite'],
    ] as const) {
      const row = await failed(type, owner);
      expect(row.retryPayload).toBeNull();
      expect(await api.retryNotification(row.id)).toMatchObject({ ok: true, status: 'logged' });
      const [updated] = await db.select().from(notificationLogTable).where(eq(notificationLogTable.id, row.id));
      const [token] = await db.select().from(authTokensTable).where(eq(authTokensTable.id, updated!.relatedId!));
      expect(token!.type).toBe(tokenType); expect(token!.tokenHash).toMatch(/^[0-9a-f]{64}$/);
      expect(token!.expiresAt.getTime() - Date.now()).toBeGreaterThan((hours - .1) * 3600000);
      expect(updated!.retryPayload).toBeNull();
    }
  });
});
