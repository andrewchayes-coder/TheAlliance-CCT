import { and, eq, gt, isNull } from 'drizzle-orm';
import { db, usersTable, authTokensTable, volunteerProfilesTable, type User } from '@workspace/db';
import { createEmailTemplate, sendEmail } from '../email';
import { appOrigin, randomToken } from './session';
import { agreementVersion } from '../server/agreements';
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
  const [profile] = await db.select({ completed: volunteerProfilesTable.onboardingCompletedAt,
    acknowledged: volunteerProfilesTable.agreementAcknowledgedAt, agreementVersion: volunteerProfilesTable.agreementVersion })
    .from(volunteerProfilesTable).where(eq(volunteerProfilesTable.userId, user.id)).limit(1);
  if (!profile?.completed) return '/onboarding';
  return profile.acknowledged && profile.agreementVersion === await agreementVersion() ? '/dashboard' : '/agreements';
}
export async function mintToken(userId: string, type: 'email_verify' | 'password_reset' | 'admin_invite') {
  const raw = randomToken();
  const expiresAt = new Date(Date.now() + (type === 'email_verify' ? 48 : type === 'admin_invite' ? 168 : 1) * 60 * 60 * 1000);
  const row = await db.transaction(async tx => {
    await tx.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.id, userId)).for('update');
    await tx.update(authTokensTable).set({ usedAt: new Date() })
      .where(and(eq(authTokensTable.userId, userId), eq(authTokensTable.type, type), isNull(authTokensTable.usedAt)));
    const [created] = await tx.insert(authTokensTable).values({ userId, type, tokenHash: tokenHash(raw), expiresAt }).returning();
    return created!;
  });
  return { ...row, raw };
}
export async function verificationEmail(user: User, retryLogId?: string) {
  const token = await mintToken(user.id, 'email_verify');
  const content = createEmailTemplate({
    heading: 'Welcome to The Alliance',
    firstName: user.firstName,
    paragraphs: [
      'Thank you for helping local families find the support they need.',
      'Please confirm your email so we can welcome you into the volunteer portal and help you get started. This link is valid for 48 hours.',
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
    heading: 'Let’s get you back into the volunteer portal',
    firstName: user.firstName,
    paragraphs: [
      'We received a request to reset your password. Use the link below to choose a new password and continue supporting your community.',
      'This link is valid for one hour and can only be used once.',
      "If you didn't request a reset, you don't need to do anything. Your current password will stay the same.",
    ],
    cta: { label: 'Reset my password', url: `${appOrigin}/reset-password?token=${token.raw}` },
  });
  return sendEmail({ type: 'password_reset', to: user.email, toUserId: user.id,
    subject: 'Reset your Alliance Volunteer Portal password', relatedId: token.id, retryLogId, ...content });
}
