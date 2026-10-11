import {beforeAll,afterAll,it,expect,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {createServer,type Server} from 'node:http';
import {eq,inArray,and} from 'drizzle-orm';
import {db,pool,usersTable,volunteerProfilesTable,shiftSlotsTable,shiftAssignmentsTable,shiftSkipsTable,slotBlocksTable,
  customShiftsTable,customShiftAssignmentsTable,activityLogTable,notificationLogTable,sessionsTable} from '@workspace/db';
import {loadStandardGrid,blockSlots,unblockSlot,createCustom,cancelCustom} from './scheduleExtras';
import {customAssignmentAction} from './customShiftService';
import {slotInstant} from './scheduleService';
import {readScheduleData} from './scheduleRepository';
import {releaseCustomAssignments} from './customShiftRelease';
import {releaseGaps} from './coverageAlerts';
import {sendEmail} from '../email';
import {adminScheduleAction} from './adminScheduleControls';
vi.hoisted(()=>{process.env.NODE_ENV='development';process.env.POSTMARK_SERVER_TOKEN='';process.env.EMAIL_FROM='';});
vi.mock('./coverageAlerts',async original=>({...await original<typeof import('./coverageAlerts')>(),notifyCustomReduction:vi.fn()}));
const tag=`extras-${randomUUID()}`,userIds:string[]=[],profileIds:string[]=[],customIds:string[]=[],sessionIds:string[]=[],slotIds:string[]=[];
const now=slotInstant('2030-10-05','07:00'),date='2030-10-08';
let server:Server,base:string,origin:string;
type Client=(path:string,method?:string,body?:unknown)=>Promise<{status:number;data:any}>;
let admin:Client,volunteers:Client[];
const actor=(i:number)=>({id:userIds[i]!,sessionVersion:0});
async function client(id?:string):Promise<Client> {
  const response=await fetch(`${base}/api/auth/session`,{headers:{'x-forwarded-proto':'https'}});
  const cookie=response.headers.get('set-cookie')!.split(';')[0]!,{csrfToken}=await response.json() as {csrfToken:string};
  const sid=decodeURIComponent(cookie.split('=').slice(1).join('=')).slice(2).split('.')[0]!;
  sessionIds.push(sid);
  if(id){const {rows}=await pool.query('SELECT sess FROM sessions WHERE sid=$1',[sid]);
    await pool.query('UPDATE sessions SET sess=$1 WHERE sid=$2',[JSON.stringify({...rows[0].sess,userId:id,authVersion:0}),sid]);}
  return async(path,method='GET',body)=>{const r=await fetch(`${base}/api${path}`,{method,headers:{cookie,Origin:origin,
    'x-forwarded-proto':'https','X-CSRF-Token':csrfToken,'Content-Type':'application/json'},...(body!==undefined?{body:JSON.stringify(body)}:{})});
    return {status:r.status,data:await r.json()};};
}
beforeAll(async()=>{
  const {default:app}=await import('../app');origin=(await import('../auth/session')).appOrigin;
  server=createServer(app);await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  for(let i=0;i<4;i++){
    const [user]=await db.insert(usersTable).values({role:i===0?'admin':'volunteer',email:`${tag}-${i}@example.invalid`,
      firstName:'Test',lastName:`Fixture${i}`,phone:'5555550100',emailVerifiedAt:new Date(),isTestAccount:true,passwordHash:'not-usable'}).returning();
    userIds.push(user!.id);
    if(i){const [profile]=await db.insert(volunteerProfilesTable).values({userId:user!.id,status:'active',
      onboardingCompletedAt:new Date(),dateOfBirth:'1990-01-01',addressLine1:'123 Test St',city:'Auburn',state:'CA',zip:'95603',
      emergencyContactName:'Test Contact',emergencyContactRelationship:'Friend',emergencyContactPhone:'5555550100'}).returning();
      profileIds.push(profile!.id);}
  }
  const [slot]=await db.insert(shiftSlotsTable).values({dayOfWeek:2,startTime:'09:00',endTime:'11:00',capacity:2,label:tag}).returning();slotIds.push(slot!.id);
  await db.insert(shiftAssignmentsTable).values({shiftSlotId:slot!.id,volunteerProfileId:profileIds[0]!,startDate:'2030-01-01',createdByUserId:userIds[0]!});
  admin=await client(userIds[0]);volunteers=await Promise.all(userIds.slice(1).map(client));
});
afterAll(async()=>{
  if(sessionIds.length)await db.delete(sessionsTable).where(inArray(sessionsTable.sid,sessionIds));
  if(customIds.length){await db.delete(customShiftAssignmentsTable).where(inArray(customShiftAssignmentsTable.customShiftId,customIds));
    await db.delete(customShiftsTable).where(inArray(customShiftsTable.id,customIds));}
  if(slotIds.length){await db.delete(slotBlocksTable).where(inArray(slotBlocksTable.shiftSlotId,slotIds));
    const owned=await db.select({id:shiftAssignmentsTable.id}).from(shiftAssignmentsTable).where(inArray(shiftAssignmentsTable.shiftSlotId,slotIds));
    if(owned.length)await db.delete(shiftSkipsTable).where(inArray(shiftSkipsTable.shiftAssignmentId,owned.map(a=>a.id)));
    await db.delete(shiftAssignmentsTable).where(inArray(shiftAssignmentsTable.shiftSlotId,slotIds));await db.delete(shiftSlotsTable).where(inArray(shiftSlotsTable.id,slotIds));}
  if(profileIds.length)await db.delete(activityLogTable).where(inArray(activityLogTable.volunteerProfileId,profileIds));
  if(userIds.length)await db.delete(notificationLogTable).where(inArray(notificationLogTable.recipientUserId,userIds));
  if(profileIds.length)await db.delete(volunteerProfilesTable).where(inArray(volunteerProfilesTable.id,profileIds));
  if(userIds.length)await db.delete(usersTable).where(inArray(usersTable.id,userIds));
  if(server)await new Promise<void>(resolve=>server.close(()=>resolve()));
});
async function newShift(startTime:string,endTime:string,capacity=1,openToVolunteers=true) {
  const result=await createCustom(actor(0),{date,startTime,endTime,capacity,openToVolunteers,label:tag},now);
  const shift=result.customShifts.filter(s=>s.label===tag && !customIds.includes(s.id)).at(-1)!;
  customIds.push(shift.id);return shift;
}
it('loads missing standard grid slots once and leaves all existing records unchanged',async()=>{
  const before=await db.select().from(shiftSlotsTable);
  const first=await loadStandardGrid(actor(0)),second=await loadStandardGrid(actor(0));
  expect(first.created+first.skipped).toBe(40);expect(second).toEqual({created:0,skipped:40});
  const after=await db.select().from(shiftSlotsTable);
  for(const existing of before)expect(after.find(s=>s.id===existing.id)).toEqual(existing);
  // New standard slots intentionally remain: this request loads the approved development grid.
});
it('guards admin actions, validates writes, and prevents volunteer overlap with a standing shift',async()=>{
  expect((await volunteers[0]!('/admin/schedule/extras')).status).toBe(403);
  expect((await admin('/admin/schedule/custom-shifts','POST',{date,startTime:'11:00',endTime:'09:00'})).status).toBe(400);
  const shift=await newShift('09:30','10:30');
  const response=await volunteers[0]!(`/volunteer/custom-shifts/${shift.id}/claim`,'POST',{});
  expect(response.status).toBe(422);expect(response.data.error).toBe('That time overlaps with your Tuesday 9:00 AM–11:00 AM shift.');
});
it('serializes two people claiming the final custom seat; requires an audited staff capacity override',async()=>{
  const shift=await newShift('18:00','20:00');
  const results=await Promise.all(volunteers.slice(1).map(c=>c(`/volunteer/custom-shifts/${shift.id}/claim`,'POST',{})));
  expect(results.map(r=>r.status).sort()).toEqual([200,409]);
  const winningIndex=results.findIndex(r=>r.status===200)+2,loser=winningIndex===2?3:2;
  const view=(await volunteers[winningIndex-1]!('/volunteer/schedule')).data;
  const serialized=JSON.stringify(view);
  expect(serialized).not.toContain(userIds[loser]!);expect(serialized).not.toContain(profileIds[loser-1]!);expect(serialized).not.toContain('adminNotes');
  await expect(customAssignmentAction(actor(0),{kind:'assign',customShiftId:shift.id,userId:userIds[loser],override:true},true,now)).rejects.toThrow('reason');
  await customAssignmentAction(actor(0),{kind:'assign',customShiftId:shift.id,userId:userIds[loser],override:true,reason:'Approved QA coverage exception'},true,now);
  const audit=await db.select().from(activityLogTable).where(and(eq(activityLogTable.volunteerProfileId,profileIds[loser-1]!),eq(activityLogTable.action,'custom_shift_assigned')));
  expect(audit.at(-1)!.details).toMatchObject({override:true,overrides:['slot_capacity'],reason:'Approved QA coverage exception'});
  await expect(customAssignmentAction(actor(0),{kind:'assign',customShiftId:shift.id,userId:userIds[0]},true,now)).rejects.toThrow();
});
it('supports block ranges, idempotent blocking, and unblock restoration without deleting standing assignments',async()=>{
  const result=await blockSlots(actor(0),{fromDate:date,toDate:date,slotIds,reason:'QA staff meeting',emailVolunteers:false},now);
  const block=result.blocks.find(b=>b.shiftSlotId===slotIds[0] && b.date===date)!;
  await blockSlots(actor(0),{fromDate:date,toDate:date,slotIds,reason:'QA staff meeting',emailVolunteers:false},now);
  expect((await db.select().from(slotBlocksTable).where(eq(slotBlocksTable.shiftSlotId,slotIds[0]!))).length).toBe(1);
  await unblockSlot(actor(0),block.id);
  expect((await db.select().from(shiftAssignmentsTable).where(eq(shiftAssignmentsTable.volunteerProfileId,profileIds[0]!))).length).toBe(1);
});
it('excludes one-time claims from the standing cap and enforces the exact 24-hour cancellation cutoff',async()=>{
  const shift=await newShift('16:00','18:00',2);
  await customAssignmentAction(actor(1),{kind:'assign',customShiftId:shift.id},false,now);
  const due=new Date(slotInstant(date,'16:00').getTime()-24*3600000);
  await expect(customAssignmentAction(actor(1),{kind:'remove',customShiftId:shift.id},false,new Date(due.getTime()+1))).rejects.toThrow('24 hours');
  await customAssignmentAction(actor(1),{kind:'remove',customShiftId:shift.id},false,due);
  const view=(await volunteers[0]!('/volunteer/schedule')).data;
  expect(view.assignments).toHaveLength(1);
});
it('cancels custom reservations on inactivation and reconstructs the combined before/after coverage gap',async()=>{
  const shift=await newShift('20:00','22:00',2);
  await customAssignmentAction(actor(1),{kind:'assign',customShiftId:shift.id},false,now);
  const previous=await db.transaction(tx=>releaseCustomAssignments(tx,profileIds[0]!,now));
  const data=await db.transaction(tx=>readScheduleData(tx));
  const gaps=releaseGaps(data,{volunteerProfileId:profileIds[0]!,assignmentIds:previous.map(a=>a.id),shiftSlotIds:previous.map(a=>a.customShiftId),
    effectiveDate:'2030-10-05',activityId:'event'},'status_changed',{previousCustomAssignments:previous},now);
  expect(gaps.some(o=>o.slot.id===shift.id && o.assignedVolunteers.length===0)).toBe(true);
});
it('deduplicates custom reminder emails using notification_log, including a later rerun',async()=>{
  // A dry-run recipient scoped to this fixture proves durable dedupe without any provider or job run.
  await db.update(usersTable).set({isTestAccount:false}).where(eq(usersTable.id,userIds[1]!));
  const relatedId=`custom:${customIds[0]}:${profileIds[0]}:24h`,mail={type:'reminder' as const,to:`${tag}-1@example.invalid`,
    toUserId:userIds[1]!,subject:'QA custom reminder',html:'<p>QA only</p>',text:'QA only',relatedId};
  const first=await sendEmail(mail),second=await sendEmail(mail);
  expect(first.ok).toBe(true);expect(second).toMatchObject({ok:true,skipped:true});
  const log=await db.select().from(notificationLogTable).where(and(eq(notificationLogTable.recipientUserId,userIds[1]!),eq(notificationLogTable.relatedId,relatedId)));
  expect(log).toHaveLength(1);expect(log[0]!.status).toBe('logged');
  await db.update(usersTable).set({isTestAccount:true}).where(eq(usersTable.id,userIds[1]!));
});
it('prevents staff undoing a week off when that would double-book an owned custom reservation',async()=>{
  const [assignment]=await db.select().from(shiftAssignmentsTable).where(eq(shiftAssignmentsTable.volunteerProfileId,profileIds[0]!));
  const [skip]=await db.insert(shiftSkipsTable).values({shiftAssignmentId:assignment!.id,skipDate:date}).returning();
  const shift=await newShift('09:30','10:30',2);
  await customAssignmentAction(actor(1),{kind:'assign',customShiftId:shift.id},false,now);
  await expect(adminScheduleAction(actor(0),{kind:'undo',assignmentId:assignment!.id,skipId:skip!.id},now)).rejects.toThrow('overlaps');
  await cancelCustom(actor(0),shift.id,now);
  await adminScheduleAction(actor(0),{kind:'undo',assignmentId:assignment!.id,skipId:skip!.id},now);
});
it('whole-shift cancellation is idempotent and removes it from staff/volunteer projections',async()=>{
  const shift=await newShift('22:00','23:00');
  await customAssignmentAction(actor(1),{kind:'assign',customShiftId:shift.id},false,now);
  expect((await cancelCustom(actor(0),shift.id,now)).customShifts.some(s=>s.id===shift.id)).toBe(false);
  await cancelCustom(actor(0),shift.id,now);
  expect((await volunteers[0]!('/volunteer/schedule')).data.customShifts.some((s:any)=>s.id===shift.id)).toBe(false);
});
