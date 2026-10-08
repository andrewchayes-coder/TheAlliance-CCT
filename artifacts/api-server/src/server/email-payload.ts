import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { z } from 'zod/v4';

const payload = z.object({ html: z.string().min(1), text: z.string().min(1), replyTo: z.string().optional() }).strict();
const key = () => {
  if (!process.env.SESSION_SECRET) throw new Error('Email retry storage is not configured.');
  return createHash('sha256').update('alliance-email-retry:v1:').update(process.env.SESSION_SECRET).digest();
};
export const tokenEmailTypes = new Set(['verification', 'password_reset', 'invite']);
export function encryptEmailBody(value: z.infer<typeof payload>) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(payload.parse(value)), 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), body.toString('base64')].join('.');
}
export function decryptEmailBody(value: string) {
  const [version, iv, tag, body, extra] = value.split('.');
  if (version !== 'v1' || !iv || !tag || !body || extra) throw new Error('Email retry content is unavailable.');
  const cipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
  cipher.setAuthTag(Buffer.from(tag, 'base64'));
  return payload.parse(JSON.parse(Buffer.concat([cipher.update(Buffer.from(body, 'base64')), cipher.final()]).toString('utf8')));
}
