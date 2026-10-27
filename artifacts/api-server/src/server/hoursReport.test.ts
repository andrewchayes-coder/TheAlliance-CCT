import { describe, expect, it } from 'vitest';
import { buildHoursReport, hourEntriesCsv, hoursByVolunteerCsv, reportIncludeTest, reportPeriod,
  type ReportPerson, type ReportEntry, type ReportSchedule } from './hoursReport';
import { slotInstant } from './scheduleService';
import { pacificReportDay, presetReportRange } from '@workspace/shared/reportingPeriod';
import { reportWorkbook } from './hoursReportExcel';
import { hourEntriesRows, hoursByVolunteerRows, ReportError } from './hoursReport';
import ExcelJS from 'exceljs';

const now = new Date('2026-11-01T01:01:00Z'); // Oct 31, 6:01 PM Pacific
const person: ReportPerson = { profileId: 'p', userId: 'u', name: 'Pat Resource', email: 'pat@example.invalid',
  status: 'active', isTestAccount: false };
const testPerson = { ...person, profileId: 'test-p', userId: 'test-u', name: 'Test Resource', isTestAccount: true };
function schedule(): ReportSchedule {
  return { slots: [{ id: 'slot', dayOfWeek: 6, startTime: '16:00', endTime: '18:00',
    capacity: 2, label: null, isActive: true }],
  assignments: [{ id: 'a', volunteerProfileId: 'p', shiftSlotId: 'slot', startDate: '2026-10-01', endDate: null }],
  skips: [], closedDates: [], blocks: [],
  customShifts: [{ id: 'c', date: '2026-10-20', startTime: '10:00', endTime: '12:00',
    label: 'Community callbacks', capacity: 2, openToVolunteers: true, cancelledAt: null }],
  customAssignments: [{ id: 'claim', customShiftId: 'c', volunteerProfileId: 'p', cancelledAt: null }] };
}
function entry(overrides: Partial<ReportEntry> = {}): ReportEntry {
  return { volunteerProfileId: 'p', shiftDate: '2026-10-31', source: 'standing',
    shiftSlotId: 'slot', customShiftId: null, startTime: '16:00', endTime: '18:00', hours: '2.00',
    enteredByUserId: 'u', enteredByName: 'Pat Resource', note: null, updatedAt: now, ...overrides };
}
function report(entries: ReportEntry[] = [], s = schedule(), at = now, people = [person], includeTest = false) {
  return buildHoursReport(people, entries, s, at, undefined, includeTest);
}
describe('Pacific monthly hours report', () => {
  it('defaults to the Pacific month, keeps late afternoon on the last day in October, and counts history beyond 14 days', () => {
    const r = report([entry()]);
    expect(r.month).toBe('2026-10');
    expect(r.totals).toEqual({ teamHours: 2, volunteersWithHours: 1, shiftsLogged: 1, otherEntries: 0, shiftsNotLogged: 5 });
    expect(r.volunteers[0]).toMatchObject({ hours: 2, lastLoggedDate: '2026-10-31' });
    expect(r.trend).toHaveLength(12);
    expect(r.trend[0]!.month).toBe('2025-11');
    expect(r.trend[11]).toMatchObject({ month: '2026-10', teamHours: 2, volunteersWithHours: 1 });
    expect(reportPeriod(undefined, new Date('2026-11-01T07:00:00Z')).month).toBe('2026-11');
  });
  it('counts other entries, inactive and deactivated volunteers, and each volunteer only once in trend', () => {
    const r = report([entry(), entry({ source: 'other', shiftSlotId: null, hours: '1.25', shiftDate: '2026-10-01' }),
      entry({ shiftDate: '2026-09-30', hours: '3.5' })], schedule(), now, [{ ...person, status: 'inactive' }]);
    expect(r.totals).toMatchObject({ teamHours: 3.25, volunteersWithHours: 1, otherEntries: 1, shiftsLogged: 1 });
    expect(r.volunteers[0]!.status).toBe('inactive');
    expect(r.trend[10]).toMatchObject({ month: '2026-09', teamHours: 3.5, volunteersWithHours: 1 });
    expect(r.trend[11]!.volunteersWithHours).toBe(1);
  });
  it('includes an unlogged-only volunteer; excludes people with neither hours nor ended occurrences', () => {
    const r = report([], schedule(), now, [person, { ...person, profileId: 'empty', userId: 'empty' }]);
    expect(r.volunteers).toHaveLength(1);
    expect(r.volunteers[0]).toMatchObject({ hours: 0, shiftsNotLogged: 6, lastLoggedDate: null });
    expect(r.totals.volunteersWithHours).toBe(0);
  });
  it.each(['skip', 'blocked', 'closed', 'cancelled-claim', 'cancelled-custom', 'unassigned'] as const)(
    'does not count %s occurrences as not logged', reason => {
      const s = schedule();
      if (reason === 'skip') s.skips = [{ shiftAssignmentId: 'a', skipDate: '2026-10-31' }];
      if (reason === 'blocked') s.blocks = [{ shiftSlotId: 'slot', date: '2026-10-31', reason: 'Closed slot' }];
      if (reason === 'closed') s.closedDates = [{ date: '2026-10-31' }];
      if (reason === 'cancelled-claim') s.customAssignments![0]!.cancelledAt = now;
      if (reason === 'cancelled-custom') s.customShifts![0]!.cancelledAt = now;
      if (reason === 'unassigned') s.assignments = [{ ...s.assignments[0]!, startDate: '2026-10-04' }];
      expect(report([], s).totals.shiftsNotLogged).toBe(5);
    });
  it('does not count shifts later today, but includes them at the end instant', () => {
    const end = slotInstant('2026-10-31', '18:00');
    expect(report([], schedule(), new Date(end.getTime() - 1)).totals.shiftsNotLogged).toBe(5);
    expect(report([], schedule(), end).totals.shiftsNotLogged).toBe(6);
  });
  it.each(['2026-03-08', '2026-11-01'])('preserves Pacific boundaries and ended rules across DST on %s', date => {
    const s = schedule();
    s.slots = [{ ...s.slots[0]!, dayOfWeek: 0 }];
    s.assignments = [{ ...s.assignments[0]!, startDate: date }];
    s.customShifts = []; s.customAssignments = [];
    const end = slotInstant(date!, '18:00');
    expect(report([], s, new Date(end.getTime() - 1)).totals.shiftsNotLogged).toBe(0);
    expect(report([], s, end).totals.shiftsNotLogged).toBe(1);
  });
  it('excludes test users by default in totals, volunteers, unlogged and every trend month', () => {
    const s = schedule();
    s.assignments = [...s.assignments, { ...s.assignments[0]!, id: 'ta', volunteerProfileId: 'test-p' }];
    const rows = [entry(), entry({ volunteerProfileId: 'test-p', hours: '4' })];
    const excluded = report(rows, s, now, [person, testPerson]);
    expect(excluded.totals.teamHours).toBe(2);
    expect(excluded.volunteers).toHaveLength(1);
    expect(excluded.trend.at(-1)!.teamHours).toBe(2);
    const included = report(rows, s, now, [person, testPerson], true);
    expect(included.totals.teamHours).toBe(6);
    expect(included.volunteers).toHaveLength(2);
    expect(included.totals.shiftsNotLogged).toBe(9);
  });
  it.each(['2026-11', '2026-13', '2026-00', '2026-1', '', ['2026-10']])('refuses invalid/future month %s with 400', month => {
    expect(() => reportPeriod(month, now)).toThrow();
    try { reportPeriod(month, now); } catch (e) { expect(e).toMatchObject({ status: 400 }); }
  });
  it('validates test flag explicitly, not truthiness', () => {
    expect(reportIncludeTest('false')).toBe(false);
    expect(reportIncludeTest('true')).toBe(true);
    expect(reportIncludeTest(undefined)).toBe(false);
    expect(() => reportIncludeTest('yes')).toThrow();
  });
});
describe('inclusive Pacific reporting periods', () => {
  it.each([
    ['Today', '2026-10-31', '2026-10-31', '2026-10-31'],
    ['This Week', '2026-10-31', '2026-10-26', '2026-10-31'],
    ['This Week', '2026-11-01', '2026-10-26', '2026-11-01'],
    ['This Week', '2026-11-02', '2026-11-02', '2026-11-02'],
    ['Last Week', '2026-11-02', '2026-10-26', '2026-11-01'],
    ['Last Week', '2026-01-01', '2025-12-22', '2025-12-28'],
    ['This Month', '2026-10-15', '2026-10-01', '2026-10-15'],
    ['Last Month', '2024-03-01', '2024-02-01', '2024-02-29'],
    ['Last Month', '2026-01-01', '2025-12-01', '2025-12-31'],
  ] as const)('%s on %s is %s through %s', (preset, today, startDate, endDate) => {
    expect(presetReportRange(preset, today)).toEqual({ startDate, endDate });
  });
  it.each([
    { startDate: '2026-10-01' }, { endDate: '2026-10-01' },
    { startDate: '', endDate: '' },
    { startDate: '2025-02-29', endDate: '2025-03-01' },
    { startDate: '2026-04-31', endDate: '2026-05-01' },
    { startDate: '2026-10-20', endDate: '2026-10-01' },
    { startDate: '2026-10-01', endDate: '2026-11-01' },
    { startDate: ['2026-10-01'], endDate: '2026-10-31' },
    { month: '2026-10', startDate: '2026-10-01', endDate: '2026-10-31' },
  ])('rejects invalid range %j', range => {
    expect(() => reportPeriod(range, now)).toThrow(ReportError);
  });
  it('accepts leap dates and long ranges without a short arbitrary limit', () => {
    expect(reportPeriod({ startDate: '2024-02-29', endDate: '2026-10-31' }, now).from).toBe('2024-02-29');
    expect(buildHoursReport([], [], schedule(), now, { startDate: '0001-01-01', endDate: '0001-01-02' }).trend[0])
      .toMatchObject({ month: '0001-01', startDate: '0001-01-01', endDate: '0001-01-02', partial: true });
    const s = schedule();
    s.assignments = [{ ...s.assignments[0]!, startDate: '2024-02-29' }];
    const count = (startDate: string, endDate: string) => buildHoursReport([person], [], s, now, { startDate, endDate }).totals.shiftsNotLogged;
    expect(count('2024-02-29', '2026-10-31')).toBe(count('2024-02-29', '2024-12-31') + count('2025-01-01', '2025-12-31') + count('2026-01-01', '2026-10-31'));
  });
  it('keeps legacy full month distinct from this-month through today', () => {
    const at = new Date('2026-10-15T20:00:00Z');
    expect(reportPeriod(undefined, at).to).toBe('2026-10-31');
    expect(reportPeriod(presetReportRange('This Month', pacificReportDay(at)), at).to).toBe('2026-10-15');
  });
  it.each(['2026-03-08T07:59:00Z', '2026-03-08T08:00:00Z', '2026-11-01T06:59:00Z', '2026-11-01T07:00:00Z'])('uses Pacific midnight across DST: %s', iso => {
    const at = new Date(iso), today = pacificReportDay(at);
    const p = reportPeriod(presetReportRange('Today', today), at);
    expect(p.from).toBe(pacificReportDay(at));
    expect(p.to).toBe(p.from);
    expect(p.metadata.timezone).toBe('America/Los_Angeles');
  });
  it('clips monthly rows, totals, details, missed shifts and test users to the same inclusive endpoints', () => {
    const entries = ['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-03', '2026-10-04'].map(shiftDate => entry({ shiftDate }));
    entries.push(entry({ volunteerProfileId: 'test-p', shiftDate: '2026-10-01', hours: 4 }));
    const range = { startDate: '2026-09-30', endDate: '2026-10-03' };
    const r = buildHoursReport([person, testPerson], entries, schedule(), now, range);
    expect(r.totals).toMatchObject({ teamHours: 6, shiftsLogged: 3, shiftsNotLogged: 0 });
    expect(r.volunteers).toHaveLength(1);
    expect(r.trend).toEqual([
      { month: '2026-09', startDate: '2026-09-30', endDate: '2026-09-30', partial: true, teamHours: 2, volunteersWithHours: 1 },
      { month: '2026-10', startDate: '2026-10-01', endDate: '2026-10-03', partial: true, teamHours: 4, volunteersWithHours: 1 },
    ]);
    const rows = hourEntriesRows(r, [person, testPerson], entries, schedule());
    expect(rows.slice(1).map(row => row[0])).toEqual(['2026-09-30', '2026-10-01', '2026-10-03']);
    expect(buildHoursReport([person], [], schedule(), now, range).totals.shiftsNotLogged).toBe(1);
    const withTests = buildHoursReport([person, testPerson], entries, schedule(), now, range, true);
    expect(withTests.totals.teamHours).toBe(10);
    expect(hourEntriesRows(withTests, [person, testPerson], entries, schedule())).toHaveLength(5);
  });
  it('returns empty reports with only intersecting zero months', () => {
    const r = buildHoursReport([], [], schedule(), now, { startDate: '2026-08-01', endDate: '2026-09-30' });
    expect(r.volunteers).toEqual([]);
    expect(r.totals.teamHours).toBe(0);
    expect(r.trend.map(t => [t.month, t.partial, t.teamHours])).toEqual([['2026-08', false, 0], ['2026-09', false, 0]]);
  });
  it('excludes staff shift profiles and their hours even when test accounts are included', () => {
    const staff: ReportPerson = { ...person, role: 'admin', name: 'Staff coordinator' };
    const r = buildHoursReport([staff], [entry()], schedule(), now,
      { startDate: '2026-10-01', endDate: '2026-10-31' }, true);
    expect(r.volunteers).toEqual([]);
    expect(r.totals).toEqual({ teamHours: 0, volunteersWithHours: 0, shiftsLogged: 0, otherEntries: 0, shiftsNotLogged: 0 });
    expect(r.trend[0]!.teamHours).toBe(0);
    expect(hourEntriesRows(r, [staff], [entry()], schedule())).toHaveLength(1);
    expect(hoursByVolunteerRows(r, [staff])).toHaveLength(2);
  });
});
describe('real Excel workbooks', () => {
  it('shares CSV projections while keeping numbers typed and malicious text literal', async () => {
    const people = [{ ...person, name: '=HYPERLINK("bad")', email: '+evil@example.invalid' }];
    const entries = [entry({ note: '@SUM(1,2)\n"quoted"', source: 'other' })];
    const r = report(entries, schedule(), now, people);
    for (const rows of [hoursByVolunteerRows(r, people), hourEntriesRows(r, people, entries, schedule())]) {
      const buffer = await reportWorkbook('Report', rows);
      expect(buffer.subarray(0, 2).toString()).toBe('PK');
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(Uint8Array.from(buffer).buffer);
      const sheet = workbook.worksheets[0]!;
      rows.forEach((row, i) => row.forEach((value, j) => {
        const cell = sheet.getCell(i + 1, j + 1);
        expect(cell.value ?? '').toBe(value ?? '');
        expect(cell.formula).toBeUndefined();
        if (typeof value === 'number') expect(cell.type).toBe(ExcelJS.ValueType.Number);
      }));
      expect(sheet.getRow(1).font.bold).toBe(true);
    }
  });
});
describe('safe hours CSV exports', () => {
  it('includes BOM, exact headers, totals, and escaped formulas/quotes/newlines', () => {
    const people = [{ ...person, name: '=HYPERLINK("unsafe")', email: '+bad@example.invalid' }];
    const r = report([entry()], schedule(), now, people);
    const csv = hoursByVolunteerCsv(r, people);
    expect(csv.startsWith('\ufeff"Volunteer","Email","Status","Hours logged","Shifts logged","Other time entries","Shifts not logged","Last logged"\r\n')).toBe(true);
    expect(csv).toContain('"\'=HYPERLINK(""unsafe"")"');
    expect(csv).toContain('"Team total","","","2","1","0","5",""');
    expect(csv).toContain("\"'+bad@example.invalid\"");
  });
  it('sorts entries by shift date then name and labels standing, one-time and Other time plus actor and Pacific change time', () => {
    const entries = [entry(), entry({ shiftDate: '2026-10-20', source: 'one_time', shiftSlotId: null, customShiftId: 'c' }),
      entry({ shiftDate: '2026-10-01', source: 'other', shiftSlotId: null, note: '\t=evil,\n"note"',
        enteredByUserId: 'staff', enteredByName: '@Staff' })];
    const r = report(entries);
    const csv = hourEntriesCsv(r, [person], entries, schedule());
    expect(csv).toContain('"Date","Volunteer","Shift","Hours","Entered by","Note","Last changed"');
    expect(csv.indexOf('"2026-10-01"')).toBeLessThan(csv.indexOf('"2026-10-20"'));
    expect(csv.indexOf('"2026-10-20"')).toBeLessThan(csv.indexOf('"2026-10-31"'));
    expect(csv).toContain('"Sat 16:00–18:00"');
    expect(csv).toContain('"Community callbacks"');
    expect(csv).toContain('"Other time"');
    expect(csv).toContain('"Volunteer"');
    expect(csv).toContain('"\'@Staff"');
    expect(csv).toContain('PDT');
    expect(csv).toContain('10/31/2026');
    expect(csv).toContain('"\'\t=evil,\n""note"""');
  });
});
