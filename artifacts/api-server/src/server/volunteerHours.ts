import { appConfig } from '@workspace/shared/appConfig';
import { normalizeVolunteerStatus } from '@workspace/shared/profileFields';
import { addCalendarDays, calendarDay, createScheduleService, pacificDay, type ScheduleData } from './scheduleService';

export type HoursSource = 'standing' | 'one_time' | 'other';
export type HoursShift = {
  date: string; source: 'standing' | 'one_time'; shiftSlotId: string | null; customShiftId: string | null;
  startTime: string; endTime: string; label: string | null; defaultHours: number;
};
type HistoricalData = Omit<ScheduleData, 'assignments'> & {
  assignments: readonly (ScheduleData['assignments'][number] & { updatedAt?: Date })[];
};
/** Hours-only historical projection; live booking/coverage semantics are never changed.
 * admin_removed releases a seat immediately, but does not erase shifts served BEFORE removal.
 */
export function loggableShifts(data: HistoricalData, profileId: string, status: string, now: Date,
  range?: { from: string; to: string }): HoursShift[] {
  if (normalizeVolunteerStatus(status) === 'onboarding') return [];
  const today = pacificDay(now);
  const from = range?.from ?? addCalendarDays(today, 1 - appConfig.hoursLogWindowDays);
  const to = range?.to ?? today;
  calendarDay(from); calendarDay(to);
  const historical = { ...data, assignments: data.assignments.map(a =>
    a.endedReason === 'admin_removed' && a.endDate && a.updatedAt
      ? { ...a, endedReason: null } : a) };
  return createScheduleService(historical).getOccurrences(from, to)
    .filter(o => {
      const assigned = o.assignedVolunteers.find(v => v.volunteerProfileId === profileId);
      if (!assigned || o.endsAt > now) return false;
      const original = data.assignments.find(a => a.id === assigned.assignmentId);
      return !(original?.endedReason === 'admin_removed' &&
        (!original.updatedAt || o.endsAt > original.updatedAt));
    })
    .map(o => ({
      date: o.date, source: o.kind === 'custom' ? 'one_time' as const : 'standing' as const,
      shiftSlotId: o.kind === 'custom' ? null : o.slot.id,
      customShiftId: o.kind === 'custom' ? o.slot.id : null,
      startTime: o.slot.startTime, endTime: o.slot.endTime, label: o.slot.label,
      defaultHours: (o.endsAt.getTime() - o.startsAt.getTime()) / 3_600_000,
    }))
    .sort((a, b) => b.date.localeCompare(a.date) || b.startTime.localeCompare(a.startTime) ||
      (a.shiftSlotId ?? a.customShiftId!).localeCompare(b.shiftSlotId ?? b.customShiftId!));
}
export function sameHoursShift(a: { date: string; source: string; shiftSlotId?: string | null; customShiftId?: string | null },
  b: { date: string; source: string; shiftSlotId?: string | null; customShiftId?: string | null }) {
  return a.date === b.date && a.source === b.source &&
    (a.shiftSlotId ?? null) === (b.shiftSlotId ?? null) && (a.customShiftId ?? null) === (b.customShiftId ?? null);
}
