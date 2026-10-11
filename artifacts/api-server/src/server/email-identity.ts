import { z } from 'zod/v4';

type EmailEnvironment = Record<string, string | undefined>;
const hasControl = (value: string) => /[\u0000-\u001f\u007f]/.test(value);

/** Validate without including any configuration values in an error. */
export function parseEmailFrom(value: string) {
  const match = /^([^<>]+?)\s*<([^<>\s]+)>$/.exec(value.trim());
  if (hasControl(value) || !match || !match[1]!.trim() || !z.email().safeParse(match[2]).success) {
    throw new Error('EMAIL_FROM must use Display Name <email@domain.org> format.');
  }
  const name = match[1]!.trim();
  if (/["\\,;]/.test(name)) throw new Error('EMAIL_FROM display name must not contain quotes or header delimiters.');
  const address = match[2]!;
  return { name, address, header: `${name} <${address}>` };
}

export function parseEmailReplyTo(value: string): string {
  if (hasControl(value) || !z.email().safeParse(value.trim()).success) {
    throw new Error('EMAIL_REPLY_TO must be a single email address.');
  }
  return value.trim();
}

export function emailIdentity(env: EmailEnvironment = process.env) {
  const from = env.EMAIL_FROM?.trim() ? parseEmailFrom(env.EMAIL_FROM) : null;
  const replyTo = env.EMAIL_REPLY_TO?.trim() ? parseEmailReplyTo(env.EMAIL_REPLY_TO) : from?.address ?? null;
  return { from, replyTo };
}

/** Authorized staff-only status; tokens are represented by existence, never value. */
export function emailProviderStatus(env: EmailEnvironment = process.env) {
  const { from, replyTo } = emailIdentity(env);
  const tokenConfigured = Boolean(env.POSTMARK_SERVER_TOKEN?.trim());
  return {
    tokenConfigured, emailFrom: from?.address ?? null,
    fromName: from?.name ?? null, fromAddress: from?.address ?? null, replyTo,
    deliveryEnabled: tokenConfigured && Boolean(from),
  };
}
