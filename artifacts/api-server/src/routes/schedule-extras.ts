import {Router,type Response} from 'express';
import {z} from 'zod';
import {blockSlots,unblockSlot,loadStandardGrid,scheduleExtras,createCustom,cancelCustom} from '../server/scheduleExtras';
import {customAssignmentAction} from '../server/customShiftService';
import {volunteerSchedule} from '../server/volunteerSchedule';
import {WorkflowError} from '../admin-volunteer-detail';
import {logger} from '../lib/logger';
const uuid=z.string().uuid(),empty=z.object({}).strict(),time=z.string().regex(/^(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$/);
const block=z.object({fromDate:z.string(),toDate:z.string(),slotIds:z.array(uuid).min(1).max(1000).optional(),
  reason:z.string().trim().min(1).max(1000),emailVolunteers:z.boolean().default(true)}).strict();
const custom=z.object({date:z.string(),startTime:time,endTime:time,capacity:z.number().int().min(1).max(10).default(2),
  label:z.string().trim().max(120).nullable().optional(),openToVolunteers:z.boolean().default(false)}).strict()
  .refine(value=>value.startTime<value.endTime);
const assign=z.object({userId:uuid,override:z.boolean().default(false),reason:z.string().trim().max(2000).optional()}).strict();
function failure(err:unknown,res:Response) {
  if(err instanceof WorkflowError){res.status(err.status).json({error:err.message});return;}
  if(err instanceof z.ZodError || err instanceof RangeError){res.status(400).json({error:'Enter valid shift details, a reason, and calendar dates.'});return;}
  logger.error({err},'Schedule extension request failed');res.status(500).json({error:'We could not update the schedule. Please try again.'});
}
export const adminExtrasRouter=Router(),volunteerExtrasRouter=Router();
adminExtrasRouter.get('/schedule/extras',async(_req,res)=>{try{res.set('Cache-Control','no-store').json(await scheduleExtras());}catch(err){failure(err,res);}});
adminExtrasRouter.post('/schedule/standard-grid',async(req,res)=>{try{empty.parse(req.body??{});res.json(await loadStandardGrid(req.authUser!));}catch(err){failure(err,res);}});
adminExtrasRouter.post('/schedule/blocks',async(req,res)=>{try{res.json(await blockSlots(req.authUser!,block.parse(req.body)));}catch(err){failure(err,res);}});
adminExtrasRouter.delete('/schedule/blocks/:blockId',async(req,res)=>{try{empty.parse(req.body??{});res.json(await unblockSlot(req.authUser!,uuid.parse(req.params.blockId)));}catch(err){failure(err,res);}});
adminExtrasRouter.post('/schedule/custom-shifts',async(req,res)=>{try{res.json(await createCustom(req.authUser!,custom.parse(req.body)));}catch(err){failure(err,res);}});
adminExtrasRouter.post('/schedule/custom-shifts/:customShiftId/cancel',async(req,res)=>{try{empty.parse(req.body??{});res.json(await cancelCustom(req.authUser!,uuid.parse(req.params.customShiftId)));}catch(err){failure(err,res);}});
adminExtrasRouter.post('/schedule/custom-shifts/:customShiftId/assignments',async(req,res)=>{try{
  await customAssignmentAction(req.authUser!,{kind:'assign',customShiftId:uuid.parse(req.params.customShiftId),...assign.parse(req.body)},true);
  res.json(await scheduleExtras());
}catch(err){failure(err,res);}});
adminExtrasRouter.delete('/schedule/custom-shifts/:customShiftId/assignments/:assignmentId',async(req,res)=>{try{
  empty.parse(req.body??{});await customAssignmentAction(req.authUser!,{kind:'remove',customShiftId:uuid.parse(req.params.customShiftId),assignmentId:uuid.parse(req.params.assignmentId)},true);
  res.json(await scheduleExtras());
}catch(err){failure(err,res);}});
volunteerExtrasRouter.post(['/custom-shifts/:customShiftId/claim','/custom-shifts/:customShiftId/cancel'],async(req,res)=>{try{
  empty.parse(req.body??{});const action=z.enum(['claim','cancel']).parse(req.path.split('/').at(-1));
  await customAssignmentAction(req.authUser!,{kind:action==='claim'?'assign':'remove',customShiftId:uuid.parse(req.params.customShiftId)},false);
  res.json(await volunteerSchedule(req.authUser!.id));
}catch(err){failure(err,res);}});
