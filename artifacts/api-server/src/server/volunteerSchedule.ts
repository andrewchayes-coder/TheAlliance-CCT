import { and, eq, gte, isNotNull } from 'drizzle-orm';
import { volunteerContactText } from '@workspace/shared/appConfig';
import { db, usersTable, volunteerProfilesTable, shiftSlotsTable, shiftAssignmentsTable, shiftSkipsTable, activityLogTable } from '@workspace/db';
import { appConfig } from '@workspace/shared/appConfig';
import { readScheduleData } from './scheduleRepository';
import { bookingBlockers, heldAssignments, startDates, volunteerScheduleView } from './volunteerScheduleView';
import { lockSchedule } from './scheduleMutations';
import { calendarDay, pacificDay, addCalendarDays, slotInstant, createScheduleService } from './scheduleService';
import { WorkflowError } from '../admin-volunteer-detail';
import { sendEmail, createEmailTemplate } from '../email';
import { appOrigin } from '../auth/session';
import { onAssignmentsReleased } from '../uncovered-shifts';
import { logger } from '../lib/logger';
import { agreementVersion, lockAgreementVersion } from './agreements';
import {customOverlap,overlapMessage} from './customShiftService';
import { isOneTimeShift } from '@workspace/shared/schedule-copy';

export async function volunteerSchedule(userId: string, now = new Date()) {
  return db.transaction(async tx => {
    const [profile] = await tx.select({ id: volunteerProfilesTable.id, status: volunteerProfilesTable.status,
      agreementAcknowledgedAt: volunteerProfilesTable.agreementAcknowledgedAt, agreementVersion: volunteerProfilesTable.agreementVersion })
      .from(volunteerProfilesTable).where(eq(volunteerProfilesTable.userId, userId));
    return volunteerScheduleView(await readScheduleData(tx), profile?.id, profile, appConfig.volunteerContactEmail, now, await agreementVersion(tx));
  }, { isolationLevel: 'repeatable read' });
}
type Actor = { id: string; sessionVersion: number };
type Action =
  | { kind: 'book'; slotId: string; startDate?: string; recurrence?: 'weekly' | 'once' }
  | { kind: 'change'; assignmentId: string; slotId: string; startDate?: string; recurrence?: 'weekly' | 'once' }
  | { kind: 'drop'; assignmentId: string }
  | { kind: 'skip'; assignmentId: string; date: string }
  | { kind: 'undo'; assignmentId: string; skipId: string };
const hour = 60 * 60 * 1000;
const weekdayNames = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];
const clock = (time: string) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', hour: 'numeric', minute: '2-digit' })
  .format(new Date(`2000-01-01T${time}:00Z`));
const dateLabel = (date: string) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' })
  .format(new Date(`${date}T12:00:00Z`));

/** Global schedule order + user/profile locks serialize limits; the target slot row serializes its final seat. */
export async function volunteerScheduleAction(actor: Actor, input: Action, testNow?: Date) {
  const result = await db.transaction(async tx => {
    await lockSchedule(tx);
    const currentVersion = await lockAgreementVersion(tx);
    const [user] = await tx.select({ id: usersTable.id, email: usersTable.email, firstName: usersTable.firstName,
      isActive: usersTable.isActive, emailVerifiedAt: usersTable.emailVerifiedAt, role: usersTable.role,
      sessionVersion: usersTable.sessionVersion }).from(usersTable).where(eq(usersTable.id, actor.id)).for('update');
    if (!user || !user.isActive || !user.emailVerifiedAt || user.role !== 'volunteer' || user.sessionVersion !== actor.sessionVersion)
      throw new WorkflowError(403, 'Your account is not available for scheduling. Please sign in again.');
    const [profile] = await tx.select({ id: volunteerProfilesTable.id, status: volunteerProfilesTable.status,
      agreementAcknowledgedAt: volunteerProfilesTable.agreementAcknowledgedAt, agreementVersion: volunteerProfilesTable.agreementVersion })
      .from(volunteerProfilesTable).where(eq(volunteerProfilesTable.userId, actor.id)).for('update');
    const blockers = bookingBlockers(profile, currentVersion);
    if (blockers.length) throw new WorkflowError(403, blockers.join(' '));
    const now = testNow ?? new Date(), today = pacificDay(now);
    const once = input.kind === 'book' && input.recurrence === 'once';
    if (input.kind === 'change' && input.recurrence === 'once')
      throw new WorkflowError(422, 'Changing a weekly shift keeps it recurring. Book a separate one-time shift instead.');
    const data = await readScheduleData(tx), held = heldAssignments(data, now), own = held.filter(a => a.volunteerProfileId === profile!.id);
    const old = input.kind !== 'book' ? own.find(a => a.id === input.assignmentId) : undefined;
    if (input.kind !== 'book' && !old) throw new WorkflowError(404, 'This standing shift could not be found.');
    if (old && isOneTimeShift(old) && input.kind !== 'drop')
      throw new WorkflowError(422, 'Cancel this one-time shift and choose another date instead.');
    const oldSlot = old && data.slots.find(s => s.id === old.shiftSlotId)!;
    if (old) await tx.select({ id: shiftAssignmentsTable.id }).from(shiftAssignmentsTable).where(eq(shiftAssignmentsTable.id, old.id)).for('update');
    let assignmentId: string | null = old?.id ?? null, message = '', release = false;
    let confirmed: { day: number; start: string; end: string; date: string } | undefined;
    let reactivatedFrom: { endedReason: string; endDate: string | null; clearedWeeksOff: string[] } | undefined;
    if (input.kind === 'book' || input.kind === 'change') {
      const [slot] = await tx.select().from(shiftSlotsTable).where(eq(shiftSlotsTable.id, input.slotId)).for('update');
      if (!slot || !data.slots.some(s => s.id === slot.id)) throw new WorkflowError(404, 'This shift slot could not be found.');
      if (!once && (old?.shiftSlotId === slot.id || own.some(a => a.id !== old?.id && !isOneTimeShift(a) && a.shiftSlotId === slot.id)))
        throw new WorkflowError(422, 'You already hold this weekly shift.');
      if (!once && own.filter(a => !isOneTimeShift(a)).length - (old ? 1 : 0) >= appConfig.maxShiftsPerVolunteer)
        throw new WorkflowError(422, `You can hold up to ${appConfig.maxShiftsPerVolunteer} weekly shifts. Choose Change shift instead.`);
      const dates = startDates(data, slot, now), first = input.startDate ?? dates[0];
      if (!first || !dates.includes(calendarDay(first))) throw new WorkflowError(422, 'Choose an upcoming open date for this weekday within the next four weeks.');
      const occurrences = createScheduleService(data).getOccurrences(first, once ? first : addCalendarDays(first, 28));
      const selectedOccurrence = occurrences.find(o => o.slot.id === slot.id && o.date === first);
      if (once && !selectedOccurrence) throw new WorkflowError(422, 'This shift is closed or blocked on that date. Choose another date.');
      const overlapping = own.find(a => {
        if (a.id === old?.id) return false;
        if (once) return false; // Date-specific overlap, including skips/custom shifts, is checked below.
        if (isOneTimeShift(a) && (a.startDate < first || data.skips.some(skip => skip.shiftAssignmentId === a.id && skip.skipDate === a.startDate))) return false;
        const s = data.slots.find(s => s.id === a.shiftSlotId)!;
        return s.dayOfWeek === slot.dayOfWeek && s.startTime < slot.endTime && slot.startTime < s.endTime;
      });
      if (once && occurrences.some(o => o.slot.startTime < slot.endTime && slot.startTime < o.slot.endTime &&
        o.assignedVolunteers.some(v => v.volunteerProfileId === profile!.id)))
        throw new WorkflowError(422, overlapMessage(first, slot.startTime, slot.endTime));
      if(overlapping) {
        const conflict=data.slots.find(s=>s.id===overlapping.shiftSlotId)!;
        throw new WorkflowError(422,overlapMessage(isOneTimeShift(overlapping) ? overlapping.startDate : first,conflict.startTime,conflict.endTime));
      }
      for(const custom of data.customShifts) {
        if(once || custom.date<first || new Date(`${custom.date}T00:00:00Z`).getUTCDay()!==slot.dayOfWeek)continue;
        const overlap=customOverlap(data,profile!.id,custom.date,slot.startTime,slot.endTime);
        if(overlap?.kind==='custom')throw new WorkflowError(422,overlapMessage(custom.date,overlap.slot.startTime,overlap.slot.endTime));
      }
      // The schedule advisory lock and target slot row lock serialize all booking writers.
      const count = once ? selectedOccurrence!.assignedVolunteers.length :
        new Set(held.filter(a => a.shiftSlotId === slot.id && !isOneTimeShift(a)).map(a => a.volunteerProfileId)).size;
      if (count >= slot.capacity) throw new WorkflowError(409, 'This shift is full. Please choose another open shift.');
      if (!once) {
        // A weekly commitment must also leave room for already-reserved one-time dates,
        // including dates beyond the sign-up picker window.
        const oneTimeDates = data.assignments.filter(a => a.shiftSlotId === slot.id && isOneTimeShift(a) &&
          a.startDate >= first && !a.endedReason).map(a => a.startDate);
        for (const date of new Set(oneTimeDates)) {
          const occurrence = createScheduleService(data).getOccurrences(date, date).find(o => o.slot.id === slot.id);
          if (occurrence && occurrence.assignedVolunteers.length >= slot.capacity)
            throw new WorkflowError(409, `This shift is full on ${dateLabel(date)}. Choose a later start date or another shift.`);
        }
      }
      if (old) {
        await tx.update(shiftAssignmentsTable).set({ endDate: addCalendarDays(today, -1), endedReason: 'changed', updatedAt: now })
          .where(eq(shiftAssignmentsTable.id, old.id));
        release = true;
      }
      const [prior] = await tx.select().from(shiftAssignmentsTable).where(and(
        eq(shiftAssignmentsTable.volunteerProfileId, profile!.id), eq(shiftAssignmentsTable.shiftSlotId, slot.id), eq(shiftAssignmentsTable.startDate, first)));
      if (prior && (!prior.endedReason || held.some(a => a.id === prior.id)))
        throw new WorkflowError(409, 'Your shift record changed. Please refresh before choosing it again.');
      if (prior) {
        const cleared = await tx.delete(shiftSkipsTable).where(and(
          eq(shiftSkipsTable.shiftAssignmentId, prior.id), gte(shiftSkipsTable.skipDate, today)))
          .returning({ date: shiftSkipsTable.skipDate });
        reactivatedFrom = { endedReason: prior.endedReason!, endDate: prior.endDate, clearedWeeksOff: cleared.map(s => s.date) };
        await tx.update(shiftAssignmentsTable).set({ endDate: once ? first : null, endedReason: null, updatedAt: now })
          .where(eq(shiftAssignmentsTable.id, prior.id));
        assignmentId = prior.id;
      } else {
        const [saved] = await tx.insert(shiftAssignmentsTable).values({ volunteerProfileId: profile!.id,
          shiftSlotId: slot.id, startDate: first, endDate: once ? first : null, createdByUserId: actor.id }).returning({ id: shiftAssignmentsTable.id });
        assignmentId = saved!.id;
      }
      confirmed = { day: slot.dayOfWeek, start: slot.startTime, end: slot.endTime, date: first };
      message = once
        ? `You're on the schedule for one shift: ${dateLabel(first)}, ${clock(slot.startTime)}–${clock(slot.endTime)}.`
        : `You're on the schedule: ${weekdayNames[slot.dayOfWeek]}, ${clock(slot.startTime)}–${clock(slot.endTime)}, starting ${dateLabel(first)}.`;
    } else if (input.kind === 'drop') {
      if (isOneTimeShift(old!) && slotInstant(old!.startDate, oldSlot!.startTime).getTime() - now.getTime() < 24 * hour)
        throw new WorkflowError(422, `Please contact ${volunteerContactText}. One-time shifts must be cancelled at least 24 hours before the shift.`);
      if (!isOneTimeShift(old!) && own.filter(a => !isOneTimeShift(a)).length <= appConfig.minShiftsPerVolunteer) throw new WorkflowError(422,
        `Please keep at least ${appConfig.minShiftsPerVolunteer} weekly shift${appConfig.minShiftsPerVolunteer === 1 ? '' : 's'}. Choose Change shift instead, or contact ${volunteerContactText} if you need to step back.`);
      await tx.update(shiftAssignmentsTable).set({ endDate: addCalendarDays(today, -1), endedReason: 'dropped', updatedAt: now })
        .where(eq(shiftAssignmentsTable.id, old!.id));
      release = true; message = `Your ${isOneTimeShift(old!) ? 'one-time' : 'weekly'} shift has been released. Thank you for keeping your schedule up to date.`;
    } else if (input.kind === 'skip') {
      const date = calendarDay(input.date);
      if (date < calendarDay(old!.startDate))
        throw new WorkflowError(422, "That date is before this volunteer's standing shift starts.");
      if (old!.endDate && date > calendarDay(old!.endDate))
        throw new WorkflowError(422, "That date is after this volunteer's standing shift ends.");
      const occurrence = createScheduleService({ ...data, skips: [] }).getOccurrences(date, date)
        .find(o => o.slot.id === oldSlot!.id && o.assignedVolunteers.some(a => a.assignmentId === old!.id));
      if (!occurrence || date > addCalendarDays(today, 365)) throw new WorkflowError(422, 'Choose an upcoming date from this standing shift.');
      if (occurrence.startsAt.getTime() - now.getTime() < 24 * hour) throw new WorkflowError(422,
        `Please contact ${volunteerContactText}. Weeks off must be requested at least 24 hours before the shift.`);
      const inserted = await tx.insert(shiftSkipsTable).values({ shiftAssignmentId: old!.id, skipDate: date }).onConflictDoNothing()
        .returning({ id: shiftSkipsTable.id });
      release = inserted.length > 0; message = `Your week off on ${dateLabel(date)} is recorded. Thank you for letting us know.`;
    } else {
      const [skip] = await tx.select().from(shiftSkipsTable).where(and(
        eq(shiftSkipsTable.id, input.skipId), eq(shiftSkipsTable.shiftAssignmentId, old!.id))).for('update');
      if (!skip) throw new WorkflowError(404, 'This week off could not be found.');
      if (slotInstant(skip.skipDate, oldSlot!.startTime) <= now) throw new WorkflowError(422, `This shift has already started. Please contact ${volunteerContactText}.`);
      const replacement = createScheduleService(data).getOccurrences(skip.skipDate, skip.skipDate)
        .find(o => o.slot.id === oldSlot!.id);
      if (replacement && replacement.assignedVolunteers.length >= oldSlot!.capacity)
        throw new WorkflowError(409, 'This date has been filled while you were away. Please contact The Alliance before returning to the schedule.');
      const conflict=customOverlap(data,profile!.id,skip.skipDate,oldSlot!.startTime,oldSlot!.endTime,oldSlot!.id);
      if(conflict)throw new WorkflowError(422,overlapMessage(skip.skipDate,conflict.slot.startTime,conflict.slot.endTime));
      await tx.delete(shiftSkipsTable).where(eq(shiftSkipsTable.id, skip.id));
      message = `You're back on the schedule for ${dateLabel(skip.skipDate)}. Thank you for your help.`;
    }
    const [activity] = await tx.insert(activityLogTable).values({ volunteerProfileId: profile!.id, actorUserId: actor.id,
      action: `shift_${input.kind}`, details: { assignmentId, ...(old ? { oldAssignmentId: old.id, oldSlotId: old.shiftSlotId,
        oldStartDate: old.startDate, oldEndDate: old.endDate } : {}), ...(confirmed ? { starts: confirmed.date } : {}),
        ...(input.kind === 'skip' ? { date: input.date } : {}), ...(reactivatedFrom ? { reactivatedFrom } : {}) } }).returning({ id: activityLogTable.id });
    return { assignmentId, message, confirmed, once, user: { id: user.id, email: user.email, firstName: user.firstName },
      released: release ? { volunteerProfileId: profile!.id, assignmentIds: old ? [old.id] : [],
        shiftSlotIds: old ? [old.shiftSlotId] : [], effectiveDate: today, activityId: activity!.id } : null,
      activityId: activity!.id };
  });
  // Post-commit side effects cannot roll back or make a successfully saved schedule appear to fail.
  if (result.released) try { await onAssignmentsReleased(result.released); } catch (error) {
    logger.error({ err: error }, 'Coverage alert failed after the volunteer schedule was saved');
  }
  let emailWarning: string | null = null;
  if (result.confirmed) {
    const mail = createEmailTemplate({ heading: "You're on the schedule", paragraphs: [
      `Hi ${result.user.firstName},`, result.message,
      'Want your shifts in Google, Outlook or Apple Calendar? Open My shifts in the portal and choose Add to calendar. It updates on its own.',
      result.once
        ? 'Thank you for sharing your time and care with local families. This booking is for this date only and does not repeat. You can view it in the portal.'
        : 'Thank you for sharing your time and care with local families. Your shift repeats each week, and you can manage it or request a week off in the portal.',
    ], cta: { label: 'View my shifts', url: `${appOrigin}/shifts` } });
    const sent = await sendEmail({ type: 'shift', to: result.user.email, toUserId: result.user.id,
      subject: result.message, ...mail, relatedId: result.activityId });
    if (!sent.ok) emailWarning = 'Your shift is saved, but the confirmation email could not be sent. Your schedule here is up to date.';
  }
  return { message: result.message, assignmentId: result.assignmentId, emailWarning };
}
