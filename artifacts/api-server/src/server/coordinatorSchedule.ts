import { createScheduleService, assignmentIsHeld, slotIsActive, pacificDay, calendarDay, addCalendarDays, type ScheduleData } from './scheduleService';
import { attentionReasons } from '../volunteer-attention';
type Profile = Parameters<typeof attentionReasons>[0];
export type CoordinatorPerson = {
  profileId: string; userId: string; firstName: string; lastName: string; email: string;
  phone: string | null; accountActive: boolean; profile: Profile; isTestAccount?: boolean;
};
export function mondayOf(date: string) {
  const d = calendarDay(date), weekday = new Date(`${d}T00:00:00Z`).getUTCDay();
  return addCalendarDays(d, -((weekday + 6) % 7));
}
/** Admin-only projection; the occurrence engine remains free of personnel data. */
export type CoordinatorData = Omit<ScheduleData, 'closedDates'> & { closedDates: readonly { date: string; reason: string }[] };
export function coordinatorProjection(data: CoordinatorData,
  people: readonly CoordinatorPerson[], now = new Date()) {
  const service = createScheduleService(data, () => now);
  const standing = createScheduleService({ ...data, skips: [], closedDates: [] });
  const persons = new Map(people.map(p => [p.profileId, p]));
  const today = pacificDay(now), currentWeek = mondayOf(today);
  const closure = new Map(data.closedDates.map(c => [c.date, c.reason]));
  const actualDates = new Map<string, ReturnType<typeof service.getOccurrences>>();
  const actualOn = (date: string) => {
    if (!actualDates.has(date)) actualDates.set(date, service.getOccurrences(date, date));
    return actualDates.get(date)!;
  };
  const block = (occ: ReturnType<typeof service.getOccurrences>[number], includeSkipped = false) => {
    const closedReason = closure.get(occ.date) ?? null;
    const actual = closedReason !== null ? [] : actualOn(occ.date)
      .find(o => o.slot.id === occ.slot.id)?.assignedVolunteers ?? [];
    const assigned = new Set(actual.map(a => a.volunteerProfileId));
    const roster = closedReason !== null ? [] : includeSkipped ? occ.assignedVolunteers : actual;
    const volunteers = roster.flatMap(a => {
      const p = persons.get(a.volunteerProfileId);
      if (!p) return [];
      return [{ assignmentId: actual.find(v => v.volunteerProfileId === a.volunteerProfileId)?.assignmentId ?? a.assignmentId,
        userId: p.userId, firstName: p.firstName, lastName: p.lastName, email: p.email, phone: p.phone,
        skipped: !assigned.has(a.volunteerProfileId), accountActive: p.accountActive, isTestAccount: Boolean(p.isTestAccount) }];
    });
    const count = assigned.size, open = Math.max(0, occ.slot.capacity - count);
    return { slotId: occ.slot.id, date: occ.date, dayOfWeek: occ.slot.dayOfWeek, startTime: occ.slot.startTime,
      endTime: occ.slot.endTime, startsAt: occ.startsAt.toISOString(), endsAt: occ.endsAt.toISOString(), label: occ.slot.label,
      capacity: occ.slot.capacity, assignedCount: count, openSpots: closedReason !== null ? 0 : open,
      state: closedReason !== null ? 'closed' as const : count === 0 ? 'empty' as const : open ? 'under' as const : 'covered' as const,
      closedReason, volunteers };
  };
  function week(date: string) {
    const weekStart = mondayOf(date);
    const coverage = service.getCoverage(weekStart);
    return { weekStart, today, updatedAt: now.toISOString(),
      days: Array.from({ length: 5 }, (_, i) => ({ date: addCalendarDays(weekStart, i), dayOfWeek: i + 1,
        closedReason: closure.get(addCalendarDays(weekStart, i)) ?? null })),
      blocks: standing.getOccurrences(weekStart, addCalendarDays(weekStart, 4)).map(o => block(o, true)),
      openSpots: coverage.reduce((n, c) => n + Math.max(0, c.capacity - c.assignedCount), 0),
      underCoveredShifts: coverage.filter(c => c.underCapacity).length };
  }
  function overview() {
    const on = service.getOnShiftNow(now), coverage = service.getCoverage(currentWeek);
    const held = new Map<string, number>();
    for (const a of data.assignments) {
      const slot = data.slots.find(s => s.id === a.shiftSlotId);
      if (slot && slotIsActive(slot, today) && assignmentIsHeld(a, today)) held.set(a.volunteerProfileId, (held.get(a.volunteerProfileId) ?? 0) + 1);
    }
    return { updatedAt: now.toISOString(), today, weekStart: currentWeek, operatingNow: on.length > 0,
      onShiftNow: on.map(o => block(o)), upNext: service.getUpNext(now).map(o => block(o)),
      openSpots: coverage.reduce((n, c) => n + Math.max(0, c.capacity - c.assignedCount), 0),
      underCoveredShifts: coverage.filter(c => c.underCapacity).length,
      needsAttention: people.filter(p => !p.isTestAccount && attentionReasons(p.profile, held.get(p.profileId) ?? 0, today,p).length > 0).length };
  }
  return { week, overview };
}
