import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import { randomUUID, randomBytes } from 'node:crypto';
import type { Server } from 'node:http';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db, pool, usersTable, volunteerProfilesTable, activityLogTable, notificationLogTable, authTokensTable } from '@workspace/db';
import sharp from 'sharp';
import { preparePhoto, MAX_PROFILE_PHOTO } from './profile-photos';
import { testProfileFields } from '@workspace/shared/testAccounts';

process.env.NODE_ENV = 'development';
process.env.SESSION_SECRET ||= randomBytes(32).toString('hex');
vi.mock('../email', async original => ({
  ...await original<typeof import('../email')>(),
  sendEmail: vi.fn(async () => ({ ok: true, status: 'suppressed' as const })),
}));
const { default: app } = await import('../app');
const { hashPassword, checkPassword } = await import('../auth/security');
const { appOrigin } = await import('../auth/session');
const { sendEmail } = await import('../email');
const { requestEmailChange } = await import('./account-profile');
let server: Server, base: string;
const ids: string[] = [], tag = randomUUID(), password = 'synthetic-account-password';
const octets = randomBytes(2), ip = `198.18.${octets[0]}.${octets[1]}`;
type Client = { request: (path: string, method?: string, body?: unknown) => Promise<{ status: number; data: any }> };
async function client(email?: string): Promise<Client> {
  let cookie = '', csrf = '';
  const request: Client['request'] = async (path, method = 'GET', body) => {
    const response = await fetch(`${base}/api${path}`, { method, headers: {
      cookie, origin: appOrigin, 'x-csrf-token': csrf, 'content-type': 'application/json',
      'x-forwarded-for': ip, 'x-forwarded-proto': 'https',
    }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const update = response.headers.getSetCookie().find(c => c.startsWith('alliance.sid='));
    if (update) cookie = update.split(';')[0]!;
    const data: any = await response.json();
    if (data.csrfToken) csrf = data.csrfToken;
    return { status: response.status, data };
  };
  await request('/auth/session');
  if (email) {
    expect((await request('/auth/signin', 'POST', { email, password })).status).toBe(200);
    await request('/auth/session');
  }
  return { request };
}
let own: Client, admin: Client, other: Client;
const email = (kind: string) => `${kind}-${tag}@example.invalid`;
it('NEW-07 rejects invalid onboarding, volunteer profile and admin card saves with field errors', async () => {
  const [fixture] = await db.insert(usersTable).values({ email: email('validation'), firstName: 'Validation', lastName: 'QA',
    phone: '9165550100', passwordHash: await hashPassword(password), role: 'volunteer', emailVerifiedAt: new Date() }).returning();
  ids.push(fixture!.id);
  await db.insert(volunteerProfilesTable).values({ userId: fixture!.id, status: 'onboarding' });
  const volunteer = await client(email('validation'));
  for (const [field, value] of [['zip','1234'], ['phone','12345'], ['phone','abc5555550100'],
    ['dateOfBirth','2999-01-01'], ['emergencyContactPhone','abc']] as const) {
    const result = await volunteer.request('/onboarding', 'PATCH', { [field]: value });
    expect(result.status).toBe(400);
    expect(result.data.fieldErrors).toHaveProperty(field);
  }
  const saved = await volunteer.request('/onboarding', 'PATCH', { zip: '95603-1234', phone: '(916) 555-0100', city: null });
  expect(saved.status).toBe(200);
  expect((await db.select().from(usersTable).where(eq(usersTable.id, fixture!.id)))[0]!.phone).toBe('9165550100');
  await db.update(volunteerProfilesTable).set({ ...testProfileFields, onboardingCompletedAt: new Date() }).where(eq(volunteerProfilesTable.userId, fixture!.id));
  const expectedUpdatedAt = (await db.select().from(volunteerProfilesTable).where(eq(volunteerProfilesTable.userId, fixture!.id)))[0]!.updatedAt.toISOString();
  for (const [field, value] of [['zip','1234'], ['emergencyContactPhone','12345']] as const) {
    const ownResult = await volunteer.request('/volunteer/profile','PATCH',{[field]:value});
    expect(ownResult.status).toBe(400); expect(ownResult.data.fieldErrors).toHaveProperty(field);
    const staffResult = await admin.request(`/admin/volunteers/${fixture!.id}/tracking`,'PATCH',{[field]:value, expectedUpdatedAt});
    expect(staffResult.status).toBe(400); expect(staffResult.data.fieldErrors).toHaveProperty(field);
  }
  expect((await admin.request(`/admin/volunteers/${fixture!.id}/tracking`,'PATCH',{zip:'95603-1234',emergencyContactPhone:'(916) 555-0101',expectedUpdatedAt})).status).toBe(200);
});
beforeAll(async () => {
  server = app.listen(0);
  await new Promise<void>(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const hash = await hashPassword(password);
  for (const kind of ['own', 'admin', 'other']) {
    const [user] = await db.insert(usersTable).values({ email: email(kind), firstName: kind, lastName: 'Synthetic QA',
      phone: '9165550100', passwordHash: hash, role: kind === 'admin' ? 'admin' : 'volunteer', emailVerifiedAt: new Date() }).returning();
    ids.push(user!.id);
    if (kind !== 'admin') await db.insert(volunteerProfilesTable).values({
      userId: user!.id, status: 'onboarding', adminNotes: 'PRIVATE-STAFF-NOTES',
    });
  }
  own = await client(email('own')); admin = await client(email('admin')); other = await client(email('other'));
}, 30000);
afterAll(async () => {
  if (ids.length) {
    await db.delete(notificationLogTable).where(inArray(notificationLogTable.recipientUserId, ids));
    await db.delete(activityLogTable).where(inArray(activityLogTable.actorUserId, ids));
    await db.delete(volunteerProfilesTable).where(inArray(volunteerProfilesTable.userId, ids));
    await pool.query("DELETE FROM sessions WHERE sess->>'userId'=ANY($1::text[])", [ids]);
    await db.delete(usersTable).where(inArray(usersTable.id, ids));
  }
  await new Promise<void>(resolve => server.close(() => resolve()));
});
function lastVerificationToken() {
  const call = vi.mocked(sendEmail).mock.calls.filter(([input]) => input.subject === 'Confirm your new CCT Portal email').at(-1)![0];
  const match = /\/verify\?token=([A-Za-z0-9_-]+)/.exec(call.text)!;
  return match[1]!;
}
describe('all-role account management', () => {
  it('allows an onboarding volunteer and an admin to load their own settings without private fields', async () => {
    for (const actor of [own, admin]) {
      const result = await actor.request('/account/profile');
      expect(result.status).toBe(200);
      expect(result.data.pendingEmail).toBeNull();
      expect(JSON.stringify(result.data)).not.toMatch(/passwordHash|profilePhotoKey|adminNotes|PRIVATE-STAFF/);
    }
  });
  it('saves own contact details, normalizes phone and rejects privilege injection', async () => {
    const result = await own.request('/account/profile', 'PATCH', { firstName: ' New name ', lastName: 'QA', phone: '(916) 555-0100' });
    expect(result.status).toBe(200); expect(result.data.user.firstName).toBe('New name'); expect(result.data.user.phone).toBe('9165550100');
    expect((await own.request('/account/profile', 'PATCH', { firstName: 'QA', lastName: 'QA', phone: null, role: 'admin' })).status).toBe(400);
  });
  it('blocks volunteer access to other accounts, photos and staff controls', async () => {
    expect((await own.request(`/admin/users/${ids[2]}/profile`)).status).toBe(403);
    expect((await own.request(`/account/users/${ids[2]}/photo`)).status).toBe(404);
    expect((await own.request(`/admin/users/${ids[1]}/password-reset`, 'POST', {})).status).toBe(403);
  });
  it('lets staff edit contact details and records field names, never values', async () => {
    const result = await admin.request(`/admin/users/${ids[2]}/profile`, 'PATCH', { firstName: 'Edited member', lastName: 'QA', phone: '9165550101' });
    expect(result.status).toBe(200); expect(result.data.user.firstName).toBe('Edited member');
    const events = await db.select().from(activityLogTable).where(and(eq(activityLogTable.actorUserId, ids[1]!),
      eq(activityLogTable.action, 'account_updated')));
    expect(events.some(e => JSON.stringify(e.details).includes('firstName'))).toBe(true);
    expect(JSON.stringify(events.map(e => e.details))).not.toContain('Edited member');
  });
  it('sends reset links without changing the target password', async () => {
    const [before] = await db.select().from(usersTable).where(eq(usersTable.id, ids[2]!));
    const result = await admin.request(`/admin/users/${ids[2]}/password-reset`, 'POST', {});
    expect(result.status).toBe(200); expect(result.data.ok).toBe(true);
    const [after] = await db.select().from(usersTable).where(eq(usersTable.id, ids[2]!));
    expect(after!.passwordHash).toBe(before!.passwordHash);
    expect(vi.mocked(sendEmail).mock.calls.some(([mail]) => mail.type === 'password_reset' && mail.toUserId === ids[2])).toBe(true);
  });
  it('does not let a public test administrator change a real account identity', async () => {
    await db.update(usersTable).set({ isTestAccount: true }).where(eq(usersTable.id, ids[1]!));
    try {
      const blocked = await admin.request(`/admin/users/${ids[2]}/profile`, 'PATCH', { firstName: 'Not allowed', lastName: 'QA', phone: null });
      expect(blocked.status).toBe(403);
      expect((await admin.request(`/admin/users/${ids[2]}/password-reset`, 'POST', {})).status).toBe(403);
    } finally {
      await db.update(usersTable).set({ isTestAccount: false }).where(eq(usersTable.id, ids[1]!));
    }
  });
  it('requires current-password proof for own email changes and rejects duplicate addresses', async () => {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, ids[0]!));
    await expect(requestEmailChange(user!, user!.id, { email: email('new-own') })).rejects.toThrow('current password');
    await expect(requestEmailChange(user!, user!.id, { email: email('new-own'), currentPassword: 'wrong' })).rejects.toThrow('current password');
    await expect(requestEmailChange(user!, user!.id, { email: email('other'), currentPassword: password })).rejects.toThrow('already used');
  });
  it('keeps the old email until verification; confirmation revokes old sessions and is single-use', async () => {
    const result = await admin.request(`/admin/users/${ids[2]}/email`, 'POST', { email: email('new-other') });
    expect(result.status).toBe(200); expect(result.data.user.email).toBe(email('other'));
    expect(result.data.pendingEmail).toBe(email('new-other'));
    const token = lastVerificationToken(), anonymous = await client();
    expect((await anonymous.request('/auth/verify', 'POST', { token })).status).toBe(200);
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, ids[2]!));
    expect(user!.email).toBe(email('new-other'));
    expect((await other.request('/account/profile')).status).toBe(401);
    await anonymous.request('/auth/session');
    expect((await anonymous.request('/auth/verify', 'POST', { token })).status).toBe(400);
  });
  it('cancels a pending email change and makes its link unusable', async () => {
    expect((await own.request('/account/email', 'POST', { email: email('cancelled'), currentPassword: password })).status).toBe(200);
    const token = lastVerificationToken();
    const cancelled = await own.request('/account/email', 'DELETE');
    expect(cancelled.status).toBe(200); expect(cancelled.data.pendingEmail).toBeNull();
    expect((await (await client()).request('/auth/verify', 'POST', { token })).status).toBe(400);
  });
  it('verifies an admin’s new email without the volunteer-only gate', async () => {
    expect((await admin.request('/account/email', 'POST', { email: email('new-admin'), currentPassword: password })).status).toBe(200);
    const confirmed = await client();
    const result = await confirmed.request('/auth/verify', 'POST', { token: lastVerificationToken() });
    expect(result.status).toBe(200); expect(result.data.nextPath).toBe('/admin');
    await confirmed.request('/auth/session');
    admin = confirmed;
  });
  it('regenerates a failed new-address verification without reverting to the old address', async () => {
    const { mintToken } = await import('../auth/accounts');
    const { retryNotification } = await import('./notification-log');
    const token = await mintToken(ids[0]!, 'email_verify', { pendingEmail: email('retry-address') });
    const [log] = await db.insert(notificationLogTable).values({
      type: 'verification', recipientUserId: ids[0]!, recipientEmail: email('retry-address'),
      subject: 'Confirm your new CCT Portal email', status: 'failed', error: 'Synthetic provider rejection',
      relatedId: token.id,
    }).returning();
    expect((await retryNotification(log!.id)).ok).toBe(true);
    const call = vi.mocked(sendEmail).mock.calls.at(-1)![0];
    expect(call.to).toBe(email('retry-address')); expect(call.relatedId).not.toBe(token.id);
    const [old] = await db.select().from(authTokensTable).where(eq(authTokensTable.id, token.id));
    expect(old!.usedAt).not.toBeNull();
    // A cancelled/superseded request must never be restored by retrying its historical log.
    await expect(retryNotification(log!.id)).rejects.toThrow('cancelled or replaced');
  });
  it('rejects an expired new-address token and preserves the original email', async () => {
    const { mintToken } = await import('../auth/accounts');
    const token = await mintToken(ids[0]!, 'email_verify', { pendingEmail: email('expired-address') });
    await db.update(authTokensTable).set({ expiresAt: new Date(0) }).where(eq(authTokensTable.id, token.id));
    expect((await (await client()).request('/auth/verify', 'POST', { token: token.raw })).status).toBe(400);
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, ids[0]!));
    expect(user!.email).toBe(email('own'));
  });
  it('changes an admin password, checks bcrypt and signs out all sessions', async () => {
    const newPassword = 'synthetic-replacement-password';
    const changed = await admin.request('/account/password', 'POST', { currentPassword: password, password: newPassword, confirmPassword: newPassword });
    expect(changed.status).toBe(200);
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, ids[1]!));
    expect(await checkPassword(newPassword, user!.passwordHash)).toBe(true);
    expect((await admin.request('/account/profile')).status).toBe(401);
  });
});
describe('private profile image normalization', () => {
  it('resizes a real image and removes metadata', async () => {
    const input = await sharp({ create: { width: 1024, height: 1024, channels: 3, background: '#024b6f' } }).withMetadata().jpeg().toBuffer();
    const output = await preparePhoto(input), meta = await sharp(output).metadata();
    expect(meta.format).toBe('png'); expect(meta.width).toBe(512); expect(meta.height).toBe(512);
    expect(meta.exif).toBeUndefined(); expect(meta.icc).toBeUndefined();
  });
  it('rejects SVG, disguised content and oversized files', async () => {
    await expect(preparePhoto(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).rejects.toThrow();
    await expect(preparePhoto(Buffer.from('not a photo'))).rejects.toThrow();
    await expect(preparePhoto(Buffer.alloc(MAX_PROFILE_PHOTO + 1))).rejects.toThrow('3 MB');
  });
});
