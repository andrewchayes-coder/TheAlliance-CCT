import { beforeAll, afterAll, it, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { db, pool, usersTable, volunteerProfilesTable, shiftSlotsTable, shiftAssignmentsTable, shiftSkipsTable,
  messagesTable, messageRecipientsTable, activityLogTable, notificationLogTable, authTokensTable,
  customShiftsTable, customShiftAssignmentsTable, volunteerHoursTable } from '@workspace/db';
import { testAccounts, testProfileFields } from '@workspace/shared/testAccounts';
import { retiredVolunteerStatuses } from '@workspace/shared/legacy-compatibility';
import { createTestAccountService, isQuickLoginEnabled } from './testAccounts';
import { previewMessage } from './messaging';
import { createEmailService } from '../email';
import { filterRoster, rosterSnapshot, rosterSummary, rosterCsv, scheduleCsv, customCsvRows } from '../admin-roster';
import { monthlyCount, monthRange } from './monthly-email-limit';

vi.hoisted(() => {
  process.env.NODE_ENV = 'development';
  process.env.APP_ORIGIN = 'https://qa-fixture.example.invalid';
});
const tag = `qa-fixture-${randomUUID()}`;
const personas = testAccounts.map(p => ({ ...p, email: `${tag}-${p.key}@example.invalid`,
  ...('legacyEmail' in p ? {legacyEmail: `${tag}-${p.legacyEmail}`} : {}) }));
const ownedEmails = [...personas.flatMap(p => [p.email, ...(p.legacyEmail ? [p.legacyEmail] : [])]),
  `${tag}-ordinary@example.invalid`];
const service = createTestAccountService(personas, { NODE_ENV: 'production' });
let ids: string[] = [], profiles: string[] = [];
let ordinary: string, slotId: string;
const legacyIds = new Map<string,string>();
beforeAll(async () => {
  for (const persona of personas) {
    if (!persona.legacyEmail) continue;
    const [legacy] = await db.insert(usersTable).values({email:persona.legacyEmail,passwordHash:'unusable-fixture-hash',
      firstName:'Test',lastName:'Legacy',role:'volunteer',isTestAccount:true,emailVerifiedAt:new Date(),phone:'9165550100'}).returning();
    legacyIds.set(persona.key,legacy!.id);
    await db.insert(volunteerProfilesTable).values({userId:legacy!.id,
      status:retiredVolunteerStatuses[persona.key === 'vol-onboarding-ready' ? 1 : 0],
      certificationStatus:'in_progress',backgroundCheckStatus:'pending',agreementVersion:'legacy-retained'}); 
  }
  const [user] = await db.insert(usersTable).values({ email: `${tag}-ordinary@example.invalid`, passwordHash: 'unusable-fixture-hash',
    firstName: 'Fixture', lastName: tag, isActive: true, emailVerifiedAt: new Date() }).returning();
  ordinary = user!.id;
  await db.insert(volunteerProfilesTable).values({ userId: ordinary, status: 'active' });
  const [slot] = await db.insert(shiftSlotsTable).values({ label: tag, dayOfWeek: 1, startTime: '10:00', endTime: '12:00', capacity: 2 }).returning();
  slotId = slot!.id;
});
afterAll(async () => {
  const owned = await db.select({ id: usersTable.id }).from(usersTable).where(inArray(usersTable.email, ownedEmails));
  ids = owned.map(u => u.id);
  const ps = await db.select({ id: volunteerProfilesTable.id }).from(volunteerProfilesTable).where(inArray(volunteerProfilesTable.userId, ids));
  profiles = ps.map(p => p.id);
  await db.delete(volunteerHoursTable).where(inArray(volunteerHoursTable.volunteerProfileId, profiles));
  await db.delete(messageRecipientsTable).where(inArray(messageRecipientsTable.recipientUserId, ids));
  await db.delete(messagesTable).where(inArray(messagesTable.senderUserId, ids));
  await db.delete(notificationLogTable).where(inArray(notificationLogTable.recipientEmail, [...personas.map(p => p.email), `${tag}-ordinary@example.invalid`]));
  await db.delete(authTokensTable).where(inArray(authTokensTable.userId, ids));
  await db.delete(activityLogTable).where(inArray(activityLogTable.volunteerProfileId, profiles));
  await db.delete(shiftAssignmentsTable).where(inArray(shiftAssignmentsTable.volunteerProfileId, profiles));
  await db.delete(volunteerProfilesTable).where(inArray(volunteerProfilesTable.userId, ids));
  await db.delete(usersTable).where(inArray(usersTable.id, ids));
  await db.delete(shiftSlotsTable).where(eq(shiftSlotsTable.id, slotId));
  await pool.end();
});
it('ensures twice without duplicates, repairs personas, and preserves ordinary users', async () => {
  const first = await service.ensure();
  for (const [key,id] of legacyIds) expect(first.find(p => p.key === key)?.userId).toBe(id);
  const ready = first.find(p => p.key === 'vol-onboarding-ready')!;
  const fresh = first.find(p => p.key === 'vol-onboarding-new')!;
  const [readyProfile] = await db.select().from(volunteerProfilesTable).where(eq(volunteerProfilesTable.id,ready.profileId!));
  expect(readyProfile).toMatchObject({...testProfileFields,status:'onboarding',startDate:null,
    certificationStatus:'in_progress',backgroundCheckStatus:'pending',agreementVersion:'legacy-retained'});
  expect(readyProfile?.onboardingCompletedAt).not.toBeNull();
  const [newProfile] = await db.select().from(volunteerProfilesTable).where(eq(volunteerProfilesTable.id,fresh.profileId!));
  expect(newProfile).toMatchObject({status:'onboarding',onboardingCompletedAt:null,startDate:null});
  for (const field of Object.keys(testProfileFields)) expect(newProfile?.[field as keyof typeof newProfile]).toBeNull();
  const [newUser] = await db.select().from(usersTable).where(eq(usersTable.id,fresh.userId));
  expect(newUser?.phone).toBeNull();
  for (const key of ['vol-active','vol-active-noshift']) {
    const identity = first.find(p => p.key === key)!;
    const [profile] = await db.select().from(volunteerProfilesTable).where(eq(volunteerProfilesTable.id,identity.profileId!));
    expect(profile).toMatchObject({...testProfileFields,status:'active'});
    expect(profile?.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  }
  ids = first.map(p => p.userId);
  const active = first.find(p => p.key === 'vol-active')!;
  await db.update(usersTable).set({ role: 'admin', isActive: false, emailVerifiedAt: null }).where(eq(usersTable.id, active.userId));
  await db.update(volunteerProfilesTable).set({ status: 'inactive' }).where(eq(volunteerProfilesTable.id, active.profileId!));
  const second = await service.ensure();
  expect(second.map(p => p.userId)).toEqual(ids);
  const rows = await db.select().from(usersTable).where(inArray(usersTable.email, personas.map(p => p.email)));
  expect(rows).toHaveLength(5);
  expect(rows.every(u => u.isTestAccount && u.emailVerifiedAt && /^\$2[aby]\$12\$/.test(u.passwordHash))).toBe(true);
  expect(rows.find(u => u.id === active.userId)?.isActive).toBe(false);
  expect(rows.find(u => u.id === active.userId)?.role).toBe('volunteer');
  const [unchanged] = await db.select().from(volunteerProfilesTable).where(eq(volunteerProfilesTable.id,active.profileId!));
  expect(unchanged?.status).toBe('inactive');
  expect(await db.select().from(usersTable).where(inArray(usersTable.email, ownedEmails.filter(e => e !== `${tag}-ordinary@example.invalid`)))).toHaveLength(5);
  const [real] = await db.select().from(usersTable).where(eq(usersTable.id, ordinary));
  expect(real?.isTestAccount).toBe(false); expect(real?.passwordHash).toBe('unusable-fixture-hash');
  const standing = await db.select().from(shiftAssignmentsTable).where(inArray(shiftAssignmentsTable.volunteerProfileId, second.flatMap(p => p.profileId ? [p.profileId] : [])));
  expect(standing).toHaveLength(0); // production never automatically takes capacity
});
it('refuses to take over a non-test email and rolls back the whole ensure', async () => {
  const collision = personas.map(p => p.key === 'vol-onboarding-new' ? { ...p, email: `${tag}-ordinary@example.invalid` } : p);
  await expect(createTestAccountService(collision, { NODE_ENV: 'production' }).ensure()).rejects.toThrow('non-test account');
  const [real] = await db.select().from(usersTable).where(eq(usersTable.id, ordinary));
  expect(real?.isTestAccount).toBe(false); expect(real?.firstName).toBe('Fixture');
});
it('stops atomically if both old and new test addresses already exist', async () => {
  const ready = personas.find(p => p.key === 'vol-onboarding-ready')!;
  const [duplicate] = await db.insert(usersTable).values({email:ready.legacyEmail!,passwordHash:'unusable-fixture-hash',
    firstName:'Test',lastName:'Collision',role:'volunteer',isTestAccount:true}).returning();
  try {
    const before = await db.select().from(usersTable).where(eq(usersTable.id,ids[0]!));
    await expect(service.ensure()).rejects.toThrow('Both old and new QA addresses exist');
    const after = await db.select().from(usersTable).where(eq(usersTable.id,ids[0]!));
    expect(after[0]?.passwordHash).toBe(before[0]?.passwordHash);
  } finally {
    await db.delete(usersTable).where(eq(usersTable.id,duplicate!.id));
  }
  expect(await db.select().from(usersTable).where(inArray(usersTable.email,personas.map(p => p.email)))).toHaveLength(5);
});
it('excludes QA from both blasts, allows a single QA recipient, and isolates roster/export counts', async () => {
  for (const audience of ['active', 'all'] as const) {
    const preview = await previewMessage({ audience, userIds: [], subject: 'Fixture', body: 'Thank you.', sendByEmail: false });
    expect(preview.recipients.some(p => ids.includes(p.userId))).toBe(false);
    expect(preview.recipients.some(p => p.userId === ordinary)).toBe(true);
  }
  const active = ids[1]!;
  const single = await previewMessage({ audience: 'single', userIds: [active], subject: 'Fixture', body: 'Thank you.', sendByEmail: false });
  expect(single.recipientCount).toBe(1);
  const all = await rosterSnapshot();
  const qa = all.filter(p => ids.includes(p.user.id));
  expect(filterRoster(qa, {})).toHaveLength(0);
  expect(filterRoster(qa, { showTestAccounts: 'true' })).toHaveLength(4);
  expect(rosterSummary(qa)).toEqual({ onboarding: 0, active: 0, inactive: 0, needsAttention: 0 });
  expect(rosterCsv(qa)).not.toContain(tag);
  expect(scheduleCsv(qa)).not.toContain(tag);
});
it('suppresses QA mail with a configured provider, prints it in dev, deduplicates and excludes it from usage', async () => {
  const deliveryClient = vi.fn(), info = vi.fn();
  const send = createEmailService({ deliveryClient, settings: () => ({ token: 'fixture-provider-token', from: 'fixture@example.invalid' }),
    log: { info, warn: vi.fn(), error: vi.fn() } });
  const range = monthRange(new Date()), before = await monthlyCount(range.from, range.to);
  const data = { type: 'message' as const, to: personas[1]!.email, toUserId: ids[1]!, relatedId: tag,
    subject: 'QA thanks', html: '<p>Thank you.</p>', text: 'Thank you. https://qa-fixture.example.invalid/messages' };
  expect(await send(data)).toEqual({ ok: true, suppressed: true });
  expect(await send(data)).toEqual({ ok: true, skipped: true });
  // Also suppress when a caller supplies only the email address.
  expect(await send({ ...data, toUserId: undefined, relatedId: `${tag}:address-only` })).toMatchObject({ suppressed: true });
  expect(deliveryClient).not.toHaveBeenCalled();
  expect(info).toHaveBeenCalledWith(expect.stringContaining('QA EMAIL SUPPRESSED'));
  const rows = await db.select().from(notificationLogTable).where(eq(notificationLogTable.recipientEmail, data.to));
  expect(rows).toHaveLength(2); expect(rows.every(r => r.status === 'suppressed' && !r.providerMessageId)).toBe(true);
  expect(await monthlyCount(range.from, range.to)).toBe(before);
});
it('resets only QA shifts, skips, inbox membership and profile changes, and logs the reset', async () => {
  const active = (await service.ensure()).find(p => p.key === 'vol-active')!;
  await db.update(volunteerProfilesTable).set({ backgroundCheckStatus: 'cleared', backgroundCheckClearedAt: '2026-01-01' })
    .where(eq(volunteerProfilesTable.id, active.profileId!));
  const [custom] = await db.insert(customShiftsTable).values({date:'2030-01-15',startTime:'10:00',endTime:'12:00',
    capacity:2,openToVolunteers:true,createdByUserId:ids[0]!}).returning();
  const [ordinaryProfile] = await db.select().from(volunteerProfilesTable).where(eq(volunteerProfilesTable.userId,ordinary));
  await db.insert(volunteerHoursTable).values([
    { volunteerProfileId: active.profileId!, shiftDate: '2026-10-01', source: 'standing', shiftSlotId: slotId, hours: '2', enteredByUserId: active.userId },
    { volunteerProfileId: active.profileId!, shiftDate: '2030-01-15', source: 'one_time', customShiftId: custom!.id, hours: '2', enteredByUserId: active.userId },
    { volunteerProfileId: ordinaryProfile!.id, shiftDate: '2026-10-01', source: 'other', hours: '1', note: 'Fixture', enteredByUserId: ordinary },
  ]);
  const seats = await db.insert(customShiftAssignmentsTable).values([active.profileId!,ordinaryProfile!.id].map(volunteerProfileId =>
    ({customShiftId:custom!.id,volunteerProfileId,createdByUserId:ids[0]!}))).returning();
  const csvRows = await customCsvRows(await rosterSnapshot(),new Date('2029-01-01T00:00:00Z'));
  expect(csvRows.filter(row=>row[3]===seats[0]!.id)).toHaveLength(0);
  expect(csvRows.filter(row=>row[3]===seats[1]!.id)).toHaveLength(1);
  const [assignment] = await db.insert(shiftAssignmentsTable).values({ volunteerProfileId: active.profileId!, shiftSlotId: slotId,
    startDate: '2030-01-07', createdByUserId: ids[0]! }).returning();
  await db.insert(shiftSkipsTable).values({ shiftAssignmentId: assignment!.id, skipDate: '2030-01-14' });
  const [message] = await db.insert(messagesTable).values({ senderUserId: ids[0]!, audience: 'single', subject: tag, body: 'Fixture', sentByEmail: false }).returning();
  await db.insert(messageRecipientsTable).values({ messageId: message!.id, recipientUserId: active.userId });
  await db.update(volunteerProfilesTable).set({ onboardingAnswers: { fixture: 'edited' }, adminNotes: 'Fixture note', availabilityNotes: 'Edited' })
    .where(eq(volunteerProfilesTable.id, active.profileId!));
  await service.reset(ids[0]!);
  expect(await db.select().from(volunteerHoursTable).where(eq(volunteerHoursTable.volunteerProfileId, active.profileId!))).toHaveLength(0);
  expect(await db.select().from(volunteerHoursTable).where(eq(volunteerHoursTable.volunteerProfileId, ordinaryProfile!.id))).toHaveLength(1);
  const savedSeats = await db.select().from(customShiftAssignmentsTable).where(eq(customShiftAssignmentsTable.customShiftId,custom!.id));
  expect(savedSeats.find(a=>a.id===seats[0]!.id)?.cancelledAt).toBeInstanceOf(Date);
  expect(savedSeats.find(a=>a.id===seats[1]!.id)?.cancelledAt).toBeNull();
  await db.delete(customShiftAssignmentsTable).where(eq(customShiftAssignmentsTable.customShiftId,custom!.id));
  await db.delete(customShiftsTable).where(eq(customShiftsTable.id,custom!.id));
  expect(await db.select().from(shiftAssignmentsTable).where(eq(shiftAssignmentsTable.volunteerProfileId, active.profileId!))).toHaveLength(0);
  expect(await db.select().from(messageRecipientsTable).where(eq(messageRecipientsTable.recipientUserId, active.userId))).toHaveLength(0);
  const [profile] = await db.select().from(volunteerProfilesTable).where(eq(volunteerProfilesTable.id, active.profileId!));
  expect(profile).toMatchObject({ status: 'active', onboardingAnswers: {}, adminNotes: null, availabilityNotes: null,
    backgroundCheckStatus: 'not_started', backgroundCheckClearedAt: null });
  expect(profile).toMatchObject(testProfileFields);
  const [ready] = await db.select().from(volunteerProfilesTable).where(eq(volunteerProfilesTable.userId,ids[3]!));
  expect(ready).toMatchObject({...testProfileFields,status:'onboarding',
    certificationStatus:'in_progress',backgroundCheckStatus:'not_started',backgroundCheckClearedAt:null,agreementVersion:'legacy-retained'});
  const [fresh] = await db.select().from(volunteerProfilesTable).where(eq(volunteerProfilesTable.userId,ids[4]!));
  expect(fresh).toMatchObject({status:'onboarding',onboardingCompletedAt:null,startDate:null});
  for (const field of Object.keys(testProfileFields)) expect(fresh?.[field as keyof typeof fresh]).toBeNull();
  expect(await db.select().from(usersTable).where(inArray(usersTable.email,ownedEmails.filter(e => e !== `${tag}-ordinary@example.invalid`)))).toHaveLength(5);
  expect(await db.select().from(activityLogTable).where(and(eq(activityLogTable.volunteerProfileId, active.profileId!), eq(activityLogTable.action, 'test_accounts_reset')))).toHaveLength(1);
});
it('uses an explicit enable flag only in production', () => {
  for (const flag of [undefined, '', 'false', 'FALSE', 'yes', '1', 'true-ish']) {
    expect(isQuickLoginEnabled({ NODE_ENV: 'development', QUICK_LOGIN_ENABLED: flag })).toBe(true);
    expect(isQuickLoginEnabled({ NODE_ENV: 'production', QUICK_LOGIN_ENABLED: flag })).toBe(false);
  }
  for (const flag of ['true', 'TRUE', ' true ']) {
    expect(isQuickLoginEnabled({ NODE_ENV: 'production', QUICK_LOGIN_ENABLED: flag })).toBe(true);
  }
  expect(isQuickLoginEnabled({ NODE_ENV: 'test' })).toBe(true);
  expect(isQuickLoginEnabled({})).toBe(true);
});
