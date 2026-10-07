import { createHash, scrypt, timingSafeEqual } from 'node:crypto';
import bcrypt from 'bcrypt';
import { pool } from '@workspace/db';
import type { Request, Response } from 'express';

export const tokenHash = (raw: string) => createHash('sha256').update(raw).digest('hex');
export const hashPassword = (password: string) => bcrypt.hash(password, 12);
let dummyHash: Promise<string> | undefined;

export async function checkPassword(password: string, stored?: string): Promise<boolean> {
  if (!stored) {
    dummyHash ??= hashPassword('This is a timing placeholder, not a user credential.');
    await bcrypt.compare(password, await dummyHash);
    return false;
  }
  if (stored.startsWith('scrypt$')) {
    const [algorithm, n, r, p, salt, encoded] = stored.split('$');
    if (algorithm !== 'scrypt' || n !== '32768' || r !== '8' || p !== '1' || !salt || !encoded) return false;
    const expected = Buffer.from(encoded, 'base64');
    if (expected.length !== 64) return false;
    const actual = await new Promise<Buffer>((resolve, reject) => scrypt(
      password, Buffer.from(salt, 'base64'), 64,
      { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
      (error, key) => error ? reject(error) : resolve(key),
    ));
    return timingSafeEqual(actual, expected);
  }
  if (Buffer.byteLength(password, 'utf8') > 72) return false;
  return bcrypt.compare(password, stored);
}
export const needsPasswordUpgrade = (hash: string) => hash.startsWith('scrypt$') || bcrypt.getRounds(hash) !== 12;
export function validNewPassword(password: string, confirmation: string): string | undefined {
  if (password !== confirmation) return 'The passwords do not match.';
  if (password.length < 8) return 'Use a password with at least 8 characters.';
  if (Buffer.byteLength(password, 'utf8') > 72) return 'Use a password of at most 72 bytes (some characters use more than one byte).';
  return undefined;
}
export function normalizePhone(phone: string): string | undefined {
  if (!/^[+\d().\s-]+$/.test(phone)) return undefined;
  const digits = phone.replace(/\D/g, '');
  if (phone.trim().startsWith('+') && /^[1-9]\d{7,14}$/.test(digits)) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return undefined;
}

/** Atomic Postgres counters work across restarts and multiple server workers. */
export async function takeLimit(scope: string, identity: string, seconds: number, maximum: number) {
  const key = `${scope}:${tokenHash(identity)}`;
  const result = await pool.query<{ count: number; retry: number }>(`
    INSERT INTO auth_rate_limits (key, count, window_start) VALUES ($1, 1, now())
    ON CONFLICT (key) DO UPDATE SET
      count = CASE WHEN auth_rate_limits.window_start <= now() - ($2 * interval '1 second')
        THEN 1 ELSE auth_rate_limits.count + 1 END,
      window_start = CASE WHEN auth_rate_limits.window_start <= now() - ($2 * interval '1 second')
        THEN now() ELSE auth_rate_limits.window_start END
    RETURNING count, greatest(1, ceil(extract(epoch FROM window_start + ($2 * interval '1 second') - now())))::integer AS retry`,
  [key, seconds]);
  return { allowed: result.rows[0]!.count <= maximum, retryAfterSeconds: result.rows[0]!.retry };
}
export async function remainingCooldown(scope: string, identity: string, seconds: number): Promise<number> {
  const result = await pool.query<{ remaining: number }>(`
    SELECT greatest(0, ceil(extract(epoch FROM window_start + ($2 * interval '1 second') - now())))::integer AS remaining
    FROM auth_rate_limits WHERE key = $1`, [`${scope}:${tokenHash(identity)}`, seconds]);
  return result.rows[0]?.remaining ?? 0;
}
export async function enforceLimit(req: Request, res: Response, scope: string, identity: string, seconds: number, maximum: number): Promise<boolean> {
  const result = await takeLimit(scope, identity, seconds, maximum);
  if (result.allowed) return true;
  res.setHeader('Retry-After', result.retryAfterSeconds);
  res.status(429).json({
    error: 'Please wait before trying again.', code: 'RATE_LIMITED', retryAfterSeconds: result.retryAfterSeconds,
  });
  return false;
}
export async function ipAndEmailLimit(req: Request, res: Response, scope: 'signin' | 'reset' | 'signup', email: string): Promise<boolean> {
  const seconds = scope === 'signin' ? 15 * 60 : 60 * 60;
  if (!await enforceLimit(req, res, `${scope}-ip`, req.ip ?? 'unknown', seconds, 10)) return false;
  return enforceLimit(req, res, `${scope}-email`, email, seconds, scope === 'signin' ? 8 : 5);
}
