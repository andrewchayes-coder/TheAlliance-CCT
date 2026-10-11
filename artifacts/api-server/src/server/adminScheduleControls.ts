import { and, eq, gte } from 'drizzle-orm';
import { volunteerContactText } from '@workspace/shared/appConfig';
import { db, usersTable, volunteerProfilesTable, shiftSlotsTable, shiftAssignmentsTable, shiftSkipsTable, activityLogTable } from '@workspace/db';
import { appConfig } from '@workspace/shared/appConfig';
import { approvalRequirements, lockedVolunteer, WorkflowError } from '../admin-volunteer-detail';
import { lockSchedule } from './scheduleMutations';
import { readScheduleData, ongoingForSlot } from './scheduleRepository';
import { heldAssignments, startDates, volunteerScheduleView } from './volunteerScheduleView';
import { createScheduleService, pacificDay, calendarDay, addCalendarDays, slotInstant } from './scheduleService';
import { onAssignmentsReleased } from '../uncovered-shifts';
import { createEmailTemplate, sendEmail } from '../email';
import { appOrigin } from '../auth/session';
import { logger } from '../lib/logger';
import {customOverlap,overlapMessage} from './customShiftService';

type Actor = { id: string; sessionVersion: number };
const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const clock = (time: string) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', hour: 'numeric', minute: '2-digit' })
  .format(new Date(`2000-01-01T${time}:00Z`));
type Action = { kind: 'assign'; userId: string; slotId: string; startDate?: string; override: boolean; reason?: string }
  | { kind: 'remove'; assignmentId: string; emailVolunteer: boolean }
  | { kind: 'skip'; assignmentId: string; date: string }
  | { kind: 'undo'; assignmentId: string; skipId: string };
export async function adminScheduleControls(filter: { slotId?: string; userId?: string; q?: string }, now = new Date()) {
  return db.transaction(async tx => {
    const data = await readScheduleData(tx), held = heldAssignments(data, now), today = pacificDay(now);
    const people = await tx.select({ user: usersTable, profile: volunteerProfilesTable })
      .from(volunteerProfilesTable).innerJoin(usersTable, eq(usersTable.id, volunteerProfilesTable.userId))
      .where(eq(usersTable.role, 'volunteer'));
    const projected = volunteerScheduleView(data, undefined, undefined, null, now);
    const q = filter.q?.trim().toLowerCase() ?? '';
    const candidates = people.filter(p => p.profile.status === 'active' && p.user.isActive &&
      (!filter.userId || p.user.id === filter.userId) &&
      `${p.user.firstName} ${p.user.lastName} ${p.user.email}`.toLowerCase().includes(q));
    return { volunteers: candidates.slice(0, 100).map(p => ({
      userId: p.user.id, firstName: p.user.firstName, lastName: p.user.lastName, email: p.user.email, isTestAccount: p.user.isTestAccount,
      heldCount: held.filter(a => a.volunteerProfileId === p.profile.id).length,
      blockedReasons: approvalRequirements(p.user, p.profile).filter(r => !r.met).map(r => r.label),
    })).sort((a, b) => a.lastName.localeCompare(b.lastName)),
    slots: projected.slots,
    assignments: held.flatMap(a => {
      const p = people.find(p => p.profile.id === a.volunteerProfileId), s = data.slots.find(s => s.id === a.shiftSlotId)!;
      if (!p || filter.slotId && s.id !== filter.slotId || filter.userId && p.user.id !== filter.userId) return [];
      const potential = createScheduleService({ ...data, slots: [s], assignments: [a], skips: [], closedDates: [] })
        .getOccurrences(today, addCalendarDays(today, 35)).filter(o => o.endsAt > now).slice(0, 5);
      const dates = new Map(potential.map(o => [o.date, { date: o.date,
        skipId: data.skips.find(skip => skip.shiftAssignmentId === a.id && skip.skipDate === o.date)?.id ?? null }]));
      // Include all stored upcoming weeks off, even if a later closure suppresses the occurrence.
      for (const skip of data.skips.filter(skip => skip.shiftAssignmentId === a.id && skip.skipDate >= today))
        dates.set(skip.skipDate, { date: skip.skipDate, skipId: skip.id });
      return [{ id: a.id, userId: p.user.id, firstName: p.user.firstName, lastName: p.user.lastName, isTestAccount: p.user.isTestAccount, slotId: s.id,
        dayOfWeek: s.dayOfWeek, startTime: s.startTime, endTime: s.endTime, startDate: a.startDate,
        dates: [...dates.values()].sort((a, b) => a.date.localeCompare(b.date)).map(d => ({
          ...d, startsAt: slotInstant(d.date, s.startTime).toISOString(), endsAt: slotInstant(d.date, s.endTime).toISOString(),
          closedReason: data.closedDates.find(c => c.date === d.date)?.reason ?? null,
        })) }];
    }) };
  }, { isolationLevel: 'repeatable read' });
}
export async function adminScheduleAction(actor: Actor, input: Action, now = new Date()) {
  const result = await db.transaction(async tx => {
    await lockSchedule(tx);
    const [staff] = await tx.select().from(usersTable).where(eq(usersTable.id, actor.id)).for('update');
    if (!staff || staff.role !== 'admin' || !staff.isActive || !staff.emailVerifiedAt || staff.sessionVersion !== actor.sessionVersion)
      throw new WorkflowError(403, 'Please sign in again with an active staff account.');
    let targetId: string;
    if (input.kind === 'assign') targetId = input.userId;
    else {
      const [target] = await tx.select({ userId: volunteerProfilesTable.userId }).from(shiftAssignmentsTable)
        .innerJoin(volunteerProfilesTable, eq(volunteerProfilesTable.id, shiftAssignmentsTable.volunteerProfileId))
        .where(eq(shiftAssignmentsTable.id, input.assignmentId));
      if (!target) throw new WorkflowError(404, 'This assignment could not be found.');
      targetId = target.userId;
    }
    const { user, profile } = await lockedVolunteer(tx, targetId);
    const data = await readScheduleData(tx), held = heldAssignments(data, now), own = held.filter(a => a.volunteerProfileId === profile.id);
    const today = pacificDay(now);
    const old = input.kind === 'assign' ? undefined : data.assignments.find(a =>
      a.id === input.assignmentId && a.volunteerProfileId === profile.id);
    if (input.kind !== 'assign' && (!old || !held.some(a => a.id === old.id)))
      throw new WorkflowError(409, 'This assignment has already ended. Refresh the schedule.');
    let assignmentId = old?.id ?? '', message = '', released = false;
    let overrides: string[] = [], reactivatedFrom: unknown;
    if (input.kind === 'assign') {
      const missing = approvalRequirements(user, profile).filter(r => !r.met);
      if (!user.isActive || profile.status !== 'active' || missing.length)
        throw new WorkflowError(422, `Only eligible active volunteers can be assigned. ${missing.map(r => r.label).join('; ')}`);
      const [slot] = await tx.select().from(shiftSlotsTable).where(eq(shiftSlotsTable.id, input.slotId)).for('update');
      if (!slot) throw new WorkflowError(404, 'This slot could not be found.');
      const dates = startDates(data, slot, now), first = input.startDate ?? dates[0];
      if (!first || !dates.includes(calendarDay(first))) throw new WorkflowError(422, 'Choose an open start date within the next four weeks.');
      if (own.some(a => a.shiftSlotId === slot.id)) throw new WorkflowError(422, 'This volunteer already holds this slot.');
      if (own.some(a => { const s = data.slots.find(s => s.id === a.shiftSlotId)!;
        return s.dayOfWeek === slot.dayOfWeek && s.startTime < slot.endTime && slot.startTime < s.endTime; }))
        throw new WorkflowError(422, 'This slot overlaps another standing shift. Override cannot bypass overlap.');
      const occupants = await tx.select().from(shiftAssignmentsTable).where(ongoingForSlot(slot.id, today));
      for(const custom of data.customShifts) {
        if(custom.date<first || new Date(`${custom.date}T00:00:00Z`).getUTCDay()!==slot.dayOfWeek)continue;
        const conflict=customOverlap(data,profile.id,custom.date,slot.startTime,slot.endTime);
        if(conflict?.kind==='custom')throw new WorkflowError(422,overlapMessage(custom.date,conflict.slot.startTime,conflict.slot.endTime));
      }
      if (own.length >= appConfig.maxShiftsPerVolunteer) overrides.push('volunteer_shift_limit');
      if (new Set(occupants.map(a => a.volunteerProfileId)).size >= slot.capacity) overrides.push('slot_capacity');
      if (input.override && !input.reason?.trim()) throw new WorkflowError(422, 'Give a reason for the override.');
      if (overrides.length && (!input.override || !input.reason?.trim()))
        throw new WorkflowError(422, 'This would exceed the shift limit or slot capacity. Check Override and give a reason to continue.');
      const [prior] = await tx.select().from(shiftAssignmentsTable).where(and(eq(shiftAssignmentsTable.volunteerProfileId, profile.id),
        eq(shiftAssignmentsTable.shiftSlotId, slot.id), eq(shiftAssignmentsTable.startDate, first)));
      if (prior) {
        if (!prior.endedReason || held.some(a => a.id === prior.id)) throw new WorkflowError(409, 'The assignment changed. Refresh first.');
        const cleared = await tx.delete(shiftSkipsTable).where(and(eq(shiftSkipsTable.shiftAssignmentId, prior.id),
          gte(shiftSkipsTable.skipDate, today))).returning({ date: shiftSkipsTable.skipDate });
        reactivatedFrom = { endedReason: prior.endedReason, endDate: prior.endDate, clearedWeeksOff: cleared };
        await tx.update(shiftAssignmentsTable).set({ endDate: null, endedReason: null, updatedAt: now,
          createdByUserId: actor.id }).where(eq(shiftAssignmentsTable.id, prior.id));
        assignmentId = prior.id;
      } else {
        const [a] = await tx.insert(shiftAssignmentsTable).values({ volunteerProfileId: profile.id, shiftSlotId: slot.id,
          startDate: first, createdByUserId: actor.id }).returning();
        assignmentId = a!.id;
      }
      message = `The weekly ${weekdays[slot.dayOfWeek]} shift, ${clock(slot.startTime)}–${clock(slot.endTime)}, is assigned starting ${first}.`;
    } else if (input.kind === 'remove') {
      await tx.update(shiftAssignmentsTable).set({ endDate: today, endedReason: 'admin_removed', updatedAt: now })
        .where(eq(shiftAssignmentsTable.id, old!.id));
      const slot = data.slots.find(s => s.id === old!.shiftSlotId)!;
      released = true; message = `The weekly ${weekdays[slot.dayOfWeek]} shift, ${clock(slot.startTime)}–${clock(slot.endTime)}, has been released.`;
    } else {
      const slot = data.slots.find(s => s.id === old!.shiftSlotId)!;
      if (input.kind === 'skip') {
        const date = calendarDay(input.date);
        const occurrence = createScheduleService({ ...data, skips: [] }).getOccurrences(date, date)
          .find(o => o.slot.id === slot.id && o.assignedVolunteers.some(a => a.assignmentId === old!.id));
        if (!occurrence || occurrence.endsAt <= now || date > addCalendarDays(today, 365))
          throw new WorkflowError(422, 'Choose an upcoming occurrence that is not closed.');
        const saved = await tx.insert(shiftSkipsTable).values({ shiftAssignmentId: old!.id, skipDate: date })
          .onConflictDoNothing().returning();
        released = saved.length > 0; message = 'The week off has been recorded.';
      } else {
        const [skip] = await tx.select().from(shiftSkipsTable).where(and(eq(shiftSkipsTable.id, input.skipId),
          eq(shiftSkipsTable.shiftAssignmentId, old!.id)));
        if (!skip) throw new WorkflowError(404, 'This week off could not be found.');
        if (slotInstant(skip.skipDate, slot.endTime) <= now) throw new WorkflowError(422, 'This shift has ended.');
        const conflict=customOverlap(data,profile.id,skip.skipDate,slot.startTime,slot.endTime,slot.id);
        if(conflict)throw new WorkflowError(422,overlapMessage(skip.skipDate,conflict.slot.startTime,conflict.slot.endTime));
        await tx.delete(shiftSkipsTable).where(eq(shiftSkipsTable.id, skip.id));
        message = 'The volunteer is back on the schedule for that date.';
      }
    }
    const [activity] = await tx.insert(activityLogTable).values({ volunteerProfileId: profile.id, actorUserId: actor.id,
      action: `admin_shift_${input.kind}`, details: { assignmentId, override: input.kind === 'assign' && input.override,
        reason: input.kind === 'assign' ? input.reason?.trim() ?? null : null, overrides,
        ...(old ? { previousAssignments: [old] } : {}), ...(reactivatedFrom ? { reactivatedFrom } : {}),
        ...(input.kind === 'skip' ? { date: input.date } : {}),
        ...(input.kind === 'remove' ? { emailVolunteer: input.emailVolunteer } : {}) } }).returning();
    return { assignmentId, message, user, activityId: activity!.id,
      event: released ? { volunteerProfileId: profile.id, assignmentIds: [old!.id], shiftSlotIds: [old!.shiftSlotId],
        effectiveDate: today, activityId: activity!.id } : null };
  });
  let emailWarning: string | null = null;
  if (result.event) try { await onAssignmentsReleased(result.event, now); }
  catch (err) { logger.error({ err, activityId: result.activityId }, 'Coverage alert failed after saved staff action.');
    emailWarning = 'The schedule is saved, but the coverage alert could not be completed.'; }
  if (input.kind === 'assign' || input.kind === 'remove' && input.emailVolunteer) {
    const copy = createEmailTemplate({ heading: input.kind === 'assign' ? 'Your weekly shift is confirmed' : 'Your schedule has been updated',
      firstName: result.user.firstName, paragraphs: [result.message,
        `Thank you for the care you share with local families. Please contact ${volunteerContactText} if you have questions about this change.`],
      cta: { label: 'View my shifts', url: `${appOrigin}/shifts` } });
    const sent = await sendEmail({ type: 'shift', to: result.user.email, toUserId: result.user.id,
      subject: input.kind === 'assign' ? 'Your weekly shift is confirmed' : 'Your weekly shift has been released',
      ...copy, relatedId: result.activityId });
    if (!sent.ok) emailWarning = 'The schedule is saved, but the volunteer email could not be sent.';
  }
  return { message: result.message, assignmentId: result.assignmentId, emailWarning };
}
