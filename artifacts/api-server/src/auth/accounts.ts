import { and, eq, gt, inArray, isNull } from 'drizzle-orm';
import { db, usersTable, authTokensTable, volunteerProfilesTable, type User } from '@workspace/db';
import { createEmailTemplate, sendEmail } from '../email';
import { appOrigin, randomToken } from './session';
import { agreementVersion } from '../server/agreements';
import { appConfig } from '@workspace/shared/appConfig';
import { missingProfileFields } from '@workspace/shared/profileFields';
import { tokenHash } from './security';

/** User-before-token lock order also matches account deactivation and invitation renewal. */
export async function claimToken(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  raw: string, type: 'email_verify' | 'password_reset' | 'admin_invite',
) {
  const [candidate] = await tx.select({ userId: authTokensTable.userId }).from(authTokensTable)
    .where(and(eq(authTokensTable.tokenHash, tokenHash(raw)), eq(authTokensTable.type, type))).limit(1);
  if (!candidate) return undefined;
  const [owner] = await tx.select({ id: usersTable.id }).from(usersTable)
    .where(eq(usersTable.id, candidate.userId)).for('update');
  if (!owner) return undefined;
  const [token] = await tx.update(authTokensTable).set({ usedAt: new Date() }).where(and(
    eq(authTokensTable.tokenHash, tokenHash(raw)), eq(authTokensTable.type, type),
    isNull(authTokensTable.usedAt), gt(authTokensTable.expiresAt, new Date()),
  )).returning();
  return token;
}

export async function accountPath(user: User): Promise<string> {
  if (!user.emailVerifiedAt) return '/verify-email';
  if (user.role === 'admin') return '/admin';
  const [profile] = await db.select().from(volunteerProfilesTable).where(eq(volunteerProfilesTable.userId, user.id)).limit(1);
  if (!profile?.onboardingCompletedAt || missingProfileFields(user, profile).length) return '/onboarding';
  if (!appConfig.requireAgreementAcknowledgment) return '/dashboard';
  return profile.agreementAcknowledgedAt && profile.agreementVersion === await agreementVersion() ? '/dashboard' : '/agreements';
}
export async function mintToken(userId: string, type: 'email_verify' | 'password_reset' | 'admin_invite',
  options?: { pendingEmail: string; requester?: User }) {
  const raw = randomToken();
  const expiresAt = new Date(Date.now() + (type === 'email_verify' ? 48 : type === 'admin_invite' ? 168 : 1) * 60 * 60 * 1000);
  const row = await db.transaction(async tx => {
    const locked = await tx.select().from(usersTable).where(inArray(usersTable.id,
      [...new Set([userId, ...(options?.requester ? [options.requester.id] : [])])])).orderBy(usersTable.id).for('update');
    const owner = locked.find(u => u.id === userId);
    if (!owner) throw new Error('This account is no longer available.');
    if (options) {
      const actor = options.requester && locked.find(u => u.id === options.requester!.id);
      if (!owner.isActive || !owner.emailVerifiedAt || options.pendingEmail === owner.email ||
        (options.requester && (!actor?.isActive || !actor.emailVerifiedAt || actor.sessionVersion !== options.requester.sessionVersion ||
          (actor.id !== owner.id && actor.role !== 'admin')))) throw new Error('This email change is no longer available.');
      const [other] = await tx.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, options.pendingEmail));
      if (other) throw new Error('That email address is already used by another account.');
    }
    await tx.update(authTokensTable).set({ usedAt: new Date() })
      .where(and(eq(authTokensTable.userId, userId), eq(authTokensTable.type, type), isNull(authTokensTable.usedAt)));
    const [created] = await tx.insert(authTokensTable).values({ userId, type, tokenHash: tokenHash(raw), expiresAt,
      pendingEmail: options?.pendingEmail ?? null }).returning();
    return created!;
  });
  return { ...row, raw };
}
export async function verificationEmailForChange(user: User, email: string, requester?: User, retryLogId?: string) {
  const token = await mintToken(user.id, 'email_verify', { pendingEmail: email, requester });
  const content = createEmailTemplate({
    heading: 'Confirm your new email address', firstName: user.firstName,
    paragraphs: [
      'A change to your Community Care Team account email was requested. Confirm this address to finish the change.',
      'Your current address stays in use until you confirm. This link expires in 48 hours and can be used once.',
      'Confirming signs out your other sessions. If this change was not intended, ignore this email and contact Alliance staff.',
    ],
    cta: { label: 'Confirm new email', url: `${appOrigin}/verify?token=${token.raw}` },
  });
  return sendEmail({ type: 'verification', to: email, toUserId: user.id, subject: 'Confirm your new CCT Portal email',
    relatedId: token.id, retryLogId, ...content });
}
export async function verificationEmail(user: User, retryLogId?: string) {
  const token = await mintToken(user.id, 'email_verify');
  const content = createEmailTemplate({
    heading: 'Welcome to The Alliance',
    firstName: user.firstName,
    paragraphs: [
      'Thank you for helping local families find the support they need.',
      'Please confirm your email so we can welcome you as a Resource Coordinator and help you get started. This link is valid for 48 hours.',
      "If you didn't create this account, you can safely ignore this email.",
    ],
    cta: { label: 'Verify my email', url: `${appOrigin}/verify?token=${token.raw}` },
  });
  return sendEmail({ type: 'verification', to: user.email, toUserId: user.id,
    subject: 'Welcome to The Alliance — please verify your email', relatedId: token.id, retryLogId, ...content });
}
export async function passwordResetEmail(user: User, retryLogId?: string) {
  const token = await mintToken(user.id, 'password_reset');
  const content = createEmailTemplate({
    heading: 'Let’s get you back into the CCT Portal',
    firstName: user.firstName,
    paragraphs: [
      'We received a request to reset your password. Use the link below to choose a new password and continue supporting your community.',
      'This link is valid for one hour and can only be used once.',
      "If you didn't request a reset, you don't need to do anything. Your current password will stay the same.",
    ],
    cta: { label: 'Reset my password', url: `${appOrigin}/reset-password?token=${token.raw}` },
  });
  return sendEmail({ type: 'password_reset', to: user.email, toUserId: user.id,
    subject: 'Reset your Community Care Team Volunteer Portal password', relatedId: token.id, retryLogId, ...content });
}
