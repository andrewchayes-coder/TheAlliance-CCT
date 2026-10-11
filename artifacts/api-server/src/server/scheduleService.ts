import { addCalendarDays, calendarDay, pacificDay, slotInstant } from './schedule-time';
export { addCalendarDays, calendarDay, pacificDay, slotInstant, TIME_ZONE } from './schedule-time';

export type ScheduleSlot = {
  id: string; dayOfWeek: number; startTime: string; endTime: string; capacity: number;
  label: string | null; isActive: boolean; retireAfterDate?: string | null;
};
export type ScheduleAssignment = {
  id: string; shiftSlotId: string; volunteerProfileId: string; startDate: string; endDate: string | null;
  endedReason?: string | null;
};
export type ScheduleData = {
  slots: readonly ScheduleSlot[]; assignments: readonly ScheduleAssignment[];
  skips: readonly { shiftAssignmentId: string; skipDate: string }[];
  closedDates: readonly { date: string }[];
  blocks?: readonly {shiftSlotId:string;date:string;reason:string}[];
  customShifts?: readonly {id:string;date:string;startTime:string;endTime:string;capacity:number;label:string|null;openToVolunteers:boolean;cancelledAt:Date|null}[];
  customAssignments?: readonly {id:string;customShiftId:string;volunteerProfileId:string;cancelledAt:Date|null}[];
};
export type Occurrence = {
  slot: ScheduleSlot; date: string; startsAt: Date; endsAt: Date;
  assignedVolunteers: { assignmentId: string; volunteerProfileId: string }[];
  kind?: 'regular'|'custom';
};
export function slotIsActive(slot: ScheduleSlot, date: string): boolean {
  return slot.isActive && (!slot.retireAfterDate || slot.retireAfterDate >= date);
}
export function assignmentIsHeld(assignment: ScheduleAssignment, today: string): boolean {
  return assignment.endedReason !== 'admin_removed' && (!assignment.endDate || assignment.endDate >= today);
}
/**
 * Pure, snapshot-bound methods: no database, environment variables, or side effects.
 * Calendar ranges are inclusive Pacific days. Inject a clock for deterministic default-at calls.
 * Reminder workers must derive candidates here; closed/inactive dates never emit occurrences or gaps.
 */
export function createScheduleService(data: ScheduleData, clock: () => Date = () => new Date()) {
  const slots = data.slots.map(s => ({ ...s }));
  const assignments = data.assignments.map(a => ({ ...a }));
  const closed = new Set(data.closedDates.map(c => c.date));
  const skipped = new Set(data.skips.map(s => `${s.shiftAssignmentId}:${s.skipDate}`));
  const blocked = new Set((data.blocks??[]).map(b=>`${b.shiftSlotId}:${b.date}`));
  const bySlot = new Map<string, ScheduleAssignment[]>();
  for (const a of assignments) {
    const list = bySlot.get(a.shiftSlotId);
    if (list) list.push(a); else bySlot.set(a.shiftSlotId, [a]);
  }

  function getOccurrences(fromDate: string | Date, toDate: string | Date): Occurrence[] {
    const from = calendarDay(fromDate), to = calendarDay(toDate);
    if (to < from || Date.parse(to) - Date.parse(from) > 366 * 86400000) throw new RangeError('Use an ordered range of at most 367 days.');
    const results: Occurrence[] = [];
    for (let date = from; date <= to; date = addCalendarDays(date, 1)) {
      if (closed.has(date)) continue;
      const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
      for (const slot of slots) {
        if (slot.dayOfWeek !== weekday || !slotIsActive(slot, date) || blocked.has(`${slot.id}:${date}`)) continue;
        const seen = new Set<string>();
        const assignedVolunteers = (bySlot.get(slot.id) ?? [])
          .filter(a => assignmentIsHeld(a, date) && a.startDate <= date && !skipped.has(`${a.id}:${date}`))
          .sort((a, b) => a.id.localeCompare(b.id))
          .filter(a => { if (seen.has(a.volunteerProfileId)) return false; seen.add(a.volunteerProfileId); return true; })
          .map(a => ({ assignmentId: a.id, volunteerProfileId: a.volunteerProfileId }));
        results.push({ slot: { ...slot }, date, startsAt: slotInstant(date, slot.startTime),
          endsAt: slotInstant(date, slot.endTime), assignedVolunteers });
      }
      for(const custom of data.customShifts??[]) {
        if(custom.cancelledAt || custom.date !== date) continue;
        const seen=new Set<string>();
        const assignedVolunteers=(data.customAssignments??[]).filter(a=>a.customShiftId===custom.id && !a.cancelledAt)
          .filter(a=>{if(seen.has(a.volunteerProfileId))return false;seen.add(a.volunteerProfileId);return true;})
          .map(a=>({assignmentId:a.id,volunteerProfileId:a.volunteerProfileId}));
        results.push({kind:'custom',slot:{id:custom.id,dayOfWeek:weekday,startTime:custom.startTime,endTime:custom.endTime,
          capacity:custom.capacity,label:custom.label,isActive:true},date,startsAt:slotInstant(date,custom.startTime),
          endsAt:slotInstant(date,custom.endTime),assignedVolunteers});
      }
    }
    return results.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime() || a.slot.id.localeCompare(b.slot.id));
  }
  function getOnShiftNow(at: Date = clock()) {
    return getOccurrences(pacificDay(at), pacificDay(at)).filter(o => o.startsAt <= at && o.endsAt > at);
  }
  /** Return all slots tied for the next start, not arbitrarily one overlapping slot. */
  function getUpNext(at: Date = clock()) {
    const from = pacificDay(at), through = addCalendarDays(from, 366);
    for (let date = from; date <= through; date = addCalendarDays(date, 1)) {
      const upcoming = getOccurrences(date, date).filter(o => o.startsAt > at);
      if (upcoming.length) return upcoming.filter(o => o.startsAt.getTime() === upcoming[0]!.startsAt.getTime());
    }
    return [];
  }
  function getCoverage(weekStart: string | Date) {
    const from = calendarDay(weekStart);
    return getOccurrences(from, addCalendarDays(from, 6)).map(o => ({
      ...o, assignedCount: o.assignedVolunteers.length, capacity: o.slot.capacity,
      empty: o.assignedVolunteers.length === 0, underCapacity: o.assignedVolunteers.length < o.slot.capacity,
    }));
  }
  return { getOccurrences, getOnShiftNow, getUpNext, getCoverage };
}
