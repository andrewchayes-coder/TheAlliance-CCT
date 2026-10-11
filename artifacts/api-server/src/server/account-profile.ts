import { and, desc, eq, gt, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { db, usersTable, authTokensTable, volunteerProfilesTable, activityLogTable, userPublicSchema, type User } from '@workspace/db';
import { checkPassword } from '../auth/security';
import { verificationEmailForChange } from '../auth/accounts';
import { phoneDigits } from '@workspace/shared/profileFields';

export class AccountError extends Error { constructor(message: string, public status = 400) { super(message); } }
export const detailsSchema = z.object({
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  phone: z.string().max(50).nullable().refine(v => v === null || !v.trim() || /^[\d\s()+.-]+$/.test(v), 'Use a ten-digit US phone number.')
    .transform(v => v?.trim() ? phoneDigits(v) : null)
    .refine(v => v === null || /^\d{10}$/.test(v), 'Use a ten-digit US phone number.'),
}).strict();
export const emailChangeSchema = z.object({
  email: z.string().trim().email().max(254).transform(value => value.toLowerCase()),
  currentPassword: z.string().min(1).max(200).optional(),
}).strict();
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export async function lockAccount(tx: Tx, actor: User, targetId: string) {
  const rows = await tx.select().from(usersTable).where(inArray(usersTable.id, [...new Set([actor.id, targetId])])).orderBy(usersTable.id).for('update');
  const current = rows.find(u => u.id === actor.id), target = rows.find(u => u.id === targetId);
  if (!current?.isActive || !current.emailVerifiedAt || current.sessionVersion !== actor.sessionVersion ||
    (targetId !== actor.id && current.role !== 'admin')) throw new AccountError('Please sign in again to manage this account.', 403);
  if (!target) throw new AccountError('Account not found.', 404);
  if (current.isTestAccount && !target.isTestAccount)
    throw new AccountError('Test accounts can only change other test accounts. Use your staff account to manage a real team member.', 403);
  return target;
}
export async function recordProfileEdit(tx: Tx, actorId: string, targetId: string, fields: string[], action = 'account_updated') {
  const [profile] = await tx.select({ id: volunteerProfilesTable.id }).from(volunteerProfilesTable).where(eq(volunteerProfilesTable.userId, targetId));
  if (profile) await tx.insert(activityLogTable).values({ volunteerProfileId: profile.id, actorUserId: actorId, action, details: { fields } });
}
export async function accountProfile(actor: User, targetId = actor.id) {
  if (actor.id !== targetId && actor.role !== 'admin') throw new AccountError('Account not found.', 404);
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, targetId));
  if (!user) throw new AccountError('Account not found.', 404);
  const [pending] = await db.select({ email: authTokensTable.pendingEmail, expiresAt: authTokensTable.expiresAt })
    .from(authTokensTable).where(and(eq(authTokensTable.userId, targetId), eq(authTokensTable.type, 'email_verify'),
      isNull(authTokensTable.usedAt), gt(authTokensTable.expiresAt, new Date())))
    .orderBy(desc(authTokensTable.createdAt)).limit(1);
  return {
    user: userPublicSchema.parse(user),
    photoUrl: user.profilePhotoKey ? `/api/account/users/${user.id}/photo?v=${user.updatedAt.getTime()}` : null,
    pendingEmail: pending?.email ?? null, pendingEmailExpiresAt: pending?.email ? pending.expiresAt.toISOString() : null,
  };
}
export async function saveDetails(actor: User, targetId: string, data: z.infer<typeof detailsSchema>) {
  await db.transaction(async tx => {
    await lockAccount(tx, actor, targetId);
    await tx.update(usersTable).set({ ...data, updatedAt: new Date() }).where(eq(usersTable.id, targetId));
    await recordProfileEdit(tx, actor.id, targetId, Object.keys(data));
  });
  return accountProfile(actor, targetId);
}
export async function requestEmailChange(actor: User, targetId: string, data: z.infer<typeof emailChangeSchema>) {
  const user = await db.transaction(async tx => {
    const user = await lockAccount(tx, actor, targetId);
    if (!user.isActive || !user.emailVerifiedAt) throw new AccountError('Activate and verify this account before changing its email.', 409);
    if (data.email === user.email) throw new AccountError('This is already the account’s email address.');
    const [existing] = await tx.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, data.email));
    if (existing) throw new AccountError('That email address is already used by another account.', 409);
    if (actor.id === targetId && (!data.currentPassword || !await checkPassword(data.currentPassword, user.passwordHash)))
      throw new AccountError('Enter your current password to change your email.');
    await recordProfileEdit(tx, actor.id, targetId, ['email'], 'email_change_requested');
    return user;
  });
  const delivery = await verificationEmailForChange(user, data.email, actor);
  return { ...await accountProfile(actor, targetId), deliveryFailed: !delivery.ok,
    message: !delivery.ok ? 'The address has not changed. We could not send the verification email; please try again.'
      : delivery.suppressed ? 'TEST account: verification email suppressed. The address stays unchanged until verified.'
        : !process.env.POSTMARK_SERVER_TOKEN || !process.env.EMAIL_FROM ? 'Development mode: the verification email is in the server console. The current address stays unchanged until verified.'
        : 'Please verify the new address using the email we sent. The current address stays in use until then.' };
}
