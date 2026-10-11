import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import { randomUUID, randomBytes } from 'node:crypto';
import type { Server } from 'node:http';
import { eq, inArray } from 'drizzle-orm';
import { db, pool, usersTable, volunteerProfilesTable, activityLogTable, notificationLogTable } from '@workspace/db';
import { profileCompletionSchema, profileDraftSchema, normalizeVolunteerStatus, formatPhone, pacificToday } from '@workspace/shared/profileFields';
import { appConfig } from '@workspace/shared/appConfig';

process.env.NODE_ENV = 'development';
process.env.SESSION_SECRET ||= randomBytes(32).toString('hex');
vi.mock('../email', async importOriginal => ({
  ...await importOriginal<typeof import('../email')>(),
  sendEmail: vi.fn(async () => ({ ok:true, status:'suppressed' as const })),
}));
const { default:app } = await import('../app');
const { hashPassword, checkPassword } = await import('../auth/security');
const { appOrigin } = await import('../auth/session');
const { approvalRequirements } = await import('../admin-volunteer-detail');
const { rosterSnapshot, rosterCsv } = await import('../admin-roster');
const { sendEmail } = await import('../email');
let server:Server, base:string, volunteerId:string, otherId:string, adminId:string;
const ids:string[] = [], password = 'synthetic-profile-test-password';
const ipBytes=randomBytes(2), testIp=`198.18.${ipBytes[0]}.${ipBytes[1]}`;
const complete = {
  firstName:'Profile',lastName:'QA',phone:'9165550100',dateOfBirth:'1990-01-01',addressLine1:'123 Synthetic QA Lane',
  city:'Sacramento',state:'CA',zip:'95814-1234',emergencyContactName:'Synthetic Contact',
  emergencyContactRelationship:'Friend',emergencyContactPhone:'9165550101',
};
type Client = {request:(path:string,method?:string,body?:unknown)=>Promise<{status:number;data:any}>};
async function client(email:string):Promise<Client> {
  let cookie = '', token = '';
  const request:Client['request'] = async (path,method='GET',body) => {
    const response = await fetch(`${base}/api${path}`, {method,headers:{
      cookie,origin:appOrigin,'x-csrf-token':token,'content-type':'application/json',
      'x-forwarded-for':testIp,
      'x-forwarded-proto':'https',
    },...(body === undefined ? {} : {body:JSON.stringify(body)})});
    const updated = response.headers.getSetCookie().find(value=>value.startsWith('alliance.sid='));
    if (updated) cookie = updated.split(';')[0]!;
    const data:any = await response.json();
    if (data.csrfToken) token = data.csrfToken;
    return {status:response.status,data};
  };
  await request('/auth/session');
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
  if(ids.length) {
    await db.delete(notificationLogTable).where(inArray(notificationLogTable.recipientUserId,ids));
    await db.delete(activityLogTable).where(inArray(activityLogTable.actorUserId,ids));
    await db.delete(volunteerProfilesTable).where(inArray(volunteerProfilesTable.userId,ids));
    await db.delete(usersTable).where(inArray(usersTable.id,ids));
  }
  await new Promise<void>(resolve=>server.close(()=>resolve()));
  await pool.end();
});
describe('fixed profile validation and compatibility',()=>{
  it('accepts newborns, rejects today/future and invalid calendar days, and formats digit phones',()=>{
    const today=pacificToday(), yesterday=new Date(`${today}T12:00:00Z`);yesterday.setUTCDate(yesterday.getUTCDate()-1);
    expect(profileCompletionSchema.safeParse({...complete,dateOfBirth:yesterday.toISOString().slice(0,10)}).success).toBe(true);
    for(const dateOfBirth of [today,'2099-01-01','2025-02-30']) expect(profileCompletionSchema.safeParse({...complete,dateOfBirth}).success).toBe(false);
    expect(profileCompletionSchema.parse({...complete,phone:'(916) 555-0100'}).phone).toBe('9165550100');
    expect(formatPhone('9165550100')).toBe('(916) 555-0100');
    expect(profileDraftSchema.parse({city:'Sacramento'})).toEqual({city:'Sacramento'});
    expect(normalizeVolunteerStatus('applicant')).toBe('onboarding');
    expect(normalizeVolunteerStatus('in_training')).toBe('onboarding');
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
  it('activates with complete profile only, sets start date, audits edits, and rejects legacy status writes',async()=>{
    let detail=(await admin.request(`/admin/volunteers/${volunteerId}`)).data;
    expect(detail.approvalRequirements.every((entry:{met:boolean})=>entry.met)).toBe(true);
    expect((await admin.request(`/admin/volunteers/${volunteerId}/status`,'POST',{status:'applicant',expectedUpdatedAt:detail.entry.profile.updatedAt})).status).toBe(400);
    const result=await admin.request(`/admin/volunteers/${volunteerId}/status`,'POST',{status:'active',expectedUpdatedAt:detail.entry.profile.updatedAt});
    expect(result.status).toBe(200);detail=result.data.detail;
    expect(detail.entry.profile.startDate).toBe(pacificToday());
    const changed=await admin.request(`/admin/volunteers/${volunteerId}/tracking`,'PATCH',{
      expectedUpdatedAt:detail.entry.profile.updatedAt,startDate:'2026-01-01',dateOfBirth:'1991-01-01'});
    expect(changed.status).toBe(200);
    expect((await own.request('/me')).data.profile.dateOfBirth).toBe('1991-01-01');
    const events=await db.select().from(activityLogTable).where(eq(activityLogTable.volunteerProfileId,detail.entry.profile.id));
    expect(events.filter(e=>e.action==='start_date_changed')).toHaveLength(2);
    expect(events.some(e=>e.action==='status_changed')).toBe(true);
    expect(sendEmail).toHaveBeenCalled();
  });
  it('never returns another volunteer private fields or staff notes through me, schedule, inbox, resources or admin routes',async()=>{
    const [privateRow]=await db.select().from(volunteerProfilesTable).where(eq(volunteerProfilesTable.userId,otherId));
    for(const path of ['/me','/volunteer/dashboard','/volunteer/schedule','/volunteer/messages','/volunteer/resources']) {
      const response=await own.request(path);expect(response.status).toBe(200);
      const json=JSON.stringify(response.data);
      for(const value of [privateRow!.addressLine1,privateRow!.emergencyContactName,privateRow!.dateOfBirth,privateRow!.adminNotes])
        expect(json).not.toContain(value);
      expect(json).not.toContain('adminNotes');
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
    expect(csv).not.toContain('Profile: certification');expect(csv).not.toContain('Profile: backgroundCheck');
    expect(csv).not.toContain('Profile: agreement');expect(csv).not.toContain('Profile: onboardingAnswers');
    expect(csv).toContain('Profile: dateOfBirth');
  });
});
