import { createEmailTemplate } from '../email-template';
import { volunteerContactText } from '@workspace/shared/appConfig';
import { createScheduleService, pacificDay, addCalendarDays, TIME_ZONE, type ScheduleData, type Occurrence } from './scheduleService';

export type ReminderConfig = { reminderHoursBefore: number; sameMorningReminder: boolean; sameMorningReminderHour: number };
export type ReminderPerson = { profileId: string; userId: string; email: string; firstName: string; status: string; isActive: boolean; verified: boolean };
export type ReminderSnapshot = { schedule: ScheduleData; people: ReminderPerson[]; links: { label: string; url: string }[] };
export type ReminderCandidate = {
  occurrence: Occurrence; assignmentId: string; person: ReminderPerson; variant: '24h' | 'am'; relatedId: string;
};
export const REMINDER_WINDOW_MS = 15 * 60_000;
const localHour = new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, hour: '2-digit', hourCycle: 'h23' });
export function reminderRange(now: Date, config: ReminderConfig) {
  if (!Number.isFinite(config.reminderHoursBefore) || config.reminderHoursBefore <= 0 || config.reminderHoursBefore > 8760 ||
    !Number.isInteger(config.sameMorningReminderHour) || config.sameMorningReminderHour < 0 || config.sameMorningReminderHour > 23)
    throw new RangeError('Invalid reminder configuration.');
  const from = new Date(now.getTime() + config.reminderHoursBefore * 3600_000);
  const to = new Date(from.getTime() + REMINDER_WINDOW_MS);
  return { from, to, fromDate: pacificDay(now), toDate: pacificDay(to) };
}
/** Half-open windows and Pacific calendar instants; delivery deduplication lives in email.ts. */
export function selectReminders(snapshot: ReminderSnapshot, now: Date, config: ReminderConfig, catchUp = false): ReminderCandidate[] {
  const range = reminderRange(now, config);
  const today = pacificDay(now);
  const hour = Number(localHour.format(now));
  const morning = config.sameMorningReminder && (catchUp ? hour >= config.sameMorningReminderHour : hour === config.sameMorningReminderHour);
  const people = new Map(snapshot.people.filter(p => p.status === 'active' && p.isActive && p.verified).map(p => [p.profileId, p]));
  return createScheduleService(snapshot.schedule).getOccurrences(range.fromDate, range.toDate).flatMap(occurrence => {
    const variants: ReminderCandidate['variant'][] = [];
    // Late or budget-limited checks revisit every due, still-future occurrence.
    // Confirmed/uncertain notification rows are filtered by the runner/service.
    if (catchUp ? occurrence.startsAt > now && occurrence.startsAt <= range.from
      : occurrence.startsAt >= range.from && occurrence.startsAt < range.to) variants.push('24h');
    if (morning && occurrence.date === today && occurrence.startsAt > now) variants.push('am');
    return occurrence.assignedVolunteers.flatMap(a => {
      const person = people.get(a.volunteerProfileId);
      return person ? variants.map(variant => ({ occurrence, assignmentId: a.assignmentId, person, variant,
        relatedId: occurrence.kind==='custom' ? `custom:${occurrence.slot.id}:${a.volunteerProfileId}:${variant}`
          : `${a.assignmentId}:${occurrence.date}:${variant}` })) : [];
    });
  });
}
export function shiftTime(start: string, end: string) {
  const format = (value: string) => {
    const [h, m] = value.split(':').map(Number);
    return { time: `${h! % 12 || 12}:${String(m).padStart(2, '0')}`, period: h! < 12 ? 'AM' : 'PM' };
  };
  const a = format(start), b = format(end);
  return `${a.time}${a.period === b.period ? '' : ` ${a.period}`}–${b.time} ${b.period}`;
}
export function reminderEmail(candidate: ReminderCandidate, links: ReminderSnapshot['links'], now: Date, origin: string, test = false) {
  const { occurrence: o, person } = candidate;
  const today = pacificDay(now);
  const label = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long', month: 'short', day: 'numeric' })
    .format(new Date(`${o.date}T12:00:00Z`));
  const when = o.date === today ? 'today' : o.date === addCalendarDays(today, 1) ? 'tomorrow' : label;
  const time = shiftTime(o.slot.startTime, o.slot.endTime);
  const subject = `${test ? '[Test] ' : ''}Reminder: your shift ${when}, ${time}`;
  const safeLinks = links.filter(link => {
    try { const u = new URL(link.url); return ['https:', 'http:'].includes(u.protocol) && !u.username && !u.password; } catch { return false; }
  });
  const copy = createEmailTemplate({ heading: test ? 'Your test shift reminder' : 'Thank you for being there', firstName: person.firstName,
    paragraphs: [
      ...(test ? ['This is a test of our reminder service, not a shift assignment.'] : []),
      'Thank you for helping local families connect with the care and support they need. Your time makes a difference.',
      `Your shift: ${label}, ${time} (Pacific time).`,
      'Need the week off? Update it in the portal or let us know as soon as you can.',
      ...(test ? [] : [`If your shift is less than 24 hours away, please contact ${volunteerContactText} so we can help arrange coverage.`]),
    ],
    ctas: [...safeLinks, { label: 'Manage my shifts', url: `${origin}/shifts` }],
  });
  return { subject, ...copy };
}
