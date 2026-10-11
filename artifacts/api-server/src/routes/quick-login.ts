import { Router } from 'express';
import { z } from 'zod';
import { and, eq, isNotNull } from 'drizzle-orm';
import { db, usersTable, volunteerProfilesTable, activityLogTable } from '@workspace/db';
import { testAccounts } from '@workspace/shared/testAccounts';
import { establishSession, endSession, csrfGuard } from '../auth/session';
import { accountPath } from '../auth/accounts';
import { enforceLimit } from '../auth/security';
import { logger } from '../lib/logger';
import { isQuickLoginEnabled, quickLoginNotFound } from '../auth/quick-login-lock';

type Persona = { key: string; email: string; label: string; role: 'admin' | 'volunteer'; description: string };
export function createQuickLoginRoutes(env: NodeJS.ProcessEnv = process.env, personas: readonly Persona[] = testAccounts) {
  const api = Router();
  api.use('/quick-login', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (!isQuickLoginEnabled(env)) { quickLoginNotFound(res); return; }
    next();
  });
  api.use('/quick-login', csrfGuard);
  api.get('/quick-login/status', (_req, res) => {
    res.json({ enabled: true, production: env.NODE_ENV === 'production',
      personas: personas.map(({ key, label, role, description }) => ({ key, label, role, description })) });
  });
  api.post('/quick-login', async (req, res) => {
    if (!await enforceLimit(req, res, 'qa-login-ip', req.ip ?? 'unknown', 3600, 30)) return;
    const parsed = z.object({ persona: z.string().min(1).max(80) }).strict().safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: 'Please choose a test persona.', code: 'INVALID_INPUT' }); return; }
    const persona = personas.find(p => p.key === parsed.data.persona);
    if (!persona) { quickLoginNotFound(res); return; }
    // Do not call ensure here: it could repair a deliberately revoked persona.
    const found = await db.transaction(async tx => {
      const [existing] = await tx.select().from(usersTable).where(and(eq(usersTable.email, persona.email),
        eq(usersTable.isTestAccount, true), eq(usersTable.isActive, true), eq(usersTable.role, persona.role),
        isNotNull(usersTable.emailVerifiedAt))).for('update');
      if (!existing) return undefined;
      const [user] = await tx.update(usersTable).set({ lastLoginAt: new Date(), updatedAt: new Date() })
        .where(eq(usersTable.id, existing.id)).returning();
      const [profile] = await tx.select({ id: volunteerProfilesTable.id }).from(volunteerProfilesTable)
        .where(eq(volunteerProfilesTable.userId, existing.id));
      return { user: user!, profile };
    });
    if (!found) { quickLoginNotFound(res); return; }
    await establishSession(req, found.user);
    try {
    const details = { persona: persona.key, ip: req.ip ?? null, userAgent:
      (req.get('user-agent') ?? '').slice(0, 1024) };
    if (found.profile) await db.insert(activityLogTable).values({ volunteerProfileId: found.profile.id,
      actorUserId: found.user.id, action: 'quick_login', details });
    // Also covers the admin, which intentionally has no volunteer profile.
    logger.info({ audit: true, actorUserId: found.user.id, action: 'quick_login', details }, 'QA quick login');
    res.json({ ok: true, email: found.user.email, nextPath: await accountPath(found.user) });
    } catch (error) {
      // Never leave an authenticated session after an audit/response failure.
      await endSession(req, res);
      throw error;
    }
  });
  return { api };
}
const routes = createQuickLoginRoutes();
export default routes.api;
