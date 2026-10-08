import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { eq, inArray } from 'drizzle-orm';
import {
  db, pool, usersTable, volunteerProfilesTable, resourcesTable, sessionsTable, authTokensTable, authRateLimitsTable,
  messagesTable, messageRecipientsTable, shiftSlotsTable, shiftAssignmentsTable,
} from '@workspace/db';
import { upcomingOccurrences, slotInstant, pacificDay } from './volunteer-shifts';
if (process.env.NODE_ENV && process.env.NODE_ENV !== 'development') throw new Error('Volunteer tests require the development database.');
process.env.NODE_ENV = 'development'; process.env.POSTMARK_SERVER_TOKEN = ''; process.env.EMAIL_FROM = '';
const { default: app } = await import('./app');
const { appOrigin } = await import('./auth/session');
const { hashPassword, checkPassword, tokenHash } = await import('./auth/security');
const namespace = randomBytes(5).toString('hex');
const password = 'Volunteer-Test123!';
const users: string[] = [], resourceIds: string[] = [], sessionIds: string[] = [], messageIds: string[] = [], slotIds: string[] = [];
const ip = `2001:db8:${namespace.slice(0, 4)}::77`;
let server: Server, base: string, active: string, applicant: string, other: string, pending: string, administrator: string;
const answers = { county: 'Placer', languages: ['English'], previousExperience: false, heardAbout: '', availability: '', anythingElse: '' };
async function fixture(status: 'active' | 'applicant', completed = true, verified = true, role: 'volunteer' | 'admin' = 'volunteer') {
  const [user] = await db.insert(usersTable).values({ firstName: 'VolunteerQA', lastName: namespace, phone: '9165550101',
    email: `volunteer-test-${namespace}-${users.length}@example.org`, passwordHash: await hashPassword(password), role,
    emailVerifiedAt: verified ? new Date() : null }).returning();
  users.push(user!.id);
  if (role === 'volunteer') await db.insert(volunteerProfilesTable).values({ userId: user!.id, status, onboardingAnswers: answers,
    onboardingCompletedAt: completed ? new Date() : null, agreementAcknowledgedAt: completed ? new Date() : null,
    agreementVersion: completed ? 'v1' : null, adminNotes: 'PRIVATE_ONLY_ADMIN' });
  return user!.id;
}
async function client(userId?: string) {
  const bootstrap = await fetch(`${base}/api/auth/session`, { headers: { 'x-forwarded-proto': 'https' } });
  const cookie = bootstrap.headers.get('set-cookie')!.split(';')[0]!;
  const { csrfToken } = await bootstrap.json() as { csrfToken: string };
  const sid = decodeURIComponent(cookie.split('=').slice(1).join('=')).slice(2).split('.')[0]!;
  sessionIds.push(sid);
  if (userId) {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
    const { rows } = await pool.query<{ sess: Record<string, unknown> }>('SELECT sess FROM sessions WHERE sid=$1', [sid]);
    await pool.query('UPDATE sessions SET sess=$1 WHERE sid=$2', [JSON.stringify({ ...rows[0]!.sess, userId, authVersion: user!.sessionVersion }), sid]);
  }
  return async (path: string, method = 'GET', body?: unknown) => {
    const response = await fetch(`${base}/api${path}`, { method, headers: { cookie, 'x-forwarded-proto': 'https',
      'x-forwarded-for': ip, origin: appOrigin, 'x-csrf-token': csrfToken, 'content-type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}) });
    const text = await response.text();
    let data: any; try { data = JSON.parse(text); } catch { data = text; }
    return { status: response.status, data };
  };
}
before(async () => {
  server = createServer(app); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  active = await fixture('active'); applicant = await fixture('applicant'); other = await fixture('active');
  pending = await fixture('applicant', false); administrator = await fixture('applicant', true, true, 'admin');
});
after(async () => {
  if (slotIds.length) {
    await db.delete(shiftAssignmentsTable).where(inArray(shiftAssignmentsTable.shiftSlotId, slotIds));
    await db.delete(shiftSlotsTable).where(inArray(shiftSlotsTable.id, slotIds));
  }
  if (messageIds.length) {
    await db.delete(messageRecipientsTable).where(inArray(messageRecipientsTable.messageId, messageIds));
    await db.delete(messagesTable).where(inArray(messagesTable.id, messageIds));
  }
  if (resourceIds.length) await db.delete(resourcesTable).where(inArray(resourcesTable.id, resourceIds));
  if (sessionIds.length) await db.delete(sessionsTable).where(inArray(sessionsTable.sid, sessionIds));
  if (users.length) {
    await db.delete(authTokensTable).where(inArray(authTokensTable.userId, users));
    await db.delete(volunteerProfilesTable).where(inArray(volunteerProfilesTable.userId, users));
    await db.delete(usersTable).where(inArray(usersTable.id, users));
  }
  const keys = [
    ...users.map(id => `password-change-user:${tokenHash(id)}`), `password-change-ip:${tokenHash(ip)}`,
    `signin-ip:${tokenHash(ip)}`, ...users.map((_, i) => `signin-email:${tokenHash(`volunteer-test-${namespace}-${i}@example.org`)}`),
  ];
  await db.delete(authRateLimitsTable).where(inArray(authRateLimitsTable.key, keys));
  await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
  await pool.end();
});
test('Pacific recurrence handles DST, closures, skips, end dates and four occurrence limit', () => {
  assert.equal(slotInstant('2026-03-06', '09:00').toISOString(), '2026-03-06T17:00:00.000Z');
  assert.equal(slotInstant('2026-03-09', '09:00').toISOString(), '2026-03-09T16:00:00.000Z');
  assert.equal(slotInstant('2026-11-02', '09:00').toISOString(), '2026-11-02T17:00:00.000Z');
  assert.equal(pacificDay(new Date('2026-03-09T02:00:00Z')), '2026-03-08');
  const slot = { assignmentId: 'fixture', dayOfWeek: 1, startTime: '09:00', endTime: '11:00', startDate: '2026-01-01', endDate: null, label: null };
  const result = upcomingOccurrences([slot], new Set(['2026-03-09']), new Set(['fixture:2026-03-16']), new Date('2026-03-06T18:00:00Z'));
  assert.equal(result.length, 4); assert.equal(result[0]!.date, '2026-03-23');
  assert.equal(upcomingOccurrences([{ ...slot, endDate: '2026-03-16' }], new Set(['2026-03-09']), new Set(['fixture:2026-03-16']), new Date('2026-03-06T18:00:00Z')).length, 0);
});
test('new volunteer routes deny anonymous, unverified, incomplete and administrator callers', async () => {
  for (const actor of [undefined, await fixture('active', true, false), pending, administrator]) {
    const request = await client(actor);
    for (const path of ['/volunteer/dashboard', '/volunteer/messages', '/volunteer/resources']) {
      const response = await request(path);
      assert.equal(response.status, actor ? 403 : 401);
      if (actor === pending) assert.equal(response.data.nextPath, '/onboarding');
    }
  }
});
test('quick links are published and active-only; no staff/creator fields leak', async () => {
  for (const published of [true, false]) {
    const [row] = await db.insert(resourcesTable).values({ type: 'link', title: `Quick ${namespace} ${published}`, category: 'QA',
      url: 'https://example.org/qa', isQuickLink: true, isPublished: published, createdByUserId: administrator }).returning();
    resourceIds.push(row!.id);
  }
  const request = await client(active);
  const response = await request('/volunteer/dashboard');
  assert.equal(response.status, 200); assert.equal(response.data.shiftCount, 0); assert.equal(response.data.nextShift, null);
  assert.ok(response.data.quickLinks.some((row: any) => row.id === resourceIds[0]));
  assert.ok(!response.data.quickLinks.some((row: any) => row.id === resourceIds[1]));
  assert.equal('createdByUserId' in response.data.quickLinks[0], false);
  assert.equal(JSON.stringify(response.data).includes('adminNotes'), false);
  const application = await client(applicant);
  assert.deepEqual((await application('/volunteer/dashboard')).data.quickLinks, []);
  assert.ok((await application('/volunteer/resources')).data.every((row: any) => !row.isQuickLink));
});
test('messages are recipient-scoped and another recipient cannot be marked read', async () => {
  const recipientIds: string[] = [];
  for (const recipient of [active, other]) {
    const [message] = await db.insert(messagesTable).values({ senderUserId: administrator, audience: 'single', subject: `Message ${namespace} ${recipient}`, body: 'Private fixture content' }).returning();
    messageIds.push(message!.id);
    const [row] = await db.insert(messageRecipientsTable).values({ messageId: message!.id, recipientUserId: recipient }).returning();
    recipientIds.push(row!.id);
  }
  const request = await client(active);
  const list = await request('/volunteer/messages');
  assert.equal(list.data.length, 1); assert.equal(list.data[0].recipientId, recipientIds[0]);
  const history = await db.insert(messagesTable).values(Array.from({ length: 201 }, (_, i) => ({
    senderUserId: administrator, audience: 'single' as const, subject: `QA history ${namespace} ${i}`,
    body: 'Read owned-history fixture', sentAt: new Date(Date.now() + 1000),
  }))).returning({ id: messagesTable.id });
  messageIds.push(...history.map(row => row.id));
  await db.insert(messageRecipientsTable).values(history.map(row => ({ messageId: row.id, recipientUserId: active, readAt: new Date() })));
  const withHistory = await request('/volunteer/messages');
  assert.equal(withHistory.data.length, 202);
  assert.ok(withHistory.data.some((row: any) => row.recipientId === recipientIds[0] && row.readAt === null),
    'A latest-unread preview must remain readable even behind more than 200 newer read messages.');
  assert.equal((await request('/volunteer/dashboard')).data.unreadCount, 1);
  assert.equal((await request(`/volunteer/messages/${recipientIds[1]}/read`, 'PATCH')).status, 404);
  assert.equal((await request(`/volunteer/messages/${recipientIds[0]}/read`, 'PATCH')).status, 200);
  assert.equal((await request('/volunteer/dashboard')).data.unreadMessage, null);
});
test('own assignment projection returns four dates without other volunteers or old assignments', async () => {
  const [slot] = await db.insert(shiftSlotsTable).values({ dayOfWeek: 1, startTime: '09:00', endTime: '11:00', label: `QA ${namespace}` }).returning();
  slotIds.push(slot!.id);
  for (const owner of [active, other]) {
    const [profile] = await db.select().from(volunteerProfilesTable).where(eq(volunteerProfilesTable.userId, owner));
    await db.insert(shiftAssignmentsTable).values({ volunteerProfileId: profile!.id, shiftSlotId: slot!.id, startDate: '2026-01-01', createdByUserId: administrator });
  }
  const request = await client(active);
  const response = await request('/volunteer/dashboard');
  assert.equal(response.data.shiftCount, 1); assert.equal(response.data.upcomingShifts.length, 4);
  assert.equal(response.data.nextShift.startTime, '09:00');
  assert.equal(JSON.stringify(response.data).includes('volunteerProfileId'), false);
  assert.equal(JSON.stringify(response.data).includes(other), false);
  assert.equal(response.data.schedulingOpen, true);
});
test('profile saves explicit blank availability and config answers, never ownership/role/status/email/agreement', async () => {
  const request = await client(active);
  const body = { firstName: 'Updated', lastName: namespace, phone: '+19165550102', county: 'Sacramento',
    availabilityNotes: null, answers: { ...answers, languages: ['Spanish'], availability: 'not canonical', county: 'Placer', adminNotes: 'bad' },
    userId: other, role: 'admin', email: 'bad@example.org', status: 'active', agreementVersion: 'bad' };
  const response = await request('/volunteer/profile', 'PATCH', body);
  assert.equal(response.status, 200);
  assert.equal(response.data.user.id, active); assert.equal(response.data.user.role, 'volunteer');
  assert.equal(response.data.user.firstName, 'Updated');
  assert.equal(response.data.profile.county, 'Sacramento'); assert.equal(response.data.profile.availabilityNotes, null);
  assert.equal(response.data.profile.onboardingAnswers.county, 'Sacramento');
  assert.equal(response.data.profile.onboardingAnswers.availability, '');
  assert.equal(response.data.profile.onboardingAnswers.adminNotes, undefined);
  assert.equal(response.data.profile.agreementVersion, 'v1');
  assert.equal(response.data.profile.adminNotes, undefined);
  assert.equal((await request('/volunteer/profile', 'PATCH', { ...body, county: 'invalid' })).status, 400);
  const [otherUser] = await db.select().from(usersTable).where(eq(usersTable.id, other));
  assert.equal(otherUser!.firstName, 'VolunteerQA');
});
test('password change checks current password, bcrypt 12, rejects invalid input and ends all sessions', async () => {
  const request = await client(active);
  const olderSession = await client(active);
  const newPassword = 'Updated-Volunteer123!';
  assert.equal((await request('/volunteer/password', 'POST', { currentPassword: 'wrong', password: newPassword, confirmPassword: newPassword })).status, 400);
  assert.equal((await request('/volunteer/password', 'POST', { currentPassword: password, password: 'short', confirmPassword: 'short' })).status, 400);
  assert.equal((await request('/volunteer/password', 'POST', { currentPassword: password, password: 'é'.repeat(40), confirmPassword: 'é'.repeat(40) })).status, 400);
  assert.equal((await request('/volunteer/password', 'POST', { currentPassword: password, password: newPassword, confirmPassword: newPassword })).status, 200);
  assert.equal((await request('/me')).status, 401); assert.equal((await olderSession('/me')).status, 401);
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, active));
  assert.equal(await checkPassword(password, user!.passwordHash), false);
  assert.equal(await checkPassword(newPassword, user!.passwordHash), true);
  assert.ok(user!.passwordHash.startsWith('$2b$12$'));
});
