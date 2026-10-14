import assert from 'node:assert/strict';
import { testProfileFields } from '@workspace/shared/testAccounts';
import { before, after, test } from 'node:test';
import { randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { eq, inArray } from 'drizzle-orm';
import { db, pool, usersTable, volunteerProfilesTable, resourcesTable, notificationLogTable, activityLogTable, sessionsTable } from '@workspace/db';
import { onboardingQuestions, buildOnboardingAnswersSchema } from '@workspace/shared/onboardingQuestions';
import { appConfig } from '@workspace/shared/appConfig';
if (process.env.NODE_ENV && process.env.NODE_ENV !== 'development') throw new Error('Onboarding checks require the development database.');
process.env.NODE_ENV = 'development';
process.env.POSTMARK_SERVER_TOKEN = '';
process.env.EMAIL_FROM = '';
const { default: app } = await import('./app');
const { appOrigin } = await import('./auth/session');
const { csvCell } = await import('./onboarding');
const namespace = randomBytes(6).toString('hex');
const users: string[] = [];
const resources: string[] = [];
const sessions: string[] = [];
let server: Server;
let base: string;
let volunteer: string;
let other: string;
let admin: string;
const contact = { firstName: 'Onboarding', lastName: `Check-${namespace}`, phone: '916-555-0101' };
const answers = {};
async function fixture(role: 'admin' | 'volunteer', verified = true) {
  const [user] = await db.insert(usersTable).values({ ...contact, email: `onboarding-${namespace}-${users.length}@example.org`, passwordHash: 'unused-placeholder-for-isolated-session-tests', role,
    emailVerifiedAt: verified ? new Date() : null }).returning();
  users.push(user!.id);
  if (role === 'volunteer') await db.insert(volunteerProfilesTable).values({ userId: user!.id, adminNotes: 'PRIVATE ADMIN NOTE' });
  return user!.id;
}
async function client(userId?: string) {
  // The app normally signs these session IDs. Use its middleware bootstrap instead,
  // then update only the owned database session to establish the fixture actor.
  const bootstrap = await fetch(`${base}/api/auth/session`, { headers: { 'x-forwarded-proto': 'https' } });
  const cookie = bootstrap.headers.get('set-cookie')!.split(';')[0]!;
  const payload = await bootstrap.json() as { csrfToken: string };
  const sid = decodeURIComponent(cookie.split('=').slice(1).join('=')).slice(2).split('.')[0]!;
  sessions.push(sid);
  if (userId) {
    const { rows } = await pool.query<{ sess: Record<string, unknown> }>('SELECT sess FROM sessions WHERE sid=$1', [sid]);
    await pool.query('UPDATE sessions SET sess=$1 WHERE sid=$2', [JSON.stringify({ ...rows[0]!.sess, userId, authVersion: 0 }), sid]);
  }
  return async (path: string, method = 'GET', body?: unknown) => {
    const response = await fetch(`${base}/api${path}`, {
      method, headers: { cookie, 'x-forwarded-proto': 'https', origin: appOrigin, 'x-csrf-token': payload.csrfToken, 'content-type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const text = await response.text();
    let data: any; try { data = JSON.parse(text); } catch { data = text; }
    return { status: response.status, data };
  };
}
before(async () => {
  server = createServer(app); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  volunteer = await fixture('volunteer'); other = await fixture('volunteer'); admin = await fixture('admin');
});
after(async () => {
  if (sessions.length) await db.delete(sessionsTable).where(inArray(sessionsTable.sid, sessions));
  if (resources.length) await db.delete(resourcesTable).where(inArray(resourcesTable.id, resources));
  if (users.length) {
    await db.delete(notificationLogTable).where(inArray(notificationLogTable.recipientUserId, users));
    await db.delete(activityLogTable).where(inArray(activityLogTable.actorUserId, users));
    await db.delete(volunteerProfilesTable).where(inArray(volunteerProfilesTable.userId, users));
    await db.delete(usersTable).where(inArray(usersTable.id, users));
  }
  await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
  await pool.end();
});
test('empty question config preserves legacy answers; configured dates still validate', () => {
  assert.equal(buildOnboardingAnswersSchema().safeParse(answers).success, true);
  assert.equal(buildOnboardingAnswersSchema().safeParse({ ...answers, languages: [] }).success, true);
  assert.equal(buildOnboardingAnswersSchema().safeParse({ ...answers, county: 'Unknown' }).success, true);
  assert.equal(onboardingQuestions.length, 0);
  assert.equal(buildOnboardingAnswersSchema({ draft: true }).safeParse({}).success, true);
  const dynamic = { id: 'testDate', label: 'Test', type: 'date', step: 2, required: true } as const;
  const list = onboardingQuestions as typeof dynamic[]; list.push(dynamic);
  try {
    assert.equal(buildOnboardingAnswersSchema().safeParse({ ...answers, testDate: '2026-02-30' }).success, false);
    assert.equal(buildOnboardingAnswersSchema().safeParse({ ...answers, testDate: '2026-02-28' }).success, true);
  } finally { list.pop(); }
});
test('anonymous, unverified, wrong-role and other-volunteer admin access are denied', async () => {
  const anonymous = await client();
  const pending = await client(await fixture('volunteer', false));
  const administrator = await client(admin);
  const owned = await client(volunteer);
  assert.equal((await anonymous('/onboarding', 'PATCH', { ...contact, answers, complete: false })).status, 401);
  assert.equal((await pending('/onboarding', 'PATCH', { ...contact, answers, complete: false })).status, 403);
  assert.equal((await administrator('/onboarding', 'PATCH', { ...contact, answers, complete: false })).status, 403);
  assert.equal((await owned(`/admin/volunteers/${other}/onboarding`)).status, 403);
  assert.equal((await owned('/admin/volunteers/onboarding.csv')).status, 403);
});
test('draft saves own profile, strips staff notes and rejects supplied ownership', async () => {
  const owned = await client(volunteer);
  assert.equal((await owned('/onboarding','PATCH',{...contact,complete:false,userId:other})).status,400);
  const response = await owned('/onboarding', 'PATCH', { ...contact, firstName: 'Updated', answers, complete: false });
  assert.equal(response.status, 200);
  assert.equal(response.data.profile.userId, volunteer);
  assert.equal(response.data.user.firstName, 'Updated');
  assert.equal(response.data.profile.county, appConfig.defaultCounty);
  assert.deepEqual(response.data.profile.onboardingAnswers, {});
  assert.equal(response.data.profile.onboardingCompletedAt, null);
  assert.equal(response.data.profile.agreementAcknowledgedAt, null);
  assert.equal('adminNotes' in response.data.profile, false);
  const fresh = await client(volunteer);
  assert.deepEqual((await fresh('/me')).data.profile.onboardingAnswers, answers);
  assert.deepEqual((await db.select().from(volunteerProfilesTable).where(eq(volunteerProfilesTable.userId, other)))[0]!.onboardingAnswers, {});
});
test('published Agreements only; completion validates agreement version and acknowledgment, logs welcome once', async () => {
  for (const title of ['User Agreement', 'Safety Guidelines']) {
    const [row] = await db.insert(resourcesTable).values({ type: 'article', title, category: 'Agreements', body: `Clearly marked development test fixture ${namespace}; not actual Alliance policy.`, createdByUserId: admin, isPublished: true }).returning();
    resources.push(row!.id);
  }
  const owned = await client(volunteer);
  const agreement = await owned('/onboarding/agreements');
  assert.equal(agreement.data.ready, true);
  assert.equal((await owned(`/onboarding/agreements/${resources[0]}`)).status, 200);
  const body = { ...contact, ...testProfileFields, answers, complete: true };
  assert.equal((await owned('/onboarding', 'PATCH', { ...body, addressLine1: '' })).status, 400);
  assert.equal((await owned('/onboarding', 'PATCH', { ...body, dateOfBirth: '2026-02-30' })).status, 400);
  assert.equal((await owned('/onboarding', 'PATCH', { ...body, phone: '' })).status, 400);
  const response = await owned('/onboarding', 'PATCH', body);
  assert.equal(response.status, 200);
  assert.ok(response.data.profile.onboardingCompletedAt);
  assert.equal(response.data.profile.agreementAcknowledgedAt, null);
  assert.equal(response.data.profile.agreementVersion, null);
  assert.equal((await owned('/onboarding', 'PATCH', body)).status, 200);
  assert.equal((await owned('/onboarding', 'PATCH', { ...body, complete: false })).status, 409);
  const logs = await db.select().from(notificationLogTable).where(eq(notificationLogTable.recipientUserId, volunteer));
  assert.equal(logs.length, 1); assert.equal(logs[0]!.status, 'logged'); assert.equal(logs[0]!.type, 'welcome');
  // Removing either selected fixture tests publication readiness without modifying preexisting resources.
  await db.update(resourcesTable).set({ isPublished: false }).where(inArray(resourcesTable.id, resources));
});
test('admin review and CSV use configured questions and spreadsheet-safe cells', async () => {
  const administrator = await client(admin);
  const review = await administrator(`/admin/volunteers/${volunteer}/onboarding`);
  assert.equal(review.status, 200);
  assert.equal('adminNotes' in review.data.profile, false);
  const csv = await administrator('/admin/volunteers/onboarding.csv');
  assert.equal(csv.status, 200);
  for (const question of onboardingQuestions) assert.ok(csv.data.includes(csvCell(question.label)));
  assert.ok(csv.data.includes(contact.firstName));
  assert.equal(csvCell('=SUM(A1)'), '"\'=SUM(A1)"');
  assert.equal(csvCell('\t@formula'), '"\'\t@formula"');
  assert.equal(csv.data.includes('PRIVATE ADMIN NOTE'), false);
});
