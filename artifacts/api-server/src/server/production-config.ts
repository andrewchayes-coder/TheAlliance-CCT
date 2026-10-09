export type RuntimeEnvironment = Record<string, string | undefined>;
export const requiredProductionKeys = [
  'SESSION_SECRET', 'APP_BASE_URL', 'POSTMARK_SERVER_TOKEN', 'EMAIL_FROM', 'JOBS_SECRET', 'RUN_JOBS',
] as const;

/** Inspect configuration, never include values (or connection strings) in errors. */
export function assertProductionConfig(env: RuntimeEnvironment = process.env): void {
  if (env.NODE_ENV !== 'production') return;
  const errors: string[] = [];
  for (const key of [...requiredProductionKeys, 'DATABASE_URL']) {
    if (!env[key]?.trim()) errors.push(`${key} is required`);
  }
  for (const key of ['SESSION_SECRET', 'JOBS_SECRET']) {
    if (env[key] && env[key]!.length < 32) errors.push(`${key} must contain at least 32 characters`);
  }
  if (env.RUN_JOBS && !['true', 'false'].includes(env.RUN_JOBS)) errors.push('RUN_JOBS must be exactly true or false');
  if (env.EMAIL_FROM && !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(env.EMAIL_FROM)) {
    errors.push('EMAIL_FROM must be a sender email address');
  }
  if (env.APP_BASE_URL) {
    try {
      const url = new URL(env.APP_BASE_URL);
      if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error();
      if (env.APP_ORIGIN && new URL(env.APP_ORIGIN).origin !== url.origin) errors.push('APP_ORIGIN conflicts with APP_BASE_URL');
    } catch { errors.push('APP_BASE_URL must be an HTTPS origin without a path, query, or credentials'); }
  }
  if (errors.length) throw new Error(`Production startup refused:\n- ${errors.join('\n- ')}\nSee DEPLOY.md. No configuration values were printed.`);
}
