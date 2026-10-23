import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { db, pool, calendarFeedsTable, usersTable, volunteerProfilesTable, shiftSlotsTable,
  shiftAssignmentsTable, shiftSkipsTable, closedDatesTable, slotBlocksTable, customShiftsTable,
  customShiftAssignmentsTable, activityLogTable, sessionsTable } from '@workspace/db';
import { calendarLinks, calendarClient, escapeCalendarText, foldCalendarLine, serializeCalendar,
  volunteerCalendar, findCalendar, renderCalendar, recordCalendarFetch, calendarNotFound } from './calendarFeed';
import { newCalendarToken, encryptCalendarToken, decryptCalendarToken } from './calendar-token';
import { addCalendarDays, pacificDay, createScheduleService, type ScheduleData } from './scheduleService';
import { declaredGuard } from '../auth/access-policy';
import { loadAdminVolunteerDetail } from '../admin-volunteer-detail';
import { tokenHash } from '../auth/security';

if (!process.env.QA_REGRESSION_SCHEMA?.startsWith('qa_regression_')) throw new Error('Calendar fixtures require the isolated regression runner.');
const tag = `calendar-${randomUUID()}`, userIds: string[] = [], profileIds: string[] = [], slotIds: string[] = [], sessionIds: string[] = [];
let userId: string, profileId: string, otherProfile: string, otherUser: string;
let server: Server, base: string, origin: string, cookie: string, csrf: string;
let standingId: string, standingSlot: string, onceId: string, customAssignmentId: string, blockedDate: string, skipDate: string, closedDate: string;
const now = new Date(), today = pacificDay(now);
const unfold = (s: string) => s.replace(/\r\n /g, '');
async function person() {
  const [u] = await db.insert(usersTable).values({ email: `${tag}-${userIds.length}@example.invalid`,
    firstName: `Private-${tag}`, lastName: 'Do not expose', phone: '+15555559876',
    passwordHash: 'fixture-only', emailVerifiedAt: now }).returning();
  userIds.push(u!.id);
  const [p] = await db.insert(volunteerProfilesTable).values({ userId: u!.id, status: 'active', onboardingCompletedAt: now,
    dateOfBirth: '1990-01-01', addressLine1: '123 Test St', city: 'Auburn', state: 'CA', zip: '95603',
    emergencyContactName: 'Test Contact', emergencyContactRelationship: 'Friend', emergencyContactPhone: '5555550100' }).returning();
  profileIds.push(p!.id); return { user: u!.id, profile: p!.id };
}
async function api(path: string, method = 'GET', body?: unknown) {
  return fetch(`${base}/api${path}`, { method, headers: { cookie, Origin: origin, 'x-forwarded-proto': 'https',
    'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
}
async function publicFeed(url: string, method = 'GET', agent = 'Google-Calendar-Importer') {
  return fetch(`${base}${new URL(url).pathname}`, { method, headers: { 'User-Agent': agent } });
}
beforeAll(async () => {
  ({ user: userId, profile: profileId } = await person());
  ({ user: otherUser, profile: otherProfile } = await person());
  const { default: app } = await import('../app'); origin = (await import('../auth/session')).appOrigin;
  server = createServer(app); await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const boot = await fetch(`${base}/api/auth/session`, { headers: { 'x-forwarded-proto': 'https' } });
  cookie = boot.headers.get('set-cookie')!.split(';')[0]!;
  csrf = (await boot.json() as { csrfToken: string }).csrfToken;
  const sid = decodeURIComponent(cookie.split('=').slice(1).join('=')).slice(2).split('.')[0]!;
  sessionIds.push(sid);
  const { rows } = await pool.query('SELECT sess FROM sessions WHERE sid=$1', [sid]);
  await pool.query('UPDATE sessions SET sess=$1 WHERE sid=$2',
    [JSON.stringify({ ...rows[0]!.sess, userId, authVersion: 0 }), sid]);
  const [slot] = await db.insert(shiftSlotsTable).values({ dayOfWeek: 2, startTime: '09:00', endTime: '11:00', capacity: 2, label: tag }).returning();
  standingSlot = slot!.id; slotIds.push(standingSlot);
  const [standing] = await db.insert(shiftAssignmentsTable).values({
    shiftSlotId: standingSlot, volunteerProfileId: profileId, startDate: today, createdByUserId: userId,
  }).returning();
  standingId = standing!.id;
  await db.insert(shiftAssignmentsTable).values({ shiftSlotId: standingSlot, volunteerProfileId: otherProfile, startDate: today, createdByUserId: userId });
  let tuesday = addCalendarDays(today, 1);
  while (new Date(`${tuesday}T00:00:00Z`).getUTCDay() !== 2) tuesday = addCalendarDays(tuesday, 1);
  skipDate = tuesday; closedDate = addCalendarDays(tuesday, 7); blockedDate = addCalendarDays(tuesday, 14);
  await db.insert(shiftSkipsTable).values({ shiftAssignmentId: standingId, skipDate });
  await db.insert(closedDatesTable).values({ date: closedDate, reason: tag });
  await db.insert(slotBlocksTable).values({ shiftSlotId: standingSlot, date: blockedDate, reason: tag, createdByUserId: userId });
  const [oneSlot] = await db.insert(shiftSlotsTable).values({ dayOfWeek: 3, startTime: '12:00', endTime: '14:00', capacity: 2, label: 'Café 🧡; test, label\\\nsecond line' }).returning();
  slotIds.push(oneSlot!.id);
  const onceDate = addCalendarDays(tuesday, 1);
  const [one] = await db.insert(shiftAssignmentsTable).values({ shiftSlotId: oneSlot!.id,
    volunteerProfileId: profileId, startDate: onceDate, endDate: onceDate, createdByUserId: userId }).returning();
  onceId = one!.id;
  const [custom] = await db.insert(customShiftsTable).values({ date: addCalendarDays(tuesday, 2), startTime: '13:00',
    endTime: '15:00', capacity: 2, label: 'Special', createdByUserId: userId }).returning();
  const [ca] = await db.insert(customShiftAssignmentsTable).values({ customShiftId: custom!.id,
    volunteerProfileId: profileId, createdByUserId: userId }).returning();
  customAssignmentId = ca!.id;
});
afterAll(async () => {
  if (sessionIds.length) await db.delete(sessionsTable).where(inArray(sessionsTable.sid, sessionIds));
  // Files share the isolated schema serially. Remove this suite's closures too,
  // or they change the later booking suites' available dates.
  if (profileIds.length) {
    const assignments = await db.select({ id: shiftAssignmentsTable.id }).from(shiftAssignmentsTable)
      .where(inArray(shiftAssignmentsTable.volunteerProfileId, profileIds));
    if (assignments.length) await db.delete(shiftSkipsTable).where(inArray(shiftSkipsTable.shiftAssignmentId, assignments.map(a => a.id)));
    await db.delete(shiftAssignmentsTable).where(inArray(shiftAssignmentsTable.volunteerProfileId, profileIds));
    await db.delete(customShiftAssignmentsTable).where(inArray(customShiftAssignmentsTable.volunteerProfileId, profileIds));
    await db.delete(activityLogTable).where(inArray(activityLogTable.volunteerProfileId, profileIds));
    await db.delete(calendarFeedsTable).where(inArray(calendarFeedsTable.volunteerProfileId, profileIds));
  }
  if (slotIds.length) {
    await db.delete(slotBlocksTable).where(inArray(slotBlocksTable.shiftSlotId, slotIds));
    await db.delete(shiftSlotsTable).where(inArray(shiftSlotsTable.id, slotIds));
  }
  await db.delete(closedDatesTable).where(eq(closedDatesTable.reason, tag));
  if (userIds.length) {
    await db.delete(customShiftsTable).where(inArray(customShiftsTable.createdByUserId, userIds));
    await db.delete(volunteerProfilesTable).where(inArray(volunteerProfilesTable.userId, userIds));
    await db.delete(usersTable).where(inArray(usersTable.id, userIds));
  }
  await pool.query('DELETE FROM auth_rate_limits WHERE key LIKE $1 OR key=$2',
    ['calendar-token:%', `calendar-unknown-ip:${tokenHash('127.0.0.1')}`]);
  if (server) await new Promise<void>(resolve => server.close(() => resolve()));
  await pool.end();
});

describe('calendar serializer and capability links', () => {
  it('uses CRLF, escapes TEXT, folds UTF-8 without splitting emoji or exceeding 75 octets', () => {
    expect(escapeCalendarText('x\\y;z,\r\nnext')).toBe('x\\\\y\\;z\\,\\nnext');
    const folded = foldCalendarLine('SUMMARY:' + 'é🧡'.repeat(40));
    expect(folded.split('\r\n').every(l => Buffer.byteLength(l, 'utf8') <= 75)).toBe(true);
    expect(folded.replace(/\r\n /g, '')).toBe('SUMMARY:' + 'é🧡'.repeat(40));
    const empty = serializeCalendar([], { assignments: [] }, 'none');
    expect(empty).toContain('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n');
    expect(empty.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(empty).not.toContain('VEVENT'); expect(empty.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
  });
  it('builds the exact Google, Outlook and Apple subscription URLs on the server', () => {
    const token = 'A'.repeat(43), host = 'https://calendar.example.invalid', c = calendarLinks(token, host);
    expect(c.feedUrl).toBe(`${host}/api/calendar/${token}.ics`);
    expect(c.webcalUrl).toBe(`webcal://calendar.example.invalid/api/calendar/${token}.ics`);
    expect(c.links.google).toBe(`https://calendar.google.com/calendar/render?cid=${c.webcalUrl}`);
    expect(c.links.outlook).toBe(`https://outlook.live.com/calendar/0/addfromweb?url=${encodeURIComponent(c.feedUrl)}&name=CCT%20Shifts`);
    expect(c.links.office365).toBe(`https://outlook.office.com/calendar/0/addfromweb?url=${encodeURIComponent(c.feedUrl)}&name=CCT%20Shifts`);
    expect(c.links.apple).toBe(c.webcalUrl);
    expect(['Google', 'Exchange', 'CalendarAgent', 'iOS', 'macOS', 'dataaccessd', 'Mozilla'].map(calendarClient))
      .toEqual(['google', 'microsoft', 'apple', 'apple', 'apple', 'apple', 'other']);
  });
  it('encrypts tokens with authenticated encryption and rejects a changed key or ciphertext', () => {
    const token = newCalendarToken(), encrypted = encryptCalendarToken(token);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/); expect(encrypted).not.toContain(token);
    expect(decryptCalendarToken(encrypted)).toBe(token);
    expect(() => decryptCalendarToken(encrypted + 'bad')).toThrow();
    const old = process.env.SESSION_SECRET;
    try { process.env.SESSION_SECRET = `${old}-changed`; expect(() => decryptCalendarToken(encrypted)).toThrow(); }
    finally { process.env.SESSION_SECRET = old; }
  });
  it('uses the existing occurrence clock over the Pacific DST change', () => {
    const data: ScheduleData = { slots: [5, 1].map((dayOfWeek, i) => ({ id: `slot${i}`, dayOfWeek, startTime: '09:00', endTime: '11:00', capacity: 1, label: null, isActive: true })),
      assignments: [0, 1].map(i => ({ id: `assignment${i}`, shiftSlotId: `slot${i}`, volunteerProfileId: 'own', startDate: '2026-10-01', endDate: null })),
      skips: [], closedDates: [] };
    const feed = serializeCalendar(createScheduleService(data).getOccurrences('2026-10-30', '2026-11-02'), data, 'own');
    expect(feed).toContain('DTSTART:20261030T160000Z'); expect(feed).toContain('DTSTART:20261102T170000Z');
    expect(feed).not.toContain('VTIMEZONE');
  });
});
describe('calendar routes, privacy, state and reset', () => {
  it('creates exactly one feed and identical tokens under concurrent first GET requests', async () => {
    const responses = await Promise.all(Array.from({ length: 5 }, () => api('/volunteer/calendar')));
    expect(responses.map(r => r.status)).toEqual([200, 200, 200, 200, 200]);
    const urls = await Promise.all(responses.map(r => r.json().then((x: any) => x.feedUrl)));
    expect(new Set(urls).size).toBe(1);
    const feeds = await db.select().from(calendarFeedsTable).where(eq(calendarFeedsTable.volunteerProfileId, profileId));
    expect(feeds).toHaveLength(1); expect(feeds[0]!.lastFetchedAt).toBeNull();
    expect(urls[0]).toContain(decryptCalendarToken(feeds[0]!.tokenCiphertext));
    expect(feeds[0]!.tokenHash).toBe(tokenHash(decryptCalendarToken(feeds[0]!.tokenCiphertext)));
  });
  it('declares both public methods and onboarded owner-only APIs; HEAD does not record a connection', async () => {
    expect(declaredGuard('GET', '/calendar/anything.ics')).toBe('public');
    expect(declaredGuard('HEAD', '/calendar/anything.ics')).toBe('public');
    expect(declaredGuard('GET', '/volunteer/calendar')).toBe('onboardedVolunteer');
    expect(declaredGuard('POST', '/volunteer/calendar/reset')).toBe('onboardedVolunteer');
    expect((await fetch(`${base}/api/volunteer/calendar`)).status).toBe(401);
    expect((await api(`/volunteer/calendar?userId=${otherUser}`)).status).toBe(200);
    expect((await db.select().from(calendarFeedsTable)).filter(f => f.volunteerProfileId === otherProfile)).toHaveLength(0);
    const c = await volunteerCalendar(userId), response = await publicFeed(c.feedUrl, 'HEAD');
    expect(response.status).toBe(200); expect(response.headers.get('Content-Type')).toBe('text/calendar; charset=utf-8');
    expect(response.headers.get('Content-Disposition')).toBe('inline; filename="cct-shifts.ics"');
    expect(response.headers.get('Cache-Control')).toBe('no-store'); expect(await response.text()).toBe('');
    expect((await volunteerCalendar(userId)).lastFetchedAt).toBeNull();
    const missing = await publicFeed(`${origin}/api/calendar/${'Z'.repeat(43)}.ics`);
    const malformed = await publicFeed(`${origin}/api/calendar/bad.ics`);
    expect(missing.status).toBe(404); expect(malformed.status).toBe(404);
    expect(await missing.text()).toBe(calendarNotFound); expect(await malformed.text()).toBe(calendarNotFound);
  });
  it('matches shared occurrences, excludes skips/closures/blocks, includes one-time events once and never another identity', async () => {
    const c = await volunteerCalendar(userId), response = await publicFeed(c.feedUrl);
    expect(response.status).toBe(200);
    const body = unfold(await response.text());
    const through = addCalendarDays(today, 180);
    let expectedStanding = 0;
    for (let day = today; day <= through; day = addCalendarDays(day, 1))
      if (new Date(`${day}T00:00:00Z`).getUTCDay() === 2 && ![skipDate, closedDate, blockedDate].includes(day)) expectedStanding++;
    expect(body.match(/BEGIN:VEVENT/g)).toHaveLength(expectedStanding + 2);
    for (const date of [skipDate, closedDate, blockedDate])
      expect(body).not.toContain(`cct-shift-${standingId}-${date.replace(/-/g, '')}@`);
    expect(body.match(new RegExp(`cct-shift-${onceId}-`, 'g'))).toHaveLength(1);
    expect(body.match(new RegExp(`cct-custom-${customAssignmentId}@`, 'g'))).toHaveLength(1);
    expect(body.match(/\(one-time\)/g)).toHaveLength(2);
    const [otherAssignment] = await db.select().from(shiftAssignmentsTable).where(eq(shiftAssignmentsTable.volunteerProfileId, otherProfile));
    for (const secret of [`Private-${tag}`, '+15555559876', `${tag}-1@example.invalid`, otherAssignment!.id, 'ORGANIZER', 'ATTENDEE', 'VALARM'])
      expect(body).not.toContain(secret);
    const again = unfold(await (await publicFeed(c.feedUrl)).text());
    expect(body.match(/^UID:.*$/gm)).toEqual(again.match(/^UID:.*$/gm));
    const current = await volunteerCalendar(userId);
    expect(current.lastClient).toBe('google'); expect(current.lastFetchedAt).not.toBeNull();
    const f = await findCalendar(decryptCalendarToken((await db.select().from(calendarFeedsTable).where(eq(calendarFeedsTable.volunteerProfileId, profileId)))[0]!.tokenCiphertext));
    await recordCalendarFetch(f!.id, 'Exchange');
    expect((await volunteerCalendar(userId)).lastClient).toBe('google'); // ten-minute write throttle
    expect(JSON.stringify(await loadAdminVolunteerDetail(userId))).not.toContain(c.feedUrl);
    const detail = await loadAdminVolunteerDetail(userId);
    expect(detail.calendar?.lastClient).toBe('google'); expect(JSON.stringify(detail.calendar)).not.toMatch(/token|feedUrl|webcal/);
  });
  it('removes ended assignment future UIDs after changing shifts while preserving unrelated UIDs', async () => {
    const c = await volunteerCalendar(userId), token = new URL(c.feedUrl).pathname.split('/').pop()!.slice(0, -4);
    const f = (await findCalendar(token))!;
    const old = unfold(await renderCalendar(f, now));
    const [replacementSlot] = await db.insert(shiftSlotsTable).values({ dayOfWeek: 4, startTime: '09:00', endTime: '11:00', capacity: 1 }).returning();
    slotIds.push(replacementSlot!.id);
    await db.update(shiftAssignmentsTable).set({ endDate: addCalendarDays(today, -1), endedReason: 'changed' }).where(eq(shiftAssignmentsTable.id, standingId));
    const [replacement] = await db.insert(shiftAssignmentsTable).values({ volunteerProfileId: profileId, shiftSlotId: replacementSlot!.id, startDate: today, createdByUserId: userId }).returning();
    const changed = unfold(await renderCalendar(f, now));
    expect(changed).not.toContain(`cct-shift-${standingId}-`);
    expect(changed).toContain(`cct-shift-${replacement!.id}-`);
    expect(old).toContain(`cct-custom-${customAssignmentId}@`); expect(changed).toContain(`cct-custom-${customAssignmentId}@`);
  });
  it.each(['inactive', 'deactivated', 'archived'] as const)('returns an empty 200 calendar for %s accounts', async state => {
    if (state === 'inactive') await db.update(volunteerProfilesTable).set({ status: 'inactive' }).where(eq(volunteerProfilesTable.id, profileId));
    else await db.update(usersTable).set(state === 'archived' ? { archivedAt: now } : { isActive: false }).where(eq(usersTable.id, userId));
    try {
      const [f] = await db.select().from(calendarFeedsTable).where(eq(calendarFeedsTable.volunteerProfileId, profileId));
      const token = decryptCalendarToken(f!.tokenCiphertext);
      const r = await publicFeed(calendarLinks(token).feedUrl);
      expect(r.status).toBe(200); const body = await r.text();
      expect(body).toContain('BEGIN:VCALENDAR'); expect(body).not.toContain('VEVENT');
    } finally {
      await db.update(usersTable).set({ isActive: true, archivedAt: null }).where(eq(usersTable.id, userId));
      await db.update(volunteerProfilesTable).set({ status: 'active' }).where(eq(volunteerProfilesTable.id, profileId));
    }
  });
  it('validates an empty reset, requires CSRF, rotates once and writes no capability into activity', async () => {
    expect((await api('/volunteer/calendar/reset', 'POST', { ignored: 'no' })).status).toBe(400);
    expect((await fetch(`${base}/api/volunteer/calendar/reset`, { method: 'POST', headers: { cookie, Origin: origin } })).status).toBe(403);
    const old = await volunteerCalendar(userId), r = await api('/volunteer/calendar/reset', 'POST', {});
    expect(r.status).toBe(200); const next = await r.json() as any;
    expect(next.feedUrl).not.toBe(old.feedUrl); expect(next.lastFetchedAt).toBeNull(); expect(next.lastClient).toBeNull();
    expect((await publicFeed(old.feedUrl)).status).toBe(404); expect((await publicFeed(next.feedUrl)).status).toBe(200);
    const rows = await db.select().from(activityLogTable).where(and(eq(activityLogTable.volunteerProfileId, profileId), eq(activityLogTable.action, 'calendar_link_reset')));
    expect(rows).toHaveLength(1); expect(rows[0]!.details).toEqual({});
  });
  it('recovers a link whose ciphertext can no longer decrypt without duplicating rows', async () => {
    const old = await volunteerCalendar(userId);
    await db.update(calendarFeedsTable).set({ tokenCiphertext: 'invalid' }).where(eq(calendarFeedsTable.volunteerProfileId, profileId));
    const fresh = await volunteerCalendar(userId);
    expect(fresh.feedUrl).not.toBe(old.feedUrl); expect((await publicFeed(old.feedUrl)).status).toBe(404);
    expect((await publicFeed(fresh.feedUrl)).status).toBe(200);
    expect(await db.select().from(calendarFeedsTable).where(eq(calendarFeedsTable.volunteerProfileId, profileId))).toHaveLength(1);
  });
  it('limits valid capabilities at 120/hour and unknown URLs at 30/hour with Retry-After', async () => {
    const c = await volunteerCalendar(userId), token = new URL(c.feedUrl).pathname.split('/').pop()!.slice(0, -4);
    await pool.query(`INSERT INTO auth_rate_limits (key,count,window_start) VALUES ($1,120,now())
      ON CONFLICT (key) DO UPDATE SET count=120,window_start=now()`, [`calendar-token:${tokenHash(tokenHash(token))}`]);
    const blocked = await publicFeed(c.feedUrl);
    expect(blocked.status).toBe(429); expect(Number(blocked.headers.get('Retry-After'))).toBeGreaterThan(0);
    // Existing unknown requests have the same IP. Set the next counter exactly at the threshold.
    await pool.query(`INSERT INTO auth_rate_limits (key,count,window_start) VALUES ($1,30,now())
      ON CONFLICT (key) DO UPDATE SET count=30,window_start=now()`, [`calendar-unknown-ip:${tokenHash('127.0.0.1')}`]);
    const unknown = await publicFeed(`${origin}/api/calendar/${'Q'.repeat(43)}.ics`);
    expect(unknown.status).toBe(429); expect(Number(unknown.headers.get('Retry-After'))).toBeGreaterThan(0);
  });
});
