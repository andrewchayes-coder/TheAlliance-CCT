import { z } from 'zod';
import { GetAdminHoursReportResponse } from '@workspace/api-zod';
import { normalizeVolunteerStatus } from '@workspace/shared/profileFields';
import { csvCell } from '../onboarding';
import { addCalendarDays, pacificDay, type ScheduleData } from './scheduleService';
import { loggableShifts, sameHoursShift } from './volunteerHours';
import { pacificReportDay, reportingRangeError } from '@workspace/shared/reportingPeriod';

export class ReportError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export type ReportPerson = {
  profileId: string; userId: string; name: string; email: string; status: string; isTestAccount: boolean;
  role?: 'admin' | 'volunteer';
};
export type ReportEntry = {
  volunteerProfileId: string; shiftDate: string; source: string; shiftSlotId: string | null;
  customShiftId: string | null; startTime: string | null; endTime: string | null;
  hours: string | number; note: string | null; enteredByUserId: string;
  enteredByName: string; updatedAt: Date;
};
export type ReportSchedule = Omit<ScheduleData, 'assignments'> & {
  assignments: readonly (ScheduleData['assignments'][number] & { updatedAt?: Date })[];
};
export function shiftMonth(month: string, offset: number): string {
  const date = new Date(`${month}-01T12:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + offset);
  return date.toISOString().slice(0, 7);
}
export type ReportPeriodInput = { month?: unknown; startDate?: unknown; endDate?: unknown };
export function reportPeriod(value: unknown, now: Date) {
  const input: ReportPeriodInput = value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value : { month: value };
  const today = pacificReportDay(now);
  const currentMonth = pacificDay(now).slice(0, 7);
  if (input.startDate !== undefined || input.endDate !== undefined) {
    if (input.month !== undefined) throw new ReportError(400, 'Choose either a month or a date range, not both.');
    const error = reportingRangeError(input.startDate, input.endDate, today);
    if (error) throw new ReportError(400, error);
    const from = input.startDate as string, to = input.endDate as string;
    return { month: from.slice(0, 7), currentMonth, from, to, trendFrom: from,
      metadata: { startDate: from, endDate: to, today, timezone: 'America/Los_Angeles', mode: 'range' as const } };
  }
  const month = input.month === undefined ? currentMonth : input.month;
  if (typeof month !== 'string' || !/^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(month))
    throw new ReportError(400, 'Choose a month in YYYY-MM format.');
  if (month > currentMonth) throw new ReportError(400, 'Choose the current month or an earlier month.');
  const from = `${month}-01`, to = addCalendarDays(`${shiftMonth(month, 1)}-01`, -1);
  return { month, currentMonth, from, to, trendFrom: `${shiftMonth(month, -11)}-01`,
    metadata: { startDate: from, endDate: to, today, timezone: 'America/Los_Angeles', mode: 'legacy-month' as const } };
}
export function reportIncludeTest(value: unknown): boolean {
  if (value === undefined || value === 'false') return false;
  if (value === 'true') return true;
  throw new ReportError(400, 'Show test accounts must be true or false.');
}
type Report = z.infer<typeof GetAdminHoursReportResponse>;
/** The scheduling service limits each expansion to a year. Reporting supports
 * arbitrary historical periods by expanding bounded, non-overlapping chunks. */
function missedShifts(schedule: ReportSchedule, person: ReportPerson, rows: ReportEntry[],
  now: Date, from: string, to: string): number {
  if (normalizeVolunteerStatus(person.status) === 'onboarding') return 0;
  const customIds = new Set(schedule.customAssignments?.filter(a => a.volunteerProfileId === person.profileId).map(a => a.customShiftId));
  const dates = [
    ...schedule.assignments.filter(a => a.volunteerProfileId === person.profileId).map(a => a.startDate),
    ...(schedule.customShifts ?? []).filter(s => customIds.has(s.id)).map(s => s.date),
  ].sort();
  if (!dates.length) return 0;
  const end = to < pacificDay(now) ? to : pacificDay(now);
  let missed = 0;
  for (let start = from > dates[0]! ? from : dates[0]!; start <= end;) {
    const chunkEnd = addCalendarDays(start, 365) < end ? addCalendarDays(start, 365) : end;
    missed += loggableShifts(schedule, person.profileId, person.status, now, { from: start, to: chunkEnd })
      .filter(s => !rows.some(row => sameHoursShift(s, { ...row, date: row.shiftDate }))).length;
    start = addCalendarDays(chunkEnd, 1);
  }
  return missed;
}
/** Pure read projection, shared by JSON and both CSVs. Dates are Pacific calendar dates,
 * never UTC timestamps of when somebody happened to enter the hours.
 */
export function buildHoursReport(people: ReportPerson[], entries: ReportEntry[], schedule: ReportSchedule,
  now: Date, monthValue?: unknown, includeTest = false): Report {
  const period = reportPeriod(monthValue, now);
  const included = people.filter(p => p.role !== 'admin' && (includeTest || !p.isTestAccount));
  const ids = new Set(included.map(p => p.profileId));
  const history = entries.filter(e => ids.has(e.volunteerProfileId) &&
    e.shiftDate >= period.trendFrom && e.shiftDate <= period.to);
  const selected = history.filter(e => e.shiftDate >= period.from);
  const volunteers = included.flatMap(p => {
    const rows = selected.filter(e => e.volunteerProfileId === p.profileId);
    const missed = missedShifts(schedule, p, rows, now, period.from, period.to);
    if (!rows.length && !missed) return [];
    return [{ userId: p.userId, name: p.name, status: normalizeVolunteerStatus(p.status),
      isTestAccount: p.isTestAccount, hours: rows.reduce((sum, row) => sum + Number(row.hours), 0),
      shiftsLogged: rows.filter(row => row.source !== 'other').length,
      otherEntries: rows.filter(row => row.source === 'other').length, shiftsNotLogged: missed,
      lastLoggedDate: rows.map(row => row.shiftDate).sort().at(-1) ?? null }];
  }).sort((a, b) => a.name.localeCompare(b.name) || a.userId.localeCompare(b.userId));
  const totals = {
    teamHours: volunteers.reduce((sum, p) => sum + p.hours, 0),
    volunteersWithHours: volunteers.filter(p => p.hours > 0).length,
    shiftsLogged: volunteers.reduce((sum, p) => sum + p.shiftsLogged, 0),
    otherEntries: volunteers.reduce((sum, p) => sum + p.otherEntries, 0),
    shiftsNotLogged: volunteers.reduce((sum, p) => sum + p.shiftsNotLogged, 0),
  };
  const trend = [];
  for (let month = period.trendFrom.slice(0, 7); month <= period.to.slice(0, 7); month = shiftMonth(month, 1)) {
    const first = `${month}-01`, last = addCalendarDays(`${shiftMonth(month, 1)}-01`, -1);
    const startDate = first < period.trendFrom ? period.trendFrom : first;
    const endDate = last > period.to ? period.to : last;
    const rows = history.filter(e => e.shiftDate >= startDate && e.shiftDate <= endDate);
    trend.push({ month, startDate, endDate, partial: startDate !== first || endDate !== last,
      teamHours: rows.reduce((sum, row) => sum + Number(row.hours), 0),
      volunteersWithHours: new Set(rows.map(row => row.volunteerProfileId)).size });
  }
  return { month: period.month, currentMonth: period.currentMonth, period: period.metadata, totals, volunteers, trend };
}
const csv = (rows: unknown[][]) => '\ufeff' + rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
export function hoursByVolunteerCsv(report: Report, people: ReportPerson[]) {
  return csv(hoursByVolunteerRows(report, people));
}
export function hoursByVolunteerRows(report: Report, people: ReportPerson[]) {
  const emails = new Map(people.map(p => [p.userId, p.email]));
  return [['Volunteer', 'Email', 'Status', 'Hours logged', 'Shifts logged', 'Other time entries', 'Shifts not logged', 'Last logged'],
    ...report.volunteers.map(p => [p.name, emails.get(p.userId), p.status, p.hours, p.shiftsLogged,
      p.otherEntries, p.shiftsNotLogged, p.lastLoggedDate]),
    ['Team total', '', '', report.totals.teamHours, report.totals.shiftsLogged,
      report.totals.otherEntries, report.totals.shiftsNotLogged, '']];
}
export function hourEntriesCsv(report: Report, people: ReportPerson[], entries: ReportEntry[], schedule: ReportSchedule) {
  return csv(hourEntriesRows(report, people, entries, schedule));
}
export function hourEntriesRows(report: Report, people: ReportPerson[], entries: ReportEntry[], schedule: ReportSchedule) {
  const ids = new Set(report.volunteers.map(p => p.userId));
  const persons = new Map(people.filter(p => ids.has(p.userId)).map(p => [p.profileId, p]));
  const rows = entries.filter(e => e.shiftDate >= report.period.startDate && e.shiftDate <= report.period.endDate && persons.has(e.volunteerProfileId))
    .sort((a, b) => a.shiftDate.localeCompare(b.shiftDate) ||
      persons.get(a.volunteerProfileId)!.name.localeCompare(persons.get(b.volunteerProfileId)!.name) ||
      (a.startTime ?? '').localeCompare(b.startTime ?? ''));
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const lastChanged = (d: Date) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(d);
  return [['Date', 'Volunteer', 'Shift', 'Hours', 'Entered by', 'Note', 'Last changed'],
    ...rows.map(e => {
      const person = persons.get(e.volunteerProfileId)!;
      const slot = schedule.slots.find(s => s.id === e.shiftSlotId);
      const label = e.source === 'other' ? 'Other time' : e.source === 'one_time'
        ? schedule.customShifts?.find(s => s.id === e.customShiftId)?.label ?? 'One-time shift'
        : `${weekdays[slot?.dayOfWeek ?? new Date(`${e.shiftDate}T12:00:00Z`).getUTCDay()]} ${(e.startTime ?? slot?.startTime ?? '').slice(0, 5)}–${(e.endTime ?? slot?.endTime ?? '').slice(0, 5)}`;
      return [e.shiftDate, person.name, label, Number(e.hours),
        e.enteredByUserId === person.userId ? 'Volunteer' : e.enteredByName, e.note, lastChanged(e.updatedAt)];
    })];
}
