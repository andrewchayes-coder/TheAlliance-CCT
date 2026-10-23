import { randomBytes } from 'node:crypto';
import { and, eq, inArray, isNull, or, gte, sql } from 'drizzle-orm';
import {
  db, usersTable, volunteerProfilesTable, shiftAssignmentsTable, shiftSlotsTable, shiftSkipsTable,
  messageRecipientsTable, activityLogTable, authTokensTable, customShiftAssignmentsTable, volunteerHoursTable, calendarFeedsTable,
} from '@workspace/db';
import { testAccounts, testProfileFields } from '@workspace/shared/testAccounts';
import { normalizeVolunteerStatus } from '@workspace/shared/profileFields';
import { pacificDay, addCalendarDays } from './scheduleService';
import { WorkflowError } from '../admin-volunteer-detail';
import { hashPassword } from '../auth/security';

import { isQuickLoginEnabled } from '../auth/quick-login-lock';
export { isQuickLoginEnabled } from '../auth/quick-login-lock';

type FixtureEmail<P> = P extends unknown ? Omit<P, 'email' | 'legacyEmail'> & { email: string; legacyEmail?: string } : never;
type Persona = FixtureEmail<typeof testAccounts[number]>;
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
/** The override seam lets automated tests use only their owned fixture emails. */
export function createTestAccountService(personas: readonly Persona[] = testAccounts, env: NodeJS.ProcessEnv = process.env) {
  async function restore(tx: Tx, reset: boolean, actorUserId?: string) {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(91847314)`);
    const now = new Date(), today = pacificDay(now);
    const result: { key: string; label: string; userId: string; profileId: string | null; created: boolean }[] = [];
    for (const persona of personas) {
      const matches = await tx.select().from(usersTable).where(inArray(usersTable.email,
        [persona.email, ...(persona.legacyEmail ? [persona.legacyEmail] : [])])).for('update');
      if (matches.some(user => !user.isTestAccount))
        throw new WorkflowError(409, `The QA address ${persona.email} belongs to a non-test account. No accounts were changed.`);
      if (matches.length > 1)
        throw new WorkflowError(409, `Both old and new QA addresses exist for ${persona.key}. No accounts were changed; review these test identities first.`);
      const existing = matches[0];
      const migrating = !!existing && existing.email !== persona.email;
      const restoring = reset || !existing || migrating;
      // The cleartext is ephemeral and never returned, logged, or persisted.
      const passwordHash = await hashPassword(randomBytes(32).toString('hex'));
      const blankProfile = persona.role === 'volunteer' && !persona.onboardingComplete;
      const patch = { email: persona.email, firstName: restoring ? 'Test' : existing!.firstName,
        lastName: restoring ? persona.lastName : existing!.lastName, role: persona.role,
        isActive: restoring ? true : existing!.isActive,
        isTestAccount: true, emailVerifiedAt: existing?.emailVerifiedAt ?? now, passwordHash, googleSubject: null,
        phone: restoring ? (blankProfile ? null : '5555550100')
          : existing!.phone === '9165550100' || (!existing!.phone && !blankProfile) ? '5555550100' : existing!.phone,
        ...(reset ? { sessionVersion: sql`${usersTable.sessionVersion} + 1` } : {}), updatedAt: now };
      const [user] = existing
        ? await tx.update(usersTable).set(patch).where(and(eq(usersTable.id, existing.id), eq(usersTable.isTestAccount, true))).returning()
        : await tx.insert(usersTable).values({ ...patch, sessionVersion: 0 }).returning();
      if (!user) throw new WorkflowError(409, 'A QA account changed while it was being prepared. Please try again.');
      let profileId: string | null = null;
      if (persona.role === 'volunteer') {
        const completed = persona.onboardingComplete;
        const [storedProfile] = await tx.select().from(volunteerProfilesTable).where(eq(volunteerProfilesTable.userId,user.id));
        const oldDefaults = storedProfile?.addressLine1 === '123 QA Test Lane';
        const repairs = completed ? Object.fromEntries(Object.entries(testProfileFields).filter(([key]) =>
          oldDefaults || !storedProfile?.[key as keyof typeof storedProfile])) : {};
        const values = { county: 'Placer', status: persona.status, onboardingCompletedAt: completed ? now : null,
          ...repairs,
          ...(restoring || !storedProfile ? {
            ...Object.fromEntries(Object.entries(testProfileFields).map(([key,value]) => [key,completed ? value : null])),
            startDate:persona.status === 'active' ? today : null,
          } : {}),
          ...(reset || !existing ? { onboardingAnswers: {}, availabilityNotes: null, adminNotes: null } : {}),
          ...(reset ? { backgroundCheckStatus: 'not_started' as const, backgroundCheckClearedAt: null } : {}),
          updatedAt: now };
        // Ordinary preparation must not undo saved onboarding, status or start date.
        // Only the explicit reset action restores the persona's starting state.
        const legacyStatus = storedProfile && normalizeVolunteerStatus(storedProfile.status) !== storedProfile.status
          ? {status:normalizeVolunteerStatus(storedProfile.status)} : {};
        const repairValues = {...repairs,...legacyStatus,
          ...(storedProfile?.status === 'active' && !storedProfile.startDate ? {startDate:today} : {})};
        const [profile] = storedProfile && !restoring
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
        await tx.delete(calendarFeedsTable).where(inArray(calendarFeedsTable.volunteerProfileId, allProfiles));
        await tx.delete(volunteerHoursTable).where(inArray(volunteerHoursTable.volunteerProfileId, allProfiles));
        await tx.update(customShiftAssignmentsTable).set({ cancelledAt: now })
          .where(and(inArray(customShiftAssignmentsTable.volunteerProfileId, allProfiles),
            isNull(customShiftAssignmentsTable.cancelledAt)));
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
