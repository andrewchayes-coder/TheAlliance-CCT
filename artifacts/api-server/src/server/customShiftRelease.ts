import {and,eq,isNull,inArray} from 'drizzle-orm';
import {customShiftsTable,customShiftAssignmentsTable} from '@workspace/db';
import type {ScheduleTransaction} from './scheduleRepository';
import {slotInstant} from './scheduleService';
/** Cancel future one-time reservations alongside standing shifts; reactivation must not resurrect them. */
export async function releaseCustomAssignments(tx:ScheduleTransaction,profileId:string,now=new Date()) {
  const rows=await tx.select({assignment:customShiftAssignmentsTable,shift:customShiftsTable})
    .from(customShiftAssignmentsTable).innerJoin(customShiftsTable,eq(customShiftsTable.id,customShiftAssignmentsTable.customShiftId))
    .where(and(eq(customShiftAssignmentsTable.volunteerProfileId,profileId),isNull(customShiftAssignmentsTable.cancelledAt),isNull(customShiftsTable.cancelledAt)));
  const previous=rows.filter(r=>slotInstant(r.shift.date,r.shift.endTime)>now).map(r=>r.assignment);
  if(previous.length)await tx.update(customShiftAssignmentsTable).set({cancelledAt:now}).where(inArray(customShiftAssignmentsTable.id,previous.map(a=>a.id)));
  return previous;
}
