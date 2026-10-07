import { and, eq, gte, inArray, isNull, ne, or } from 'drizzle-orm';
import { db, shiftSlotsTable, shiftAssignmentsTable, shiftSkipsTable, closedDatesTable } from '@workspace/db';
import { GetScheduleSettingsResponse } from '@workspace/api-zod';
import { assignmentIsHeld, pacificDay, slotIsActive, createScheduleService } from './scheduleService';
export type ScheduleTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export const ongoingForSlot = (slotId: string, today: string) => and(
  eq(shiftAssignmentsTable.shiftSlotId, slotId),
  or(isNull(shiftAssignmentsTable.endedReason), ne(shiftAssignmentsTable.endedReason, 'admin_removed')),
  or(isNull(shiftAssignmentsTable.endDate), gte(shiftAssignmentsTable.endDate, today)),
);
/** No cached snapshot: closed dates and edits take effect on the next read. */
export async function readScheduleData(tx: ScheduleTransaction, profileId?: string) {
  const slots = await tx.select().from(shiftSlotsTable);
  const assignments = await tx.select().from(shiftAssignmentsTable)
    .where(profileId ? eq(shiftAssignmentsTable.volunteerProfileId, profileId) : undefined);
  const skips = assignments.length ? await tx.select().from(shiftSkipsTable)
    .where(inArray(shiftSkipsTable.shiftAssignmentId, assignments.map(a => a.id))) : [];
  const closedDates = await tx.select().from(closedDatesTable).orderBy(closedDatesTable.date);
  return { slots, assignments, skips, closedDates };
}
/** Scope volunteer consumers at the query, never project a global personnel snapshot. */
export async function loadScheduleService(profileId?: string) {
  return db.transaction(async tx => createScheduleService(await readScheduleData(tx, profileId)),
    { isolationLevel: 'repeatable read' });
}
export async function scheduleSettings(now = new Date()) {
  const today = pacificDay(now);
  return db.transaction(async tx => {
    const data = await readScheduleData(tx);
    const parsed = GetScheduleSettingsResponse.parse({
      slots: data.slots.sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.startTime.localeCompare(b.startTime) || a.id.localeCompare(b.id))
        .map(slot => {
          const held = data.assignments.filter(a => a.shiftSlotId === slot.id && assignmentIsHeld(a, today));
          return { ...slot, isActive: slotIsActive(slot, today),
            assignedCount: new Set(held.map(a => a.volunteerProfileId)).size, assignmentIds: held.map(a => a.id).sort(),
            overlaps: data.slots.filter(s => s.id !== slot.id && s.dayOfWeek === slot.dayOfWeek &&
              s.startTime < slot.endTime && slot.startTime < s.endTime).map(s => ({
                id: s.id, startTime: s.startTime, endTime: s.endTime, label: s.label,
              })),
          };
        }),
      closedDates: data.closedDates.map(c => ({ id: c.id, date: c.date, reason: c.reason })),
    });
    // Generated Zod coerces format:date to Date; the HTTP contract is a calendar string,
    // not a midnight-UTC instant that would render as the previous Pacific day.
    return { ...parsed, slots: parsed.slots.map(s => ({ ...s,
      retireAfterDate: s.retireAfterDate ? s.retireAfterDate.toISOString().slice(0, 10) : null })),
      closedDates: parsed.closedDates.map(c => ({ ...c, date: c.date.toISOString().slice(0, 10) })) };
  }, { isolationLevel: 'repeatable read' });
}
