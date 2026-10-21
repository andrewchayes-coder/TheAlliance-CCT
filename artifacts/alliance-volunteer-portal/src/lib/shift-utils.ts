import type { VolunteerAvailableSlot, VolunteerSchedule, VolunteerStandingShift } from '@workspace/api-client-react';
import { shiftDate, timeRange } from '@/lib/pacific';
import { isOneTimeShift } from '@workspace/shared/schedule-copy';

export const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const WEEKDAYS = [1, 2, 3, 4, 5];

/** Accepts YYYYMMDD or YYYY-MM-DD, returns YYYY-MM-DD. */
export const ymd = (s: string) => (/^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6)}` : s);
export const dateLabel = (s: string) => shiftDate(ymd(s));
export const slotTitle = (s: { dayOfWeek: number; startTime: string; endTime: string }) => `${DAYS[s.dayOfWeek]}, ${timeRange(s.startTime, s.endTime)}`;

type Span = { dayOfWeek: number; startTime: string; endTime: string };
export const overlaps = (a: Span, b: Span) => a.dayOfWeek === b.dayOfWeek && a.startTime < b.endTime && b.startTime < a.endTime;

export type SlotState = 'own' | 'full' | 'overlap' | 'max' | 'open' | 'closed';

/** Client-side guidance only; the server is authoritative. */
export function slotState(slot: VolunteerAvailableSlot, sch: VolunteerSchedule, changing: VolunteerStandingShift | null): SlotState {
  if (slot.ownAssignmentId) return changing && slot.ownAssignmentId === changing.id ? 'own' : 'own';
  if (slot.openSpots <= 0) return 'full';
  if (slot.startDates.length === 0) return 'closed';
  const others = sch.assignments.filter(a => a.id !== changing?.id && !isOneTimeShift(a));
  if (others.some(a => overlaps(a, slot))) return 'overlap';
  if (!changing && others.length >= sch.maxShifts) return 'max';
  return 'open';
}
