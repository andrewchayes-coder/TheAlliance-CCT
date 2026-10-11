import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';

export const QA_COOKIE = 'qa_unlock';
export const QA_LIFETIME = 30 * 24 * 60 * 60 * 1000;
export const qaCookieOptions = { httpOnly: true, secure: true, sameSite: 'lax' as const, path: '/' };
export function isQuickLoginEnabled(env: NodeJS.ProcessEnv = process.env) {
  return env.NODE_ENV !== 'production' ||
    (env.QUICK_LOGIN_ENABLED === 'true' && (env.QUICK_LOGIN_KEY?.length ?? 0) >= 32);
}
export function quickLoginConfigurationWarning(env: NodeJS.ProcessEnv = process.env) {
  return env.NODE_ENV === 'production' && env.QUICK_LOGIN_ENABLED === 'true' && !isQuickLoginEnabled(env)
    ? 'QUICK LOGIN DISABLED: QUICK_LOGIN_KEY must be set and contain at least 32 characters. The application will continue without quick login.'
    : undefined;
}
export function matchesQuickLoginKey(candidate: unknown, env: NodeJS.ProcessEnv = process.env) {
  if (typeof candidate !== 'string' || !isQuickLoginEnabled(env) || !env.QUICK_LOGIN_KEY) return false;
  // Fixed-size digests permit timingSafeEqual even for different input lengths.
  return timingSafeEqual(createHash('sha256').update(candidate).digest(),
    createHash('sha256').update(env.QUICK_LOGIN_KEY).digest());
}
function signature(payload: string, env: NodeJS.ProcessEnv) {
  if (!env.SESSION_SECRET || !env.QUICK_LOGIN_KEY) return undefined;
  const key = createHmac('sha256', env.SESSION_SECRET).update(`qa-unlock:${env.QUICK_LOGIN_KEY}`).digest();
  return createHmac('sha256', key).update(payload).digest();
}
export function createQaUnlockCookie(env: NodeJS.ProcessEnv = process.env, now = Date.now()) {
  const payload = `v1.${now + QA_LIFETIME}.${randomBytes(32).toString('hex')}`;
  const signed = signature(payload, env);
  if (!signed) throw new Error('QA cookie signing is not configured.');
  return `${payload}.${signed.toString('hex')}`;
}
export function validQaUnlockCookie(value: string | undefined, env: NodeJS.ProcessEnv = process.env, now = Date.now()) {
  if (!value || !isQuickLoginEnabled(env)) return false;
  const match = /^(v1\.(\d{13})\.[a-f0-9]{64})\.([a-f0-9]{64})$/.exec(value);
  if (!match || Number(match[2]) <= now) return false;
  const expected = signature(match[1]!, env);
  return Boolean(expected && timingSafeEqual(expected, Buffer.from(match[3]!, 'hex')));
}
export function hasQuickLoginAccess(req: Request, env: NodeJS.ProcessEnv = process.env) {
  if (!isQuickLoginEnabled(env)) return false;
  if (env.NODE_ENV !== 'production') return true;
  const cookies = (req.get('cookie') ?? '').split(';').map(part => part.trim());
  const values = cookies.filter(part => part.startsWith(`${QA_COOKIE}=`));
  return values.length === 1 && validQaUnlockCookie(values[0]!.slice(QA_COOKIE.length + 1), env);
}
export function quickLoginNotFound(res: Response) {
  res.set('Cache-Control', 'no-store').status(404).json({ error: 'Not found.', code: 'NOT_FOUND' });
}
