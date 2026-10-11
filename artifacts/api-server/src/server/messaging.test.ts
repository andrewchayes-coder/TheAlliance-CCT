import { beforeAll, afterAll, it, expect } from 'vitest';
import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { db, pool, usersTable, volunteerProfilesTable, messagesTable, messageRecipientsTable, notificationLogTable, sessionsTable } from '@workspace/db';
import { renderMessageMarkdown } from '@workspace/shared/markdown';
process.env.NODE_ENV = 'development'; process.env.POSTMARK_SERVER_TOKEN = ''; process.env.EMAIL_FROM = '';
const tag = `messages-${randomUUID()}`, users: string[] = [], sessions: string[] = [], ownedMessages: string[] = [];
type Client = (path: string, method?: string, body?: unknown, csrf?: boolean) => Promise<{ status: number; data: any }>;
let server: Server, base: string, origin: string, admin: Client, a: Client, b: Client, unverified: Client, anon: Client;
let service: typeof import('./messaging');
const content = '**Thank you** for caring.\n- First item\n- [Find help](https://example.org/help)\n<script>alert(1)</script>';
async function client(userId?: string): Promise<Client> {
  const boot = await fetch(`${base}/api/auth/session`, { headers: { 'x-forwarded-proto': 'https' } });
  const cookie = boot.headers.get('set-cookie')!.split(';')[0]!, { csrfToken } = await boot.json() as { csrfToken: string };
  const sid = decodeURIComponent(cookie.split('=').slice(1).join('=')).slice(2).split('.')[0]!; sessions.push(sid);
  if (userId) {
    const { rows } = await pool.query('SELECT sess FROM sessions WHERE sid=$1', [sid]);
    await pool.query('UPDATE sessions SET sess=$1 WHERE sid=$2', [JSON.stringify({ ...rows[0]!.sess, userId, authVersion: 0 }), sid]);
  }
  return async (path, method = 'GET', body, csrf = true) => {
    const response = await fetch(`${base}/api${path}`, { method,
      headers: { cookie, Origin: origin, 'x-forwarded-proto': 'https', 'Content-Type': 'application/json', ...(csrf ? { 'X-CSRF-Token': csrfToken } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, data: await response.json() };
  };
}
beforeAll(async () => {
  service = await import('./messaging');
  const { default: app } = await import('../app'); origin = (await import('../auth/session')).appOrigin;
  server = createServer(app); await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  for (let i = 0; i < 5; i++) {
    const [user] = await db.insert(usersTable).values({ role: i ? 'volunteer' : 'admin', email: `${tag}-${i}@example.invalid`,
      firstName: `${tag} ${i}`, lastName: 'Care', phone: '5555550100', passwordHash: 'unusable', emailVerifiedAt: i === 4 ? null : new Date() }).returning();
    users.push(user!.id);
    if (i) await db.insert(volunteerProfilesTable).values({ userId: user!.id, status: i === 3 ? 'inactive' : i === 4 ? 'applicant' : 'active',
      dateOfBirth: '1990-01-01', addressLine1: '123 Test St', city: 'Auburn', state: 'CA', zip: '95603',
      emergencyContactName: 'Test Contact', emergencyContactRelationship: 'Friend', emergencyContactPhone: '5555550100',
      onboardingCompletedAt: new Date(), agreementAcknowledgedAt: new Date(), adminNotes: 'staff-private-do-not-expose' });
  }
  admin = await client(users[0]); a = await client(users[1]); b = await client(users[2]); unverified = await client(users[4]); anon = await client();
});
afterAll(async () => {
  if (server) await new Promise<void>(r => server.close(() => r()));
  if (ownedMessages.length) {
    await db.delete(notificationLogTable).where(inArray(notificationLogTable.relatedId, ownedMessages));
    await db.delete(messagesTable).where(inArray(messagesTable.id, ownedMessages));
  }
  if (users.length) {
    await db.delete(notificationLogTable).where(inArray(notificationLogTable.recipientUserId, users));
    await db.delete(volunteerProfilesTable).where(inArray(volunteerProfilesTable.userId, users));
    await db.delete(usersTable).where(inArray(usersTable.id, users));
  }
  if (sessions.length) await db.delete(sessionsTable).where(inArray(sessionsTable.sid, sessions));
  await pool.end();
});
const draft = (audience: 'selected' | 'single' | 'active' | 'all' = 'selected', sendByEmail = true) => ({
  audience, userIds: audience === 'selected' ? users.slice(1, 3) : audience === 'single' ? [users[1]!] : [],
  subject: 'A note of thanks', body: content, sendByEmail,
});
it('renders bold, safe links, ordered/bullet lists, and escapes every raw HTML vector', () => {
  const result = renderMessageMarkdown(content + '\n1. Ordered\n[Bad](javascript:alert)\n<img src=x onerror=alert(1)>');
  expect(result.html).toContain('<strong>Thank you</strong>'); expect(result.html).toContain('<ul');
  expect(result.html).toContain('<ol'); expect(result.html).toContain('href="https://example.org/help"');
  expect(result.html).not.toContain('<script>'); expect(result.html).not.toContain('<img');
  expect(result.html).not.toContain('href="javascript:'); expect(result.text).toContain('Find help (https://example.org/help)');
  expect(result.text).not.toContain('**Thank you**');
});
it('guards all staff routes, rejects unverified readers and missing CSRF, and scopes volunteer search', async () => {
  for (const [path, method] of [['/admin/messages', 'GET'], ['/admin/messages', 'POST'],
    ['/admin/messages/preview', 'POST'], ['/admin/messages/volunteers', 'GET'], [`/admin/messages/${randomUUID()}`, 'GET']]) {
    expect((await anon!(path!, method!)).status).toBe(401);
    expect((await a!(path!, method!)).status).toBe(403);
    expect((await unverified!(path!, method!)).status).toBe(403);
  }
  expect((await admin('/admin/messages/preview', 'POST', draft(), false)).status).toBe(403);
  expect((await unverified('/volunteer/messages/context')).status).toBe(403);
  const candidates = await admin(`/admin/messages/volunteers?q=${tag}`);
  expect(candidates.data).toHaveLength(4); expect(JSON.stringify(candidates.data)).not.toContain('adminNotes');
});
it('previews all four audiences, validates recipient types, and detects stale previews', async () => {
  const all = await admin('/admin/messages/preview', 'POST', draft('all'));
  const active = await admin('/admin/messages/preview', 'POST', draft('active'));
  expect(all.data.recipients.some((p: any) => p.userId === users[3])).toBe(true);
  expect(active.data.recipients.some((p: any) => p.userId === users[3])).toBe(false);
  expect(active.data.recipients.every((p: any) => p.status === 'active')).toBe(true);
  expect((await admin('/admin/messages/preview', 'POST', { ...draft(), userIds: [users[0]] })).status).toBe(422);
  expect((await admin('/admin/messages/preview', 'POST', { ...draft('single'), userIds: users.slice(1, 3) })).status).toBe(400);
  const requestId = randomUUID(); ownedMessages.push(requestId);
  const preview = await service.previewMessage(draft());
  await expect(service.sendMessage({ id: users[0]!, sessionVersion: 0 }, { ...draft(), body: 'Changed body', previewHash: preview.previewHash, requestId }))
    .rejects.toMatchObject({ status: 409 });
  expect(await db.select().from(messagesTable).where(eq(messagesTable.id, requestId))).toHaveLength(0);
});
it('atomically sends selected recipients and bounded email copies, with concurrent retry deduplication', async () => {
  const preview = await admin('/admin/messages/preview', 'POST', draft());
  const requestId = randomUUID(); ownedMessages.push(requestId);
  const payload = { ...draft(), requestId, previewHash: preview.data.previewHash };
  const replies = await Promise.all([admin('/admin/messages', 'POST', payload), admin('/admin/messages', 'POST', payload)]);
  expect(replies.every(r => r.status === 200)).toBe(true);
  expect(replies.some(r => r.data.reused)).toBe(true);
  expect((await db.select().from(messageRecipientsTable).where(eq(messageRecipientsTable.messageId, requestId)))).toHaveLength(2);
  const logs = await db.select().from(notificationLogTable).where(eq(notificationLogTable.relatedId, requestId));
  expect(logs).toHaveLength(2); expect(logs.every(l => l.status === 'logged' && l.type === 'message')).toBe(true);
  expect((await admin('/admin/messages', 'POST', { ...payload, userIds: [users[3]!] })).status).toBe(409);
  const inboxA = await a('/volunteer/messages'), inboxB = await b('/volunteer/messages');
  expect(inboxA.data).toHaveLength(1); expect(inboxB.data).toHaveLength(1);
  for (const inbox of [inboxA, inboxB]) expect(JSON.stringify(inbox.data)).not.toMatch(/recipientUserId|email|adminNotes|firstName/);
});
it('marks only owned messages read, preserves first read time, updates receipts/history and unread count', async () => {
  const [message] = (await a('/volunteer/messages')).data;
  expect((await b(`/volunteer/messages/${message.recipientId}/read`, 'PATCH')).status).toBe(404);
  const context = (await a('/volunteer/messages/context')).data;
  expect(context.unreadCount).toBe(1);
  expect(context.adminContact).toBe('cct@defendingthecause.org');
  expect(JSON.stringify(context)).not.toContain(`${tag}-0@example.invalid`);
  const first = await a(`/volunteer/messages/${message.recipientId}/read`, 'PATCH');
  const again = await a(`/volunteer/messages/${message.recipientId}/read`, 'PATCH');
  expect(again.data.readAt).toBe(first.data.readAt);
  expect((await a('/volunteer/messages/context')).data.unreadCount).toBe(0);
  expect((await b('/volunteer/messages/context')).data.unreadCount).toBe(1);
  const detail = await admin(`/admin/messages/${message.id}`);
  expect(detail.data.message.readCount).toBe(1); expect(detail.data.message.recipientCount).toBe(2);
  expect(detail.data.recipients.find((p: any) => p.userId === users[1]).readAt).toBe(first.data.readAt);
  const history = await admin(`/admin/messages?userId=${users[1]}`);
  expect(history.data[0].readAt).toBe(first.data.readAt);
  expect(history.data[0].readCount).toBe(1);
});
it('sends a single inbox-only message without email logs, including inactive volunteers', async () => {
  const input = { ...draft('single', false), userIds: [users[3]!] }, preview = await service.previewMessage(input);
  const requestId = randomUUID(); ownedMessages.push(requestId);
  const result = await service.sendMessage({ id: users[0]!, sessionVersion: 0 }, { ...input, requestId, previewHash: preview.previewHash });
  expect(result.recipientCount).toBe(1); expect(result.logged).toBe(0);
  expect(await db.select().from(notificationLogTable).where(eq(notificationLogTable.relatedId, requestId))).toHaveLength(0);
  expect((await service.listMessages(users[3]))).toHaveLength(1);
});
