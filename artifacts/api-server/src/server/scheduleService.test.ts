import { describe, it, expect } from 'vitest';
import { createScheduleService, type ScheduleData, type ScheduleSlot, pacificDay } from './scheduleService';
import { upcomingOccurrences } from '../volunteer-shifts';
const monday: ScheduleSlot = { id: 'mon', dayOfWeek: 1, startTime: '09:00', endTime: '11:00', capacity: 2, label: null, isActive: true };
const empty: ScheduleData = { slots: [monday], assignments: [], skips: [], closedDates: [] };
const standing = { id: 'a', shiftSlotId: 'mon', volunteerProfileId: 'v1', startDate: '2026-01-01', endDate: null };
describe('Pacific schedule service', () => {
  it('honors inclusive starts/ends, future starts, and immediately cancelled reservations', () => {
    const s = createScheduleService({ ...empty, assignments: [
      { ...standing, startDate: '2026-10-05', endDate: '2026-10-12' },
      { ...standing, id: 'future', volunteerProfileId: 'v2', startDate: '2026-10-12' },
      { ...standing, id: 'cancelled', volunteerProfileId: 'v3', endedReason: 'admin_removed', endDate: '2026-10-12' },
    ] });
    expect(s.getOccurrences('2026-09-28', '2026-09-28')[0]!.assignedVolunteers).toHaveLength(0);
    expect(s.getOccurrences('2026-10-05', '2026-10-05')[0]!.assignedVolunteers.map(a => a.volunteerProfileId)).toEqual(['v1']);
    expect(s.getOccurrences('2026-10-12', '2026-10-12')[0]!.assignedVolunteers).toHaveLength(2);
    expect(s.getOccurrences('2026-10-19', '2026-10-19')[0]!.assignedVolunteers.map(a => a.volunteerProfileId)).toEqual(['v2']);
  });
  it('skip removes only that assignment; closure suppresses occurrences, current/next, and gap candidates', () => {
    const data = { ...empty, assignments: [standing], skips: [{ shiftAssignmentId: 'a', skipDate: '2026-10-05' }],
      closedDates: [{ date: '2026-10-12' }] };
    const s = createScheduleService(data);
    expect(s.getCoverage('2026-10-05')[0]).toMatchObject({ assignedCount: 0, capacity: 2, empty: true, underCapacity: true });
    expect(s.getOccurrences('2026-10-12', '2026-10-12')).toEqual([]);
    expect(s.getCoverage('2026-10-12')).toEqual([]);
    expect(s.getOnShiftNow(new Date('2026-10-12T16:30:00Z'))).toEqual([]);
    expect(s.getUpNext(new Date('2026-10-11T00:00:00Z'))[0]!.date).toBe('2026-10-19');
  });
  it('inactive slots vanish even with assignments; scheduled retirement keeps the last day inclusive', () => {
    expect(createScheduleService({ ...empty, slots: [{ ...monday, isActive: false }], assignments: [standing] })
      .getOccurrences('2026-10-05', '2026-10-05')).toEqual([]);
    const s = createScheduleService({ ...empty, slots: [{ ...monday, retireAfterDate: '2026-10-05' }], assignments: [standing] });
    expect(s.getOccurrences('2026-10-05', '2026-10-12')).toHaveLength(1);
    expect(s.getCoverage('2026-10-12')).toEqual([]);
  });
  it('includes all overlapping slots; half-open now intervals and tied up-next starts', () => {
    const s = createScheduleService({ ...empty, slots: [monday, { ...monday, id: 'overlap', startTime: '10:00', endTime: '12:00' },
      { ...monday, id: 'same-start' }] });
    expect(s.getOnShiftNow(new Date('2026-10-05T17:30:00Z'))).toHaveLength(3);
    expect(s.getOnShiftNow(new Date('2026-10-05T18:00:00Z')).map(o => o.slot.id)).toEqual(['overlap']);
    expect(s.getUpNext(new Date('2026-10-05T15:59:59Z'))).toHaveLength(2);
  });
  it('spring DST week preserves 09:00 local and changes UTC offset after Sunday', () => {
    const s = createScheduleService({ ...empty, slots: [monday, { ...monday, id: 'fri', dayOfWeek: 5 }] });
    const rows = s.getOccurrences('2026-03-02', '2026-03-13');
    expect(rows.map(o => o.startsAt.toISOString())).toEqual([
      '2026-03-02T17:00:00.000Z', '2026-03-06T17:00:00.000Z', '2026-03-09T16:00:00.000Z', '2026-03-13T16:00:00.000Z',
    ]);
    expect(s.getCoverage('2026-03-02')).toHaveLength(2);
    expect(s.getCoverage('2026-03-09')).toHaveLength(2);
  });
  it('fall DST week preserves 09:00 local and changes UTC offset after Sunday', () => {
    const s = createScheduleService({ ...empty, slots: [monday, { ...monday, id: 'fri', dayOfWeek: 5 }] });
    expect(s.getOccurrences('2026-10-26', '2026-11-06').map(o => o.startsAt.toISOString())).toEqual([
      '2026-10-26T16:00:00.000Z', '2026-10-30T16:00:00.000Z', '2026-11-02T17:00:00.000Z', '2026-11-06T17:00:00.000Z',
    ]);
    expect(s.getCoverage('2026-10-26')).toHaveLength(2);
    expect(s.getCoverage('2026-11-02')).toHaveLength(2);
  });
  it('uses Pacific day near UTC midnight and supports injected default clock', () => {
    const at = new Date('2026-10-06T06:30:00Z');
    const s = createScheduleService({ ...empty, slots: [{ ...monday, startTime: '23:00', endTime: '23:59' }] }, () => at);
    expect(pacificDay(at)).toBe('2026-10-05');
    expect(s.getOnShiftNow()).toHaveLength(1);
    expect(s.getOnShiftNow()[0]!.date).toBe('2026-10-05');
  });
  it('capacity counts people, not duplicate assignment rows; full/empty/under flags are exact', () => {
    const s = createScheduleService({ ...empty, assignments: [standing, { ...standing, id: 'duplicate' }] });
    expect(s.getCoverage('2026-10-05')[0]).toMatchObject({ assignedCount: 1, capacity: 2, empty: false, underCapacity: true });
    expect(createScheduleService({ ...empty, assignments: [standing, { ...standing, id: 'b', volunteerProfileId: 'v2' }] })
      .getCoverage('2026-10-05')[0]).toMatchObject({ assignedCount: 2, empty: false, underCapacity: false });
  });
  it('rejects invalid/rolling calendar dates and reversed/excessive ranges', () => {
    const s = createScheduleService(empty);
    expect(() => s.getOccurrences('2026-02-30', '2026-03-01')).toThrow();
    expect(() => s.getOccurrences('2026-10-06', '2026-10-05')).toThrow();
    expect(() => s.getOccurrences('2026-01-01', '2028-01-01')).toThrow();
  });
  it('does not mutate inputs or share mutable output/Date objects with later calls', () => {
    const data = { ...empty, assignments: [standing] }, before = JSON.stringify(data);
    const s = createScheduleService(data), first = s.getOccurrences('2026-10-05', '2026-10-05');
    first[0]!.slot.capacity = 10; first[0]!.startsAt.setUTCFullYear(1900); first[0]!.assignedVolunteers.length = 0;
    expect(JSON.stringify(data)).toBe(before);
    expect(s.getOccurrences('2026-10-05', '2026-10-05')[0]).toMatchObject({ slot: { capacity: 2 }, assignedVolunteers: [{ volunteerProfileId: 'v1' }] });
  });
  it('own dashboard projection uses real slot/person identities rather than duplicating overlapping reservation rows', () => {
    const slot = { dayOfWeek: 1, startTime: '09:00', endTime: '11:00', label: null, endDate: null,
      shiftSlotId: 'same-slot', volunteerProfileId: 'own-profile', startDate: '2026-01-01' };
    const upcoming = upcomingOccurrences([{ ...slot, assignmentId: 'a' }, { ...slot, assignmentId: 'b' }],
      new Set(), new Set(), new Date('2026-10-05T15:00:00Z'), 4);
    expect(upcoming).toHaveLength(4); expect(new Set(upcoming.map(o => o.date)).size).toBe(4);
    expect(upcoming[0]!.assignmentId).toBe('a');
  });
});
