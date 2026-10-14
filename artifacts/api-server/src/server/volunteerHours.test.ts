import { describe, expect, it } from 'vitest';
import { loggableShifts } from './volunteerHours';
import { slotInstant, type ScheduleData } from './scheduleService';

function fixture(): ScheduleData {
  return {
    slots: [{ id: 'slot', dayOfWeek: 2, startTime: '10:00', endTime: '12:00', capacity: 2, label: null, isActive: true }],
    assignments: [{ id: 'assignment', shiftSlotId: 'slot', volunteerProfileId: 'mine', startDate: '2026-01-01', endDate: null }],
    skips: [], closedDates: [], blocks: [],
    customShifts: [{ id: 'custom', date: '2026-10-20', startTime: '12:00', endTime: '13:30', label: 'Callbacks', capacity: 1, openToVolunteers: true, cancelledAt: null }],
    customAssignments: [{ id: 'claim', customShiftId: 'custom', volunteerProfileId: 'mine', cancelledAt: null }],
  };
}
const now = new Date('2026-10-20T21:00:00Z');
describe('one shared ended-shift hours helper', () => {
  it('includes ended standing and one-time shifts with actual lengths, newest first', () => {
    const shifts = loggableShifts(fixture(), 'mine', 'active', now);
    expect(shifts[0]).toMatchObject({ source: 'one_time', customShiftId: 'custom', defaultHours: 1.5 });
    expect(shifts.find(s => s.date === '2026-10-20' && s.source === 'standing')).toMatchObject({ defaultHours: 2 });
    expect(shifts.every(s => s.date >= '2026-10-07')).toBe(true);
  });
  it.each(['skip', 'block', 'closed', 'claim-cancelled', 'shift-cancelled', 'other-person', 'not-ended'] as const)('excludes %s', reason => {
    const d = fixture();
    let at = now;
    if (reason === 'skip') d.skips = [{ shiftAssignmentId: 'assignment', skipDate: '2026-10-20' }];
    if (reason === 'block') d.blocks = [{ shiftSlotId: 'slot', date: '2026-10-20', reason: 'Training' }];
    if (reason === 'closed') d.closedDates = [{ date: '2026-10-20' }];
    if (reason === 'claim-cancelled') d.customAssignments![0]!.cancelledAt = now;
    if (reason === 'shift-cancelled') d.customShifts![0]!.cancelledAt = now;
    if (reason === 'other-person') d.assignments = [{ ...d.assignments[0]!, volunteerProfileId: 'someone-else' }];
    if (reason === 'not-ended') at = new Date('2026-10-20T18:59:59Z');
    const shifts = loggableShifts(d, 'mine', 'active', at);
    expect(shifts.filter(s => s.date === '2026-10-20' &&
      (reason.includes('cancelled') ? s.source === 'one_time' : s.source === 'standing'))).toEqual([]);
  });
  it('does not include shifts older than the Pacific 14-day window or onboarding shifts', () => {
    expect(loggableShifts(fixture(), 'mine', 'active', now).some(s => s.date === '2026-10-06')).toBe(false);
    expect(loggableShifts(fixture(), 'mine', 'onboarding', now)).toEqual([]);
  });
  it('keeps served shifts before admin inactivation, but not occurrences ending after removal', () => {
    const d = fixture();
    const assignments = [{ ...d.assignments[0]!, endedReason: 'admin_removed', endDate: '2026-10-20',
      updatedAt: new Date('2026-10-20T20:00:00Z') }];
    expect(loggableShifts({ ...d, assignments }, 'mine', 'inactive', now).some(s => s.date === '2026-10-20')).toBe(true);
    assignments[0]!.updatedAt = new Date('2026-10-20T18:00:00Z');
    expect(loggableShifts({ ...d, assignments }, 'mine', 'inactive', now).some(s => s.date === '2026-10-20' && s.source === 'standing')).toBe(false);
  });
  it.each([['2026-03-03', '20'], ['2026-03-10', '19'], ['2026-10-27', '19'], ['2026-11-03', '20']])(
    'uses Pacific end times across DST: %s', (date, endHour) => {
      const d = fixture();
      const end = slotInstant(date!, '12:00');
      expect(end.toISOString()).toContain(`T${endHour}:00`);
      expect(loggableShifts(d, 'mine', 'active', new Date(end.getTime() - 1)).some(s => s.date === date)).toBe(false);
      expect(loggableShifts(d, 'mine', 'active', end).find(s => s.date === date)?.defaultHours).toBe(2);
    });
});
