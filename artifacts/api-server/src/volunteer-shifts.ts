import { createScheduleService, addCalendarDays, pacificDay } from './server/scheduleService';
export { pacificDay, addCalendarDays, slotInstant } from './server/scheduleService';
export type AssignedSlot = {
  assignmentId: string; startDate: string; endDate: string | null;
  dayOfWeek: number; startTime: string; endTime: string; label: string | null;
  retireAfterDate?: string | null;
  shiftSlotId?: string; volunteerProfileId?: string;
};
/** Compatibility projection: own assignments only, using the single occurrence engine. */
export function upcomingOccurrences(slots: AssignedSlot[], closed: Set<string>, skips: Set<string>, now = new Date(), limit = 4) {
  const service = createScheduleService({
    slots: [...new Map(slots.map(s => [s.shiftSlotId ?? s.assignmentId, {
      ...s, id: s.shiftSlotId ?? s.assignmentId, capacity: 1, isActive: true,
    }])).values()],
    assignments: slots.map(s => ({ id: s.assignmentId, shiftSlotId: s.shiftSlotId ?? s.assignmentId,
      volunteerProfileId: s.volunteerProfileId ?? s.assignmentId, startDate: s.startDate, endDate: s.endDate })),
    closedDates: [...closed].map(date => ({ date })),
    skips: [...skips].map(key => ({ shiftAssignmentId: key.slice(0, key.lastIndexOf(':')), skipDate: key.slice(key.lastIndexOf(':') + 1) })),
  });
  return service.getOccurrences(pacificDay(now), addCalendarDays(pacificDay(now), 365))
    .filter(o => o.assignedVolunteers.length > 0 && o.endsAt > now).slice(0, limit).map(o => ({
      assignmentId: o.assignedVolunteers[0]!.assignmentId, date: o.date, startTime: o.slot.startTime,
      endTime: o.slot.endTime, startsAt: o.startsAt.toISOString(), endsAt: o.endsAt.toISOString(), label: o.slot.label,
    }));
}
