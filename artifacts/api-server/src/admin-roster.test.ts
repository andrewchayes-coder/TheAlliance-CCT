import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { eq, inArray } from 'drizzle-orm';
import { db, pool, usersTable, volunteerProfilesTable, shiftSlotsTable, shiftAssignmentsTable, shiftSkipsTable, sessionsTable } from '@workspace/db';
import { onboardingQuestions } from '@workspace/shared/onboardingQuestions';
import { pacificDay, addCalendarDays } from './volunteer-shifts';
if (process.env.NODE_ENV && process.env.NODE_ENV !== 'development') throw new Error('Roster tests require development.');
process.env.NODE_ENV = 'development'; process.env.POSTMARK_SERVER_TOKEN = ''; process.env.EMAIL_FROM = '';
const { attentionReasons } = await import('./admin-roster');
const { default: app } = await import('./app');
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
  const sid = decodeURIComponent(cookie.split('=').slice(1).join('=')).slice(2).split('.')[0]!;
  sessionIds.push(sid);
  if (userId) {
    const { rows } = await pool.query<{ sess: Record<string, unknown> }>('SELECT sess FROM sessions WHERE sid=$1', [sid]);
    await pool.query('UPDATE sessions SET sess=$1 WHERE sid=$2', [JSON.stringify({ ...rows[0]!.sess, userId, authVersion: 0 }), sid]);
  }
  return async (path: string) => {
    const response = await fetch(`${base}/api${path}`, { headers: { cookie, 'x-forwarded-proto': 'https' } });
    const text = await response.text();
    let data: any; try { data = JSON.parse(text); } catch { data = text; }
    return { status: response.status, data, headers: response.headers };
  };
}
before(async () => {
  server = createServer(app); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  admin = await fixture('admin', 5); unverified = await fixture('admin', 6, false); deactivated = await fixture('admin', 7, true, false);
  const statuses = ['active', 'active', 'in_training', 'applicant', 'inactive'] as const;
  for (let i = 0; i < statuses.length; i++) {
    const id = await fixture('volunteer', i, i !== 3); volunteers.push(id);
    const [profile] = await db.insert(volunteerProfilesTable).values({
      userId: id, status: statuses[i], county: i === 2 ? 'Sacramento' : 'Placer', adminNotes: `ADMIN PRIVATE ${namespace}`,
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
    await db.delete(volunteerProfilesTable).where(inArray(volunteerProfilesTable.userId, users));
    await db.delete(usersTable).where(inArray(usersTable.id, users));
  }
  await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
  await pool.end();
});
test('attention uses inclusive future 30-day expiry, strict >14 pending days and unique volunteer counts', () => {
  const profile = { status: 'active' as const, certificationExpiresAt: addCalendarDays(today, 30), backgroundCheckStatus: 'pending' as const,
    backgroundCheckSubmittedAt: addCalendarDays(today, -15), onboardingCompletedAt: null };
  assert.deepEqual(attentionReasons(profile, 0, today), ['no_shift', 'certification_expiring', 'background_pending', 'onboarding_incomplete']);
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
  const active = await request(`/admin/volunteers?search=${namespace}&status=active&county=Placer&certificationStatus=complete&backgroundCheckStatus=pending`);
  assert.equal(active.data.total, 1); assert.equal(active.data.volunteers[0].user.id, volunteers[1]);
  assert.equal(active.data.volunteers[0].shiftCount, 2); assert.deepEqual(active.data.summary, all.data.summary);
  const page2 = await request(`/admin/volunteers?search=${namespace}&limit=1&offset=1`);
  assert.notEqual(page2.data.volunteers[0].user.id, all.data.volunteers[0].user.id);
  const phone = await request(`/admin/volunteers?search=${encodeURIComponent('(916) 555-0101')}`);
  assert.equal(phone.data.total, 1); assert.equal(phone.data.volunteers[0].user.id, volunteers[1]);
  const wildcard = await request('/admin/volunteers?search=%25%5F');
  assert.equal(wildcard.data.total, 0);
  for (const [reason, index] of [['no_shift', 0], ['certification_expiring', 0], ['background_pending', 2], ['onboarding_incomplete', 3]] as const) {
    const filtered = await request(`/admin/volunteers?search=${namespace}&needsAttention=${reason}`);
    assert.equal(filtered.data.total, 1); assert.equal(filtered.data.volunteers[0].user.id, volunteers[index]);
  }
  assert.equal((await request(`/admin/volunteers?search=${namespace}&needsAttention=any`)).data.total, 3);
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
  assert.ok(roster.data.includes('"Profile: adminNotes"')); assert.ok(roster.data.includes('"Profile: onboardingAnswers"'));
  for (const question of onboardingQuestions) assert.ok(roster.data.includes(`(${question.id})`));
  for (let i = 0; i < 5; i++) assert.ok(roster.data.includes(`roster-${namespace}-${i}@example.org`));
  assert.ok(roster.data.includes(`"'=2+2"`)); assert.ok(roster.data.includes(`"'=HYPERLINK(""bad"")"`));
  assert.ok(roster.data.includes('""Quoted""')); assert.ok(roster.data.includes('"No"'));
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
