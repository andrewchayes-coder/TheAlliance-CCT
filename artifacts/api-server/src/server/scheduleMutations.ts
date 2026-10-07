import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  db, shiftSlotsTable, shiftAssignmentsTable, usersTable, volunteerProfilesTable, activityLogTable, notificationLogTable,
} from '@workspace/db';
import { ongoingForSlot, type ScheduleTransaction } from './scheduleRepository';
import { calendarDay, pacificDay, slotIsActive } from './scheduleService';
import { WorkflowError } from '../admin-volunteer-detail';
import { sendEmail, createEmailTemplate } from '../email';
import { appOrigin } from '../auth/session';
import { onAssignmentsReleased } from '../uncovered-shifts';
import { logger } from '../lib/logger';
export type SlotInput = { dayOfWeek: number; startTime: string; endTime: string; capacity: number; label: string | null; isActive: boolean };
export type SlotUpdate = SlotInput & {
  expectedUpdatedAt: string; expectedAssignmentIds: string[]; cancelRetirement?: boolean;
  deactivation?: { mode: 'now' | 'keep_until'; keepUntilDate?: string };
};
/** Future assignment writers must acquire this before user/profile/slot locks. */
export const lockSchedule = (tx: ScheduleTransaction) => tx.execute(sql`select pg_advisory_xact_lock(91847310)`);
const sameIds = (a: string[], b: string[]) => a.length === b.length && [...a].sort().every((id, i) => id === [...b].sort()[i]);

export async function updateSlot(slotId: string, input: SlotUpdate, actorUserId: string) {
  const today = pacificDay(new Date());
  const result = await db.transaction(async tx => {
    await lockSchedule(tx);
    const [slot] = await tx.select().from(shiftSlotsTable).where(eq(shiftSlotsTable.id, slotId)).for('update');
    if (!slot) throw new WorkflowError(404, 'This shift slot could not be found.');
    if (slot.updatedAt.getTime() !== new Date(input.expectedUpdatedAt).getTime())
      throw new WorkflowError(409, 'This slot changed. Refresh and review it before saving.');
    let held = await tx.select().from(shiftAssignmentsTable).where(ongoingForSlot(slotId, today));
    const people = held.length ? await tx.select({ user: usersTable, profile: volunteerProfilesTable }).from(volunteerProfilesTable)
      .innerJoin(usersTable, eq(usersTable.id, volunteerProfilesTable.userId))
      .where(inArray(volunteerProfilesTable.id, held.map(a => a.volunteerProfileId))).orderBy(usersTable.id) : [];
    // Existing profile-status writer locks a single user, then profile. Never lock assignments first.
    for (const p of people) {
      await tx.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.id, p.user.id)).for('update');
      await tx.select({ id: volunteerProfilesTable.id }).from(volunteerProfilesTable).where(eq(volunteerProfilesTable.id, p.profile.id)).for('update');
    }
    held = await tx.select().from(shiftAssignmentsTable).where(ongoingForSlot(slotId, today));
    if (!sameIds(input.expectedAssignmentIds, held.map(a => a.id)))
      throw new WorkflowError(409, 'The assigned volunteers changed. Refresh and review the assignment count before saving.');
    const count = new Set(held.map(a => a.volunteerProfileId)).size;
    if (input.capacity < count) throw new WorkflowError(422, `${count} volunteers are assigned. Capacity cannot be reduced below ${count}; move or end assignments first.`);
    if (!input.isActive && count && !input.deactivation)
      throw new WorkflowError(400, `Choose when to end the assignments for these ${count} volunteers.`);
    let retireAfterDate = input.isActive && slotIsActive(slot, today) && !input.cancelRetirement ? slot.retireAfterDate : null;
    const mode = !input.isActive ? input.deactivation?.mode ?? 'now' : null;
    if (mode === 'keep_until') {
      if (!input.deactivation?.keepUntilDate) throw new WorkflowError(400, 'Choose the last date volunteers can keep this shift.');
      retireAfterDate = calendarDay(input.deactivation.keepUntilDate);
      if (retireAfterDate < today) throw new WorkflowError(400, 'Choose today or a future date.');
    }
    // Revisions must change even within one millisecond or after a clock correction.
    const changedAt = new Date(Math.max(Date.now(), slot.updatedAt.getTime() + 1));
    await tx.update(shiftSlotsTable).set({ dayOfWeek: input.dayOfWeek, startTime: input.startTime, endTime: input.endTime,
      capacity: input.capacity, label: input.label, isActive: mode === 'keep_until' ? true : input.isActive,
      retireAfterDate, updatedAt: changedAt }).where(eq(shiftSlotsTable.id, slotId));
    const effects = [];
    if (mode) {
      for (const p of people) {
        const owned = held.filter(a => a.volunteerProfileId === p.profile.id);
        if (!owned.length) continue;
        const immediate = owned.filter(a => mode === 'now' || a.startDate > retireAfterDate!);
        for (const a of owned) {
          const cancelledNow = immediate.some(b => b.id === a.id);
          const endDate = cancelledNow ? today : (a.endDate && a.endDate < retireAfterDate! ? a.endDate : retireAfterDate!);
          await tx.update(shiftAssignmentsTable).set({ endDate, endedReason: cancelledNow ? 'admin_removed' : (a.endedReason ?? 'changed'),
            updatedAt: changedAt }).where(eq(shiftAssignmentsTable.id, a.id));
        }
        const [activity] = await tx.insert(activityLogTable).values({ volunteerProfileId: p.profile.id, actorUserId,
          action: 'shift_slot_deactivated', details: { slotId, mode, keepUntilDate: retireAfterDate,
            assignmentIds: owned.map(a => a.id), releasedAssignmentIds: immediate.map(a => a.id) } }).returning();
        effects.push({ user: p.user, profileId: p.profile.id, activityId: activity!.id, released: immediate.map(a => a.id),
          keptCount: owned.length - immediate.length, keepUntilDate: retireAfterDate });
      }
    }
    return { slot, effects };
  });
  const emailSummary = { sent: 0, logged: 0, failed: 0 };
  let releasedAssignmentCount = 0;
  for (const effect of result.effects) {
    if (!effect.released.length) continue;
    releasedAssignmentCount += effect.released.length;
    try { await onAssignmentsReleased({ volunteerProfileId: effect.profileId, assignmentIds: effect.released,
      shiftSlotIds: [slotId], effectiveDate: today, activityId: effect.activityId }); }
    catch (error) { logger.error({ err: error }, 'Released shifts await the later coverage-check step.'); }
    const weekday = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'][result.slot.dayOfWeek];
    const copy = createEmailTemplate({ heading: 'An update to your weekly shift', firstName: effect.user.firstName,
      paragraphs: [
        effect.keepUntilDate ?
          `The Alliance is retiring the ${weekday} shift, ${result.slot.startTime}–${result.slot.endTime}, after ${effect.keepUntilDate}. Your future reservation will not begin because its start date is after the slot closes.${effect.keptCount ? ` Your current assignment continues through ${effect.keepUntilDate}.` : ''}` :
          `The Alliance is updating its shift grid. Your ${weekday} shift, ${result.slot.startTime}–${result.slot.endTime}, has been released as of ${today}.`,
        "Thank you for the care and time you share with local families. This is a schedule change, not a reflection of your contribution.",
        "Please choose another weekly shift when you're ready, or contact The Alliance if you'd like help finding a time that works for you.",
      ], cta: { label: 'Review my shifts', url: `${appOrigin}/shifts` } });
    const delivery = await sendEmail({ type: 'message', to: effect.user.email, toUserId: effect.user.id,
      subject: 'An update to your weekly Alliance shift', ...copy, relatedId: effect.activityId });
    if (!delivery.ok) { emailSummary.failed++; continue; }
    try {
      const [log] = await db.select({ status: notificationLogTable.status }).from(notificationLogTable)
        .where(and(eq(notificationLogTable.relatedId, effect.activityId), eq(notificationLogTable.recipientUserId, effect.user.id))).limit(1);
      if (log?.status === 'sent') emailSummary.sent++; else if (log?.status === 'logged') emailSummary.logged++; else emailSummary.failed++;
    } catch (error) { emailSummary.failed++; logger.error({ err: error }, 'Email audit could not be read. Review the notification log.'); }
  }
  return { releasedAssignmentCount, emailSummary };
}

export async function copyMonday() {
  return db.transaction(async tx => {
    await lockSchedule(tx);
    const slots = await tx.select().from(shiftSlotsTable);
    const today = pacificDay(new Date()), ids: string[] = [];
    const monday = slots.filter(s => s.dayOfWeek === 1 && slotIsActive(s, today) && !s.retireAfterDate);
    if (!monday.length) throw new WorkflowError(400, 'Add an active Monday slot first.');
    for (let day = 2; day <= 5; day++) {
      const used = new Set<string>();
      for (const source of monday) {
        const match = slots.find(s => !used.has(s.id) && s.dayOfWeek === day && s.isActive && !s.retireAfterDate &&
          s.startTime === source.startTime && s.endTime === source.endTime && s.capacity === source.capacity && s.label === source.label);
        if (match) { used.add(match.id); continue; }
        const [created] = await tx.insert(shiftSlotsTable).values({ dayOfWeek: day, startTime: source.startTime,
          endTime: source.endTime, capacity: source.capacity, label: source.label, isActive: true }).returning();
        ids.push(created!.id); used.add(created!.id); slots.push(created!);
      }
    }
    return ids;
  });
}
