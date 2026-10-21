import { describe, it, expect } from 'vitest';
import { createScheduleService, slotInstant, type ScheduleData } from './scheduleService';
import { volunteerScheduleView } from './volunteerScheduleView';
const slot = { id: 'slot', dayOfWeek: 1, startTime: '09:00', endTime: '11:00', capacity: 1, label: null, isActive: true };
const profile = { status: 'active', agreementAcknowledgedAt: new Date(), agreementVersion: '1' };
const once = { id: 'once', shiftSlotId: 'slot', volunteerProfileId: 'mine', startDate: '2026-11-02', endDate: '2026-11-02' };
const data = { slots: [slot], assignments: [once], skips: [], closedDates: [], customShifts: [], customAssignments: [] };
describe('Single-date assignments use the existing occurrence, reminder and hours schedule', () => {
  it('occurs once across Pacific DST, without adding an occurrence the following week', () => {
    const occurrences = createScheduleService(data).getOccurrences('2026-10-26', '2026-11-16');
    expect(occurrences.filter(o => o.assignedVolunteers.length).map(o => o.date)).toEqual(['2026-11-02']);
    expect(slotInstant('2026-11-02', '09:00').toISOString()).toBe('2026-11-02T17:00:00.000Z');
  });
  it('offers the seat in other weeks without exposing other volunteers or blocking a standing seat', () => {
    const view = volunteerScheduleView(data, 'other', profile, null, new Date('2026-10-25T12:00:00Z'), '1');
    expect(view.slots[0]!.openSpots).toBe(1);
    expect(view.slots[0]!.oneTimeDates.map(d => d.date)).not.toContain('2026-11-02');
    expect(view.slots[0]!.oneTimeDates.map(d => d.date)).toContain('2026-11-09');
    expect(JSON.stringify(view)).not.toContain('"mine"');
  });
  it('honors closed dates, blocked dates and a weekly volunteer taking a week off', () => {
    const snapshot = { ...data, assignments: [{ ...once, id: 'weekly', endDate: null }],
      skips: [{ id: 'skip', shiftAssignmentId: 'weekly', skipDate: '2026-11-02' }],
      closedDates: [{ date: '2026-11-09' }], blocks: [{ shiftSlotId: 'slot', date: '2026-11-16', reason: 'Training' }] };
    const view = volunteerScheduleView(snapshot, 'other', profile, null, new Date('2026-10-25T12:00:00Z'), '1');
    expect(view.slots[0]!.oneTimeDates.map(d => d.date)).toEqual(['2026-10-26', '2026-11-02']);
  });
  it('does not offer a date that overlaps the caller’s custom shift', () => {
    const snapshot: ScheduleData = { ...data, assignments: [],
      customShifts: [{ id: 'custom', date: '2026-11-02', startTime: '10:00', endTime: '12:00', capacity: 1, label: null, openToVolunteers: true, cancelledAt: null }],
      customAssignments: [{ id: 'claim', customShiftId: 'custom', volunteerProfileId: 'mine', cancelledAt: null }] };
    const view = volunteerScheduleView({ ...snapshot, skips: [] }, 'mine', profile, null, new Date('2026-10-25T12:00:00Z'), '1');
    expect(view.slots[0]!.oneTimeDates.map(d => d.date)).not.toContain('2026-11-02');
  });
});
