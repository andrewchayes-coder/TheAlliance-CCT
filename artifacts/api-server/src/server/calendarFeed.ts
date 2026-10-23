import { and, eq, isNull, lt, or } from 'drizzle-orm';
import { db, calendarFeedsTable, volunteerProfilesTable, usersTable, activityLogTable } from '@workspace/db';
import { appConfig, volunteerContactText } from '@workspace/shared/appConfig';
import { tokenHash } from '../auth/security';
import { appOrigin } from '../auth/session';
import { createScheduleService, pacificDay, addCalendarDays, type Occurrence, type ScheduleData } from './scheduleService';
import { readScheduleData } from './scheduleRepository';
import { newCalendarToken, encryptCalendarToken, decryptCalendarToken } from './calendar-token';
import { WorkflowError } from '../admin-volunteer-detail';

export const calendarNotFound = 'This calendar link is no longer active. Open My Shifts in the Community Care Team portal to get your current link.';
export const calendarEmailParagraph = 'Want your shifts in Google, Outlook or Apple Calendar? Open My shifts in the portal and choose Add to calendar. It updates on its own.';
export function calendarLinks(token: string, origin = appOrigin) {
  const feedUrl = `${origin}/api/calendar/${token}.ics`;
  const webcalUrl = feedUrl.replace(/^https:\/\//, 'webcal://');
  return { feedUrl, webcalUrl, links: {
    google: `https://calendar.google.com/calendar/render?cid=${webcalUrl}`,
    outlook: `https://outlook.live.com/calendar/0/addfromweb?url=${encodeURIComponent(feedUrl)}&name=${encodeURIComponent('CCT Shifts')}`,
    office365: `https://outlook.office.com/calendar/0/addfromweb?url=${encodeURIComponent(feedUrl)}&name=${encodeURIComponent('CCT Shifts')}`,
    apple: webcalUrl,
  } };
}
export function calendarClient(agent = ''): 'google' | 'microsoft' | 'apple' | 'other' {
  if (/google/i.test(agent)) return 'google';
  if (/microsoft|outlook|exchange/i.test(agent)) return 'microsoft';
  if (/ios|macos|calendaragent|dataaccessd/i.test(agent)) return 'apple';
  return 'other';
}
export const escapeCalendarText = (s: string) => s.replace(/\\/g, '\\\\').replace(/\r\n|\r|\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,');
/** RFC 5545 limits physical lines to 75 octets, including continuation whitespace. */
export function foldCalendarLine(line: string) {
  const parts: string[] = [];
  let current = '', length = 0;
  for (const char of line) {
    const size = Buffer.byteLength(char, 'utf8');
    if (length + size > 75) { parts.push(current); current = ' '; length = 1; }
    current += char; length += size;
  }
  parts.push(current);
  return parts.join('\r\n');
}
const utc = (date: Date) => date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const clock = (date: Date) => new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit', hour12: true,
}).format(date);
export function serializeCalendar(occurrences: readonly Occurrence[], data: Pick<ScheduleData, 'assignments'>,
  profileId: string, now = new Date(), origin = appOrigin) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//The Alliance//Community Care Team Portal//EN',
    'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:CCT Shifts',
    'X-WR-CALDESC:Your Community Care Team shifts. This calendar updates on its own.',
    'X-WR-TIMEZONE:America/Los_Angeles', 'REFRESH-INTERVAL;VALUE=DURATION:PT1H', 'X-PUBLISHED-TTL:PT1H'];
  for (const occurrence of occurrences) {
    const own = occurrence.assignedVolunteers.find(a => a.volunteerProfileId === profileId);
    if (!own) continue;
    const custom = occurrence.kind === 'custom';
    const assignment = data.assignments.find(a => a.id === own.assignmentId);
    const once = custom || !!assignment?.endDate && assignment.endDate === assignment.startDate;
    const uid = custom ? `cct-custom-${own.assignmentId}` : `cct-shift-${own.assignmentId}-${occurrence.date.replace(/-/g, '')}`;
    const summary = `Community Care Team shift${occurrence.slot.label ? `: ${occurrence.slot.label}` : ''}${once ? ' (one-time)' : ''}`;
    const description = `${appConfig.volunteerRoleName} shift, ${clock(occurrence.startsAt)}–${clock(occurrence.endsAt)} Pacific.\nManage your shifts, take a week off or log your hours: ${origin}/shifts\nQuestions? Contact ${volunteerContactText}.`;
    lines.push('BEGIN:VEVENT', `UID:${uid}@${new URL(origin).host}`, `DTSTAMP:${utc(now)}`,
      `DTSTART:${utc(occurrence.startsAt)}`, `DTEND:${utc(occurrence.endsAt)}`,
      `SUMMARY:${escapeCalendarText(summary)}`, `DESCRIPTION:${escapeCalendarText(description)}`,
      `URL:${origin}/shifts`,
      ...(appConfig.calendarEventLocation?.trim() ? [`LOCATION:${escapeCalendarText(appConfig.calendarEventLocation.trim())}`] : []),
      'STATUS:CONFIRMED', 'TRANSP:OPAQUE', 'SEQUENCE:0', 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldCalendarLine).join('\r\n') + '\r\n';
}

export async function volunteerCalendar(userId: string, reset = false) {
  return db.transaction(async tx => {
    // Serializes first creation, decryption recovery and explicit resets for one profile.
    const [profile] = await tx.select({ id: volunteerProfilesTable.id }).from(volunteerProfilesTable)
      .where(eq(volunteerProfilesTable.userId, userId)).for('update');
    if (!profile) throw new WorkflowError(404, 'Volunteer profile not found.');
    let [feed] = await tx.select().from(calendarFeedsTable).where(eq(calendarFeedsTable.volunteerProfileId, profile.id));
    let token: string | undefined;
    if (feed && !reset) {
      try {
        token = decryptCalendarToken(feed.tokenCiphertext);
        if (tokenHash(token) !== feed.tokenHash) token = undefined;
      } catch { /* Key rotation: replace the unusable capability, never return ciphertext. */ }
    }
    if (!token) {
      token = newCalendarToken();
      const values = { tokenHash: tokenHash(token), tokenCiphertext: encryptCalendarToken(token),
        rotatedAt: feed ? new Date() : null, lastFetchedAt: null, lastClient: null };
      if (feed) [feed] = await tx.update(calendarFeedsTable).set(values).where(eq(calendarFeedsTable.id, feed.id)).returning();
      else [feed] = await tx.insert(calendarFeedsTable).values({ volunteerProfileId: profile.id, ...values }).returning();
    }
    if (reset) await tx.insert(activityLogTable).values({
      volunteerProfileId: profile.id, actorUserId: userId, action: 'calendar_link_reset', details: {},
    });
    return { ...calendarLinks(token), lastFetchedAt: feed!.lastFetchedAt, lastClient: feed!.lastClient };
  });
}
export async function findCalendar(token: string) {
  const [feed] = await db.select().from(calendarFeedsTable).where(eq(calendarFeedsTable.tokenHash, tokenHash(token)));
  return feed;
}
export async function renderCalendar(feed: typeof calendarFeedsTable.$inferSelect, now = new Date()) {
  return db.transaction(async tx => {
    const [person] = await tx.select({ role: usersTable.role, isActive: usersTable.isActive,
      archivedAt: usersTable.archivedAt, status: volunteerProfilesTable.status })
      .from(volunteerProfilesTable).innerJoin(usersTable, eq(usersTable.id, volunteerProfilesTable.userId))
      .where(eq(volunteerProfilesTable.id, feed.volunteerProfileId));
    if (!person || person.role !== 'volunteer' || !person.isActive || person.archivedAt || person.status !== 'active')
      return serializeCalendar([], { assignments: [] }, feed.volunteerProfileId, now);
    const today = pacificDay(now), from = addCalendarDays(today, -30), to = addCalendarDays(today, 180);
    const data = await readScheduleData(tx, feed.volunteerProfileId, { from, to });
    return serializeCalendar(createScheduleService(data).getOccurrences(from, to), data, feed.volunteerProfileId, now);
  }, { isolationLevel: 'repeatable read' });
}
export async function recordCalendarFetch(feedId: string, agent?: string, now = new Date()) {
  await db.update(calendarFeedsTable).set({ lastFetchedAt: now, lastClient: calendarClient(agent) })
    .where(and(eq(calendarFeedsTable.id, feedId),
      or(isNull(calendarFeedsTable.lastFetchedAt), lt(calendarFeedsTable.lastFetchedAt, new Date(now.getTime() - 600_000)))));
}
