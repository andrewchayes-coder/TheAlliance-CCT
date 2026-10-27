import { beforeAll, afterAll, it, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq, inArray, or } from 'drizzle-orm';
import { db, pool, usersTable, volunteerProfilesTable, shiftSlotsTable, shiftAssignmentsTable,
  shiftSkipsTable, customShiftsTable, customShiftAssignmentsTable, activityLogTable, notificationLogTable } from '@workspace/db';
import { adminScheduleAction, adminScheduleControls } from './adminScheduleControls';
import { customAssignmentAction } from './customShiftService';
import { coordinatorSnapshot } from './coordinatorRepository';
import { slotInstant } from './scheduleService';
import { setAccountActive } from '../auth/admin-management';
import { scheduleParticipantBlockers } from './scheduleParticipants';
import * as email from '../email';

const tag = `staff-shifts-${randomUUID()}`;
const ids: string[] = [], slots: string[] = [], customIds: string[] = [];
let actor: { id: string; sessionVersion: number };
async function overview(at: Date) {
  const result = await coordinatorSnapshot(undefined, at);
  if (!('onShiftNow' in result)) throw new Error('Expected a dispatch overview.');
  return result;
}
beforeAll(async () => {
  if (!process.env.QA_REGRESSION_SCHEMA?.startsWith('qa_regression_'))
    throw new Error('Staff shift tests require the isolated development regression runner.');
  vi.spyOn(email, 'sendEmail').mockResolvedValue({ ok: true });
  for (let i = 0; i < 4; i++) {
    const [u] = await db.insert(usersTable).values({ email: `${tag}-${i}@example.invalid`,
      firstName: 'Schedule', lastName: `Staff ${i}`, passwordHash: 'fixture-only',
      role: i === 3 ? 'volunteer' : 'admin', emailVerifiedAt: i === 2 ? null : new Date(),
      phone: '5555550100' }).returning();
    ids.push(u!.id);
  }
  actor = { id: ids[0]!, sessionVersion: 0 };
  for (const [startTime, endTime] of [['08:00', '10:00'], ['09:00', '11:00']]) {
    const [slot] = await db.insert(shiftSlotsTable).values({
      dayOfWeek: 1, startTime, endTime, capacity: 1, label: tag }).returning();
    slots.push(slot!.id);
  }
});
afterAll(async () => {
  vi.restoreAllMocks();
  const profiles = await db.select({ id: volunteerProfilesTable.id }).from(volunteerProfilesTable)
    .where(inArray(volunteerProfilesTable.userId, ids));
  const pids = profiles.map(p => p.id);
  if (pids.length) {
    const activities = await db.select({ id: activityLogTable.id }).from(activityLogTable)
      .where(inArray(activityLogTable.volunteerProfileId, pids));
    await db.delete(notificationLogTable).where(or(inArray(notificationLogTable.recipientUserId, ids),
      activities.length ? inArray(notificationLogTable.relatedId, activities.map(a => a.id)) : undefined));
    await db.delete(activityLogTable).where(inArray(activityLogTable.volunteerProfileId, pids));
    const assignments = await db.select({ id: shiftAssignmentsTable.id }).from(shiftAssignmentsTable)
      .where(inArray(shiftAssignmentsTable.volunteerProfileId, pids));
    if (assignments.length) await db.delete(shiftSkipsTable)
      .where(inArray(shiftSkipsTable.shiftAssignmentId, assignments.map(a => a.id)));
    await db.delete(shiftAssignmentsTable).where(inArray(shiftAssignmentsTable.volunteerProfileId, pids));
    await db.delete(customShiftAssignmentsTable).where(inArray(customShiftAssignmentsTable.volunteerProfileId, pids));
    await db.delete(volunteerProfilesTable).where(inArray(volunteerProfilesTable.id, pids));
  }
  if (customIds.length) await db.delete(customShiftsTable).where(inArray(customShiftsTable.id, customIds));
  if (slots.length) await db.delete(shiftSlotsTable).where(inArray(shiftSlotsTable.id, slots));
  if (ids.length) await db.delete(usersTable).where(inArray(usersTable.id, ids));
  await pool.end();
});

it('admins take weekly and one-time shifts, retain roles, count in dispatch, and use normal safety controls', async () => {
  const candidates = await adminScheduleControls({ userId: actor.id });
  expect(candidates.volunteers).toEqual([expect.objectContaining({ userId: actor.id, role: 'admin', blockedReasons: [] })]);
  expect(await db.select().from(volunteerProfilesTable).where(eq(volunteerProfilesTable.userId, actor.id))).toHaveLength(0);
  const booked = await adminScheduleAction(actor, { kind: 'assign', userId: actor.id, slotId: slots[0]!, override: false });
  const [assignment] = await db.select().from(shiftAssignmentsTable).where(eq(shiftAssignmentsTable.id, booked.assignmentId));
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, actor.id));
  expect(user!.role).toBe('admin');
  const [profile] = await db.select().from(volunteerProfilesTable).where(eq(volunteerProfilesTable.userId, actor.id));
  expect(profile!.status).toBe('active');
  expect(scheduleParticipantBlockers(user!, profile)).toEqual([]);
  expect(email.sendEmail).toHaveBeenCalledWith(expect.objectContaining({ toUserId: actor.id,
    html: expect.stringContaining('/admin/schedule') }));

  await expect(adminScheduleAction(actor, { kind: 'assign', userId: ids[1]!, slotId: slots[0]!, override: false }))
    .rejects.toMatchObject({ status: 422 });
  await expect(adminScheduleAction(actor, { kind: 'assign', userId: actor.id, slotId: slots[1]!, override: true, reason: 'Coverage' }))
    .rejects.toMatchObject({ status: 422 });
  await adminScheduleAction(actor, { kind: 'assign', userId: ids[1]!, slotId: slots[0]!, override: true, reason: 'Staff coverage' });

  const at = new Date(slotInstant(assignment!.startDate, '08:00').getTime() + 30 * 60_000);
  const live = await overview(at);
  expect(live.onShiftNow.flatMap(b => b.volunteers)).toEqual(expect.arrayContaining([
    expect.objectContaining({ userId: actor.id, role: 'admin' }), expect.objectContaining({ userId: ids[1], role: 'admin' }),
  ]));
  const next = await overview(new Date(at.getTime() - 60 * 60_000));
  expect(next.upNext.flatMap(b => b.volunteers)).toEqual(expect.arrayContaining([expect.objectContaining({ userId: actor.id })]));

  await adminScheduleAction(actor, { kind: 'skip', assignmentId: booked.assignmentId, date: assignment!.startDate });
  expect((await overview(at)).onShiftNow.flatMap(b => b.volunteers).some(v => v.userId === actor.id)).toBe(false);
  const [skip] = await db.select().from(shiftSkipsTable).where(eq(shiftSkipsTable.shiftAssignmentId, booked.assignmentId));
  // Even staff cannot undo into a full occurrence without releasing its replacement.
  await expect(adminScheduleAction(actor, { kind: 'undo', assignmentId: booked.assignmentId, skipId: skip!.id }))
    .rejects.toMatchObject({ status: 409 });
  const [replacement] = await db.select().from(volunteerProfilesTable).where(eq(volunteerProfilesTable.userId, ids[1]!));
  const [replacementAssignment] = await db.select().from(shiftAssignmentsTable)
    .where(eq(shiftAssignmentsTable.volunteerProfileId, replacement!.id));
  await adminScheduleAction(actor, { kind: 'remove', assignmentId: replacementAssignment!.id, emailVolunteer: false });
  await adminScheduleAction(actor, { kind: 'undo', assignmentId: booked.assignmentId, skipId: skip!.id });
  await adminScheduleAction(actor, { kind: 'assign', userId: ids[1]!, slotId: slots[0]!, override: true, reason: 'Staff coverage' });

  const [custom] = await db.insert(customShiftsTable).values({ date: assignment!.startDate,
    startTime: '11:00', endTime: '12:00', capacity: 1, label: tag, createdByUserId: actor.id }).returning();
  customIds.push(custom!.id);
  await customAssignmentAction(actor, { kind: 'assign', userId: actor.id, customShiftId: custom!.id }, true);
  await expect(customAssignmentAction(actor, { kind: 'assign', userId: ids[1]!, customShiftId: custom!.id }, true))
    .rejects.toMatchObject({ status: 409 });
  await customAssignmentAction(actor, { kind: 'assign', userId: ids[1]!, customShiftId: custom!.id,
    override: true, reason: 'Staff coverage' }, true);
  expect(await db.select().from(volunteerProfilesTable).where(eq(volunteerProfilesTable.userId, actor.id))).toHaveLength(1);

  await setAccountActive(actor, ids[1]!, false);
  const [otherProfile] = await db.select().from(volunteerProfilesTable).where(eq(volunteerProfilesTable.userId, ids[1]!));
  expect((await db.select().from(shiftAssignmentsTable).where(eq(shiftAssignmentsTable.volunteerProfileId, otherProfile!.id)))[0]!.endedReason)
    .toBe('admin_removed');
  expect((await db.select().from(customShiftAssignmentsTable).where(eq(customShiftAssignmentsTable.volunteerProfileId, otherProfile!.id)))[0]!.cancelledAt)
    .not.toBeNull();
  expect((await overview(at)).onShiftNow.flatMap(b => b.volunteers).some(v => v.userId === ids[1])).toBe(false);
  await adminScheduleAction(actor, { kind: 'remove', assignmentId: booked.assignmentId, emailVolunteer: false });
});

it('inactive/unverified staff cannot be assigned and volunteers cannot use staff override actions', async () => {
  await expect(adminScheduleAction(actor, { kind: 'assign', userId: ids[2]!, slotId: slots[0]!, override: false }))
    .rejects.toMatchObject({ status: 422 });
  expect(await db.select().from(volunteerProfilesTable).where(eq(volunteerProfilesTable.userId, ids[2]!))).toHaveLength(0);
  await expect(adminScheduleAction(actor, { kind: 'assign', userId: ids[1]!, slotId: slots[0]!, override: false }))
    .rejects.toMatchObject({ status: 422 });
  await expect(adminScheduleAction({ id: ids[3]!, sessionVersion: 0 },
    { kind: 'assign', userId: ids[3]!, slotId: slots[0]!, override: true, reason: 'Not allowed' }))
    .rejects.toMatchObject({ status: 403 });
});
