import { Router, type IRouter } from 'express';
import { OAuth2Client, CodeChallengeMethod } from 'google-auth-library';
import { createHash } from 'node:crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { db, usersTable, volunteerProfilesTable, authTokensTable } from '@workspace/db';
import { appOrigin, googleEnabled, randomToken, sameSecret, saveSession, establishSession } from '../auth/session';
import { accountPath } from '../auth/accounts';
import { enforceLimit, hashPassword } from '../auth/security';

const router: IRouter = Router();
class InactiveGoogleAccount extends Error {}
const redirectUri = `${appOrigin}/api/auth/google/callback`;
function googleClient() {
  return new OAuth2Client(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, redirectUri);
}

router.get('/google', async (req, res): Promise<void> => {
  if (!googleEnabled) { res.redirect(303, '/signin?error=google_unavailable'); return; }
  if (!await enforceLimit(req, res, 'google-ip', req.ip ?? 'unknown', 3600, 30)) return;
  const state = randomToken();
  const nonce = randomToken();
  const verifier = randomToken();
  req.session.googleLogin = { state, nonce, verifier, expiresAt: Date.now() + 10 * 60 * 1000 };
  await saveSession(req);
  res.redirect(302, googleClient().generateAuthUrl({
    scope: ['openid', 'email', 'profile'], access_type: 'online', prompt: 'select_account',
    state, nonce, code_challenge_method: CodeChallengeMethod.S256,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
  }));
});

router.get('/google/callback', async (req, res): Promise<void> => {
  const login = req.session.googleLogin;
  delete req.session.googleLogin;
  await saveSession(req);
  const code = typeof req.query.code === 'string' ? req.query.code : undefined;
  const state = typeof req.query.state === 'string' ? req.query.state : undefined;
  if (!googleEnabled || !login || login.expiresAt < Date.now() || !code || !sameSecret(login.state, state)) {
    res.redirect(303, '/signin?error=google_failed'); return;
  }
  try {
    const client = googleClient();
    const { tokens } = await client.getToken({ code, codeVerifier: login.verifier, redirect_uri: redirectUri });
    if (!tokens.id_token) throw new Error('No identity token.');
    const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: process.env.GOOGLE_CLIENT_ID });
    const identity = ticket.getPayload();
    if (!identity?.sub || !identity.email || !identity.email_verified || identity.nonce !== login.nonce) {
      throw new Error('Google identity did not verify.');
    }
    const email = identity.email.trim().toLowerCase();
    // Google-only accounts have an unknown random bcrypt password; reset can establish a local password.
    const unusablePassword = await hashPassword(randomToken());
    const user = await db.transaction(async tx => {
      const [linked] = await tx.select().from(usersTable).where(eq(usersTable.googleSubject, identity.sub)).limit(1);
      if (linked) {
        const [updated] = await tx.update(usersTable).set({ lastLoginAt: new Date() })
          .where(and(eq(usersTable.id, linked.id), eq(usersTable.isActive, true), eq(usersTable.isTestAccount, false))).returning();
        if (!updated) throw new InactiveGoogleAccount();
        return updated;
      }
      const [existing] = await tx.select().from(usersTable).where(eq(usersTable.email, email)).limit(1).for('update');
      if (existing) {
        if (!existing.isActive || existing.isTestAccount) throw new InactiveGoogleAccount();
        if (existing.role === 'admin' && !existing.emailVerifiedAt) {
          throw new Error('Accept the administrator invitation before using Google sign-in.');
        }
        if (existing.googleSubject && existing.googleSubject !== identity.sub) {
          throw new Error('Account cannot be linked.');
        }
        // Prevent pre-registration hijacking: never retain an unverified registrant's password or sessions.
        const reclaim = !existing.emailVerifiedAt;
        const [updated] = await tx.update(usersTable).set({
          googleSubject: identity.sub, emailVerifiedAt: existing.emailVerifiedAt ?? new Date(), lastLoginAt: new Date(),
          ...(reclaim ? {
            passwordHash: unusablePassword, sessionVersion: sql`${usersTable.sessionVersion} + 1`,
            firstName: (identity.given_name ?? existing.firstName).slice(0, 100),
            lastName: (identity.family_name ?? existing.lastName).slice(0, 100), phone: null,
          } : {}),
        }).where(eq(usersTable.id, existing.id)).returning();
        if (reclaim) {
          await tx.update(authTokensTable).set({ usedAt: new Date() })
            .where(and(eq(authTokensTable.userId, existing.id), isNull(authTokensTable.usedAt)));
        }
        return updated!;
      }
      const [created] = await tx.insert(usersTable).values({
        email, passwordHash: unusablePassword, googleSubject: identity.sub,
        firstName: (identity.given_name ?? 'Volunteer').slice(0, 100),
        lastName: (identity.family_name ?? '').slice(0, 100),
        emailVerifiedAt: new Date(), lastLoginAt: new Date(), role: 'volunteer',
      }).returning();
      await tx.insert(volunteerProfilesTable).values({ userId: created!.id, status: 'applicant' });
      return created!;
    });
    await establishSession(req, user);
    res.redirect(303, await accountPath(user));
  } catch (error) {
    // OAuth errors may contain token-exchange credentials. Never print the SDK error object.
    req.log.warn('Google sign-in could not be completed');
    res.redirect(303, error instanceof InactiveGoogleAccount ? '/signin?error=account_inactive' : '/signin?error=google_failed');
  }
});

export default router;
