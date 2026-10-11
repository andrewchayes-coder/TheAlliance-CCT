import {and,eq,isNull,inArray} from 'drizzle-orm';
import {db,usersTable,volunteerProfilesTable,shiftSlotsTable,slotBlocksTable,customShiftsTable,customShiftAssignmentsTable,activityLogTable} from '@workspace/db';
import {standardGrid} from '@workspace/shared/standardGrid';
import {lockSchedule} from './scheduleMutations';
import {readScheduleData} from './scheduleRepository';
import {createScheduleService,calendarDay,addCalendarDays,slotInstant} from './scheduleService';
import {WorkflowError} from '../admin-volunteer-detail';
import {checkScheduleActor,sendScheduleNotice,type ScheduleActor} from './customShiftService';
export async function scheduleExtras() {
  return db.transaction(async tx=>{
    const blocks=await tx.select().from(slotBlocksTable).orderBy(slotBlocksTable.date,slotBlocksTable.shiftSlotId);
    const customShifts=await tx.select().from(customShiftsTable).where(isNull(customShiftsTable.cancelledAt)).orderBy(customShiftsTable.date,customShiftsTable.startTime);
    const assigned=await tx.select({id:customShiftAssignmentsTable.id,customShiftId:customShiftAssignmentsTable.customShiftId,
      volunteerProfileId:volunteerProfilesTable.id,userId:usersTable.id,firstName:usersTable.firstName,lastName:usersTable.lastName,isTestAccount:usersTable.isTestAccount})
      .from(customShiftAssignmentsTable).innerJoin(volunteerProfilesTable,eq(volunteerProfilesTable.id,customShiftAssignmentsTable.volunteerProfileId))
      .innerJoin(usersTable,eq(usersTable.id,volunteerProfilesTable.userId)).where(isNull(customShiftAssignmentsTable.cancelledAt));
    return {blocks,customShifts:customShifts.map(s=>({...s,assignments:assigned.filter(a=>a.customShiftId===s.id)}))};
  },{isolationLevel:'repeatable read'});
}
export async function loadStandardGrid(actor:ScheduleActor) {
  return db.transaction(async tx=>{
    await lockSchedule(tx);await checkScheduleActor(tx,actor,'admin');
    const slots=await tx.select().from(shiftSlotsTable);
    const missing=standardGrid.filter(s=>!slots.some(o=>o.dayOfWeek===s.dayOfWeek && o.startTime===s.startTime && o.endTime===s.endTime));
    if(missing.length) await tx.insert(shiftSlotsTable).values(missing);
    return {created:missing.length,skipped:40-missing.length};
  });
}
export async function blockSlots(actor:ScheduleActor,input:{fromDate:string;toDate:string;slotIds?:string[];reason:string;emailVolunteers:boolean},now=new Date()) {
  const from=calendarDay(input.fromDate),to=calendarDay(input.toDate);
  if(to<from || to>addCalendarDays(from,366)) throw new WorkflowError(422,'Choose an ordered range of no more than one year.');
  const notices=await db.transaction(async tx=>{
    await lockSchedule(tx);await checkScheduleActor(tx,actor,'admin');
    const data=await readScheduleData(tx);
    const selected=input.slotIds?data.slots.filter(s=>input.slotIds!.includes(s.id)):data.slots.filter(s=>s.isActive);
    if(!selected.length || input.slotIds?.some(id=>!selected.some(s=>s.id===id))) throw new WorkflowError(422,'Choose at least one existing weekly shift.');
    const occurrences=createScheduleService(data).getOccurrences(from,to);
    const notices:{user:{id:string;email:string};subject:string;body:string;key:string}[]=[];
    for(let date=from;date<=to;date=addCalendarDays(date,1)) for(const slot of selected) {
      if(new Date(`${date}T00:00:00Z`).getUTCDay()!==slot.dayOfWeek) continue;
      const [created]=await tx.insert(slotBlocksTable).values({shiftSlotId:slot.id,date,reason:input.reason,createdByUserId:actor.id})
        .onConflictDoNothing().returning();
      if(!created)continue;
      const occ=occurrences.find(o=>o.kind!=='custom' && o.slot.id===slot.id && o.date===date);
      for(const a of occ?.assignedVolunteers??[]) {
        await tx.insert(activityLogTable).values({volunteerProfileId:a.volunteerProfileId,actorUserId:actor.id,
          action:'slot_blocked',details:{slotId:slot.id,date,blockId:created.id}});
        if(!input.emailVolunteers || occ!.endsAt<=now)continue;
        const [user]=await tx.select({id:usersTable.id,email:usersTable.email}).from(usersTable)
          .innerJoin(volunteerProfilesTable,eq(volunteerProfilesTable.userId,usersTable.id)).where(eq(volunteerProfilesTable.id,a.volunteerProfileId));
        const label=new Intl.DateTimeFormat('en-US',{timeZone:'UTC',weekday:'long',month:'short',day:'numeric'}).format(new Date(`${date}T12:00:00Z`));
        if(user)notices.push({user,subject:`No shift on ${label} — ${input.reason}`,body:'Your regular shift continues the following week. Thank you for your flexibility and care.',key:`block:${created.id}`});
      }
    }
    return notices;
  });
  for(const n of notices)await sendScheduleNotice(n.user,n.subject,[n.body],n.key);
  return scheduleExtras();
}
export async function unblockSlot(actor:ScheduleActor,id:string) {
  await db.transaction(async tx=>{
    await lockSchedule(tx);await checkScheduleActor(tx,actor,'admin');
    const [block]=await tx.select().from(slotBlocksTable).where(eq(slotBlocksTable.id,id)).for('update');
    if(!block)throw new WorkflowError(404,'This shift block could not be found.');
    const data=await readScheduleData(tx);
    const occurrences=createScheduleService({...data,blocks:data.blocks.filter(b=>b.id!==id)}).getOccurrences(block.date,block.date);
    const restored=occurrences.find(o=>o.slot.id===block.shiftSlotId);
    if(restored && occurrences.some(o=>o.kind==='custom' && o.slot.startTime<restored.slot.endTime && restored.slot.startTime<o.slot.endTime &&
      o.assignedVolunteers.some(a=>restored.assignedVolunteers.some(b=>b.volunteerProfileId===a.volunteerProfileId))))
      throw new WorkflowError(422,'Unblocking would overlap an assigned one-time shift. Resolve that reservation first.');
    await tx.delete(slotBlocksTable).where(eq(slotBlocksTable.id,id));
    for(const a of restored?.assignedVolunteers??[])await tx.insert(activityLogTable).values({volunteerProfileId:a.volunteerProfileId,
      actorUserId:actor.id,action:'slot_unblocked',details:{slotId:block.shiftSlotId,date:block.date}});
  });
  return scheduleExtras();
}
export async function createCustom(actor:ScheduleActor,input:{date:string;startTime:string;endTime:string;capacity:number;label?:string|null;openToVolunteers:boolean},now=new Date()) {
  const date=calendarDay(input.date);
  if(slotInstant(date,input.startTime)<=now)throw new WorkflowError(422,'Choose a start time in the future.');
  await db.transaction(async tx=>{
    await lockSchedule(tx);await checkScheduleActor(tx,actor,'admin');
    const data=await readScheduleData(tx);
    if(data.closedDates.some(c=>c.date===date))throw new WorkflowError(422,'This date is closed. Choose another date.');
    await tx.insert(customShiftsTable).values({...input,date,createdByUserId:actor.id});
  });
  return scheduleExtras();
}
export async function cancelCustom(actor:ScheduleActor,id:string,now=new Date()) {
  const cancelled=await db.transaction(async tx=>{
    await lockSchedule(tx);await checkScheduleActor(tx,actor,'admin');
    const [shift]=await tx.select().from(customShiftsTable).where(eq(customShiftsTable.id,id)).for('update');
    if(!shift)throw new WorkflowError(404,'This one-time shift could not be found.');
    if(shift.cancelledAt)return {shift,people:[]};
    const assignments=await tx.select().from(customShiftAssignmentsTable).where(and(eq(customShiftAssignmentsTable.customShiftId,id),isNull(customShiftAssignmentsTable.cancelledAt)));
    const people=assignments.length?await tx.select({id:usersTable.id,email:usersTable.email,profileId:volunteerProfilesTable.id})
      .from(usersTable).innerJoin(volunteerProfilesTable,eq(volunteerProfilesTable.userId,usersTable.id))
      .where(inArray(volunteerProfilesTable.id,assignments.map(a=>a.volunteerProfileId))):[];
    await tx.update(customShiftsTable).set({cancelledAt:now}).where(eq(customShiftsTable.id,id));
    await tx.update(customShiftAssignmentsTable).set({cancelledAt:now}).where(and(eq(customShiftAssignmentsTable.customShiftId,id),isNull(customShiftAssignmentsTable.cancelledAt)));
    for(const p of people)await tx.insert(activityLogTable).values({volunteerProfileId:p.profileId,actorUserId:actor.id,
      action:'custom_shift_cancelled',details:{customShiftId:id}});
    return {shift,people};
  });
  for(const p of cancelled.people)await sendScheduleNotice(p,'Your one-time shift has been cancelled',
    [`There is no one-time shift on ${cancelled.shift.date}, ${cancelled.shift.startTime}–${cancelled.shift.endTime} (Pacific time).`,
      'Your regular weekly shifts continue as usual. Thank you for your flexibility.'],`custom-cancel:${id}`);
  return scheduleExtras();
}
