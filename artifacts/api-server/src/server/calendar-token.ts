import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const key = () => {
  if (!process.env.SESSION_SECRET) throw new Error('Calendar storage is not configured.');
  return createHash('sha256').update('alliance-calendar-feed:v1:').update(process.env.SESSION_SECRET).digest();
};
export const newCalendarToken = () => randomBytes(32).toString('base64url');
export function encryptCalendarToken(token: string) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key(), iv);
  const body = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), body.toString('base64')].join('.');
}
export function decryptCalendarToken(value: string) {
  const [version, iv, tag, body, extra] = value.split('.');
  if (version !== 'v1' || !iv || !tag || !body || extra) throw new Error('Calendar link is unavailable.');
  if ([iv, tag, body].some(part => Buffer.from(part, 'base64').toString('base64') !== part)
    || Buffer.from(iv, 'base64').length !== 12 || Buffer.from(tag, 'base64').length !== 16)
    throw new Error('Calendar link is unavailable.');
  const cipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
  cipher.setAuthTag(Buffer.from(tag, 'base64'));
  const token = Buffer.concat([cipher.update(Buffer.from(body, 'base64')), cipher.final()]).toString('utf8');
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error('Calendar link is unavailable.');
  return token;
}
