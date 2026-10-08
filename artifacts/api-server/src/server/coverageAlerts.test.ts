import { beforeAll, describe, expect, it } from 'vitest';
import { slotInstant, type ScheduleData } from './scheduleService';
process.env.NODE_ENV = 'development';
let alerts: typeof import('./coverageAlerts');
beforeAll(async () => { alerts = await import('./coverageAlerts'); });
const now = slotInstant('2026-10-05', '07:00');
const slot = { id: 'slot', dayOfWeek: 2, startTime: '09:00', endTime: '11:00', capacity: 2, label: null, isActive: true };
const a = { id: 'a', shiftSlotId: 'slot', volunteerProfileId: 'p', startDate: '2026-10-01', endDate: null };
const data: ScheduleData = { slots: [slot], assignments: [a], skips: [], closedDates: [] };
const event = { volunteerProfileId: 'p', assignmentIds: ['a'], shiftSlotIds: ['slot'], effectiveDate: '2026-10-05', activityId: 'event' };
describe('Coverage alert windows and Pacific scheduling', () => {
  it('combines only newly reduced occurrences below capacity within fourteen days', () => {
    const changed = { ...data, assignments: [{ ...a, endDate: '2026-10-04', endedReason: 'dropped' }] };
    const gaps = alerts.releaseGaps(changed, event, 'shift_drop', { oldEndDate: null }, now);
    expect(gaps.map(o => o.date)).toEqual(['2026-10-06', '2026-10-13']);
    expect(alerts.gapLine(gaps[0]!)).toContain('0 of 2');
    expect(alerts.releaseGaps({ ...changed, assignments: [] }, event, 'shift_drop', {}, now)).toHaveLength(0);
  });
  it('limits week-off alerts to seven days and only the selected date', () => {
    const changed = { ...data, skips: [{ shiftAssignmentId: 'a', skipDate: '2026-10-06' }] };
    expect(alerts.releaseGaps(changed, event, 'shift_skip', { date: '2026-10-06' }, now)).toHaveLength(1);
    expect(alerts.releaseGaps({ ...data, skips: [{ shiftAssignmentId: 'a', skipDate: '2026-10-13' }] },
      event, 'admin_shift_skip', { date: '2026-10-13' }, now)).toHaveLength(0);
  });
  it('does not alert closures, inactive slots, expired assignments, or a still-covered over-capacity slot', () => {
    const ended = { ...a, endDate: '2026-10-05', endedReason: 'admin_removed' };
    expect(alerts.releaseGaps({ ...data, assignments: [ended], closedDates: [{ date: '2026-10-06' }, { date: '2026-10-13' }] },
      event, 'admin_shift_remove', { previousAssignments: [a] }, now)).toHaveLength(0);
    expect(alerts.gaps({ ...data, slots: [{ ...slot, isActive: false }] }, now, 7)).toHaveLength(0);
    expect(alerts.releaseGaps({ ...data, assignments: [ended] }, event, 'admin_shift_remove',
      { previousAssignments: [{ ...a, endDate: '2026-10-05' }] }, now)).toHaveLength(0);
    const others = [1, 2].map(i => ({ ...a, id: `b${i}`, volunteerProfileId: `other${i}` }));
    expect(alerts.releaseGaps({ ...data, assignments: [ended, ...others] }, event, 'admin_shift_remove',
      { previousAssignments: [a] }, now)).toHaveLength(0);
  });
  it('fires at seven Pacific, not six, through both DST seasons and never on weekends', () => {
    for (const date of ['2026-03-09', '2026-11-02']) {
      expect(alerts.digestDue(slotInstant(date, '06:59'))).toBe(false);
      expect(alerts.digestDue(slotInstant(date, '07:00'))).toBe(true);
    }
    expect(alerts.digestDue(slotInstant('2026-11-01', '07:00'))).toBe(false);
    expect(alerts.digestDue(slotInstant('2026-10-10', '07:00'))).toBe(false);
  });
});
