import { randomBytes } from 'node:crypto';
import { and, eq, inArray, isNull, or, gte, sql } from 'drizzle-orm';
import {
  db, usersTable, volunteerProfilesTable, shiftAssignmentsTable, shiftSlotsTable, shiftSkipsTable,
  messageRecipientsTable, activityLogTable, authTokensTable, appSettingsTable,
} from '@workspace/db';
import { testAccounts } from '@workspace/shared/testAccounts';
import { appConfig } from '@workspace/shared/appConfig';
import { normalizeVolunteerStatus } from '@workspace/shared/profileFields';
import { pacificDay, addCalendarDays } from './scheduleService';
import { WorkflowError } from '../admin-volunteer-detail';
import { hashPassword } from '../auth/security';

import { isQuickLoginEnabled } from '../auth/quick-login-lock';
export { isQuickLoginEnabled } from '../auth/quick-login-lock';

type FixtureEmail<P> = P extends unknown ? Omit<P, 'email'> & { email: string } : never;
type Persona = FixtureEmail<typeof testAccounts[number]>;
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
/** The override seam lets automated tests use only their owned fixture emails. */
export function createTestAccountService(personas: readonly Persona[] = testAccounts, env: NodeJS.ProcessEnv = process.env) {
  async function restore(tx: Tx, reset: boolean, actorUserId?: string) {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(91847314)`);
    const now = new Date(), today = pacificDay(now);
    const [settings] = await tx.select({ version: appSettingsTable.agreementVersion }).from(appSettingsTable)
      .where(eq(appSettingsTable.id, 'schedule'));
    const version = settings?.version ?? appConfig.agreementVersion;
    const result: { key: string; label: string; userId: string; profileId: string | null; created: boolean }[] = [];
    for (const persona of personas) {
      const [existing] = await tx.select().from(usersTable).where(eq(usersTable.email, persona.email)).for('update');
      if (existing && !existing.isTestAccount)
        throw new WorkflowError(409, `The QA address ${persona.email} belongs to a non-test account. No accounts were changed.`);
      // The cleartext is ephemeral and never returned, logged, or persisted.
      const passwordHash = await hashPassword(randomBytes(32).toString('hex'));
      const patch = { firstName: reset || !existing ? 'Test' : existing.firstName,
        lastName: reset || !existing ? persona.lastName : existing.lastName, role: persona.role,
        isActive: reset || !existing ? true : existing.isActive,
        isTestAccount: true, emailVerifiedAt: existing?.emailVerifiedAt ?? now, passwordHash, googleSubject: null,
        phone: reset || !existing?.phone ? '9165550100' : existing.phone,
        ...(reset ? { sessionVersion: sql`${usersTable.sessionVersion} + 1` } : {}), updatedAt: now };
      const [user] = existing
        ? await tx.update(usersTable).set(patch).where(and(eq(usersTable.id, existing.id), eq(usersTable.isTestAccount, true))).returning()
        : await tx.insert(usersTable).values({ email: persona.email, ...patch, sessionVersion: 0 }).returning();
      if (!user) throw new WorkflowError(409, 'A QA account changed while it was being prepared. Please try again.');
      let profileId: string | null = null;
      if (persona.role === 'volunteer') {
        const completed = persona.onboardingComplete;
        const [storedProfile] = await tx.select().from(volunteerProfilesTable).where(eq(volunteerProfilesTable.userId,user.id));
        const completeDefaults = {
          dateOfBirth:'1990-01-01',addressLine1:'123 QA Test Lane',city:'Sacramento',state:'CA',zip:'95814',
          emergencyContactName:'Test Contact',emergencyContactRelationship:'Friend',emergencyContactPhone:'9165550101',
        };
        const repairs = completed ? Object.fromEntries(Object.entries(completeDefaults).filter(([key]) =>
          !storedProfile?.[key as keyof typeof storedProfile])) : {};
        const values = { county: 'Placer', status: persona.status, onboardingCompletedAt: completed ? now : null,
          ...repairs,
          ...(reset || !existing ? {
            dateOfBirth: completed ? '1990-01-01' : null, addressLine1: completed ? '123 QA Test Lane' : null,
            city: completed ? 'Sacramento' : null, state:'CA',zip:completed ? '95814' : null,
            emergencyContactName:completed ? 'Test Contact' : null,emergencyContactRelationship:completed ? 'Friend' : null,
            emergencyContactPhone:completed ? '9165550101' : null,startDate:persona.status === 'active' ? today : null,
          } : {}),
          agreementAcknowledgedAt: completed ? now : null, agreementVersion: completed ? version : null,
          certificationStatus: persona.certificationStatus, certificationCompletedAt: persona.certificationStatus === 'complete' ? today : null,
          backgroundCheckStatus: persona.backgroundCheckStatus, backgroundCheckSubmittedAt: persona.backgroundCheckStatus === 'not_started' ? null : today,
          backgroundCheckClearedAt: persona.backgroundCheckStatus === 'cleared' ? today : null,
          ...(reset || !existing ? { onboardingAnswers: {}, availabilityNotes: null, adminNotes: null, certificationExpiresAt: null } : {}),
          updatedAt: now };
        // Ordinary preparation must not undo saved onboarding, status or start date.
        // Only the explicit reset action restores the persona's starting state.
        const legacyStatus = storedProfile && normalizeVolunteerStatus(storedProfile.status) !== storedProfile.status
          ? {status:normalizeVolunteerStatus(storedProfile.status)} : {};
        const repairValues = {...repairs,...legacyStatus};
        const [profile] = storedProfile && !reset
          ? Object.keys(repairValues).length
            ? await tx.update(volunteerProfilesTable).set({...repairValues,updatedAt:now})
              .where(eq(volunteerProfilesTable.id,storedProfile.id)).returning()
            : [storedProfile]
          : await tx.insert(volunteerProfilesTable).values({ userId: user.id, ...values })
            .onConflictDoUpdate({ target: volunteerProfilesTable.userId, set: values }).returning();
        profileId = profile!.id;
      }
      result.push({ key: persona.key, label: persona.label, userId: user.id, profileId, created: !existing });
    }
    if (reset) {
      const ids = result.map(p => p.userId);
      const profiles = result.flatMap(p => p.profileId ? [p.profileId] : []);
      // Also clean a formerly-volunteer QA admin without touching any real profile.
      const ownedProfiles = await tx.select({ id: volunteerProfilesTable.id }).from(volunteerProfilesTable)
        .where(inArray(volunteerProfilesTable.userId, ids));
      const allProfiles = [...new Set([...profiles, ...ownedProfiles.map(p => p.id)])];
      if (allProfiles.length) {
        const assignments = await tx.select({ id: shiftAssignmentsTable.id }).from(shiftAssignmentsTable)
          .where(inArray(shiftAssignmentsTable.volunteerProfileId, allProfiles));
        if (assignments.length) await tx.delete(shiftSkipsTable).where(inArray(shiftSkipsTable.shiftAssignmentId, assignments.map(a => a.id)));
        await tx.delete(shiftAssignmentsTable).where(inArray(shiftAssignmentsTable.volunteerProfileId, allProfiles));
      }
      await tx.delete(messageRecipientsTable).where(inArray(messageRecipientsTable.recipientUserId, ids));
      await tx.delete(authTokensTable).where(inArray(authTokensTable.userId, ids));
      if (actorUserId && profiles.length) await tx.insert(activityLogTable).values(profiles.map(volunteerProfileId => ({
        volunteerProfileId, actorUserId, action: 'test_accounts_reset', details: { personas: result.map(p => p.key) },
      })));
    }
    // Never reserve real production capacity automatically. In dev, seed only
    // the designated active persona, on first creation or explicit reset.
    const active = result.find(p => p.key === 'vol-active');
    if (env.NODE_ENV === 'development' && active?.profileId && (reset || active.created)) {
      const slots = await tx.select().from(shiftSlotsTable).where(and(eq(shiftSlotsTable.isActive, true),
        or(isNull(shiftSlotsTable.retireAfterDate), gte(shiftSlotsTable.retireAfterDate, today))))
        .orderBy(shiftSlotsTable.dayOfWeek, shiftSlotsTable.startTime).for('update');
      for (const slot of slots) {
        const assigned = await tx.select({ id: shiftAssignmentsTable.id }).from(shiftAssignmentsTable)
          .where(and(eq(shiftAssignmentsTable.shiftSlotId, slot.id), isNull(shiftAssignmentsTable.endedReason),
            or(isNull(shiftAssignmentsTable.endDate), gte(shiftAssignmentsTable.endDate, today))));
        if (assigned.length >= slot.capacity) continue;
        const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
        const startDate = addCalendarDays(today, (slot.dayOfWeek - weekday + 7) % 7 || 7);
        if (slot.retireAfterDate && startDate > slot.retireAfterDate) continue;
        await tx.insert(shiftAssignmentsTable).values({ volunteerProfileId: active.profileId,
          shiftSlotId: slot.id, startDate, createdByUserId: result.find(p => p.key === 'admin')!.userId });
        break;
      }
    }
    return result;
  }
  return {
    ensure: () => db.transaction(tx => restore(tx, false)),
    reset: (actorUserId: string) => db.transaction(tx => restore(tx, true, actorUserId)),
  };
}
const service = createTestAccountService();
export const ensureTestAccounts = service.ensure;
export const resetTestAccounts = service.reset;
export async function testAccountList() {
  if (!isQuickLoginEnabled()) return { enabled: false, accounts: [] };
  const users = await db.select({ id: usersTable.id, email: usersTable.email, lastLoginAt: usersTable.lastLoginAt })
    .from(usersTable).where(and(eq(usersTable.isTestAccount, true), inArray(usersTable.email, testAccounts.map(p => p.email))));
  return { enabled: true, accounts: testAccounts.map(p => {
    const user = users.find(u => u.email === p.email);
    return { key: p.key, label: p.label, email: p.email, userId: user?.id ?? null, lastLoginAt: user?.lastLoginAt?.toISOString() ?? null };
  }) };
}
