export function createReadinessCheck(ping: () => Promise<unknown>, configured: () => boolean, timeoutMs = 4000) {
  let cached: { expires: number; result: Readiness } | undefined;
  let pending: Promise<Readiness> | undefined;
  let databaseProbe: Promise<unknown> | undefined;
  type Readiness = { status: 'ok' | 'degraded'; db: 'ok' | 'unavailable'; email: { configured: boolean } };
  return async (): Promise<Readiness> => {
    if (cached && cached.expires > Date.now()) return cached.result;
    if (pending) return pending;
    pending = (async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      let db: Readiness['db'] = 'ok';
      try {
        // A timed-out connection attempt must not start another queued probe.
        databaseProbe ??= ping().finally(() => { databaseProbe = undefined; });
        await Promise.race([databaseProbe, new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('Database readiness timed out')), timeoutMs);
        })]);
      } catch { db = 'unavailable'; }
      finally { if (timer) clearTimeout(timer); }
      const email = { configured: configured() };
      const result: Readiness = { status: db === 'ok' && email.configured ? 'ok' : 'degraded', db, email };
      cached = { expires: Date.now() + 5000, result };
      return result;
    })();
    try { return await pending; } finally { pending = undefined; }
  };
}
