import type { Response } from 'express';

/** Development is always enabled; production has one explicit switch. */
export function isQuickLoginEnabled(env: NodeJS.ProcessEnv = process.env) {
  return env.NODE_ENV !== 'production' || env.QUICK_LOGIN_ENABLED?.trim().toLowerCase() === 'true';
}

export function quickLoginNotFound(res: Response) {
  res.status(404).json({ error: 'Not found.', code: 'NOT_FOUND' });
}
