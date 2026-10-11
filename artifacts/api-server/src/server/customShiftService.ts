import {and,eq,isNull} from 'drizzle-orm';
import {db,usersTable,volunteerProfilesTable,customShiftsTable,customShiftAssignmentsTable,activityLogTable} from '@workspace/db';
import {WorkflowError,lockedVolunteer,approvalRequirements} from '../admin-volunteer-detail';
import {lockSchedule} from './scheduleMutations';
import {readScheduleData,type ScheduleTransaction} from './scheduleRepository';
import {createScheduleService,pacificDay,slotInstant,type ScheduleData} from './scheduleService';
import {bookingBlockers} from './volunteerScheduleView';
import {lockAgreementVersion} from './agreements';
import {sendEmail,createEmailTemplate} from '../email';
import {appOrigin} from '../auth/session';
import {notifyCustomReduction} from './coverageAlerts';
import {logger} from '../lib/logger';
export type ScheduleActor={id:string;sessionVersion:number};
export async function checkScheduleActor(tx:ScheduleTransaction,actor:ScheduleActor,role:'admin'|'volunteer') {
  const [user]=await tx.select().from(usersTable).where(eq(usersTable.id,actor.id)).for('update');
  if(!user || user.role!==role || !user.isActive || !user.emailVerifiedAt || user.sessionVersion!==actor.sessionVersion)
    throw new WorkflowError(403,'Please sign in again with an active, verified account.');
  return user;
}
export function customOverlap(data:ScheduleData,profileId:string,date:string,start:string,end:string,excludeId?:string) {
  return createScheduleService(data).getOccurrences(date,date).find(o=>o.slot.id!==excludeId &&
    o.slot.startTime<end && start<o.slot.endTime && o.assignedVolunteers.some(a=>a.volunteerProfileId===profileId));
}
export function overlapMessage(date:string,start:string,end:string) {
  const day=new Intl.DateTimeFormat('en-US',{weekday:'long',timeZone:'UTC'}).format(new Date(`${date}T12:00:00Z`));
  const fmt=(s:string)=>new Intl.DateTimeFormat('en-US',{hour:'numeric',minute:'2-digit',timeZone:'UTC'}).format(new Date(`2000-01-01T${s}:00Z`));
  return `That time overlaps with your ${day} ${fmt(start)}–${fmt(end)} shift.`;
}
export async function sendScheduleNotice(user:{id:string;email:string},subject:string,paragraphs:string[],relatedId:string) {
  const copy=createEmailTemplate({heading:subject,paragraphs,cta:{label:'View my shifts',url:`${appOrigin}/shifts`}});
  return sendEmail({type:'welcome',to:user.email,toUserId:user.id,subject,...copy,relatedId});
}
type CustomAction={kind:'assign';customShiftId:string;userId?:string;override?:boolean;reason?:string}
  |{kind:'remove';customShiftId:string;assignmentId?:string};
/** All regular and custom mutations use the same lock ordering; target row locks serialize the final seat. */
export async function customAssignmentAction(actor:ScheduleActor,input:CustomAction,staff:boolean,now=new Date()) {
  const result=await db.transaction(async tx=>{
    await lockSchedule(tx);
    await checkScheduleActor(tx,actor,staff?'admin':'volunteer');
    const [shift]=await tx.select().from(customShiftsTable).where(eq(customShiftsTable.id,input.customShiftId)).for('update');
    if(!shift || shift.cancelledAt) throw new WorkflowError(404,'This one-time shift is no longer available.');
    if(slotInstant(shift.date,shift.endTime)<=now) throw new WorkflowError(422,'This one-time shift has already ended.');
    let target=staff?input.kind==='assign'?input.userId:undefined:actor.id;
    if(staff && input.kind==='remove') {
      const [row]=await tx.select({userId:volunteerProfilesTable.userId}).from(customShiftAssignmentsTable)
        .innerJoin(volunteerProfilesTable,eq(volunteerProfilesTable.id,customShiftAssignmentsTable.volunteerProfileId))
        .where(and(eq(customShiftAssignmentsTable.id,input.assignmentId!),eq(customShiftAssignmentsTable.customShiftId,shift.id)));
      target=row?.userId;
    }
    if(!target) throw new WorkflowError(404,'Choose a volunteer assigned to this shift.');
    const {user,profile}=await lockedVolunteer(tx,target);
    const active=await tx.select().from(customShiftAssignmentsTable).where(and(eq(customShiftAssignmentsTable.customShiftId,shift.id),isNull(customShiftAssignmentsTable.cancelledAt)));
    const existing=active.find(a=>a.volunteerProfileId===profile.id);
    const data=await readScheduleData(tx);
    let id:string,reason:Record<string,unknown>;
    if(input.kind==='assign') {
      if(!user.isActive || !user.emailVerifiedAt || user.role!=='volunteer' || profile.status!=='active')
        throw new WorkflowError(422,'Only active, verified volunteers can join this shift.');
      if(!staff && !shift.openToVolunteers) throw new WorkflowError(403,'This one-time shift is assigned by Alliance staff.');
      const blockers=staff?approvalRequirements(user,profile).filter(r=>!r.met).map(r=>r.label)
        :bookingBlockers(profile,await lockAgreementVersion(tx));
      if(blockers.length) throw new WorkflowError(422,blockers.join('; '));
      if(slotInstant(shift.date,shift.startTime)<=now || data.closedDates.some(c=>c.date===shift.date))
        throw new WorkflowError(422,'Choose an upcoming shift on an open date.');
      if(existing) return {user,shift,id:existing.id,eventId:existing.id,changed:false,remove:false};
      const overlap=customOverlap(data,profile.id,shift.date,shift.startTime,shift.endTime,shift.id);
      if(overlap) throw new WorkflowError(422,overlapMessage(shift.date,overlap.slot.startTime,overlap.slot.endTime));
      const full=active.length>=shift.capacity;
      if(staff && input.override && !input.reason?.trim()) throw new WorkflowError(422,'Give a reason for the override.');
      if(full && (!staff || !input.override || !input.reason?.trim()))
        throw new WorkflowError(409,staff?'This shift is full. Check Override and give a reason to continue.':'This shift is full. Please choose another open shift.');
      const [saved]=await tx.insert(customShiftAssignmentsTable).values({customShiftId:shift.id,volunteerProfileId:profile.id,createdByUserId:actor.id}).returning();
      id=saved!.id;reason={customShiftId:shift.id,assignmentId:id,override:full,overrides:full?['slot_capacity']:[],...(staff && input.override?{reason:input.reason!.trim()}:{})};
    }else{
      if(!existing || staff && existing.id!==input.assignmentId) throw new WorkflowError(404,'This reservation could not be found.');
      if(!staff && slotInstant(shift.date,shift.startTime).getTime()-now.getTime()<24*3600000)
        throw new WorkflowError(422,'Please contact The Alliance. One-time shifts must be cancelled at least 24 hours before they start.');
      await tx.update(customShiftAssignmentsTable).set({cancelledAt:now}).where(eq(customShiftAssignmentsTable.id,existing.id));
      id=existing.id;reason={customShiftId:shift.id,assignmentId:id};
    }
    const [event]=await tx.insert(activityLogTable).values({volunteerProfileId:profile.id,actorUserId:actor.id,
      action:input.kind==='assign'?'custom_shift_assigned':'custom_shift_removed',details:reason}).returning();
    return {user,shift,id,eventId:event!.id,changed:true,remove:input.kind==='remove'};
  });
  if(result.changed) {
    const subject=result.remove?'Your one-time shift has been released':"You're on the schedule: one-time shift";
    await sendScheduleNotice(result.user,subject,[`${result.shift.date}, ${result.shift.startTime}–${result.shift.endTime} (Pacific time).`,
      result.remove?'Thank you for keeping your schedule up to date. Your regular weekly shifts are unchanged.'
        :'Thank you for helping local families. This shift happens once; your weekly shifts are unchanged.'],result.eventId);
    if(result.remove) try {await notifyCustomReduction(result.shift.id,result.eventId,'A volunteer released a one-time shift',now);}
      catch(err){logger.error({err},'Coverage notification failed after a one-time shift was released');}
  }
  return result;
}
