import { z } from 'zod';
import { GetAdminHoursReportResponse } from '@workspace/api-zod';
import { normalizeVolunteerStatus } from '@workspace/shared/profileFields';
import { csvCell } from '../onboarding';
import { addCalendarDays, pacificDay, type ScheduleData } from './scheduleService';
import { loggableShifts, sameHoursShift } from './volunteerHours';

export class ReportError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export type ReportPerson = {
  profileId: string; userId: string; name: string; email: string; status: string; isTestAccount: boolean;
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
  const [year, m] = month.split('-').map(Number);
  return new Date(Date.UTC(year!, m! - 1 + offset, 1)).toISOString().slice(0, 7);
}
export function reportPeriod(value: unknown, now: Date) {
  const currentMonth = pacificDay(now).slice(0, 7);
  const month = value === undefined ? currentMonth : value;
  if (typeof month !== 'string' || !/^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(month))
    throw new ReportError(400, 'Choose a month in YYYY-MM format.');
  if (month > currentMonth) throw new ReportError(400, 'Choose the current month or an earlier month.');
  return { month, currentMonth, from: `${month}-01`,
    to: addCalendarDays(`${shiftMonth(month, 1)}-01`, -1), trendFrom: `${shiftMonth(month, -11)}-01` };
}
export function reportIncludeTest(value: unknown): boolean {
  if (value === undefined || value === 'false') return false;
  if (value === 'true') return true;
  throw new ReportError(400, 'Show test accounts must be true or false.');
}
type Report = z.infer<typeof GetAdminHoursReportResponse>;
/** Pure read projection, shared by JSON and both CSVs. Dates are Pacific calendar dates,
 * never UTC timestamps of when somebody happened to enter the hours.
 */
export function buildHoursReport(people: ReportPerson[], entries: ReportEntry[], schedule: ReportSchedule,
  now: Date, monthValue?: unknown, includeTest = false): Report {
  const period = reportPeriod(monthValue, now);
  const included = people.filter(p => includeTest || !p.isTestAccount);
  const ids = new Set(included.map(p => p.profileId));
  const history = entries.filter(e => ids.has(e.volunteerProfileId) &&
    e.shiftDate >= period.trendFrom && e.shiftDate <= period.to);
  const selected = history.filter(e => e.shiftDate >= period.from);
  const volunteers = included.flatMap(p => {
    const rows = selected.filter(e => e.volunteerProfileId === p.profileId);
    const missed = loggableShifts(schedule, p.profileId, p.status, now, { from: period.from, to: period.to })
      .filter(s => !rows.some(row => sameHoursShift(s, { ...row, date: row.shiftDate }))).length;
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
  const trend = Array.from({ length: 12 }, (_, i) => {
    const month = shiftMonth(period.month, i - 11), rows = history.filter(e => e.shiftDate.startsWith(month));
    return { month, teamHours: rows.reduce((sum, row) => sum + Number(row.hours), 0),
      volunteersWithHours: new Set(rows.map(row => row.volunteerProfileId)).size };
  });
  return { month: period.month, currentMonth: period.currentMonth, totals, volunteers, trend };
}
const csv = (rows: unknown[][]) => '\ufeff' + rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
export function hoursByVolunteerCsv(report: Report, people: ReportPerson[]) {
  const emails = new Map(people.map(p => [p.userId, p.email]));
  return csv([['Volunteer', 'Email', 'Status', 'Hours logged', 'Shifts logged', 'Other time entries', 'Shifts not logged', 'Last logged'],
    ...report.volunteers.map(p => [p.name, emails.get(p.userId), p.status, p.hours, p.shiftsLogged,
      p.otherEntries, p.shiftsNotLogged, p.lastLoggedDate]),
    ['Team total', '', '', report.totals.teamHours, report.totals.shiftsLogged,
      report.totals.otherEntries, report.totals.shiftsNotLogged, '']]);
}
export function hourEntriesCsv(report: Report, people: ReportPerson[], entries: ReportEntry[], schedule: ReportSchedule) {
  const ids = new Set(report.volunteers.map(p => p.userId));
  const persons = new Map(people.filter(p => ids.has(p.userId)).map(p => [p.profileId, p]));
  const rows = entries.filter(e => e.shiftDate.startsWith(report.month) && persons.has(e.volunteerProfileId))
    .sort((a, b) => a.shiftDate.localeCompare(b.shiftDate) ||
      persons.get(a.volunteerProfileId)!.name.localeCompare(persons.get(b.volunteerProfileId)!.name) ||
      (a.startTime ?? '').localeCompare(b.startTime ?? ''));
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const lastChanged = (d: Date) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(d);
  return csv([['Date', 'Volunteer', 'Shift', 'Hours', 'Entered by', 'Note', 'Last changed'],
    ...rows.map(e => {
      const person = persons.get(e.volunteerProfileId)!;
      const slot = schedule.slots.find(s => s.id === e.shiftSlotId);
      const label = e.source === 'other' ? 'Other time' : e.source === 'one_time'
        ? schedule.customShifts?.find(s => s.id === e.customShiftId)?.label ?? 'One-time shift'
        : `${weekdays[slot?.dayOfWeek ?? new Date(`${e.shiftDate}T12:00:00Z`).getUTCDay()]} ${(e.startTime ?? slot?.startTime ?? '').slice(0, 5)}–${(e.endTime ?? slot?.endTime ?? '').slice(0, 5)}`;
      return [e.shiftDate, person.name, label, Number(e.hours),
        e.enteredByUserId === person.userId ? 'Volunteer' : e.enteredByName, e.note, lastChanged(e.updatedAt)];
    })]);
}
