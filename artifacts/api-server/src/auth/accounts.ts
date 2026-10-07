import { and, eq, isNull } from 'drizzle-orm';
import { db, authTokensTable, volunteerProfilesTable, type User } from '@workspace/db';
import { createEmailTemplate, sendEmail } from '../email';
import { appOrigin, randomToken } from './session';
import { tokenHash } from './security';

export async function accountPath(user: User): Promise<string> {
  if (!user.emailVerifiedAt) return '/verify-email';
  if (user.role === 'admin') return '/dashboard';
  const [profile] = await db.select({ completed: volunteerProfilesTable.onboardingCompletedAt })
    .from(volunteerProfilesTable).where(eq(volunteerProfilesTable.userId, user.id)).limit(1);
  return profile?.completed ? '/dashboard' : '/onboarding';
}
export async function mintToken(userId: string, type: 'email_verify' | 'password_reset') {
  const raw = randomToken();
  const expiresAt = new Date(Date.now() + (type === 'email_verify' ? 48 : 1) * 60 * 60 * 1000);
  const row = await db.transaction(async tx => {
    await tx.update(authTokensTable).set({ usedAt: new Date() })
      .where(and(eq(authTokensTable.userId, userId), eq(authTokensTable.type, type), isNull(authTokensTable.usedAt)));
    const [created] = await tx.insert(authTokensTable).values({ userId, type, tokenHash: tokenHash(raw), expiresAt }).returning();
    return created!;
  });
  return { ...row, raw };
}
export async function verificationEmail(user: User) {
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
    subject: 'Welcome to The Alliance — please verify your email', relatedId: token.id, ...content });
}
export async function passwordResetEmail(user: User) {
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
    subject: 'Reset your Alliance Volunteer Portal password', relatedId: token.id, ...content });
}
