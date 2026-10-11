import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import {
  db, usersTable, authTokensTable, sessionsTable, notificationLogTable, volunteerProfilesTable,
  shiftAssignmentsTable, activityLogTable, type User,
} from '@workspace/db';
import { createEmailTemplate, sendEmail } from '../email';
import { appOrigin, randomToken } from './session';
import { hashPassword, tokenHash } from './security';
import { lockSchedule } from '../server/scheduleMutations';
import {releaseCustomAssignments} from '../server/customShiftRelease';
import { pacificDay, assignmentIsHeld } from '../server/scheduleService';
import { onAssignmentsReleased, type ReleasedAssignments } from '../uncovered-shifts';
import { logger } from '../lib/logger';

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type AdminActor = Pick<User, 'id' | 'sessionVersion'>;
export class AdminActionError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

// Consistent lock order serializes administrator writes, including concurrent
// deactivations. Recheck the actor after locking so revoked sessions cannot finish a grant.
async function lockActiveAdmins(tx: Transaction, actor?: AdminActor) {
  const admins = await tx.select().from(usersTable).where(and(
    eq(usersTable.role, 'admin'), eq(usersTable.isActive, true), isNotNull(usersTable.emailVerifiedAt),
  )).orderBy(usersTable.id).for('update');
  if (actor && !admins.some(user => user.id === actor.id && user.sessionVersion === actor.sessionVersion)) {
    throw new AdminActionError(403, 'ADMIN_REQUIRED', 'Please sign in with an active administrator account.');
  }
  return admins;
}

export async function inviteAdministrator(
  input: { firstName: string; lastName: string; email: string },
  options: { actor: AdminActor; bootstrap?: never } | { bootstrap: true; actor?: never },
) {
  const email = input.email.trim().toLowerCase();
  const firstName = input.firstName.trim();
  const lastName = input.lastName.trim();
  if (!firstName || !lastName || firstName.length > 100 || lastName.length > 100
    || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new AdminActionError(400, 'INVITE_INPUT_INVALID', 'Please enter a first name, last name, and valid email.');
  }
  const passwordHash = await hashPassword(randomToken());
  const raw = randomToken();
  const { user, tokenId } = await db.transaction(async tx => {
    // Bootstrap is a shell-only operation. It never replaces existing administrators.
    if (options.bootstrap) await tx.execute(sql`SELECT pg_advisory_xact_lock(742183019)`);
    const admins = await lockActiveAdmins(tx, options.actor);
    if (options.bootstrap && admins.some(u => !u.isTestAccount)) {
      throw new AdminActionError(409, 'ALREADY_INITIALIZED', 'An active administrator already exists. Use /admin/team to invite another.');
    }
    const [existing] = await tx.select().from(usersTable).where(eq(usersTable.email, email)).for('update');
    if (existing && (existing.role !== 'admin' || existing.emailVerifiedAt || !existing.isActive)) {
      throw new AdminActionError(409, 'ACCOUNT_EXISTS',
        'This email belongs to an existing account. Only active, pending admin invitations can be renewed.');
    }
    const [user] = existing
      ? await tx.update(usersTable).set({ firstName, lastName, updatedAt: new Date() })
        .where(eq(usersTable.id, existing.id)).returning()
      : await tx.insert(usersTable).values({ email, firstName, lastName, passwordHash, role: 'admin' }).returning();
    await tx.update(authTokensTable).set({ usedAt: new Date() }).where(and(
      eq(authTokensTable.userId, user!.id), eq(authTokensTable.type, 'admin_invite'), isNull(authTokensTable.usedAt),
    ));
    const [token] = await tx.insert(authTokensTable).values({
      userId: user!.id, type: 'admin_invite', tokenHash: tokenHash(raw),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    }).returning({ id: authTokensTable.id });
    return { user: user!, tokenId: token!.id };
  });
  const inviteUrl = `${appOrigin}/accept-invite?token=${raw}`;
  const content = createEmailTemplate({
    heading: 'You’re invited to help coordinate community care',
    firstName,
    paragraphs: [
      "You’ve been invited to join The Alliance's Community Care Team as an administrator.",
      'Your care and coordination help volunteers connect local families with the support they need. Set your password to accept this invitation and confirm your email address.',
      'This invitation is valid for seven days and can be used once. If you weren’t expecting it, you can safely ignore this email.',
    ],
    cta: { label: 'Accept admin invitation', url: inviteUrl },
  });
  const result = await sendEmail({
    type: 'invite', to: user.email, toUserId: user.id,
    subject: 'Your invitation to the Community Care Team Volunteer Portal', relatedId: tokenId, ...content,
  });
  const [log] = await db.select({ status: notificationLogTable.status }).from(notificationLogTable)
    .where(eq(notificationLogTable.relatedId, tokenId)).limit(1);
  const delivery = result.ok && log?.status === 'sent' ? 'sent' : result.ok && log?.status === 'logged' ? 'logged' : 'failed';
  return {
    user, inviteUrl, delivery,
    message: delivery === 'sent' ? 'The invitation has been emailed. It expires in seven days.'
      : delivery === 'logged' ? 'The invitation is ready. In development, its link is printed in the server console.'
        : 'The admin account is pending, but we couldn’t send the invitation. Please try inviting this email again.',
  };
}

export function assertDeactivationAllowed(actorId: string, target: User, activeAdminCount: number) {
  if (target.id === actorId) {
    throw new AdminActionError(409, 'SELF_DEACTIVATION', 'You can’t deactivate your own account.');
  }
  if (!target.isTestAccount && target.role === 'admin' && target.isActive && target.emailVerifiedAt && activeAdminCount <= 1) {
    throw new AdminActionError(409, 'LAST_ADMIN', 'The last active, verified administrator cannot be deactivated.');
  }
}

export async function setAccountActive(actor: AdminActor, userId: string, isActive: boolean) {
  let event: ReleasedAssignments | undefined;
  const result = await db.transaction(async tx => {
    await lockSchedule(tx);
    const admins = await lockActiveAdmins(tx, actor);
    const [target] = await tx.select().from(usersTable).where(eq(usersTable.id, userId)).for('update');
    if (!target) throw new AdminActionError(404, 'USER_NOT_FOUND', 'This account could not be found.');
    if (!isActive) assertDeactivationAllowed(actor.id, target,
      admins.filter(u => !u.isTestAccount).length + (!target.isTestAccount && target.role === 'admin' && target.isActive && target.emailVerifiedAt
        && !admins.some(admin => admin.id === target.id) ? 1 : 0));
    if (target.isActive === isActive) return target;
    const [updated] = await tx.update(usersTable).set({
      isActive, updatedAt: new Date(), sessionVersion: sql`${usersTable.sessionVersion} + 1`,
    }).where(eq(usersTable.id, userId)).returning();
    await tx.delete(sessionsTable).where(sql`${sessionsTable.sess}->>'userId' = ${userId}`);
    if (!isActive) {
      await tx.update(authTokensTable).set({ usedAt: new Date() })
        .where(and(eq(authTokensTable.userId, userId), isNull(authTokensTable.usedAt)));
      if (target.role === 'volunteer') {
        const [profile] = await tx.select().from(volunteerProfilesTable).where(eq(volunteerProfilesTable.userId, userId)).for('update');
        if (profile) {
          const today = pacificDay(new Date());
          const rows = (await tx.select().from(shiftAssignmentsTable).where(eq(shiftAssignmentsTable.volunteerProfileId, profile.id)))
            .filter(a => assignmentIsHeld(a, today));
          const custom=await releaseCustomAssignments(tx,profile.id);
          for (const a of rows) await tx.update(shiftAssignmentsTable).set({ endDate: today, endedReason: 'admin_removed', updatedAt: new Date() })
            .where(eq(shiftAssignmentsTable.id, a.id));
          const [activity] = await tx.insert(activityLogTable).values({ volunteerProfileId: profile.id,
            actorUserId: actor.id, action: 'account_deactivated', details: { previousAssignments: rows,previousCustomAssignments:custom } }).returning();
          event = { volunteerProfileId: profile.id, assignmentIds: [...rows.map(a => a.id),...custom.map(a=>a.id)], shiftSlotIds: [...new Set([...rows.map(a => a.shiftSlotId),...custom.map(a=>a.customShiftId)])],
            effectiveDate: today, activityId: activity!.id };
        }
      }
    }
    return updated!;
  });
  if (event) try { await onAssignmentsReleased(event); }
  catch (err) { logger.error({ err }, 'Coverage alert failed after account deactivation.'); }
  return result;
}
