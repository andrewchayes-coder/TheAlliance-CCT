import {describe,it,expect} from 'vitest';
import {standardGrid} from '@workspace/shared/standardGrid';
import {createScheduleService,slotInstant,type ScheduleData} from './scheduleService';
import {coordinatorProjection} from './coordinatorSchedule';
import {selectReminders,type ReminderSnapshot} from './reminders';
import {volunteerScheduleView} from './volunteerScheduleView';
const config={reminderHoursBefore:24,sameMorningReminder:false,sameMorningReminderHour:7};
type MutableData={[K in keyof Required<ScheduleData>]: Array<Required<ScheduleData>[K][number]>}&{closedDates:{date:string;reason:string}[]};
function fixture():MutableData {
  return {slots:standardGrid.map((s,i)=>({...s,id:`slot-${i}`})),assignments:[
    {id:'regular',shiftSlotId:'slot-0',volunteerProfileId:'profile',startDate:'2026-01-01',endDate:null}],
    skips:[],closedDates:[],blocks:[],
    customShifts:[{id:'custom',date:'2026-10-06',startTime:'18:00',endTime:'20:00',capacity:2,label:'Family resource event',openToVolunteers:true,cancelledAt:null}],
    customAssignments:[{id:'custom-assignment',customShiftId:'custom',volunteerProfileId:'profile',cancelledAt:null}]};
}
describe('CCT standard grid, date blocks, and one-time shifts',()=>{
  it('provides exactly 40 two-hour slots and two concurrent overlapping shifts',()=>{
    const data=fixture(),service=createScheduleService({...data,customShifts:[],customAssignments:[]});
    expect(data.slots).toHaveLength(40);
    expect(service.getOccurrences('2026-10-05','2026-10-09')).toHaveLength(40);
    expect(service.getOnShiftNow(slotInstant('2026-10-05','10:30')).map(o=>o.slot.startTime)).toEqual(['09:00','10:00']);
    expect(data.slots.every(s=>s.capacity===2 && Number(s.endTime.slice(0,2))-Number(s.startTime.slice(0,2))===2)).toBe(true);
  });
  it('blocks exactly one slot/date, not its neighbor or the following week',()=>{
    const data=fixture();data.blocks=[{shiftSlotId:'slot-0',date:'2026-10-05',reason:'Staff gathering'}];
    const service=createScheduleService(data);
    expect(service.getOnShiftNow(slotInstant('2026-10-05','10:30')).map(o=>o.slot.id)).toEqual(['slot-1']);
    expect(service.getUpNext(slotInstant('2026-10-05','08:30')).map(o=>o.slot.id)).toEqual(['slot-1']);
    expect(service.getCoverage('2026-10-05').some(o=>o.slot.id==='slot-0')).toBe(false);
    expect(service.getOccurrences('2026-10-12','2026-10-12').some(o=>o.slot.id==='slot-0')).toBe(true);
    const week=coordinatorProjection(data,[],slotInstant('2026-10-05','08:00')).week('2026-10-05');
    expect(week.blocks.find(o=>o.slotId==='slot-0')).toMatchObject({state:'blocked',blockedReason:'Staff gathering',openSpots:0,volunteers:[]});
  });
  it('includes custom shifts in now, next, and coverage, but never repeats them weekly',()=>{
    const service=createScheduleService(fixture());
    expect(service.getOnShiftNow(slotInstant('2026-10-06','18:30'))[0]).toMatchObject({kind:'custom',slot:{id:'custom'},assignedVolunteers:[{assignmentId:'custom-assignment'}]});
    expect(service.getUpNext(slotInstant('2026-10-06','17:30'))[0]?.slot.id).toBe('custom');
    expect(service.getCoverage('2026-10-05').find(o=>o.slot.id==='custom')).toMatchObject({assignedCount:1,capacity:2,underCapacity:true});
    expect(service.getOccurrences('2026-10-13','2026-10-13').some(o=>o.kind==='custom')).toBe(false);
  });
  it('suppresses closed dates, cancelled custom shifts and cancelled reservations',()=>{
    const data=fixture();data.customAssignments![0]!.cancelledAt=new Date();
    expect(createScheduleService(data).getOccurrences('2026-10-06','2026-10-06').find(o=>o.kind==='custom')!.assignedVolunteers).toEqual([]);
    data.customShifts![0]!.cancelledAt=new Date();
    expect(createScheduleService(data).getOnShiftNow(slotInstant('2026-10-06','18:30'))).toEqual([]);
    data.customShifts![0]!.cancelledAt=null;data.closedDates=[{date:'2026-10-06',reason:'Closed'}];
    expect(createScheduleService(data).getOccurrences('2026-10-06','2026-10-06')).toEqual([]);
  });
  it('uses stable custom reminder keys during 15-minute catch-up and reruns',()=>{
    const snapshot:ReminderSnapshot={schedule:fixture(),people:[{profileId:'profile',userId:'user',firstName:'Test',email:'test@example.invalid',
      status:'active',isActive:true,verified:true}],links:[]};
    const at=slotInstant('2026-10-05','18:15');
    const first=selectReminders(snapshot,at,config,true).filter(r=>r.occurrence.kind==='custom');
    const rerun=selectReminders(snapshot,new Date(at.getTime()+15*60000),config,true).filter(r=>r.occurrence.kind==='custom');
    expect(first.map(r=>r.relatedId)).toEqual(['custom:custom:profile:24h']);
    expect(rerun.map(r=>r.relatedId)).toEqual(first.map(r=>r.relatedId));
    const logged=new Set(first.map(r=>r.relatedId));
    expect(rerun.filter(r=>!logged.has(r.relatedId))).toEqual([]);
  });
  it('uses Pacific DST offsets for custom shifts on spring and autumn changeover weekends',()=>{
    for(const [date,hour] of [['2026-03-07','17'],['2026-03-08','16'],['2026-10-31','16'],['2026-11-01','17']]) {
      const data=fixture();data.customShifts![0]={...data.customShifts![0]!,date:date!,startTime:'09:00',endTime:'11:00'};
      const occurrence=createScheduleService(data).getOccurrences(date!,date!).find(o=>o.kind==='custom')!;
      expect(occurrence.startsAt.toISOString()).toBe(`${date}T${hour}:00:00.000Z`);
      expect(occurrence.endsAt.getTime()-occurrence.startsAt.getTime()).toBe(2*3600000);
      expect(createScheduleService(data).getCoverage(date!).some(o=>o.slot.id==='custom')).toBe(true);
    }
  });
  it('shows weekend custom blocks on the master schedule',()=>{
    const data=fixture();data.customShifts![0]!.date='2026-10-11';
    const week=coordinatorProjection(data,[],slotInstant('2026-10-05','08:00')).week('2026-10-05');
    expect(week.days).toHaveLength(7);expect(week.blocks.some(b=>b.kind==='custom' && b.date==='2026-10-11')).toBe(true);
  });
  it('volunteer projections reveal counts and their own reservation, never other profiles or names',()=>{
    const data=fixture();data.customAssignments!.push({id:'secret-assignment',customShiftId:'custom',volunteerProfileId:'secret-profile',cancelledAt:null});
    const view=volunteerScheduleView({...data,skips:[]},'profile',
      {status:'active',agreementAcknowledgedAt:null},null,slotInstant('2026-10-05','08:00'));
    expect(view.customShifts[0]).toMatchObject({assignedCount:2,openSpots:0,ownAssignmentId:'custom-assignment',canCancel:true});
    expect(JSON.stringify(view)).not.toMatch(/secret-profile|secret-assignment|adminNotes/);
    expect(view.assignments).toHaveLength(1);
  });
});
