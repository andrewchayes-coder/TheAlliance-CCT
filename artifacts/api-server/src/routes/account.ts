import { Router, type RequestHandler } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { db, usersTable, authTokensTable, sessionsTable } from '@workspace/db';
import { accountProfile, saveDetails, requestEmailChange, lockAccount, recordProfileEdit, detailsSchema, emailChangeSchema, AccountError } from '../server/account-profile';
import { MAX_PROFILE_PHOTO, uploadPhoto, deletePhoto, photoStream, PhotoError } from '../server/profile-photos';
import { checkPassword, hashPassword, validNewPassword, enforceLimit } from '../auth/security';
import { passwordResetEmail } from '../auth/accounts';
import { endSession } from '../auth/session';

const router = Router(), empty = z.object({}).strict(), uuid = z.string().uuid();
const target = (req: Parameters<RequestHandler>[0]) => req.params.userId ? uuid.parse(req.params.userId) : req.authUser!.id;
const wrap = (handler: RequestHandler): RequestHandler => async (req, res, next) => {
  try { await handler(req, res, next); }
  catch (error) {
    const status = error instanceof AccountError || error instanceof PhotoError ? error.status : error instanceof z.ZodError ? 400 : 500;
    if (status === 500) req.log.error({ err: error }, 'Account request failed');
    res.status(status).json({ error: error instanceof z.ZodError ? error.issues[0]?.message :
      status !== 500 ? (error as Error).message : 'Your account could not be updated. Please try again.' });
  }
};
for (const prefix of ['/account', '/admin/users/:userId']) {
  router.get(`${prefix}/profile`, wrap(async (req, res) => {
    res.set('Cache-Control', 'no-store').json(await accountProfile(req.authUser!, target(req)));
  }));
  router.patch(`${prefix}/profile`, wrap(async (req, res) => {
    const data = detailsSchema.parse(req.body), id = target(req);
    const saved = await saveDetails(req.authUser!, id, data);
    req.log.info({ actorUserId: req.authUser!.id, targetUserId: id, fields: Object.keys(data) }, 'Account profile edited');
    res.set('Cache-Control', 'no-store').json(saved);
  }));
  router.post(`${prefix}/email`, wrap(async (req, res) => {
    const data = emailChangeSchema.parse(req.body), id = target(req);
    if (!await enforceLimit(req, res, 'account-email-minute', id, 60, 1) ||
      !await enforceLimit(req, res, 'account-email-hour', id, 3600, 5)) return;
    res.set('Cache-Control', 'no-store').json(await requestEmailChange(req.authUser!, id, data));
  }));
  router.delete(`${prefix}/email`, wrap(async (req, res) => {
    empty.parse(req.body ?? {}); const id = target(req);
    await db.transaction(async tx => {
      await lockAccount(tx, req.authUser!, id);
      await tx.update(authTokensTable).set({ usedAt: new Date() }).where(and(eq(authTokensTable.userId, id),
        eq(authTokensTable.type, 'email_verify'), isNull(authTokensTable.usedAt), sql`${authTokensTable.pendingEmail} is not null`));
    });
    res.set('Cache-Control', 'no-store').json(await accountProfile(req.authUser!, id));
  }));
  const parsePhoto = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_PROFILE_PHOTO, files: 1, fields: 0 } }).single('file');
  router.post(`${prefix}/photo`, (req, res, next) => {
    parsePhoto(req, res, error => {
      if (error) { res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: 'Choose one PNG, JPEG or WebP photo no larger than 3 MB.' }); return; }
      next();
    });
  }, wrap(async (req, res) => {
    const id = target(req);
    if (!await enforceLimit(req, res, 'account-photo', req.authUser!.id, 3600, 20)) return;
    if (!req.file) throw new AccountError('Choose a photo to upload.');
    const key = await uploadPhoto(req.file.buffer); let committed = false;
    try {
      const previous = await db.transaction(async tx => {
        const user = await lockAccount(tx, req.authUser!, id);
        await tx.update(usersTable).set({ profilePhotoKey: key, updatedAt: new Date() }).where(eq(usersTable.id, id));
        await recordProfileEdit(tx, req.authUser!.id, id, ['profilePhoto']);
        return user.profilePhotoKey;
      });
      committed = true;
      await deletePhoto(previous).catch(() => req.log.warn('Previous profile photo needs storage cleanup.'));
      res.set('Cache-Control', 'no-store').json(await accountProfile(req.authUser!, id));
    } finally {
      if (!committed) await deletePhoto(key).catch(() => req.log.warn('Unused profile photo needs storage cleanup.'));
    }
  }));
  router.delete(`${prefix}/photo`, wrap(async (req, res) => {
    empty.parse(req.body ?? {}); const id = target(req);
    const previous = await db.transaction(async tx => {
      const user = await lockAccount(tx, req.authUser!, id);
      await tx.update(usersTable).set({ profilePhotoKey: null, updatedAt: new Date() }).where(eq(usersTable.id, id));
      await recordProfileEdit(tx, req.authUser!.id, id, ['profilePhoto']);
      return user.profilePhotoKey;
    });
    await deletePhoto(previous).catch(() => req.log.warn('Removed profile photo needs storage cleanup.'));
    res.set('Cache-Control', 'no-store').json(await accountProfile(req.authUser!, id));
  }));
}
router.get('/account/users/:userId/photo', wrap(async (req, res) => {
  const id = target(req);
  if (req.authUser!.id !== id && req.authUser!.role !== 'admin') throw new AccountError('Photo not found.', 404);
  const [user] = await db.select({ key: usersTable.profilePhotoKey }).from(usersTable).where(eq(usersTable.id, id));
  if (!user?.key) throw new AccountError('Photo not found.', 404);
  res.set({ 'Cache-Control': 'private, no-store', 'Content-Type': 'image/png', 'X-Content-Type-Options': 'nosniff' });
  const stream = photoStream(user.key);
  stream.on('error', () => { if (!res.headersSent) res.status(503).type('application/json').json({ error: 'This photo is temporarily unavailable.' }); else res.destroy(); });
  stream.pipe(res);
}));
router.post('/admin/users/:userId/password-reset', wrap(async (req, res) => {
  empty.parse(req.body ?? {}); const id = target(req);
  if (!await enforceLimit(req, res, 'managed-password-reset', `${req.authUser!.id}:${id}`, 3600, 5)) return;
  const user = await db.transaction(async tx => {
    const u = await lockAccount(tx, req.authUser!, id);
    if (!u.isActive || !u.emailVerifiedAt) throw new AccountError('Activate and verify this account before sending a reset link.', 409);
    await recordProfileEdit(tx, req.authUser!.id, id, [], 'password_reset_requested');
    return u;
  });
  const result = await passwordResetEmail(user);
  req.log.info({ actorUserId: req.authUser!.id, targetUserId: id }, 'Password reset requested by administrator');
  res.json({ ok: result.ok, deliveryFailed: !result.ok,
    message: !result.ok ? 'The reset email could not be sent. Please try again.'
      : result.suppressed ? 'TEST account: the reset email was suppressed. No email was sent.'
        : !process.env.POSTMARK_SERVER_TOKEN || !process.env.EMAIL_FROM ? 'Development mode: the password-reset email was logged in the server console. No email was sent.'
        : 'A password-reset link has been sent to the current verified email address. It expires in one hour.' });
}));
router.post('/account/password', wrap(async (req, res) => {
  const data = z.object({ currentPassword: z.string().min(1).max(200), password: z.string().min(8).max(200), confirmPassword: z.string().max(200) }).strict().parse(req.body);
  const invalid = validNewPassword(data.password, data.confirmPassword);
  if (invalid) throw new AccountError(invalid);
  const actor = req.authUser!;
  if (!await enforceLimit(req, res, 'password-change-user', actor.id, 900, 10) ||
    !await enforceLimit(req, res, 'password-change-ip', req.ip ?? 'unknown', 900, 20)) return;
  if (!await checkPassword(data.currentPassword, actor.passwordHash)) throw new AccountError('Your current password does not match. Please try again.');
  const hash = await hashPassword(data.password);
  await db.transaction(async tx => {
    const user = await lockAccount(tx, actor, actor.id);
    if (user.passwordHash !== actor.passwordHash) throw new AccountError('Your account changed. Please sign in again.', 409);
    await tx.update(usersTable).set({ passwordHash: hash, sessionVersion: user.sessionVersion + 1, updatedAt: new Date() }).where(eq(usersTable.id, user.id));
    await tx.update(authTokensTable).set({ usedAt: new Date() }).where(and(eq(authTokensTable.userId, user.id), isNull(authTokensTable.usedAt)));
    await tx.delete(sessionsTable).where(sql`${sessionsTable.sess}->>'userId' = ${user.id}`);
  });
  await endSession(req, res);
  res.json({ ok: true, nextPath: '/signin' });
}));
export default router;
