import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import { retiredVolunteerStatuses } from '@workspace/shared/legacy-compatibility';
import { randomUUID, randomBytes } from 'node:crypto';
import type { Server } from 'node:http';
import { eq, inArray } from 'drizzle-orm';
import { profileCompletionSchema, profileDraftSchema, normalizeVolunteerStatus, formatPhone, pacificToday } from '@workspace/shared/profileFields';
import { appConfig } from '@workspace/shared/appConfig';
import type { Request, Response } from 'express';
import { errorEnvelope } from '../middlewares/request-hardening';

process.env.NODE_ENV = 'development';
process.env.SESSION_SECRET ||= randomBytes(32).toString('hex');
vi.mock('../email', async importOriginal => ({
  ...await importOriginal<typeof import('../email')>(),
  sendEmail: vi.fn(async () => ({ ok:true, status:'suppressed' as const })),
}));
import { db, pool, usersTable, volunteerProfilesTable, activityLogTable, notificationLogTable, sessionsTable, authRateLimitsTable } from '@workspace/db';
const { default:app } = await import('../app');

const { hashPassword, checkPassword, tokenHash } = await import('../auth/security');
const { appOrigin } = await import('../auth/session');
const { approvalRequirements, WorkflowError } = await import('../admin-volunteer-detail');
const { rosterSnapshot, rosterCsv } = await import('../admin-roster');
const { sendEmail } = await import('../email');

const { mintToken } = await import('../auth/accounts');
let server:Server, base:string, volunteerId:string, otherId:string, adminId:string;
const ids:string[] = [], password = 'synthetic-profile-test-password';

const sessionIds=new Set<string>(),rateIdentities=new Set<string>();
const ipBytes=randomBytes(2), testIp=`198.18.${ipBytes[0]}.${ipBytes[1]}`;
rateIdentities.add(testIp);
const complete = {
  firstName:'Profile',lastName:'QA',phone:'9165550100',dateOfBirth:'1990-01-01',addressLine1:'123 Synthetic QA Lane',
  city:'Sacramento',state:'CA',zip:'95814-1234',emergencyContactName:'Synthetic Contact',
  emergencyContactRelationship:'Friend',emergencyContactPhone:'9165550101',
};
type Client = {request:(path:string,method?:string,body?:unknown)=>Promise<{status:number;data:any}>};
async function client(email?:string):Promise<Client> {
  let cookie = '', token = '';
  const request:Client['request'] = async (path,method='GET',body) => {
    const response = await fetch(`${base}/api${path}`, {method,headers:{
      cookie,origin:appOrigin,'x-csrf-token':token,'content-type':'application/json',
      'x-forwarded-for':testIp,
      'x-forwarded-proto':'https',
    },...(body === undefined ? {} : {body:JSON.stringify(body)})});
    const updated = response.headers.getSetCookie().find(value=>value.startsWith('alliance.sid='));
    if (updated) {
      cookie = updated.split(';')[0]!;
      const value=decodeURIComponent(cookie.split('=').slice(1).join('='));
      if(value.startsWith('s:')) sessionIds.add(value.slice(2).split('.')[0]!);
    }
    const data:any = await response.json();
    if (data.csrfToken) token = data.csrfToken;
    return {status:response.status,data};
  };
  await request('/auth/session');
  if(!email) return {request};
  rateIdentities.add(email);
  const result = await request('/auth/signin','POST',{email,password});
  expect(result.status).toBe(200);
  await request('/auth/session');
  return {request};
}
let own:Client, other:Client, admin:Client;
beforeAll(async()=>{
  server = app.listen(0);
  await new Promise<void>(resolve => server.once('listening',resolve));
  base = `http://127.0.0.1:${(server.address() as {port:number}).port}`;
  const hash = await hashPassword(password), tag=randomUUID();
  for(const [kind,role] of [['own','volunteer'],['other','volunteer'],['admin','admin']] as const) {
    const [user] = await db.insert(usersTable).values({email:`${kind}-${tag}@example.invalid`,firstName:`${kind}-${tag}`,
      lastName:'Synthetic QA',phone:'9165550100',passwordHash:hash,role,isTestAccount:false,emailVerifiedAt:new Date()}).returning();
    ids.push(user!.id);
    rateIdentities.add(user!.id);rateIdentities.add(user!.email);
    if(kind==='admin') adminId=user!.id;
    else {
      const {firstName:_,lastName:_last,phone:_phone,...fields}=complete;
      await db.insert(volunteerProfilesTable).values({userId:user!.id,county:'Placer',status:kind==='own'?'onboarding':'active',
        ...(kind==='other'?{...fields,addressLine1:`PRIVATE-ADDRESS-${tag}`,emergencyContactName:`PRIVATE-CONTACT-${tag}`,
          dateOfBirth:'1982-04-05',onboardingCompletedAt:new Date()}:{}),adminNotes:`PRIVATE-NOTES-${tag}`,onboardingAnswers:{legacy:'preserve'}} );
      if(kind==='own') volunteerId=user!.id; else otherId=user!.id;
    }
  }
  own=await client(`own-${tag}@example.invalid`);
  other=await client(`other-${tag}@example.invalid`);
  admin=await client(`admin-${tag}@example.invalid`);
},30000);
afterAll(async()=>{
  if(sessionIds.size) await db.delete(sessionsTable).where(inArray(sessionsTable.sid,[...sessionIds]));
  const rateKeys=[...rateIdentities].flatMap(identity=>['signup','signup-ip','signup-email','signin','signin-ip','signin-email','verify-ip','resend-minute']
    .map(scope=>`${scope}:${tokenHash(identity)}`));
  if(rateKeys.length) await db.delete(authRateLimitsTable).where(inArray(authRateLimitsTable.key,rateKeys));
  if(ids.length) {
    await db.delete(notificationLogTable).where(inArray(notificationLogTable.recipientUserId,ids));
    await db.delete(activityLogTable).where(inArray(activityLogTable.actorUserId,ids));
    await db.delete(volunteerProfilesTable).where(inArray(volunteerProfilesTable.userId,ids));
    await db.delete(usersTable).where(inArray(usersTable.id,ids));
  }
  await new Promise<void>(resolve=>server.close(()=>resolve()));
  await pool.end();
});

// Staff tools use the existing admin permission; there is no separate persisted staff role.
describe.each(['Admin','Staff'] as const)('%s signup-to-approval review workflow',persona=>{
  it('classifies signup before verification, enforces requirements, approves, reopens review and survives email failure',async()=>{
    const tag=randomUUID(),email=`review-${tag}@example.invalid`;
    rateIdentities.add(email);
    const actorUser=await db.insert(usersTable).values({firstName:persona,lastName:'Synthetic Staff',email:`actor-${tag}@example.invalid`,
      phone:'9165550100',role:'admin',passwordHash:await hashPassword(password),emailVerifiedAt:new Date()}).returning();
    ids.push(actorUser[0]!.id);rateIdentities.add(actorUser[0]!.id);
    const actor=await client(actorUser[0]!.email);
    const before=(await actor.request('/admin/volunteers')).data.summary;
    const overviewBefore=(await actor.request('/admin/overview')).data.needsAttention;
    const fresh=await client();
    const signup=await fresh.request('/auth/signup','POST',{firstName:'Review',lastName:tag,email,phone:'9165550100',password,confirmPassword:password});
    expect(signup.status).toBe(200);
    await fresh.request('/auth/session');
    const [user]=await db.select().from(usersTable).where(eq(usersTable.email,email));ids.push(user!.id);rateIdentities.add(user!.id);
    const path=`/admin/volunteers/${user!.id}`;
    let detail=(await actor.request(path)).data;
    expect(detail.entry.attention).toEqual(['awaiting_review']);
    expect(detail.entry.user.emailVerifiedAt).toBeNull();
    expect(detail.entry.user.isActive).toBe(true); // Login access is not approval.
    for(const needsAttention of ['awaiting_review','any']) {
      const list=await actor.request(`/admin/volunteers?search=${email}&needsAttention=${needsAttention}`);
      expect(list.data.total).toBe(1);expect(list.data.volunteers[0].user.id).toBe(user!.id);
      expect(list.data.summary.needsAttention).toBe(before.needsAttention+1);
    }
    expect((await actor.request('/admin/overview')).data.needsAttention).toBe(overviewBefore+1);
    const blocked=await actor.request(`${path}/status`,'POST',{status:'active',expectedUpdatedAt:detail.entry.profile.updatedAt});
    expect(blocked.status).toBe(422);
    expect(blocked.data.missing.map((r:{key:string})=>r.key)).toEqual(expect.arrayContaining(['email_verified','onboarding_completed','profile_dateOfBirth']));
    const token=await mintToken(user!.id,'email_verify');
    expect((await fresh.request('/auth/verify','POST',{token:token.raw})).status).toBe(200);
    await fresh.request('/auth/session');
    detail=(await actor.request(path)).data;
    expect(detail.entry.profile.status).toBe('onboarding');
    expect(detail.approvalRequirements.find((r:{key:string})=>r.key==='email_verified').met).toBe(true);
    expect((await fresh.request('/onboarding','PATCH',{...complete,complete:true})).status).toBe(200);
    detail=(await actor.request(path)).data;
    expect(detail.approvalRequirements.every((r:{met:boolean})=>r.met)).toBe(true);
    expect(detail.entry.attention).toEqual(['awaiting_review']);
    expect((await actor.request(`/admin/volunteers?search=${email}&needsAttention=awaiting_review`)).data.total).toBe(1);
    let approved=await actor.request(`${path}/status`,'POST',{status:'active',expectedUpdatedAt:detail.entry.profile.updatedAt});
    expect(approved.status).toBe(200);
    expect(approved.data.detail.entry.profile.status).toBe('active');
    expect(approved.data.detail.entry.attention).toEqual(['no_shift']);
    expect((await actor.request(`/admin/volunteers?search=${email}&needsAttention=awaiting_review`)).data.total).toBe(0);
    expect((await actor.request(`/admin/volunteers?search=${email}&needsAttention=any`)).data.total).toBe(1);
    expect((await actor.request('/admin/overview')).data.needsAttention).toBe(overviewBefore+1);
    expect((await actor.request(`${path}/status`,'POST',{status:'onboarding',expectedUpdatedAt:detail.entry.profile.updatedAt})).status).toBe(409);
    detail=approved.data.detail;
    const returned=await actor.request(`${path}/status`,'POST',{status:'onboarding',expectedUpdatedAt:detail.entry.profile.updatedAt});
    expect(returned.status).toBe(200);detail=returned.data.detail;
    expect(detail.entry.attention).toEqual(['awaiting_review']);
    vi.mocked(sendEmail).mockResolvedValueOnce({ok:false,error:'Synthetic delivery failure'});
    approved=await actor.request(`${path}/status`,'POST',{status:'active',expectedUpdatedAt:detail.entry.profile.updatedAt});
    expect(approved.status).toBe(200);expect(approved.data.emailDelivery.ok).toBe(false);
    expect(approved.data.detail.entry.profile.status).toBe('active');
    const reopen=await actor.request(`${path}/status`,'POST',{status:'onboarding',expectedUpdatedAt:approved.data.detail.entry.profile.updatedAt});
    vi.mocked(sendEmail).mockRejectedValueOnce(new Error('Synthetic provider exception'));
    const exceptional=await actor.request(`${path}/status`,'POST',{status:'active',expectedUpdatedAt:reopen.data.detail.entry.profile.updatedAt});
    expect(exceptional.status).toBe(200);expect(exceptional.data.emailDelivery.ok).toBe(false);
    expect((await actor.request(path)).data.entry.profile.status).toBe('active');
  },30000);
});
describe('fixed profile validation and compatibility',()=>{
  it('normalizes stored legacy status values in the authenticated me endpoint',async()=>{
    const [before]=await db.select().from(volunteerProfilesTable).where(eq(volunteerProfilesTable.userId,volunteerId));
    try {
      for(const status of retiredVolunteerStatuses) {
        await db.update(volunteerProfilesTable).set({status}).where(eq(volunteerProfilesTable.userId,volunteerId));
        const result=await own.request('/me');
        expect(result.status).toBe(200); expect(result.data.profile.status).toBe('onboarding');
        expect(result.data.profile.adminNotes).toBeUndefined();
      }
    } finally {
      await db.update(volunteerProfilesTable).set({status:before!.status}).where(eq(volunteerProfilesTable.userId,volunteerId));
    }
  });
  it('accepts newborns, rejects today/future and invalid calendar days, and formats digit phones',()=>{
    const today=pacificToday(), yesterday=new Date(`${today}T12:00:00Z`);yesterday.setUTCDate(yesterday.getUTCDate()-1);
    expect(profileCompletionSchema.safeParse({...complete,dateOfBirth:yesterday.toISOString().slice(0,10)}).success).toBe(true);
    for(const dateOfBirth of [today,'2099-01-01','2025-02-30']) expect(profileCompletionSchema.safeParse({...complete,dateOfBirth}).success).toBe(false);
    expect(profileCompletionSchema.parse({...complete,phone:'(916) 555-0100'}).phone).toBe('9165550100');
    expect(formatPhone('9165550100')).toBe('(916) 555-0100');
    expect(profileDraftSchema.parse({city:'Sacramento'})).toEqual({city:'Sacramento'});
    for (const value of retiredVolunteerStatuses) expect(normalizeVolunteerStatus(value)).toBe('onboarding');
  });
  it('persists individual fields, requires every field for completion, and retains legacy answers without agreement',async()=>{
    expect((await own.request('/onboarding','PATCH',{city:'Roseville'})).status).toBe(200);
    expect((await own.request('/me')).data.profile.city).toBe('Roseville');
    expect((await own.request('/onboarding','PATCH',{complete:true})).status).toBe(400);
    expect((await own.request('/onboarding','PATCH',{...complete,complete:true})).status).toBe(200);
    const row=(await own.request('/me')).data.profile;
    expect(row.onboardingCompletedAt).toBeTruthy();expect(row.agreementAcknowledgedAt).toBeNull();
    expect(row.onboardingAnswers).toEqual({legacy:'preserve'});expect(row.phone).toBeUndefined();
    expect(row.dateOfBirth).toBe('1990-01-01');expect(row.adminNotes).toBeUndefined();
    expect((await own.request('/volunteer/profile','PATCH',{dateOfBirth:'2000-01-01'})).status).toBe(400);
    expect((await own.request('/volunteer/profile','PATCH',{startDate:'2026-01-01'})).status).toBe(400);
  });
  it('refuses activation of a complete profile until onboarding completion is recorded',async()=>{
    const [before]=await db.select().from(volunteerProfilesTable).where(eq(volunteerProfilesTable.userId,volunteerId));
    try {
      await db.update(volunteerProfilesTable).set({onboardingCompletedAt:null}).where(eq(volunteerProfilesTable.userId,volunteerId));
      const detail=(await admin.request(`/admin/volunteers/${volunteerId}`)).data;
      const result=await admin.request(`/admin/volunteers/${volunteerId}/status`,'POST',{status:'active',expectedUpdatedAt:detail.entry.profile.updatedAt});
      expect(result.status).toBe(422);
      expect(result.data.missing.map((entry:{key:string})=>entry.key)).toEqual(['onboarding_completed']);
    } finally {
      await db.update(volunteerProfilesTable).set({onboardingCompletedAt:before!.onboardingCompletedAt}).where(eq(volunteerProfilesTable.userId,volunteerId));
    }
  });
  it('422 WorkflowError preserves its message and receives VALIDATION_FAILED', () => {
    const error = new WorkflowError(422, "That date is before this volunteer's standing shift starts.");
    const response = { statusCode: error.status, json: (body: unknown) => body } as unknown as Response;
    errorEnvelope({} as Request, response, () => undefined);
    expect(response.json({ error: error.message })).toEqual({ error: error.message, code: 'VALIDATION_FAILED' });
  });
  it('activates after complete onboarding, sets start date, audits edits, and rejects legacy status writes',async()=>{
    let detail=(await admin.request(`/admin/volunteers/${volunteerId}`)).data;
    expect(detail.approvalRequirements.every((entry:{met:boolean})=>entry.met)).toBe(true);
    expect((await admin.request(`/admin/volunteers/${volunteerId}/status`,'POST',{status:retiredVolunteerStatuses[0],expectedUpdatedAt:detail.entry.profile.updatedAt})).status).toBe(400);
    const result=await admin.request(`/admin/volunteers/${volunteerId}/status`,'POST',{status:'active',expectedUpdatedAt:detail.entry.profile.updatedAt});
    expect(result.status).toBe(200);detail=result.data.detail;
    expect(detail.entry.profile.startDate).toBe(pacificToday());
    const changed=await admin.request(`/admin/volunteers/${volunteerId}/tracking`,'PATCH',{
      expectedUpdatedAt:detail.entry.profile.updatedAt,startDate:'2026-01-01',dateOfBirth:'1991-01-01'});
    expect(changed.status).toBe(200);
    expect((await own.request('/me')).data.profile.dateOfBirth).toBe('1991-01-01');
    const events=await db.select().from(activityLogTable).where(eq(activityLogTable.volunteerProfileId,detail.entry.profile.id));
    expect(events.filter(e=>e.action==='start_date_changed')).toHaveLength(2);
    expect(events.filter(e=>e.action==='tracking_updated')).toHaveLength(1);
    expect(events.find(e=>e.action==='tracking_updated')!.details).toEqual({fields:['dateOfBirth']});
    const startOnly = await admin.request(`/admin/volunteers/${volunteerId}/tracking`, 'PATCH', {
      expectedUpdatedAt:changed.data.entry.profile.updatedAt,startDate:'2026-02-01',
    });
    expect(startOnly.status).toBe(200);
    const after = await db.select().from(activityLogTable).where(eq(activityLogTable.volunteerProfileId,detail.entry.profile.id));
    expect(after.filter(e=>e.action==='start_date_changed')).toHaveLength(3);
    expect(after.filter(e=>e.action==='tracking_updated')).toHaveLength(1);
    expect(events.some(e=>e.action==='status_changed')).toBe(true);
    expect(sendEmail).toHaveBeenCalled();
  });
  it('never returns another volunteer private fields or staff notes through me, schedule, inbox, resources or admin routes',async()=>{
    const [staff]=await db.select().from(usersTable).where(eq(usersTable.id,adminId));
    const [privateRow]=await db.select().from(volunteerProfilesTable).where(eq(volunteerProfilesTable.userId,otherId));
    for(const path of ['/me','/volunteer/dashboard','/volunteer/schedule','/volunteer/messages','/volunteer/resources']) {
      const response=await own.request(path);expect(response.status).toBe(200);
      const json=JSON.stringify(response.data);
      for(const value of [privateRow!.addressLine1,privateRow!.emergencyContactName,privateRow!.dateOfBirth,privateRow!.adminNotes])
        expect(json).not.toContain(value);
      expect(json).not.toContain('adminNotes');
      expect(json).not.toContain(staff!.email);
      if(path==='/volunteer/schedule') expect(response.data.contactEmail).toBe(appConfig.volunteerContactEmail);
    }
    expect((await own.request(`/admin/volunteers/${otherId}`)).status).toBe(403);
    const [user]=await db.select().from(usersTable).where(eq(usersTable.id,volunteerId));
    const [profile]=await db.select().from(volunteerProfilesTable).where(eq(volunteerProfilesTable.userId,volunteerId));
    const previous={...appConfig};
    try {
      Object.assign(appConfig,{trackCertificationInApp:true,trackBackgroundCheckInApp:true,requireAgreementAcknowledgment:true});
      expect(approvalRequirements(user!,profile!).filter(r=>!r.met).map(r=>r.key)).toEqual(expect.arrayContaining(['certification_complete','background_cleared','agreement_acknowledged']));
    } finally {Object.assign(appConfig,previous);}
    const snapshot=await rosterSnapshot();
    const csv=rosterCsv(snapshot);
    expect(csv).not.toContain('Certification');expect(csv).not.toContain('Background check');
    expect(csv).not.toContain('Agreement');expect(csv).not.toContain('Onboarding answers');
    expect(csv).toContain('Date of birth');
  });
  it('lets staff edit private fields, filters the complete roster, and audits names without values',async()=>{
    const path=`/admin/volunteers/${volunteerId}`;
    let detail=(await admin.request(path)).data;
    const sensitive={dateOfBirth:'1992-02-03',addressLine1:'904 Private Test St',city:'Auburn',state:'CA',zip:'95603',
      emergencyContactName:'Private Emergency Contact',emergencyContactRelationship:'Sibling',
      emergencyContactPhone:'(555) 555-0100',county:'Placer',startDate:'2026-02-02'};
    const changed=await admin.request(`${path}/tracking`,'PATCH',{expectedUpdatedAt:detail.entry.profile.updatedAt,...sensitive});
    expect(changed.status).toBe(200);detail=changed.data;
    expect(detail.entry.profile).toMatchObject({...sensitive,emergencyContactPhone:'5555550100'});
    expect((await admin.request(`${path}/tracking`,'PATCH',{
      expectedUpdatedAt:detail.entry.profile.updatedAt,zip:'bad-zip'})).status).toBe(400);
    expect((await own.request('/volunteer/profile','PATCH',{county:'Nevada'})).status).toBe(400);
    expect((await own.request(`${path}/tracking`,'PATCH',{expectedUpdatedAt:detail.entry.profile.updatedAt,city:'Roseville'})).status).toBe(403);
    const audit=await db.select().from(activityLogTable).where(eq(activityLogTable.volunteerProfileId,detail.entry.profile.id));
    const edits=audit.filter(event=>['tracking_updated','start_date_changed'].includes(event.action));
    expect(edits.length).toBeGreaterThan(0);
    for(const event of edits) {
      expect(Array.isArray(event.details?.fields)).toBe(true);
      for(const value of ['904 Private Test St','1992-02-03','Private Emergency Contact','5555550100','2026-02-02'])
        expect(JSON.stringify(event.details)).not.toContain(value);
    }
    const filtered=await admin.request(`/admin/volunteers?search=${encodeURIComponent(detail.entry.user.email)}&city=Auburn&county=Placer&shiftPresence=no_shift&profileIncomplete=false&sortBy=email&sortDirection=desc&limit=1`);
    expect(filtered.status).toBe(200);
    expect(filtered.data.volunteers.some((row:{user:{id:string}})=>row.user.id===volunteerId)).toBe(true);
    expect(filtered.data.cities).toContain('Auburn');expect(filtered.data.counties).toContain('Placer');
    const before=await admin.request(`${path}/tracking`,'PATCH',{expectedUpdatedAt:detail.entry.profile.updatedAt,addressLine1:null});
    expect(before.status).toBe(200);
    const incomplete=await admin.request(`/admin/volunteers?search=${encodeURIComponent(detail.entry.user.email)}&profileIncomplete=true`);
    expect(incomplete.data.volunteers.map((row:{user:{id:string}})=>row.user.id)).toContain(volunteerId);
    const csv=rosterCsv(await rosterSnapshot());
    for(const column of ['Start date','Date of birth','Address','City','State','ZIP','Emergency contact name','Emergency contact relationship','Emergency contact phone','County','Shifts held']) expect(csv).toContain(column);
  });
});
