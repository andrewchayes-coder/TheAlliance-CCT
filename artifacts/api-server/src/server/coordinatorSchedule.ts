import { createScheduleService, assignmentIsHeld, slotIsActive, pacificDay, calendarDay, addCalendarDays, type ScheduleData } from './scheduleService';
import { attentionReasons } from '../volunteer-attention';
import { operatingWeekStart } from '@workspace/shared/calendar-display';
type Profile = Parameters<typeof attentionReasons>[0];
export type CoordinatorPerson = {
  profileId: string; userId: string; firstName: string; lastName: string; email: string;
  phone: string | null; accountActive: boolean; profile: Profile; isTestAccount?: boolean; role?: 'admin' | 'volunteer';
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
  const standing = createScheduleService({ ...data, skips: [], closedDates: [],blocks:[] });
  const persons = new Map(people.map(p => [p.profileId, p]));
  const today = pacificDay(now), currentWeek = operatingWeekStart(today);
  const closure = new Map(data.closedDates.map(c => [c.date, c.reason]));
  const actualDates = new Map<string, ReturnType<typeof service.getOccurrences>>();
  const actualOn = (date: string) => {
    if (!actualDates.has(date)) actualDates.set(date, service.getOccurrences(date, date));
    return actualDates.get(date)!;
  };
  const block = (occ: ReturnType<typeof service.getOccurrences>[number], includeSkipped = false) => {
    const closedReason = closure.get(occ.date) ?? null;
    const blockedSlot=(data.blocks??[]).find(b=>b.shiftSlotId===occ.slot.id && b.date===occ.date);
    const suppressed = closedReason!==null || !!blockedSlot;
    const actual = suppressed ? [] : actualOn(occ.date)
      .find(o => o.slot.id === occ.slot.id)?.assignedVolunteers ?? [];
    const assigned = new Set(actual.map(a => a.volunteerProfileId));
    const roster = suppressed ? [] : includeSkipped ? occ.assignedVolunteers : actual;
    const volunteers = roster.flatMap(a => {
      const p = persons.get(a.volunteerProfileId);
      if (!p) return [];
      return [{ assignmentId: actual.find(v => v.volunteerProfileId === a.volunteerProfileId)?.assignmentId ?? a.assignmentId,
        userId: p.userId, firstName: p.firstName, lastName: p.lastName, email: p.email, phone: p.phone,
         skipped: !assigned.has(a.volunteerProfileId), accountActive: p.accountActive, isTestAccount: Boolean(p.isTestAccount), role: p.role ?? 'volunteer' }];
    });
    const count = assigned.size, open = Math.max(0, occ.slot.capacity - count);
    return { slotId: occ.slot.id, date: occ.date, dayOfWeek: occ.slot.dayOfWeek, startTime: occ.slot.startTime,
      endTime: occ.slot.endTime, startsAt: occ.startsAt.toISOString(), endsAt: occ.endsAt.toISOString(), label: occ.slot.label,
      capacity: occ.slot.capacity, assignedCount: count, openSpots: suppressed ? 0 : open,
      kind:occ.kind??'regular',blockedReason:blockedSlot?.reason??null,blockId:blockedSlot && 'id' in blockedSlot ? String(blockedSlot.id):null,
      state: closedReason !== null ? 'closed' as const : blockedSlot ? 'blocked' as const : count === 0 ? 'empty' as const : open ? 'under' as const : 'covered' as const,
      closedReason, volunteers };
  };
  function week(date: string) {
    const weekStart = mondayOf(date);
    const coverage = service.getCoverage(weekStart);
    const weekend=(data.customShifts??[]).some(s=>!s.cancelledAt && s.date>=addCalendarDays(weekStart,5) && s.date<=addCalendarDays(weekStart,6));
    return { weekStart, today, updatedAt: now.toISOString(),
      days: Array.from({ length: weekend?7:5 }, (_, i) => ({ date: addCalendarDays(weekStart, i), dayOfWeek: (i+1)%7,
        closedReason: closure.get(addCalendarDays(weekStart, i)) ?? null })),
      blocks: standing.getOccurrences(weekStart, addCalendarDays(weekStart, weekend?6:4)).map(o => block(o, true)),
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
      needsAttention: people.filter(p => p.role !== 'admin' && !p.isTestAccount && attentionReasons(p.profile, held.get(p.profileId) ?? 0, today,p).length > 0).length };
  }
  return { week, overview };
}
