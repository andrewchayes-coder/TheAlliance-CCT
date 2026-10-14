import { appConfig } from '@workspace/shared/appConfig';
import { volunteerContactText } from '@workspace/shared/appConfig';
import { createScheduleService, assignmentIsHeld, slotIsActive, pacificDay, addCalendarDays, slotInstant,
  type ScheduleData, type ScheduleSlot } from './scheduleService';

export function bookingBlockers(profile: { status: string; agreementAcknowledgedAt: Date | null; agreementVersion?: string | null } | undefined, currentVersion?: string) {
  if (!profile) return ['Please complete your onboarding before choosing a weekly shift.'];
  const reasons: string[] = [];
  if (profile.status !== 'active') reasons.push(profile.status === 'inactive'
    ? `Your Resource Coordinator status is inactive. Please contact ${volunteerContactText} if you would like to return.`
    : appConfig.autoActivateOnProfileComplete
      ? `Your account isn't active yet. The Community Care Team will turn on shift sign-up for you. Questions? Contact ${volunteerContactText}.`
      : "Your profile is awaiting approval. We'll email you when you're ready to choose a shift.");
  if (appConfig.requireAgreementAcknowledgment && !profile.agreementAcknowledgedAt) reasons.push('Please acknowledge the volunteer agreement in onboarding.');
  else if (appConfig.requireAgreementAcknowledgment && currentVersion && profile.agreementVersion !== currentVersion) reasons.push('Please acknowledge the updated volunteer agreements before using shifts.');
  return reasons;
}
export function startDates(data: ScheduleData, slot: ScheduleSlot, now: Date) {
  const today = pacificDay(now), closed = new Set(data.closedDates.map(c => c.date));
  return Array.from({ length: 29 }, (_, i) => addCalendarDays(today, i)).filter(date =>
    new Date(`${date}T00:00:00Z`).getUTCDay() === slot.dayOfWeek && slotIsActive(slot, date) &&
    !closed.has(date) && slotInstant(date, slot.startTime) > now);
}
export function heldAssignments(data: ScheduleData, now: Date) {
  const today = pacificDay(now), slots = new Map(data.slots.map(s => [s.id, s]));
  return data.assignments.filter(a => assignmentIsHeld(a, today) && !!slots.get(a.shiftSlotId) &&
    slotIsActive(slots.get(a.shiftSlotId)!, today));
}
type BookingData = Omit<ScheduleData, 'skips'> & { skips: readonly {
  id: string; shiftAssignmentId: string; skipDate: string;
}[] };
/** Personnel-free counts; every assignment identifier in the result belongs to this caller. */
export function volunteerScheduleView(data: BookingData, profileId: string | undefined,
  profile: Parameters<typeof bookingBlockers>[0], contactEmail: string | null, now = new Date(), currentVersion?: string) {
  const today = pacificDay(now), held = heldAssignments(data, now), own = held.filter(a => a.volunteerProfileId === profileId);
  const blockedReasons = bookingBlockers(profile, currentVersion);
  const ownSlotIds = new Set(own.map(a => a.shiftSlotId));
  const ownData = { ...data, slots: data.slots.filter(s => ownSlotIds.has(s.id)), assignments: own };
  const occurrences = own.length ? createScheduleService({ ...ownData, skips: [] }).getOccurrences(today, addCalendarDays(today, 365)) : [];
  const datesFor = (id: string) => occurrences.filter(o => o.endsAt > now && o.assignedVolunteers.some(v => v.assignmentId === id)).map(o => {
    const skip = data.skips.find(s => s.shiftAssignmentId === id && s.skipDate === o.date);
    return { date: o.date, startsAt: o.startsAt.toISOString(), endsAt: o.endsAt.toISOString(),
      skipped: !!skip, skipId: skip?.id ?? null,
      canSkip: !skip && o.startsAt.getTime() - now.getTime() >= 24 * 60 * 60 * 1000,
      canUndo: !!skip && o.startsAt > now };
  });
  return { canBook: blockedReasons.length === 0, blockedReasons, contactEmail,
    minShifts: appConfig.minShiftsPerVolunteer, maxShifts: appConfig.maxShiftsPerVolunteer, today,
    customShifts:(data.customShifts??[]).filter(s=>!s.cancelledAt && slotInstant(s.date,s.endTime)>now &&
      !data.closedDates.some(c=>c.date===s.date) && (s.openToVolunteers || (data.customAssignments??[]).some(a=>
        a.customShiftId===s.id && a.volunteerProfileId===profileId && !a.cancelledAt))).map(s=>{
        const assigned=(data.customAssignments??[]).filter(a=>a.customShiftId===s.id && !a.cancelledAt);
        return {id:s.id,date:s.date,startTime:s.startTime,endTime:s.endTime,capacity:s.capacity,label:s.label,
          openToVolunteers:s.openToVolunteers,assignedCount:assigned.length,openSpots:Math.max(0,s.capacity-assigned.length),
          ownAssignmentId:assigned.find(a=>a.volunteerProfileId===profileId)?.id??null,
          canCancel:slotInstant(s.date,s.startTime).getTime()-now.getTime()>=24*3600000};
      }).sort((a,b)=>a.date.localeCompare(b.date)||a.startTime.localeCompare(b.startTime)),
    slots: data.slots.filter(s => slotIsActive(s, today)).sort((a, b) =>
      a.dayOfWeek - b.dayOfWeek || a.startTime.localeCompare(b.startTime) || a.id.localeCompare(b.id)).map(s => {
        const heldCount = new Set(held.filter(a => a.shiftSlotId === s.id).map(a => a.volunteerProfileId)).size;
        return { id: s.id, dayOfWeek: s.dayOfWeek, startTime: s.startTime, endTime: s.endTime,
          label: s.label ?? null, capacity: s.capacity, heldCount, openSpots: Math.max(0, s.capacity - heldCount),
          ownAssignmentId: own.find(a => a.shiftSlotId === s.id)?.id ?? null, startDates: startDates(data, s, now) };
      }),
    assignments: own.map(a => {
      const s = data.slots.find(s => s.id === a.shiftSlotId)!, dates = datesFor(a.id);
      return { id: a.id, slotId: s.id, dayOfWeek: s.dayOfWeek, startTime: s.startTime, endTime: s.endTime,
        label: s.label ?? null, startDate: a.startDate, endDate: a.endDate ?? null,
        nextDates: dates.slice(0, 4), weeksOff: data.skips.filter(skip =>
          skip.shiftAssignmentId === a.id && slotInstant(skip.skipDate, s.endTime) > now)
          .sort((a, b) => a.skipDate.localeCompare(b.skipDate)).map(skip => ({
            date: skip.skipDate, startsAt: slotInstant(skip.skipDate, s.startTime).toISOString(),
            endsAt: slotInstant(skip.skipDate, s.endTime).toISOString(), skipped: true, skipId: skip.id,
            canSkip: false, canUndo: slotInstant(skip.skipDate, s.startTime) > now,
          })) };
    }),
  };
}
