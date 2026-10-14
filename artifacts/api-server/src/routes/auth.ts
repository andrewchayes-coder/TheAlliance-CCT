import { Router, type IRouter } from 'express';
import { and, eq, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { db, usersTable, volunteerProfilesTable, authTokensTable, sessionsTable } from '@workspace/db';
import { recordProfileEdit } from '../server/account-profile';
import {
  GetAuthSessionResponse, SignupBody, SignupResponse, SigninBody, SigninResponse,
  ResendVerificationResponse, VerifyEmailBody, VerifyEmailResponse,
  ForgotPasswordBody, ForgotPasswordResponse, ResetPasswordBody, ResetPasswordResponse, SignoutResponse,
  AcceptAdminInviteBody, AcceptAdminInviteResponse,
} from '@workspace/api-zod';
import {
  csrfGuard, establishSession, endSession, sessionUser, googleEnabled, randomToken,
  saveSession, inactiveMessage, appOrigin,
} from '../auth/session';
import {
  checkPassword, hashPassword, needsPasswordUpgrade, normalizePhone, validNewPassword,
  ipAndEmailLimit, enforceLimit, takeLimit, remainingCooldown,
} from '../auth/security';
import { accountPath, claimToken, passwordResetEmail, verificationEmail } from '../auth/accounts';
import googleRouter from './google-auth';
import quickLoginRouter from './quick-login';
import { mountApiRouter } from '../auth/route-catalog';
import { phoneDigits } from '@workspace/shared/profileFields';

const router: IRouter = Router();
router.use(csrfGuard);
mountApiRouter(router, '', googleRouter);
mountApiRouter(router, '', quickLoginRouter);
const normalizedBody = (body: unknown) => {
  if (!body || typeof body !== 'object') return body;
  const value = body as Record<string, unknown>;
  return { ...value, ...(typeof value.email === 'string' ? { email: value.email.trim().toLowerCase() } : {}) };
};
class InvalidLink extends Error {}
function isDuplicate(error: unknown): boolean {
  const value = error as { code?: string; cause?: { code?: string } };
  return value?.code === '23505' || value?.cause?.code === '23505';
}

router.get('/session', async (req, res): Promise<void> => {
  let user = await sessionUser(req);
  if (user && !user.isActive) {
    req.session.notice = inactiveMessage;
    delete req.session.userId;
    delete req.session.authVersion;
    user = undefined;
  }
  req.session.csrfToken ??= randomToken();
  const state = GetAuthSessionResponse.parse({
    csrfToken: req.session.csrfToken,
    authenticated: Boolean(user),
    verified: Boolean(user?.emailVerifiedAt),
    email: user?.email ?? null,
    firstName: user?.firstName ?? null,
    role: user?.role ?? null,
    googleEnabled,
    appOrigin,
    nextPath: user ? await accountPath(user) : '/signin',
    resendAfterSeconds: user ? await remainingCooldown('resend-minute', user.id, 60) : 0,
    ...(req.session.notice ? { notice: req.session.notice } : {}),
  });
  await saveSession(req);
  res.json(state);
});

router.post('/signup', async (req, res): Promise<void> => {
  const parsed = SignupBody.safeParse(normalizedBody(req.body));
  if (!parsed.success) {
    res.status(400).json({ error: 'Please complete all fields and use a password of at least 8 characters.' }); return;
  }
  const data = parsed.data;
  if (!await ipAndEmailLimit(req, res, 'signup', data.email)) return;
  const firstName = data.firstName.trim();
  const lastName = data.lastName.trim();
  const phone = phoneDigits(data.phone);
  const passwordError = validNewPassword(data.password, data.confirmPassword);
  if (!firstName || !lastName || !normalizePhone(data.phone) || phone.length !== 10 || passwordError) {
    res.status(400).json({ error: passwordError ?? 'Please enter your name and a valid mobile phone number.' }); return;
  }
  const passwordHash = await hashPassword(data.password);
  let user;
  try {
    user = await db.transaction(async tx => {
      const [created] = await tx.insert(usersTable).values({
        firstName, lastName, email: data.email, phone, passwordHash, role: 'volunteer',
      }).returning();
      await tx.insert(volunteerProfilesTable).values({ userId: created!.id, status: 'onboarding' });
      return created!;
    });
  } catch (error) {
    if (!isDuplicate(error)) throw error;
    res.status(409).json({ error: 'An account with this email already exists. Please sign in or reset your password.' }); return;
  }
  await establishSession(req, user);
  const delivery = await verificationEmail(user);
  if (delivery.ok) await takeLimit('resend-minute', user.id, 60, 1);
  req.session.notice = delivery.ok ? undefined
    : 'Your account was created, but we couldn’t send the verification email. Please try Resend email.';
  await saveSession(req);
  res.json(SignupResponse.parse({ ok: true, email: user.email, nextPath: '/verify-email', message: req.session.notice }));
});

router.post('/signin', async (req, res): Promise<void> => {
  const parsed = SigninBody.safeParse(normalizedBody(req.body));
  if (!parsed.success) {
    res.status(401).json({ error: 'The email or password is incorrect.' }); return;
  }
  const { email, password } = parsed.data;
  if (!await ipAndEmailLimit(req, res, 'signin', email)) return;
  const [existing] = await db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1);
  if (!await checkPassword(password, existing?.passwordHash) || !existing || existing.isTestAccount) {
    res.status(401).json({ error: 'The email or password is incorrect.' }); return;
  }
  if (!existing.isActive) {
    res.status(403).json({ error: inactiveMessage, code: 'ACCOUNT_INACTIVE' }); return;
  }
  // The version predicate prevents a concurrent password reset from being bypassed by an old password.
  const [user] = await db.update(usersTable).set({
    lastLoginAt: new Date(),
    ...(needsPasswordUpgrade(existing.passwordHash) ? { passwordHash: await hashPassword(password) } : {}),
  }).where(and(eq(usersTable.id, existing.id), eq(usersTable.sessionVersion, existing.sessionVersion), eq(usersTable.isActive, true))).returning();
  if (!user) { res.status(401).json({ error: 'The email or password is incorrect.' }); return; }
  await establishSession(req, user);
  res.json(SigninResponse.parse({ ok: true, email: user.email, nextPath: await accountPath(user) }));
});

router.post('/resend-verification', async (req, res): Promise<void> => {
  const user = await sessionUser(req);
  if (!user) { res.status(401).json({ error: 'Please sign in or create an account first.', nextPath: '/signin' }); return; }
  if (!user.isActive) { res.status(403).json({ error: inactiveMessage }); return; }
  if (user.emailVerifiedAt) {
    res.json(ResendVerificationResponse.parse({ ok: true, nextPath: await accountPath(user) })); return;
  }
  if (user.role === 'admin') {
    res.status(403).json({ error: 'Please accept your admin invitation or ask an administrator to renew it.' }); return;
  }
  if (!await enforceLimit(req, res, 'resend-ip', req.ip ?? 'unknown', 3600, 20)) return;
  if (!await enforceLimit(req, res, 'resend-minute', user.id, 60, 1)) return;
  if (!await enforceLimit(req, res, 'resend-hour', user.id, 3600, 5)) return;
  const delivery = await verificationEmail(user);
  if (!delivery.ok) {
    res.status(503).json({ error: 'We couldn’t send your email just now. Please wait a minute and try again.', retryAfterSeconds: 60 }); return;
  }
  delete req.session.notice;
  await saveSession(req);
  res.json(ResendVerificationResponse.parse({ ok: true, email: user.email, nextPath: '/verify-email', message: 'A new verification email is on its way.' }));
});

router.post('/verify', async (req, res): Promise<void> => {
  if (!await enforceLimit(req, res, 'verify-ip', req.ip ?? 'unknown', 900, 30)) return;
  const parsed = VerifyEmailBody.safeParse(req.body);
  const invalid = () => res.status(400).json({
    error: 'This verification link is invalid or has expired. Please request a new email.', code: 'TOKEN_INVALID',
  });
  if (!parsed.success) { invalid(); return; }
  try {
    const user = await db.transaction(async tx => {
      const token = await claimToken(tx, parsed.data.token, 'email_verify');
      if (!token) throw new InvalidLink();
      const [verified] = await tx.update(usersTable).set({
        ...(token.pendingEmail ? { email: token.pendingEmail } : {}),
        emailVerifiedAt: token.pendingEmail ? new Date() : sql`coalesce(${usersTable.emailVerifiedAt}, now())`,
        lastLoginAt: new Date(), updatedAt: new Date(), sessionVersion: sql`${usersTable.sessionVersion} + 1`,
      }).where(and(eq(usersTable.id, token.userId), token.pendingEmail ? undefined : eq(usersTable.role, 'volunteer'), eq(usersTable.isActive, true))).returning();
      if (!verified) throw new InvalidLink();
      if (token.pendingEmail) {
        await recordProfileEdit(tx, verified.id, verified.id, ['email'], 'email_changed');
        await tx.update(authTokensTable).set({ usedAt: new Date() }).where(and(eq(authTokensTable.userId, verified.id), isNull(authTokensTable.usedAt)));
        await tx.delete(sessionsTable).where(sql`${sessionsTable.sess}->>'userId' = ${verified.id}`);
      }
      return verified;
    });
    await establishSession(req, user);
    res.json(VerifyEmailResponse.parse({ ok: true, email: user.email, nextPath: await accountPath(user) }));
  } catch (error) {
    if ((error as { code?: string; cause?: { code?: string } }).code === '23505' ||
      (error as { cause?: { code?: string } }).cause?.code === '23505') {
      res.status(409).json({ error: 'That email address is now used by another account. Please request a different address.' }); return;
    }
    if (!(error instanceof InvalidLink)) throw error;
    invalid();
  }
});

router.post('/forgot-password', async (req, res): Promise<void> => {
  const parsed = ForgotPasswordBody.safeParse(normalizedBody(req.body));
  if (!parsed.success) { res.status(400).json({ error: 'Please enter a valid email address.' }); return; }
  if (!await ipAndEmailLimit(req, res, 'reset', parsed.data.email)) return;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, parsed.data.email)).limit(1);
  // Never expose existence, deactivation, or provider delivery outcome to this public endpoint.
  if (user?.isActive && !user.isTestAccount && (user.role !== 'admin' || user.emailVerifiedAt)) {
    try { await passwordResetEmail(user); }
    catch { req.log.warn('A password reset email could not be prepared'); }
  }
  res.json(ForgotPasswordResponse.parse({
    ok: true, nextPath: '/forgot-password',
    message: "If an account matches that email, you'll receive a password reset link. Please check your inbox.",
  }));
});

router.post('/reset-password', async (req, res): Promise<void> => {
  if (!await enforceLimit(req, res, 'reset-apply-ip', req.ip ?? 'unknown', 3600, 20)) return;
  const parsed = ResetPasswordBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Use a valid reset link and a password of at least 8 characters.', code: 'RESET_INPUT_INVALID' }); return;
  }
  const passwordError = validNewPassword(parsed.data.password, parsed.data.confirmPassword);
  if (passwordError) { res.status(400).json({ error: passwordError }); return; }
  const passwordHash = await hashPassword(parsed.data.password);
  try {
    await db.transaction(async tx => {
      const token = await claimToken(tx, parsed.data.token, 'password_reset');
      if (!token) throw new InvalidLink();
      const [user] = await tx.update(usersTable).set({
        passwordHash, sessionVersion: sql`${usersTable.sessionVersion} + 1`,
      }).where(and(eq(usersTable.id, token.userId), eq(usersTable.isActive, true), eq(usersTable.isTestAccount, false),
        or(eq(usersTable.role, 'volunteer'), isNotNull(usersTable.emailVerifiedAt)))).returning();
      if (!user) throw new InvalidLink();
      await tx.update(authTokensTable).set({ usedAt: new Date() })
        .where(and(eq(authTokensTable.userId, user.id), isNull(authTokensTable.usedAt)));
    });
    await endSession(req, res);
    res.json(ResetPasswordResponse.parse({
      ok: true, nextPath: '/signin', message: 'Your password has been updated. Please sign in with your new password.',
    }));
  } catch (error) {
    if (!(error instanceof InvalidLink)) throw error;
    res.status(400).json({ error: 'This reset link is invalid or has expired. Please request a new one.', code: 'TOKEN_INVALID' });
  }
});

router.post('/signout', async (req, res): Promise<void> => {
  await endSession(req, res);
  res.json(SignoutResponse.parse({ ok: true, nextPath: '/signin' }));
});

router.post('/accept-invite', async (req, res): Promise<void> => {
  if (!await enforceLimit(req, res, 'invite-accept-ip', req.ip ?? 'unknown', 3600, 20)) return;
  const parsed = AcceptAdminInviteBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Use a valid invitation and a password of at least 8 characters.' }); return; }
  const passwordError = validNewPassword(parsed.data.password, parsed.data.confirmPassword);
  if (passwordError) { res.status(400).json({ error: passwordError }); return; }
  const passwordHash = await hashPassword(parsed.data.password);
  try {
    const user = await db.transaction(async tx => {
      const token = await claimToken(tx, parsed.data.token, 'admin_invite');
      if (!token) throw new InvalidLink();
      const [accepted] = await tx.update(usersTable).set({
        passwordHash, emailVerifiedAt: new Date(), lastLoginAt: new Date(), updatedAt: new Date(),
        sessionVersion: sql`${usersTable.sessionVersion} + 1`,
      }).where(and(
        eq(usersTable.id, token.userId), eq(usersTable.role, 'admin'),
        eq(usersTable.isActive, true), isNull(usersTable.emailVerifiedAt),
      )).returning();
      if (!accepted) throw new InvalidLink();
      await tx.update(authTokensTable).set({ usedAt: new Date() }).where(and(
        eq(authTokensTable.userId, accepted.id), isNull(authTokensTable.usedAt),
      ));
      await tx.delete(sessionsTable).where(sql`${sessionsTable.sess}->>'userId' = ${accepted.id}`);
      return accepted;
    });
    await establishSession(req, user);
    res.json(AcceptAdminInviteResponse.parse({ ok: true, email: user.email, nextPath: '/admin' }));
  } catch (error) {
    if (!(error instanceof InvalidLink)) throw error;
    res.status(400).json({ error: 'This invitation is invalid or has expired. Please ask an administrator for a new invitation.', code: 'TOKEN_INVALID' });
  }
});

export default router;
