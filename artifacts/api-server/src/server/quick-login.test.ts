import { beforeAll, afterAll, it, expect, vi } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'node:http';
import { randomUUID, randomInt } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { db, pool, usersTable, volunteerProfilesTable, activityLogTable, sessionsTable,
  notificationLogTable, authRateLimitsTable } from '@workspace/db';
import { testAccounts } from '@workspace/shared/testAccounts';
import { createTestAccountService } from './testAccounts';
import { createQuickLoginRoutes } from '../routes/quick-login';
import { sessionMiddleware, saveSession, randomToken, appOrigin, sessionUser } from '../auth/session';
import { tokenHash } from '../auth/security';
import { logger } from '../lib/logger';
import { GetQuickLoginStatusResponse, SigninResponse } from '@workspace/api-zod';

vi.hoisted(() => { process.env.NODE_ENV = 'development'; process.env.APP_ORIGIN ||= 'https://qa.example.invalid'; });
const tag = `quick-${randomUUID()}`;
const personas = testAccounts.map(p => ({ ...p, email: `${tag}-${p.key}@example.invalid`,
  ...('legacyEmail' in p ? {legacyEmail: `${tag}-${p.legacyEmail}`} : {}) }));
const configured = { NODE_ENV: 'production', QUICK_LOGIN_ENABLED: 'true' };
const ip = `198.18.${randomInt(1, 254)}.${randomInt(1, 254)}`;
let userIds: string[] = [], profileIds: string[] = [];
const servers: Server[] = [], sessionIds: string[] = [];
const audit = vi.spyOn(logger, 'info').mockImplementation(() => undefined);
async function harness(env: NodeJS.ProcessEnv) {
  const app = express(); app.set('trust proxy', 1);
  app.use(express.json()); app.use(sessionMiddleware());
  const routes = createQuickLoginRoutes(env, personas);
  app.get('/api/auth/session', async (req, res) => {
    req.session.csrfToken ||= randomToken();
    sessionIds.push(req.sessionID);
    await saveSession(req);
    res.json({ csrfToken: req.session.csrfToken, userId: (await sessionUser(req))?.id ?? null });
  });
  app.use('/api/auth', routes.api);
  app.get('/api/auth/normal', (_req, res) => res.json({ normal: true }));
  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  const server = createServer(app); servers.push(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return (path: string, init: RequestInit = {}) => fetch(base + path, { ...init, redirect: 'manual',
    headers: { 'x-forwarded-proto': 'https', 'x-forwarded-for': ip, ...init.headers } });
}
const cookiePart = (res: Response, name: string) => res.headers.getSetCookie().find(c => c.startsWith(name + '='))?.split(';')[0];
const identityBody = (res: Response) => res.json() as Promise<{ csrfToken: string; userId: string | null }>;
beforeAll(async () => {
  const ensured = await createTestAccountService(personas, configured).ensure();
  userIds = ensured.map(p => p.userId); profileIds = ensured.flatMap(p => p.profileId ? [p.profileId] : []);
});
afterAll(async () => {
  audit.mockRestore();
  for (const server of servers) { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); }
  await db.delete(activityLogTable).where(inArray(activityLogTable.volunteerProfileId, profileIds));
  await db.delete(volunteerProfilesTable).where(inArray(volunteerProfilesTable.id, profileIds));
  await db.delete(usersTable).where(inArray(usersTable.id, userIds));
  if (sessionIds.length) await db.delete(sessionsTable).where(inArray(sessionsTable.sid, sessionIds));
  await db.delete(authRateLimitsTable).where(eq(authRateLimitsTable.key, `qa-login-ip:${tokenHash(ip)}`));
  await pool.end();
});
it.each([undefined, 'false', '', 'FALSE', 'yes', '1', 'true-ish'])(
  'production flag %s returns 404 without breaking ordinary auth or health', async flag => {
    const request = await harness({ NODE_ENV: 'production', QUICK_LOGIN_ENABLED: flag });
    expect((await request('/api/auth/quick-login/status')).status).toBe(404);
    expect((await request('/api/auth/quick-login', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } })).status).toBe(404);
    expect((await request('/api/auth/normal')).status).toBe(200);
    expect((await request('/api/health')).status).toBe(200);
});
it.each(['true', 'TRUE', ' true '])('production flag %s allows public status and sign-in with the normal CSRF session only', async flag => {
  const request = await harness({ NODE_ENV: 'production', QUICK_LOGIN_ENABLED: flag });
  const status = await request('/api/auth/quick-login/status');
  expect(status.status).toBe(200);
  expect(status.headers.get('cache-control')).toBe('no-store');
  const metadata = GetQuickLoginStatusResponse.parse(await status.json());
  expect(metadata.enabled).toBe(true); expect(metadata.production).toBe(true); expect(metadata.personas).toHaveLength(5);
  expect(metadata.personas.find(p => p.key === 'vol-onboarding-ready')?.label).toBe('Volunteer · Onboarding, ready to activate');
  expect(metadata.personas.find(p => p.key === 'vol-onboarding-new')?.label).toBe('Volunteer · Onboarding, new');
  expect(metadata.personas.map(p => p.key)).toEqual(['admin','vol-active','vol-active-noshift','vol-onboarding-ready','vol-onboarding-new']);
  for (const persona of metadata.personas) expect(Object.keys(persona).sort()).toEqual(['description', 'key', 'label', 'role']);
  expect(JSON.stringify(metadata).includes('@')).toBe(false);
  const boot = await request('/api/auth/session');
  const { csrfToken } = await identityBody(boot);
  const login = await request('/api/auth/quick-login', { method: 'POST',
    headers: { cookie: cookiePart(boot, 'alliance.sid')!, origin: appOrigin,
      'x-csrf-token': csrfToken, 'content-type': 'application/json' },
    body: JSON.stringify({ persona: 'admin' }) });
  expect(login.status).toBe(200);
  expect(SigninResponse.parse(await login.json()).nextPath).toBe('/admin');
});
it('requires CSRF, rotates sessions, routes every persona normally, audits without notifications, and refuses real/inactive users', async () => {
  const request = await harness(configured);
  for (const persona of personas) {
    const boot = await request('/api/auth/session');
    const { csrfToken } = await identityBody(boot); const session = cookiePart(boot, 'alliance.sid')!;
    const cookies = session;
    const post = (body: unknown, headers: Record<string, string> = {}) => request('/api/auth/quick-login', {
      method: 'POST', body: JSON.stringify(body), headers: { cookie: cookies, 'content-type': 'application/json',
        origin: appOrigin, 'x-csrf-token': csrfToken, ...headers } });
    expect((await post({ persona: persona.key }, { origin: 'https://outside.example.invalid' })).status).toBe(403);
    expect((await post({ persona: persona.key }, { 'x-csrf-token': 'wrong' })).status).toBe(403);
    const login = await post({ persona: persona.key });
    expect(login.status).toBe(200);
    expect(SigninResponse.parse(await login.json()).nextPath).toBe(persona.key === 'admin' ? '/admin' : persona.key === 'vol-onboarding-new' ? '/onboarding' : '/dashboard');
    const next = cookiePart(login, 'alliance.sid')!;
    expect(next !== session).toBe(true);
    const check = await request('/api/auth/session', { headers: { cookie: next } });
    const identity = await identityBody(check);
    const index = personas.findIndex(p => p.key === persona.key);
    expect(identity.userId).toBe(userIds[index]);
    expect(identity.csrfToken !== csrfToken).toBe(true);
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userIds[index]!));
    expect(user?.lastLoginAt).toBeInstanceOf(Date);
  }
  expect(audit).toHaveBeenCalledWith(expect.objectContaining({ actorUserId: userIds[0], action: 'quick_login',
    details: expect.objectContaining({ persona: 'admin', ip }) }), 'QA quick login');
  expect(await db.select().from(activityLogTable).where(and(inArray(activityLogTable.volunteerProfileId, profileIds),
    eq(activityLogTable.action, 'quick_login')))).toHaveLength(4);
  expect(await db.select().from(notificationLogTable).where(inArray(notificationLogTable.recipientUserId, userIds))).toHaveLength(0);
  const boot = await request('/api/auth/session');
  const { csrfToken } = await identityBody(boot);
  const headers = { cookie: `${cookiePart(boot, 'alliance.sid')}; ${unlock}`, 'content-type': 'application/json',
    origin: appOrigin, 'x-csrf-token': csrfToken };
  const post = (persona: string) => request('/api/auth/quick-login', { method: 'POST', headers, body: JSON.stringify({ persona }) });
  await db.update(usersTable).set({ isTestAccount: false }).where(eq(usersTable.id, userIds[0]!));
  expect((await post('admin')).status).toBe(404);
  await db.update(usersTable).set({ isTestAccount: true, isActive: false }).where(eq(usersTable.id, userIds[0]!));
  expect((await post('admin')).status).toBe(404);
  await db.update(usersTable).set({ isActive: true }).where(eq(usersTable.id, userIds[0]!));
  expect((await post('unknown-real-user')).status).toBe(404);
});
it('development is always enabled even with a false flag and POST is limited to 30 per IP/hour', async () => {
  const request = await harness({ NODE_ENV: 'development', QUICK_LOGIN_ENABLED: 'false' });
  const status = await request('/api/auth/quick-login/status');
  expect(status.status).toBe(200);
  expect(GetQuickLoginStatusResponse.parse(await status.json()).production).toBe(false);
  const boot = await request('/api/auth/session'); const { csrfToken } = await identityBody(boot);
  const headers = { cookie: cookiePart(boot, 'alliance.sid')!, origin: appOrigin, 'x-csrf-token': csrfToken, 'content-type': 'application/json' };
  await db.delete(authRateLimitsTable).where(eq(authRateLimitsTable.key, `qa-login-ip:${tokenHash(ip)}`));
  for (let i = 0; i < 30; i++) expect((await request('/api/auth/quick-login', { method: 'POST', headers,
    body: '{"persona":"unknown"}' })).status).toBe(404);
  const limited = await request('/api/auth/quick-login', { method: 'POST', headers, body: '{"persona":"unknown"}' });
  expect(limited.status).toBe(429); expect(limited.headers.get('retry-after')).toBeTruthy();
});
