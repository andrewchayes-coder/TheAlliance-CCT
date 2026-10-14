import assert from 'node:assert/strict';
import { testProfileFields } from '@workspace/shared/testAccounts';
import { before, after, test } from 'node:test';
import { randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { eq, inArray } from 'drizzle-orm';
import { db, pool, usersTable, volunteerProfilesTable, shiftSlotsTable, shiftAssignmentsTable, shiftSkipsTable, sessionsTable, activityLogTable, notificationLogTable } from '@workspace/db';
import { onboardingQuestions } from '@workspace/shared/onboardingQuestions';
import { pacificDay, addCalendarDays } from './volunteer-shifts';
if (process.env.NODE_ENV && process.env.NODE_ENV !== 'development') throw new Error('Roster tests require development.');
process.env.NODE_ENV = 'development'; process.env.POSTMARK_SERVER_TOKEN = ''; process.env.EMAIL_FROM = '';
const { attentionReasons } = await import('./admin-roster');
const { default: app } = await import('./app');
const { appOrigin } = await import('./auth/session');
const namespace = randomBytes(5).toString('hex');
const users: string[] = [], slots: string[] = [], assignmentIds: string[] = [], sessionIds: string[] = [];
const volunteers: string[] = [];
const today = pacificDay(new Date());
let server: Server, base: string, admin: string, unverified: string, deactivated: string;
async function fixture(role: 'admin' | 'volunteer', index: number, verified = true, active = true) {
  const [user] = await db.insert(usersTable).values({ firstName: index === 0 ? '=2+2' : 'RosterQA', lastName: `${namespace}, "Quoted"\nName`,
    email: `roster-${namespace}-${index}@example.org`, phone: `+1916555010${index}`, role, passwordHash: 'unusable-owned-fixture',
    emailVerifiedAt: verified ? new Date() : null, isActive: active }).returning();
  users.push(user!.id); return user!.id;
}
async function client(userId?: string) {
  const bootstrap = await fetch(`${base}/api/auth/session`, { headers: { 'x-forwarded-proto': 'https' } });
  const cookie = bootstrap.headers.get('set-cookie')!.split(';')[0]!;
  const bootstrapData = await bootstrap.json() as { csrfToken: string };
  const sid = decodeURIComponent(cookie.split('=').slice(1).join('=')).slice(2).split('.')[0]!;
  sessionIds.push(sid);
  if (userId) {
    const { rows } = await pool.query<{ sess: Record<string, unknown> }>('SELECT sess FROM sessions WHERE sid=$1', [sid]);
    await pool.query('UPDATE sessions SET sess=$1 WHERE sid=$2', [JSON.stringify({ ...rows[0]!.sess, userId, authVersion: 0 }), sid]);
  }
  return async (path: string, method = 'GET', body?: unknown) => {
    const response = await fetch(`${base}/api${path}`, { method, headers: { cookie, 'x-forwarded-proto': 'https',
      Origin: appOrigin, 'X-CSRF-Token': bootstrapData.csrfToken, 'Content-Type': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    const text = await response.text();
    let data: any; try { data = JSON.parse(text); } catch { data = text; }
    return { status: response.status, data, headers: response.headers };
  };
}
before(async () => {
  server = createServer(app); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  admin = await fixture('admin', 5); unverified = await fixture('admin', 6, false); deactivated = await fixture('admin', 7, true, false);
  const statuses = ['active', 'active', 'onboarding', 'onboarding', 'inactive'] as const;
  for (let i = 0; i < statuses.length; i++) {
    const id = await fixture('volunteer', i, i !== 3); volunteers.push(id);
    const [profile] = await db.insert(volunteerProfilesTable).values({
      userId: id, status: statuses[i], county: i === 2 ? 'Sacramento' : 'Placer', adminNotes: `ADMIN PRIVATE ${namespace}`,
      ...(i === 3 ? {} : testProfileFields),
      createdAt: new Date(Date.now() - (i === 2 ? 32 : i === 3 ? 9 : 0) * 86400000),
      onboardingCompletedAt: i === 3 ? null : new Date(), agreementAcknowledgedAt: new Date(), agreementVersion: 'v1',
      certificationStatus: i < 2 ? 'complete' : 'not_started',
      certificationExpiresAt: i === 0 ? addCalendarDays(today, 30) : i === 1 ? addCalendarDays(today, 31) : null,
      backgroundCheckStatus: i === 1 || i === 2 ? 'pending' : 'not_started',
      backgroundCheckSubmittedAt: i === 1 ? addCalendarDays(today, -14) : i === 2 ? addCalendarDays(today, -15) : null,
      onboardingAnswers: { county: 'Placer', languages: ['English', 'Spanish'], previousExperience: false, availability: '=HYPERLINK("bad")', anythingElse: 'line one\nline two' },
    }).returning();
    if (i === 1) {
      for (const [dayOfWeek, startTime, endTime] of [[1, '09:00', '11:00'], [3, '13:00', '15:00']] as const) {
        const [slot] = await db.insert(shiftSlotsTable).values({ dayOfWeek, startTime, endTime }).returning(); slots.push(slot!.id);
        const [assignment] = await db.insert(shiftAssignmentsTable).values({ volunteerProfileId: profile!.id, shiftSlotId: slot!.id,
          startDate: today, createdByUserId: admin }).returning(); assignmentIds.push(assignment!.id);
        await db.insert(shiftSkipsTable).values({ shiftAssignmentId: assignment!.id, skipDate: addCalendarDays(today, 7) });
        await db.insert(shiftSkipsTable).values({ shiftAssignmentId: assignment!.id, skipDate: addCalendarDays(today, -7) });
      }
      const [ended] = await db.insert(shiftAssignmentsTable).values({ volunteerProfileId: profile!.id, shiftSlotId: slots[0]!,
        startDate: addCalendarDays(today, -60), endDate: addCalendarDays(today, -1), createdByUserId: admin, endedReason: 'dropped' }).returning();
      assignmentIds.push(ended!.id);
    }
  }
});
after(async () => {
  if (assignmentIds.length) {
    await db.delete(shiftSkipsTable).where(inArray(shiftSkipsTable.shiftAssignmentId, assignmentIds));
    await db.delete(shiftAssignmentsTable).where(inArray(shiftAssignmentsTable.id, assignmentIds));
  }
  if (slots.length) await db.delete(shiftSlotsTable).where(inArray(shiftSlotsTable.id, slots));
  if (sessionIds.length) await db.delete(sessionsTable).where(inArray(sessionsTable.sid, sessionIds));
  if (users.length) {
    const profiles = await db.select({ id: volunteerProfilesTable.id }).from(volunteerProfilesTable).where(inArray(volunteerProfilesTable.userId, users));
    if (profiles.length) {
      const events = await db.select({ id: activityLogTable.id }).from(activityLogTable).where(inArray(activityLogTable.volunteerProfileId, profiles.map(row => row.id)));
      if (events.length) await db.delete(notificationLogTable).where(inArray(notificationLogTable.relatedId, events.map(e => e.id)));
      await db.delete(activityLogTable).where(inArray(activityLogTable.volunteerProfileId, profiles.map(row => row.id)));
    }
    await db.delete(notificationLogTable).where(inArray(notificationLogTable.recipientUserId, users));
    await db.delete(volunteerProfilesTable).where(inArray(volunteerProfilesTable.userId, users));
    await db.delete(usersTable).where(inArray(usersTable.id, users));
  }
  await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
  await pool.end();
});
test('attention uses inclusive future 30-day expiry, strict >14 pending days and unique volunteer counts', () => {
  const profile = { status: 'active' as const, certificationExpiresAt: addCalendarDays(today, 30), backgroundCheckStatus: 'pending' as const,
    backgroundCheckSubmittedAt: addCalendarDays(today, -15), onboardingCompletedAt: null };
  assert.deepEqual(attentionReasons(profile, 0, today), ['no_shift']);
  assert.deepEqual(attentionReasons({ ...profile, status: 'inactive', certificationExpiresAt: addCalendarDays(today, 31),
    backgroundCheckSubmittedAt: addCalendarDays(today, -14), onboardingCompletedAt: new Date() }, 0, today), []);
  assert.ok(!attentionReasons({ ...profile, certificationExpiresAt: addCalendarDays(today, -1) }, 1, today).includes('certification_expiring'));
});
test('list, detail and CSV endpoints deny anonymous, volunteer, unverified and deactivated actors', async () => {
  for (const actor of [undefined, volunteers[0], unverified, deactivated]) {
    const request = await client(actor);
    for (const path of ['/admin/volunteers', `/admin/volunteers/${volunteers[1]}`, '/admin/volunteers/roster.csv', '/admin/volunteers/schedule.csv']) {
      const response = await request(path);
      assert.equal(response.status, actor ? 403 : 401); assert.ok(!JSON.stringify(response.data).includes(namespace));
      assert.equal(response.headers.get('content-disposition'), null);
    }
  }
});
test('roster combines filters/search, pages matching profiles and keeps global summaries independent', async () => {
  const request = await client(admin);
  const all = await request(`/admin/volunteers?search=${namespace}&limit=1`);
  assert.equal(all.status, 200); assert.equal(all.data.total, 5); assert.equal(all.data.volunteers.length, 1);
  assert.equal(all.data.volunteers[0].profile.adminNotes, undefined);
  assert.equal(all.data.volunteers[0].user.passwordHash, undefined);
  const active = await request(`/admin/volunteers?search=${namespace}&status=active&county=Placer&shiftPresence=has_shift`);
  assert.equal(active.data.total, 1); assert.equal(active.data.volunteers[0].user.id, volunteers[1]);
  assert.equal(active.data.volunteers[0].shiftCount, 2); assert.deepEqual(active.data.summary, all.data.summary);
  const page2 = await request(`/admin/volunteers?search=${namespace}&limit=1&offset=1`);
  assert.notEqual(page2.data.volunteers[0].user.id, all.data.volunteers[0].user.id);
  const phone = await request(`/admin/volunteers?search=${encodeURIComponent('(916) 555-0101')}`);
  assert.equal(phone.data.total, 1); assert.equal(phone.data.volunteers[0].user.id, volunteers[1]);
  const wildcard = await request('/admin/volunteers?search=%25%5F');
  assert.equal(wildcard.data.total, 0);
  for (const [reason, index] of [['no_shift', 0], ['onboarding_overdue', 2], ['onboarding_incomplete', 3]] as const) {
    const filtered = await request(`/admin/volunteers?search=${namespace}&needsAttention=${reason}`);
    assert.equal(filtered.data.total, 1); assert.equal(filtered.data.volunteers[0].user.id, volunteers[index]);
  }
  assert.equal((await request(`/admin/volunteers?search=${namespace}&needsAttention=any`)).data.total, 3);
  const review=await request(`/admin/volunteers?search=${namespace}&needsAttention=awaiting_review`);
  assert.equal(review.status,200);
  assert.deepEqual(new Set(review.data.volunteers.map((v:any)=>v.user.id)),new Set([volunteers[2],volunteers[3]]));
  const csv=await request(`/admin/volunteers/roster.csv?search=${namespace}&needsAttention=awaiting_review`);
  assert.equal(csv.status,200);
  for(const i of [2,3]) assert.ok(csv.data.includes(`roster-${namespace}-${i}@example.org`));
  for(const i of [0,1,4]) assert.ok(!csv.data.includes(`roster-${namespace}-${i}@example.org`));
  assert.equal((await request(`/admin/volunteers/schedule.csv?search=${namespace}&needsAttention=awaiting_review`)).status,200);
  assert.equal((await request('/admin/volunteers?limit=0')).status, 400);
  assert.equal((await request('/admin/volunteers?status=wrong')).status, 400);
});
test('detail is volunteer-only, has admin notes and excludes old assignments and past skips', async () => {
  const request = await client(admin);
  const response = await request(`/admin/volunteers/${volunteers[1]}`);
  assert.equal(response.status, 200); assert.equal(response.data.adminNotes, `ADMIN PRIVATE ${namespace}`);
  assert.equal(response.data.shifts.length, 2);
  assert.deepEqual(response.data.shifts[0].upcomingSkipDates, [addCalendarDays(today, 7)]);
  assert.equal((await request(`/admin/volunteers/${admin}`)).status, 404);
  assert.equal((await request('/admin/volunteers/not-a-uuid')).status, 400);
});
test('CSV exports include all fields/config answers, safe cells, all filtered pages and dated server filenames', async () => {
  const request = await client(admin);
  const roster = await request(`/admin/volunteers/roster.csv?search=${namespace}&limit=1`);
  assert.equal(roster.status, 200);
  assert.equal(roster.headers.get('content-disposition'), `attachment; filename="alliance-roster-${today}.csv"`);
  assert.ok(roster.headers.get('content-type')!.startsWith('text/csv'));
  assert.ok(roster.data.includes('Date of birth')); assert.ok(roster.data.includes('Emergency contact phone'));
  for (const question of onboardingQuestions) assert.ok(roster.data.includes(`(${question.id})`));
  for (let i = 0; i < 5; i++) assert.ok(roster.data.includes(`roster-${namespace}-${i}@example.org`));
  assert.ok(roster.data.includes(`"'=2+2"`));
  assert.equal(roster.data.includes('Certification status'), false);
  assert.equal(roster.data.includes('Background check status'), false);
  assert.ok(roster.data.includes('""Quoted""'));
  assert.equal(roster.data.includes('Answer:'), false);
  assert.ok(roster.data.includes('Mon 9:00–11:00; Wed 13:00–15:00'));
  assert.ok(!roster.data.includes('passwordHash')); assert.ok(!roster.data.includes('unusable-owned-fixture'));
  const schedule = await request(`/admin/volunteers/schedule.csv?search=${namespace}`);
  assert.equal(schedule.status, 200);
  assert.equal(schedule.headers.get('content-disposition'), `attachment; filename="alliance-schedule-${today}.csv"`);
  assert.ok(schedule.data.includes(addCalendarDays(today, 7)));
  assert.ok(!schedule.data.includes(addCalendarDays(today, -7))); assert.ok(!schedule.data.includes(assignmentIds[2]!));
  assert.equal((schedule.data.match(new RegExp(`roster-${namespace}-1@example.org`, 'g')) ?? []).length, 2);
  assert.ok(!(await request(`/admin/volunteers/schedule.csv?search=${namespace}&status=inactive`)).data.includes(`roster-${namespace}-1@example.org`));
});
test('workflow mutations are admin-only and approval lists verification, completed onboarding and missing profile fields', async () => {
  for (const actor of [undefined, volunteers[0], unverified, deactivated]) {
    const request = await client(actor);
    for (const [suffix, method, body] of [['status', 'POST', { status: 'active' }], ['notes', 'PATCH', { adminNotes: 'forbidden' }], ['tracking', 'PATCH', {}]] as const) {
      assert.equal((await request(`/admin/volunteers/${volunteers[3]}/${suffix}`, method, body)).status, actor ? 403 : 401);
    }
  }
  await db.update(volunteerProfilesTable).set({ agreementAcknowledgedAt: null }).where(eq(volunteerProfilesTable.userId, volunteers[3]!));
  const request = await client(admin), detail = (await request(`/admin/volunteers/${volunteers[3]}`)).data;
  const blocked = await request(`/admin/volunteers/${volunteers[3]}/status`, 'POST', { status: 'active', expectedUpdatedAt: detail.entry.profile.updatedAt });
  assert.equal(blocked.status, 422);
  assert.deepEqual(blocked.data.missing.map((check: { key: string }) => check.key),
     ['email_verified', 'onboarding_completed', ...Object.keys(testProfileFields).filter(key => key !== 'state').map(key => `profile_${key}`)]);
  assert.equal((await request(`/admin/volunteers/${volunteers[3]}/status`, 'POST', { status: 'active', expectedUpdatedAt: detail.entry.profile.updatedAt, overrideBackgroundCheck: true })).status, 400);
  assert.equal((await request(`/admin/volunteers/${volunteers[3]}`)).data.entry.profile.status, 'onboarding');
});
test('inactive release is atomic, confirms every seat including future reservations and removes seats immediately', async () => {
  const [profile] = await db.select().from(volunteerProfilesTable).where(eq(volunteerProfilesTable.userId, volunteers[1]!));
  const [futureSlot] = await db.insert(shiftSlotsTable).values({ dayOfWeek: 5, startTime: '09:00', endTime: '11:00', isActive: false }).returning();
  slots.push(futureSlot!.id);
  await assert.rejects(db.insert(shiftAssignmentsTable).values({ volunteerProfileId: profile!.id, shiftSlotId: futureSlot!.id,
    startDate: addCalendarDays(today, 14), endDate: today, createdByUserId: admin }), error =>
      error instanceof Error && (error.cause as { constraint?: string } | undefined)?.constraint === 'shift_assignments_date_order');
  const [future] = await db.insert(shiftAssignmentsTable).values({ volunteerProfileId: profile!.id, shiftSlotId: futureSlot!.id,
    startDate: addCalendarDays(today, 14), createdByUserId: admin }).returning(); assignmentIds.push(future!.id);
  const request = await client(admin), detail = (await request(`/admin/volunteers/${volunteers[1]}`)).data;
  assert.equal(detail.assignmentsToRelease.length, 3);
  const payload = { status: 'inactive', expectedUpdatedAt: detail.entry.profile.updatedAt,
    releaseAssignmentIds: detail.assignmentsToRelease.map((shift: { assignmentId: string }) => shift.assignmentId) };
  assert.equal((await request(`/admin/volunteers/${volunteers[1]}/status`, 'POST', { ...payload, releaseAssignmentIds: payload.releaseAssignmentIds.slice(0, 2) })).status, 409);
  const saved = await request(`/admin/volunteers/${volunteers[1]}/status`, 'POST', payload);
  assert.equal(saved.status, 200); assert.equal(saved.data.releasedAssignmentCount, 3);
  assert.equal(saved.data.detail.entry.profile.status, 'inactive'); assert.equal(saved.data.detail.entry.shiftCount, 0);
  assert.deepEqual(saved.data.detail.assignmentsToRelease, []); assert.deepEqual(saved.data.detail.shifts, []);
  const released = await db.select().from(shiftAssignmentsTable).where(inArray(shiftAssignmentsTable.id, payload.releaseAssignmentIds));
  assert.ok(released.every(row => row.endDate === today && row.endedReason === 'admin_removed'));
  assert.equal(saved.data.detail.activity[0].actorUserId, admin);
  assert.deepEqual([saved.data.detail.activity[0].details.from, saved.data.detail.activity[0].details.to], ['active', 'inactive']);
});
test('tracking persists calendar days/nulls, rejects invalid dates/stale saves, then Active logs one approval email', async () => {
  const request = await client(admin), path = `/admin/volunteers/${volunteers[1]}`;
  const before = (await request(path)).data;
  const fields = { certificationStatus: 'complete', certificationCompletedAt: today, certificationExpiresAt: addCalendarDays(today, 30),
    backgroundCheckStatus: 'cleared', backgroundCheckClearedAt: today,
    expectedUpdatedAt: before.entry.profile.updatedAt };
  assert.equal((await request(`${path}/tracking`, 'PATCH', { ...fields, certificationCompletedAt: '2026-02-30' })).status, 400);
  const saved = await request(`${path}/tracking`, 'PATCH', fields);
  assert.equal(saved.status, 200);
  const [raw] = await db.select().from(volunteerProfilesTable).where(eq(volunteerProfilesTable.userId, volunteers[1]!));
  assert.equal(raw!.certificationCompletedAt, today); assert.equal(raw!.backgroundCheckClearedAt, today);
  const latest = (await request(path)).data;
  const approved = await request(`${path}/status`, 'POST', { status: 'active', expectedUpdatedAt: latest.entry.profile.updatedAt });
  assert.equal(approved.status, 200); assert.equal(approved.data.detail.entry.profile.status, 'active');
  assert.equal(approved.data.emailDelivery.ok, true);
  const approvals = await db.select().from(notificationLogTable).where(eq(notificationLogTable.recipientUserId, volunteers[1]!));
  assert.equal(approvals.length, 1); assert.equal(approvals[0]!.status, 'logged'); assert.equal(approvals[0]!.type, 'welcome');
  assert.equal(approvals[0]!.subject, "You're approved! Choose your weekly shift");
  assert.ok(approved.data.detail.activity.some((event: { id: string }) => event.id === approvals[0]!.relatedId));
  const duplicate = await request(`${path}/status`, 'POST', { status: 'active', expectedUpdatedAt: approved.data.detail.entry.profile.updatedAt });
  assert.equal(duplicate.status, 200); assert.equal(duplicate.data.emailDelivery, null);
  assert.equal((await db.select().from(notificationLogTable).where(eq(notificationLogTable.recipientUserId, volunteers[1]!))).length, 1);
  const cleared = await request(`${path}/tracking`, 'PATCH', { ...fields, certificationExpiresAt: null, expectedUpdatedAt: approved.data.detail.entry.profile.updatedAt });
  assert.equal(cleared.status, 200);
  assert.equal((await db.select().from(volunteerProfilesTable).where(eq(volunteerProfilesTable.userId, volunteers[1]!)))[0]!.certificationExpiresAt, null);
  const moved = await request(`${path}/status`, 'POST', { status: 'onboarding', expectedUpdatedAt: cleared.data.entry.profile.updatedAt });
  assert.equal(moved.status, 200); assert.equal(moved.data.detail.entry.profile.status, 'onboarding');
  assert.deepEqual(moved.data.detail.entry.attention,['awaiting_review']);
});
test('notes compare-and-set protects another staff edit, clearing works, and volunteer responses never include notes', async () => {
  const request = await client(admin), path = `/admin/volunteers/${volunteers[0]}`;
  const original = (await request(path)).data.adminNotes;
  assert.equal((await request(`${path}/notes`, 'PATCH', { expectedAdminNotes: original, adminNotes: 'First staff draft' })).status, 200);
  assert.equal((await request(`${path}/notes`, 'PATCH', { expectedAdminNotes: original, adminNotes: 'Stale overwrite' })).status, 409);
  assert.equal((await request(path)).data.adminNotes, 'First staff draft');
  const outcomes = await Promise.all(['Second A', 'Second B'].map(adminNotes => request(`${path}/notes`, 'PATCH', { expectedAdminNotes: 'First staff draft', adminNotes })));
  assert.deepEqual(outcomes.map(row => row.status).sort(), [200, 409]);
  const latest = (await request(path)).data.adminNotes;
  assert.equal((await request(`${path}/notes`, 'PATCH', { expectedAdminNotes: latest, adminNotes: null })).status, 200);
  assert.equal((await request(path)).data.adminNotes, null);
  const volunteer = await client(volunteers[0]);
  assert.equal((await volunteer('/me')).data.profile.adminNotes, undefined);
  assert.equal((await request(`${path}/notes`, 'PATCH', { expectedAdminNotes: null, adminNotes: 'a'.repeat(20001) })).status, 400);
});
