import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer, type Server } from 'node:http';
import { randomBytes } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import bcrypt from 'bcrypt';
import {
  db, pool, usersTable, volunteerProfilesTable, authTokensTable, notificationLogTable, sessionsTable, authRateLimitsTable,
} from '@workspace/db';

if (process.env.NODE_ENV && process.env.NODE_ENV !== 'development') {
  throw new Error('Authentication integration tests may only run against the development database.');
}
process.env.NODE_ENV = 'development';
// This process must never send real mail or make live Google token exchanges.
process.env.POSTMARK_SERVER_TOKEN = '';
process.env.EMAIL_FROM = '';
process.env.GOOGLE_CLIENT_ID = '';
process.env.GOOGLE_CLIENT_SECRET = '';
const { default: app } = await import('../app');
const { appOrigin } = await import('./session');
const { mintToken } = await import('./accounts');
const { tokenHash } = await import('./security');
const { inviteAdministrator, assertDeactivationAllowed, AdminActionError } = await import('./admin-management');

const namespace = randomBytes(6).toString('hex');
const password = 'LocalAuth-Test123!';
const createdUsers: string[] = [];
const sessionIds = new Set<string>();
const rateKeys = new Set<string>();
let sequence = 0;
let base: string;
let server: Server;
const scopes = ['signup', 'signin', 'reset', 'resend', 'resend-minute', 'resend-hour', 'resend-ip', 'verify-ip', 'reset-apply-ip', 'google-ip', 'admin-invite', 'invite-accept-ip'];
const trackRate = (identity: string) => scopes.forEach(scope => {
  rateKeys.add(`${scope}:${tokenHash(identity)}`);
  rateKeys.add(`${scope}-ip:${tokenHash(identity)}`);
  rateKeys.add(`${scope}-email:${tokenHash(identity)}`);
});

class Client {
  cookie = '';
  csrf = '';
  lastCookie = '';
  ip = `2001:db8:${namespace.slice(0, 4)}::${(++sequence).toString(16)}`;
  constructor() { trackRate(this.ip); }
  async request(path: string, method = 'GET', data?: unknown, extras: Record<string, string> = {}) {
    const response = await fetch(`${base}/api${path}`, {
      method, redirect: 'manual',
      headers: {
        'x-forwarded-proto': 'https', 'x-forwarded-for': this.ip,
        origin: appOrigin, ...(this.cookie ? { cookie: this.cookie } : {}),
        ...(['POST', 'PATCH'].includes(method) ? { 'content-type': 'application/json', 'x-csrf-token': this.csrf } : {}),
        ...extras,
      },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
    const cookie = response.headers.get('set-cookie');
    if (cookie) {
      this.lastCookie = cookie;
      this.cookie = cookie.split(';')[0]!;
      const value = decodeURIComponent(this.cookie.split('=').slice(1).join('='));
      if (value.startsWith('s:')) sessionIds.add(value.slice(2).split('.')[0]!);
    }
    const text = await response.text();
    let body: any;
    try { body = JSON.parse(text); } catch { body = text; }
    return { status: response.status, body, headers: response.headers };
  }
  async bootstrap() {
    const response = await this.request('/auth/session');
    assert.equal(response.status, 200);
    this.csrf = response.body.csrfToken;
    return response.body;
  }
  async post(path: string, data?: unknown) {
    if (!this.csrf) await this.bootstrap();
    return this.request(path, 'POST', data);
  }
}
async function fixture() {
  const client = new Client();
  const email = `auth-check-${namespace}-${sequence}@example.org`;
  trackRate(email);
  const signup = await client.post('/auth/signup', {
    firstName: 'Test', lastName: 'Volunteer', email, phone: '(212) 555-0123',
    password, confirmPassword: password, role: 'admin',
  });
  assert.equal(signup.status, 200);
  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1);
  assert.ok(user);
  createdUsers.push(user.id);
  trackRate(user.id);
  await client.bootstrap();
  return { client, user, email };
}
async function verifyFixture() {
  const fixtureData = await fixture();
  const token = await mintToken(fixtureData.user.id, 'email_verify');
  const verified = await fixtureData.client.post('/auth/verify', { token: token.raw });
  assert.equal(verified.status, 200);
  await fixtureData.client.bootstrap();
  return { ...fixtureData, token };
}
async function adminFixture() {
  const data = await verifyFixture();
  const [user] = await db.update(usersTable).set({ role: 'admin' }).where(eq(usersTable.id, data.user.id)).returning();
  await data.client.bootstrap();
  return { ...data, user: user! };
}
async function adminInvitation(actor: Parameters<typeof inviteAdministrator>[1] & { actor: NonNullable<Parameters<typeof inviteAdministrator>[1]['actor']> }) {
  const email = `admin-check-${namespace}-${++sequence}@example.org`;
  const invitation = await inviteAdministrator({ firstName: 'Invitation', lastName: 'Check', email }, actor);
  createdUsers.push(invitation.user.id);
  trackRate(email);
  trackRate(invitation.user.id);
  return { ...invitation, raw: new URL(invitation.inviteUrl).searchParams.get('token')! };
}
before(async () => {
  server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  base = `http://127.0.0.1:${address.port}`;
});
after(async () => {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  if (createdUsers.length) {
    await db.delete(notificationLogTable).where(inArray(notificationLogTable.recipientUserId, createdUsers));
    await db.delete(authTokensTable).where(inArray(authTokensTable.userId, createdUsers));
    await db.delete(volunteerProfilesTable).where(inArray(volunteerProfilesTable.userId, createdUsers));
    await db.delete(usersTable).where(inArray(usersTable.id, createdUsers));
  }
  if (sessionIds.size) await db.delete(sessionsTable).where(inArray(sessionsTable.sid, [...sessionIds]));
  if (rateKeys.size) await db.delete(authRateLimitsTable).where(inArray(authRateLimitsTable.key, [...rateKeys]));
  await pool.end();
});

test('admin sign-in lands on /admin; undeclared API handlers cannot execute for any role', async () => {
  const admin = await adminFixture();
  await admin.client.post('/auth/signout');
  await admin.client.bootstrap();
  const signin = await admin.client.post('/auth/signin', { email: admin.user.email, password });
  assert.equal(signin.body.nextPath, '/admin');
  await admin.client.bootstrap();
  assert.equal((await admin.client.request('/admin/users?role=admin')).status, 200);
  let executed = false;
  app.get('/api/undeclared-security-check', (_req, res) => { executed = true; res.json({ private: true }); });
  const volunteer = await verifyFixture();
  for (const client of [new Client(), volunteer.client, admin.client]) {
    const denied = await client.request('/undeclared-security-check');
    assert.equal(denied.status, 403);
    assert.equal(denied.body.code, 'ROUTE_NOT_DECLARED');
  }
  assert.equal(executed, false);
});

test('volunteers see only their own safe profile and cannot reach any admin or schedule data', async () => {
  const own = await verifyFixture();
  const other = await fixture();
  await db.update(usersTable).set({ firstName: 'PrivateOther', phone: '+12125550999' }).where(eq(usersTable.id, other.user.id));
  await db.update(volunteerProfilesTable).set({ adminNotes: 'Private administrator note' })
    .where(eq(volunteerProfilesTable.userId, own.user.id));
  const me = await own.client.request(`/me?userId=${other.user.id}`);
  assert.equal(me.status, 200);
  assert.equal(me.body.user.id, own.user.id);
  assert.equal(me.body.profile.userId, own.user.id);
  const serialized = JSON.stringify(me.body);
  for (const privateValue of [other.user.id, other.user.email, 'PrivateOther', '+12125550999', 'adminNotes', 'Private administrator note']) {
    assert.ok(!serialized.includes(privateValue));
  }
  for (const path of ['/admin/users?role=volunteer', '/admin/users?role=admin', `/schedule?userId=${other.user.id}`]) {
    const denied = await own.client.request(path);
    assert.equal(denied.status, 403);
    assert.ok(!JSON.stringify(denied.body).includes(other.user.email));
  }
  assert.equal((await own.client.post('/admin/invites', { firstName: 'No', lastName: 'Access', email: other.user.email })).status, 403);
  assert.equal((await own.client.request(`/admin/users/${other.user.id}/status`, 'PATCH', { isActive: false })).status, 403);
  assert.equal((await new Client().request('/admin/users?role=admin')).status, 401);
  assert.equal((await other.client.request('/admin/users?role=admin')).status, 403);
});

test('admin directory is paginated and safe; invites create pending admins with logged audit and seven-day hashes', async () => {
  const admin = await adminFixture();
  const email = `admin-route-${namespace}-${++sequence}@example.org`;
  const result = await admin.client.post('/admin/invites', { firstName: 'Pending', lastName: 'Administrator', email });
  assert.equal(result.status, 200);
  assert.equal(result.body.delivery, 'logged');
  assert.ok(!('inviteUrl' in result.body));
  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email));
  assert.ok(user);
  createdUsers.push(user.id); trackRate(email); trackRate(user.id);
  assert.equal(user.role, 'admin');
  assert.equal(user.emailVerifiedAt, null);
  assert.equal(bcrypt.getRounds(user.passwordHash), 12);
  const [token] = await db.select().from(authTokensTable).where(eq(authTokensTable.userId, user.id));
  assert.equal(token!.type, 'admin_invite');
  assert.match(token!.tokenHash, /^[a-f0-9]{64}$/);
  assert.ok(Math.abs(token!.expiresAt.getTime() - Date.now() - 7 * 24 * 3600_000) < 10_000);
  const [log] = await db.select().from(notificationLogTable).where(eq(notificationLogTable.recipientUserId, user.id));
  assert.equal(log!.type, 'invite'); assert.equal(log!.status, 'logged');
  const list = await admin.client.request(`/admin/users?role=admin&q=${email}&limit=1&offset=0`);
  assert.equal(list.status, 200); assert.equal(list.body.total, 1);
  assert.equal(list.body.users[0].id, user.id);
  for (const field of ['passwordHash', 'googleSubject', 'sessionVersion', 'adminNotes']) {
    assert.ok(!JSON.stringify(list.body).includes(field));
  }
  assert.equal((await admin.client.request('/admin/users?role=admin&limit=101')).status, 400);
  const volunteer = await fixture();
  assert.equal((await admin.client.post('/admin/invites', {
    firstName: 'Cannot', lastName: 'Promote', email: volunteer.user.email,
  })).status, 409);
});

test('admin invite acceptance verifies email, sets bcrypt password, signs in and remains single-use', async () => {
  const admin = await adminFixture();
  const invitation = await adminInvitation({ actor: admin.user });
  const client = new Client();
  const accepted = await client.post('/auth/accept-invite', {
    token: invitation.raw, password, confirmPassword: password,
  });
  assert.equal(accepted.status, 200); assert.equal(accepted.body.nextPath, '/admin');
  await client.bootstrap();
  assert.equal((await client.request('/admin/users?role=admin')).status, 200);
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, invitation.user.id));
  assert.ok(user!.emailVerifiedAt); assert.ok(user!.lastLoginAt);
  assert.ok(await bcrypt.compare(password, user!.passwordHash));
  assert.equal(bcrypt.getRounds(user!.passwordHash), 12);
  const again = await new Client().post('/auth/accept-invite', { token: invitation.raw, password, confirmPassword: password });
  assert.equal(again.status, 400); assert.equal(again.body.code, 'TOKEN_INVALID');
});

test('expired and renewed invites fail closed, and pending admins cannot bypass invitation via verification or reset', async () => {
  const admin = await adminFixture();
  const invitation = await adminInvitation({ actor: admin.user });
  await db.update(authTokensTable).set({ expiresAt: new Date(Date.now() - 1000) })
    .where(eq(authTokensTable.userId, invitation.user.id));
  const expired = await new Client().post('/auth/accept-invite', { token: invitation.raw, password, confirmPassword: password });
  assert.equal(expired.status, 400);
  const renewed = await inviteAdministrator({
    email: invitation.user.email, firstName: invitation.user.firstName, lastName: invitation.user.lastName,
  }, { actor: admin.user });
  assert.notEqual(new URL(renewed.inviteUrl).searchParams.get('token'), invitation.raw);
  assert.equal((await new Client().post('/auth/accept-invite', {
    token: invitation.raw, password, confirmPassword: password,
  })).status, 400);
  const generic = await new Client().post('/auth/forgot-password', { email: invitation.user.email });
  assert.equal(generic.status, 200);
  const resets = await db.select().from(authTokensTable).where(and(
    eq(authTokensTable.userId, invitation.user.id), eq(authTokensTable.type, 'password_reset'),
  ));
  assert.equal(resets.length, 0);
  const verification = await mintToken(invitation.user.id, 'email_verify');
  assert.equal((await new Client().post('/auth/verify', { token: verification.raw })).status, 400);
  const reset = await mintToken(invitation.user.id, 'password_reset');
  assert.equal((await new Client().post('/auth/reset-password', {
    token: reset.raw, password, confirmPassword: password,
  })).status, 400);
});

test('deactivation revokes sessions and links for admins and volunteers; reactivation does not revive sessions', async () => {
  const admin = await adminFixture();
  for (const target of [await adminFixture(), await verifyFixture()]) {
    await mintToken(target.user.id, 'password_reset');
    const deactivated = await admin.client.request(`/admin/users/${target.user.id}/status`, 'PATCH', { isActive: false });
    assert.equal(deactivated.status, 200); assert.equal(deactivated.body.isActive, false);
    assert.equal((await target.client.request('/me')).status, 401);
    const sessions = await db.select().from(sessionsTable).where(sql`${sessionsTable.sess}->>'userId' = ${target.user.id}`);
    assert.equal(sessions.length, 0);
    const tokens = await db.select().from(authTokensTable).where(eq(authTokensTable.userId, target.user.id));
    assert.ok(tokens.every(token => token.usedAt));
    await target.client.bootstrap();
    const disabled = await target.client.post('/auth/signin', { email: target.user.email, password });
    assert.equal(disabled.status, 403);
    assert.equal(disabled.body.error, "Your account isn't active. Please contact The Alliance.");
    const reactivated = await admin.client.request(`/admin/users/${target.user.id}/status`, 'PATCH', { isActive: true });
    assert.equal(reactivated.status, 200); assert.equal(reactivated.body.isActive, true);
    assert.equal((await target.client.request('/me')).status, 401);
    assert.equal((await target.client.post('/auth/signin', { email: target.user.email, password })).status, 200);
  }
});

test('self and last-admin safeguards hold, including two administrators attempting to deactivate each other', async () => {
  const first = await adminFixture();
  const second = await adminFixture();
  const self = await first.client.request(`/admin/users/${first.user.id}/status`, 'PATCH', { isActive: false });
  assert.equal(self.status, 409); assert.equal(self.body.code, 'SELF_DEACTIVATION');
  assert.throws(() => assertDeactivationAllowed(second.user.id, first.user, 1),
    (error: unknown) => error instanceof AdminActionError && error.code === 'LAST_ADMIN');
  const responses = await Promise.all([
    first.client.request(`/admin/users/${second.user.id}/status`, 'PATCH', { isActive: false }),
    second.client.request(`/admin/users/${first.user.id}/status`, 'PATCH', { isActive: false }),
  ]);
  assert.equal(responses.filter(response => response.status === 200).length, 1);
  const users = await db.select().from(usersTable).where(inArray(usersTable.id, [first.user.id, second.user.id]));
  assert.equal(users.filter(user => user.isActive).length, 1);
});

test('signup creates bcrypt volunteer/applicant, logs verification, and denies every protected API', async () => {
  const { client, user } = await fixture();
  assert.equal(user.role, 'volunteer');
  assert.equal(user.emailVerifiedAt, null);
  assert.equal(user.phone, '+12125550123');
  assert.equal(bcrypt.getRounds(user.passwordHash), 12);
  assert.ok(await bcrypt.compare(password, user.passwordHash));
  const [profile] = await db.select().from(volunteerProfilesTable).where(eq(volunteerProfilesTable.userId, user.id));
  assert.equal(profile!.status, 'applicant');
  const [log] = await db.select().from(notificationLogTable).where(eq(notificationLogTable.recipientUserId, user.id));
  assert.equal(log!.status, 'logged');
  assert.equal(log!.type, 'verification');
  assert.equal((await client.request('/me')).body.code, 'EMAIL_UNVERIFIED');
  assert.equal((await client.request('/dashboard/private-data')).status, 403);
  assert.equal((await client.request('/anything/future-resource')).status, 403);
  assert.match(client.lastCookie, /HttpOnly/i);
  assert.match(client.lastCookie, /Secure/i);
  assert.match(client.lastCookie, /SameSite=Lax/i);
  const persisted = await pool.query('SELECT count(*)::int AS count FROM sessions WHERE sess::jsonb->>\'userId\' = $1', [user.id]);
  assert.ok(persisted.rows[0].count > 0);
});

test('CSRF rejects missing tokens and cross-origin requests before creating an account', async () => {
  const client = new Client();
  await client.bootstrap();
  const body = { email: `csrf-${namespace}@example.org`, firstName: 'Test', lastName: 'Volunteer',
    phone: '2125550123', password, confirmPassword: password };
  assert.equal((await client.request('/auth/signup', 'POST', body, { 'x-csrf-token': '' })).body.code, 'CSRF_INVALID');
  assert.equal((await client.request('/auth/signup', 'POST', body, { origin: 'https://example.org' })).body.code, 'CSRF_INVALID');
  assert.equal((await db.select().from(usersTable).where(eq(usersTable.email, body.email))).length, 0);
});

test('verification uses SHA-256/48h token, signs in once, and revokes older unverified sessions', async () => {
  const { client, user } = await fixture();
  const oldCookie = client.cookie;
  const token = await mintToken(user.id, 'email_verify');
  assert.equal(token.raw.length, 64);
  assert.equal(token.tokenHash, tokenHash(token.raw));
  assert.notEqual(token.tokenHash, token.raw);
  assert.ok(Math.abs(token.expiresAt.getTime() - Date.now() - 48 * 3600_000) < 5000);
  const verified = await client.post('/auth/verify', { token: token.raw });
  assert.equal(verified.status, 200);
  assert.equal(verified.body.nextPath, '/onboarding');
  await client.bootstrap();
  assert.equal((await client.request('/me')).status, 200);
  assert.equal((await client.post('/auth/verify', { token: token.raw })).body.code, 'TOKEN_INVALID');
  const oldClient = new Client();
  oldClient.cookie = oldCookie;
  assert.equal((await oldClient.request('/me')).status, 401);
});

test('expired verification token cannot verify or authenticate', async () => {
  const { client, user } = await fixture();
  const token = await mintToken(user.id, 'email_verify');
  await db.update(authTokensTable).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(authTokensTable.id, token.id));
  assert.equal((await client.post('/auth/verify', { token: token.raw })).body.code, 'TOKEN_INVALID');
  assert.equal((await client.request('/me')).status, 403);
});

test('unverified signin updates lastLoginAt and routes to verification; credential errors are generic', async () => {
  const { user, email } = await fixture();
  const client = new Client();
  const success = await client.post('/auth/signin', { email, password });
  assert.equal(success.body.nextPath, '/verify-email');
  await client.bootstrap();
  assert.equal((await client.request('/me')).status, 403);
  const [updated] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
  assert.ok(updated!.lastLoginAt);
  const wrong = await client.post('/auth/signin', { email, password: 'WrongPassword!' });
  const unknownEmail = `missing-${namespace}@example.org`; trackRate(unknownEmail);
  const unknown = await client.post('/auth/signin', { email: unknownEmail, password: 'WrongPassword!' });
  assert.equal(wrong.status, 401);
  assert.deepEqual(wrong.body, unknown.body);
  await db.update(usersTable).set({ isActive: false }).where(eq(usersTable.id, user.id));
  const inactive = await client.post('/auth/signin', { email, password });
  assert.equal(inactive.status, 403);
  assert.equal(inactive.body.error, "Your account isn't active. Please contact The Alliance.");
});

test('resends enforce one per minute and five per hour; old verification links are invalidated', async () => {
  const { client, user } = await fixture();
  assert.equal((await client.post('/auth/resend-verification')).status, 429);
  for (let index = 0; index < 5; index++) {
    await db.update(authRateLimitsTable).set({ windowStart: new Date(Date.now() - 120_000) })
      .where(eq(authRateLimitsTable.key, `resend-minute:${tokenHash(user.id)}`));
    assert.equal((await client.post('/auth/resend-verification')).status, 200);
  }
  await db.update(authRateLimitsTable).set({ windowStart: new Date(Date.now() - 120_000) })
    .where(eq(authRateLimitsTable.key, `resend-minute:${tokenHash(user.id)}`));
  assert.equal((await client.post('/auth/resend-verification')).status, 429);
  const tokens = await db.select().from(authTokensTable).where(and(
    eq(authTokensTable.userId, user.id), eq(authTokensTable.type, 'email_verify'),
  ));
  assert.equal(tokens.filter(token => token.usedAt === null).length, 1);
});

test('reset confirmation is generic; reset is 1h/single-use and revokes sessions without leaking admin notes', async () => {
  const { client, user, email } = await verifyFixture();
  await db.update(volunteerProfilesTable).set({ adminNotes: 'Private fixture note' }).where(eq(volunteerProfilesTable.userId, user.id));
  const me = await client.request('/me');
  assert.equal(me.status, 200);
  assert.ok(!('adminNotes' in me.body.profile));
  assert.ok(!('passwordHash' in me.body.user));
  assert.ok(!('googleSubject' in me.body.user));
  assert.ok(!('sessionVersion' in me.body.user));
  const resetClient = new Client();
  const known = await resetClient.post('/auth/forgot-password', { email });
  const unknownEmail = `reset-missing-${namespace}@example.org`; trackRate(unknownEmail);
  const unknown = await resetClient.post('/auth/forgot-password', { email: unknownEmail });
  assert.deepEqual(known.body, unknown.body);
  const token = await mintToken(user.id, 'password_reset');
  assert.ok(Math.abs(token.expiresAt.getTime() - Date.now() - 3600_000) < 5000);
  const mismatch = await resetClient.post('/auth/reset-password', {
    token: token.raw, password: 'NewPassword123!', confirmPassword: 'DifferentPassword!',
  });
  assert.equal(mismatch.status, 400);
  const success = await resetClient.post('/auth/reset-password', {
    token: token.raw, password: 'NewPassword123!', confirmPassword: 'NewPassword123!',
  });
  assert.equal(success.status, 200);
  assert.equal((await client.request('/me')).status, 401);
  await resetClient.bootstrap();
  assert.equal((await resetClient.post('/auth/reset-password', {
    token: token.raw, password: 'AnotherPassword123!', confirmPassword: 'AnotherPassword123!',
  })).body.code, 'TOKEN_INVALID');
  assert.equal((await resetClient.post('/auth/signin', { email, password })).status, 401);
  assert.equal((await resetClient.post('/auth/signin', { email, password: 'NewPassword123!' })).status, 200);
  await resetClient.bootstrap();
  assert.equal((await resetClient.request('/me')).status, 200);
});

test('signin is rate-limited independently by email and IP', async () => {
  const { email } = await fixture();
  for (let index = 0; index < 8; index++) {
    assert.equal((await new Client().post('/auth/signin', { email, password: 'WrongPassword!' })).status, 401);
  }
  assert.equal((await new Client().post('/auth/signin', { email, password: 'WrongPassword!' })).status, 429);
  const client = new Client();
  for (let index = 0; index < 10; index++) {
    const unknownEmail = `ip-limit-${namespace}-${index}@example.org`; trackRate(unknownEmail);
    assert.equal((await client.post('/auth/signin', { email: unknownEmail, password: 'WrongPassword!' })).status, 401);
  }
  assert.equal((await client.post('/auth/signin', { email: `ip-last-${namespace}@example.org`, password })).status, 429);
});

test('reset requests are rate-limited independently by email and IP', async () => {
  const email = `reset-limit-${namespace}@example.org`; trackRate(email);
  for (let index = 0; index < 5; index++) assert.equal((await new Client().post('/auth/forgot-password', { email })).status, 200);
  assert.equal((await new Client().post('/auth/forgot-password', { email })).status, 429);
  const client = new Client();
  for (let index = 0; index < 10; index++) {
    const unknownEmail = `reset-ip-${namespace}-${index}@example.org`; trackRate(unknownEmail);
    assert.equal((await client.post('/auth/forgot-password', { email: unknownEmail })).status, 200);
  }
  assert.equal((await client.post('/auth/forgot-password', { email })).status, 429);
});

test('Google cannot bypass authentication when unconfigured or callback state is invalid', async () => {
  const client = new Client();
  assert.equal((await client.bootstrap()).googleEnabled, false);
  const start = await client.request('/auth/google');
  assert.equal(start.headers.get('location'), '/signin?error=google_unavailable');
  const callback = await client.request('/auth/google/callback?code=fake&state=fake');
  assert.equal(callback.headers.get('location'), '/signin?error=google_failed');
  assert.equal((await client.request('/me')).status, 401);
});

test('signout destroys the stored session; replaying its cookie cannot access protected resources', async () => {
  const { client } = await verifyFixture();
  const cookie = client.cookie;
  assert.equal((await client.post('/auth/signout')).status, 200);
  const replay = new Client(); replay.cookie = cookie;
  assert.equal((await replay.request('/me')).status, 401);
});

test('signup rejects mismatched, short, over-72-byte passwords and invalid mobile numbers', async () => {
  const client = new Client();
  const email = `invalid-fields-${namespace}@example.org`; trackRate(email);
  const input = { email, firstName: 'Test', lastName: 'Volunteer', phone: '2125550123', password, confirmPassword: password };
  for (const overrides of [
    { confirmPassword: 'DoesNotMatch123!' },
    { password: 'short', confirmPassword: 'short' },
    { password: 'é'.repeat(37), confirmPassword: 'é'.repeat(37) },
    { phone: 'abcdefghij' },
  ]) assert.equal((await client.post('/auth/signup', { ...input, ...overrides })).status, 400);
  assert.equal((await db.select().from(usersTable).where(eq(usersTable.email, email))).length, 0);
});

test('expired password reset leaves the old password and sessions unchanged', async () => {
  const { client, user } = await verifyFixture();
  const token = await mintToken(user.id, 'password_reset');
  await db.update(authTokensTable).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(authTokensTable.id, token.id));
  assert.equal((await client.post('/auth/reset-password', {
    token: token.raw, password: 'NewPassword123!', confirmPassword: 'NewPassword123!',
  })).body.code, 'TOKEN_INVALID');
  assert.equal((await client.request('/me')).status, 200);
  const [unchanged] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
  assert.ok(await bcrypt.compare(password, unchanged!.passwordHash));
});

test('concurrent verification and reset attempts can each consume a token only once', async () => {
  const { client, user } = await fixture();
  const verification = await mintToken(user.id, 'email_verify');
  const otherVerifier = new Client();
  await otherVerifier.bootstrap();
  const verified = await Promise.all([
    client.post('/auth/verify', { token: verification.raw }),
    otherVerifier.post('/auth/verify', { token: verification.raw }),
  ]);
  assert.deepEqual(verified.map(result => result.status).sort(), [200, 400]);
  const reset = await mintToken(user.id, 'password_reset');
  const first = new Client(); const second = new Client();
  await Promise.all([first.bootstrap(), second.bootstrap()]);
  const input = { token: reset.raw, password: 'RaceReset123!', confirmPassword: 'RaceReset123!' };
  const resetResults = await Promise.all([
    first.post('/auth/reset-password', input),
    second.post('/auth/reset-password', input),
  ]);
  assert.deepEqual(resetResults.map(result => result.status).sort(), [200, 400]);
});
