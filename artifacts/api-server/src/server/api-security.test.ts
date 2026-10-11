import { afterAll, describe, expect, it } from 'vitest';
import type { Request, Response } from 'express';
import { randomBytes } from 'node:crypto';
import { pool } from '@workspace/db';

process.env.NODE_ENV = 'development';
process.env.APP_ORIGIN ||= 'https://qa.example.invalid';
process.env.SESSION_SECRET ||= randomBytes(32).toString('hex');
const { registeredApiRoutes } = await import('../routes/index');
const { registeredQaRoutes } = await import('../routes/quick-login');
const { declaredGuard, apiAccessPolicy } = await import('../auth/access-policy');
const { csrfGuard, appOrigin } = await import('../auth/session');
const { validateWriteBoundary, errorEnvelope } = await import('../middlewares/request-hardening');
afterAll(async () => { await pool.end(); });

const concrete = (path: string) => path.replace(/:([A-Za-z]+)/g, '00000000-0000-4000-8000-000000000001');
function reply() {
  const value = { statusCode: 200, body: undefined as any,
    status(n: number) { this.statusCode = n; return this; },
    json(body: unknown) { this.body = body; return this; } };
  return value as unknown as Response & { body: any };
}
describe('actual API registrations and security boundaries', () => {
  it('includes quick-login APIs and both QA entrypoints in the audited route list', () => {
    const routes = [...registeredApiRoutes().map(route => ({ ...route, path: `/api${route.path}`,
      guard: declaredGuard(route.method, concrete(route.path)) })), ...registeredQaRoutes()];
    for (const path of ['/qa', '/qa/lock', '/api/auth/quick-login/status', '/api/auth/quick-login']) {
      const matches = routes.filter(route => route.path === path);
      expect(matches.length, path).toBeGreaterThan(0);
      for (const route of matches) expect(route.guard, path).toBe('public:quick-login');
    }
    for (const route of routes) expect(route.guard, `${route.method} ${route.path}`).toBeDefined();
  });
  it('every registered method/path declares the minimum guard; HEAD inherits GET', () => {
    const routes = registeredApiRoutes();
    expect(routes.length).toBeGreaterThan(60);
    for (const { method, path } of routes) {
      const guard = declaredGuard(method, concrete(path));
      expect(guard, `${method} ${path}`).toBeDefined();
      if (path.startsWith('/admin/') || path === '/dev/email-test') expect(guard).toBe('admin');
      else if (path === '/jobs/run') expect(guard).toBe('job');
      else if (path.startsWith('/auth/quick-login')) expect(guard).toBe('public:quick-login');
      else if (path.startsWith('/auth/') || path === '/healthz' || path === '/health') expect(guard).toBe('public');
      else expect(['auth', 'volunteer', 'onboardedVolunteer']).toContain(guard);
      if (method === 'GET') expect(declaredGuard('HEAD', concrete(path))).toBe(guard);
    }
  });
  it('every non-public registered API denies anonymous requests before its handler', async () => {
    for (const { method, path } of registeredApiRoutes()) {
      if (declaredGuard(method, concrete(path))?.startsWith('public')) continue;
      const req = { method, path: concrete(path), session: {}, get: () => undefined } as unknown as Request;
      const res = reply(); let reached = false;
      await apiAccessPolicy(req, res, () => { reached = true; });
      expect(reached, `${method} ${path}`).toBe(false);
      expect([401, 403]).toContain(res.statusCode);
    }
  });
  it('undeclared APIs and wrong methods fail closed', async () => {
    for (const path of ['/new-unguarded-route', '/dev/unknown', '/admin/unknown']) {
      const res = reply();
      await apiAccessPolicy({ method: 'POST', path } as Request, res, () => { throw new Error('unguarded route'); });
      expect(res.body.code).toBe('ROUTE_NOT_DECLARED');
    }
    expect(declaredGuard('GET', '/volunteer/assignments')).toBeUndefined();
    expect(declaredGuard('POST', '/admin/schedule/assignments/abc/unknown')).toBeUndefined();
  });
  it('CSRF rejects missing/foreign origins and absent/mismatched tokens', () => {
    for (const [origin, token] of [[undefined, 'good'], ['https://evil.invalid', 'good'], [appOrigin, undefined], [appOrigin, 'bad']]) {
      const res = reply(); let passed = false;
      csrfGuard({ method: 'POST', session: { csrfToken: 'good' }, get: (key: string) => key === 'origin' ? origin : token } as Request,
        res, () => { passed = true; });
      expect(passed).toBe(false); expect(res.statusCode).toBe(403);
    }
    let passed = false;
    csrfGuard({ method: 'PATCH', session: { csrfToken: 'good' }, get: (key: string) => key === 'origin' ? appOrigin : 'good' } as Request,
      reply(), () => { passed = true; });
    expect(passed).toBe(true);
  });
  it('every write rejects non-object input; no-payload actions reject unexpected fields', () => {
    for (const { method, path } of registeredApiRoutes().filter(r => ['POST', 'PUT', 'PATCH', 'DELETE'].includes(r.method))) {
      const res = reply();
      validateWriteBoundary({ method, path: `/api${concrete(path)}`, body: ['malformed'], is: () => false } as unknown as Request,
        res, () => { throw new Error(`${path} accepted an array`); });
      expect(res.statusCode).toBe(400); expect(res.body.code).toBe('INVALID_INPUT');
    }
    const res = reply();
    validateWriteBoundary({ method: 'POST', path: '/api/auth/signout', body: { userId: 'someone-else' }, is: () => false } as unknown as Request,
      res, () => { throw new Error('unexpected fields'); });
    expect(res.statusCode).toBe(400);
    const mounted = reply();
    validateWriteBoundary({ method: 'POST', baseUrl: '/api', path: '/auth/signout',
      body: { unexpected: true }, is: () => false } as unknown as Request, mounted,
      () => { throw new Error('mounted API skipped validation'); });
    expect(mounted.statusCode).toBe(400);
  });
  it('error envelopes preserve specific codes, normalize others, and discard stack traces', () => {
    const res = reply(); res.statusCode = 500;
    errorEnvelope({} as Request, res, () => {});
    res.json({ error: 'Try again.', stack: 'private server trace' });
    expect(res.body).toEqual({ error: 'Try again.', code: 'INTERNAL_ERROR' });
  });
});
