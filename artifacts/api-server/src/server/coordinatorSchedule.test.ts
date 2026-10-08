import { describe, it, expect } from 'vitest';
import { coordinatorProjection, mondayOf, type CoordinatorPerson, type CoordinatorData } from './coordinatorSchedule';
const people: CoordinatorPerson[] = [
  { profileId: 'p1', userId: 'u1', firstName: 'Alex', lastName: 'Allen', email: 'alex@example.invalid', phone: '+15555550101',
    accountActive: true, profile: { status: 'active', certificationExpiresAt: null, backgroundCheckStatus: 'cleared',
      backgroundCheckSubmittedAt: null, onboardingCompletedAt: new Date('2026-01-01') } },
  { profileId: 'p2', userId: 'u2', firstName: 'Blair', lastName: 'Bell', email: 'blair@example.invalid', phone: null,
    accountActive: true, profile: { status: 'active', certificationExpiresAt: '2026-03-20', backgroundCheckStatus: 'pending',
      backgroundCheckSubmittedAt: '2026-01-01', onboardingCompletedAt: null } },
];
const base = (): CoordinatorData => ({
  slots: [{ id: 's1', dayOfWeek: 1, startTime: '09:00', endTime: '11:00', capacity: 2, label: null, isActive: true },
    { id: 's2', dayOfWeek: 1, startTime: '10:00', endTime: '12:00', capacity: 1, label: 'Overlap', isActive: true },
    { id: 's3', dayOfWeek: 2, startTime: '09:00', endTime: '11:00', capacity: 1, label: null, isActive: true }],
  assignments: [{ id: 'a1', shiftSlotId: 's1', volunteerProfileId: 'p1', startDate: '2026-01-01', endDate: null },
    { id: 'a2', shiftSlotId: 's1', volunteerProfileId: 'p2', startDate: '2026-03-09', endDate: null },
    { id: 'a3', shiftSlotId: 's2', volunteerProfileId: 'p1', startDate: '2026-01-01', endDate: null }],
  skips: [], closedDates: [],
});
describe('Coordinator projection', () => {
  it('normalizes Sunday and DST weeks to Monday without changing calendar dates', () => {
    expect(mondayOf('2026-03-08')).toBe('2026-03-02'); expect(mondayOf('2026-03-09')).toBe('2026-03-09');
    expect(mondayOf('2026-11-01')).toBe('2026-10-26'); expect(mondayOf('2026-11-02')).toBe('2026-11-02');
  });
  it('dispatch is half-open, includes overlapping slots and real contact details', () => {
    const d = coordinatorProjection(base(), people, new Date('2026-03-09T17:30:00Z')).overview();
    expect(d.operatingNow).toBe(true); expect(d.onShiftNow).toHaveLength(2);
    expect(d.onShiftNow[0]!.volunteers[0]!.phone).toBe('+15555550101');
    expect(d.onShiftNow[0]!.endsAt).toBe('2026-03-09T18:00:00.000Z');
    expect(coordinatorProjection(base(), people, new Date('2026-03-09T18:00:00Z')).overview().onShiftNow).toHaveLength(1);
    expect(d.needsAttention).toBe(1);
  });
  it('distinguishes empty operating hours from outside hours and closed days', () => {
    const data = base(); data.assignments = [];
    const at = new Date('2026-03-09T16:30:00Z');
    const empty = coordinatorProjection(data, people, at).overview();
    expect(empty.operatingNow).toBe(true); expect(empty.onShiftNow[0]!.volunteers).toEqual([]);
    expect(coordinatorProjection(data, people, new Date('2026-03-09T15:59:00Z')).overview().operatingNow).toBe(false);
    data.closedDates = [{ date: '2026-03-09', reason: 'Office closed' }];
    expect(coordinatorProjection(data, people, at).overview().operatingNow).toBe(false);
  });
  it('up next includes all simultaneous occurrences with Pacific DST start instants', () => {
    const data = base(); data.slots[1]!.startTime = '09:00';
    const next = coordinatorProjection(data, people, new Date('2026-03-09T15:59:00Z')).overview().upNext;
    expect(next).toHaveLength(2); expect(next.every(o => o.startsAt === '2026-03-09T16:00:00.000Z')).toBe(true);
  });
  it('week off remains visible but excluded from occupancy and coverage; ended/future assignments respected', () => {
    const data = base(); data.skips = [{ shiftAssignmentId: 'a1', skipDate: '2026-03-09' }];
    const d = coordinatorProjection(data, people, new Date('2026-03-09T17:30:00Z')).week('2026-03-11');
    const first = d.blocks.find(b => b.slotId === 's1')!;
    expect(first.assignedCount).toBe(1); expect(first.openSpots).toBe(1); expect(first.state).toBe('under');
    expect(first.volunteers.find(v => v.userId === 'u1')!.skipped).toBe(true);
    expect(first.volunteers.find(v => v.userId === 'u2')!.skipped).toBe(false);
    expect(d.openSpots).toBe(2); expect(d.underCoveredShifts).toBe(2);
    const before = coordinatorProjection(data, people, new Date('2026-03-02T17:30:00Z')).week('2026-03-02');
    expect(before.blocks.find(b => b.slotId === 's1')!.volunteers.some(v => v.userId === 'u2')).toBe(false);
  });
  it('closed cells are present with reason, suppress names and gaps even for closures with no slots', () => {
    const data = base(); data.closedDates = [{ date: '2026-03-09', reason: 'Staff meeting' }, { date: '2026-03-11', reason: 'Holiday' }];
    const week = coordinatorProjection(data, people, new Date('2026-03-09T17:30:00Z')).week('2026-03-09');
    expect(week.blocks.filter(b => b.date === '2026-03-09').every(b => b.state === 'closed' && b.closedReason === 'Staff meeting' && b.volunteers.length === 0 && b.openSpots === 0)).toBe(true);
    expect(week.days[2]!.closedReason).toBe('Holiday'); expect(week.openSpots).toBe(1);
    expect(week.underCoveredShifts).toBe(1);
  });
  it('inactive and retired definitions are absent and active users with no held seats need attention', () => {
    const data = base(); data.slots[0]!.isActive = false; data.slots[1]!.retireAfterDate = '2026-03-08';
    const p = coordinatorProjection(data, people, new Date('2026-03-09T17:30:00Z'));
    expect(p.week('2026-03-09').blocks.map(b => b.slotId)).toEqual(['s3']);
    expect(p.overview().needsAttention).toBe(2);
  });
});
