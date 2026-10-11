import session from 'express-session';
import { volunteerContactText } from '@workspace/shared/appConfig';
import { missingProfileFields } from '@workspace/shared/profileFields';
import connectPgSimple from 'connect-pg-simple';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { db, pool, usersTable, volunteerProfilesTable, type User } from '@workspace/db';
import { eq } from 'drizzle-orm';
import type { Request, Response, NextFunction } from 'express';

declare module 'express-session' {
  interface SessionData {
    userId?: string;
    authVersion?: number;
    csrfToken?: string;
    notice?: string;
    googleLogin?: { state: string; nonce: string; verifier: string; expiresAt: number };
  }
}
declare global {
  namespace Express {
    interface Request { authUser?: User }
  }
}

const originValue = process.env.APP_BASE_URL || process.env.APP_ORIGIN || (
  process.env.NODE_ENV === 'development' && process.env.REPLIT_DEV_DOMAIN
    ? `https://${process.env.REPLIT_DEV_DOMAIN}` : ''
);
if (!originValue) throw new Error('Configure APP_BASE_URL with the HTTPS public app origin.');
const originUrl = new URL(originValue);
if (originUrl.protocol !== 'https:' || originUrl.username || originUrl.password
  || originUrl.pathname !== '/' || originUrl.search || originUrl.hash) {
  throw new Error('APP_BASE_URL must be an HTTPS origin without a path, query, or credentials.');
}
export const appOrigin = originUrl.origin;
export const googleEnabled = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
export const randomToken = () => randomBytes(32).toString('hex');
export const inactiveMessage = `Your account isn't active. Please contact ${volunteerContactText}.`;
export const sessionCookieName = 'alliance.sid';

export function sameSecret(left?: string, right?: string): boolean {
  if (!left || !right) return false;
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function sessionMiddleware() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error('SESSION_SECRET is required.');
  const PgStore = connectPgSimple(session);
  return session({
    name: sessionCookieName,
    secret,
    store: new PgStore({ pool, tableName: 'sessions', createTableIfMissing: false }),
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 7 * 24 * 60 * 60 * 1000 },
  });
}

export async function establishSession(req: Request, user: User): Promise<void> {
  await new Promise<void>((resolve, reject) => req.session.regenerate(error => error ? reject(error) : resolve()));
  req.session.userId = user.id;
  req.session.authVersion = user.sessionVersion;
  req.session.csrfToken = randomToken();
  await saveSession(req);
}
export const saveSession = (req: Request) => new Promise<void>((resolve, reject) =>
  req.session.save(error => error ? reject(error) : resolve()));

export async function endSession(req: Request, res: Response): Promise<void> {
  await new Promise<void>((resolve, reject) => req.session.destroy(error => error ? reject(error) : resolve()));
  res.clearCookie(sessionCookieName, { path: '/', httpOnly: true, secure: true, sameSite: 'lax' });
}

export async function sessionUser(req: Request): Promise<User | undefined> {
  if (!req.session.userId) return undefined;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.session.userId)).limit(1);
  if (!user || user.sessionVersion !== req.session.authVersion) {
    delete req.session.userId;
    delete req.session.authVersion;
    return undefined;
  }
  return user;
}

/** Authentication is always checked against the current database state. */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const user = await sessionUser(req);
  if (!user) {
    res.status(401).json({ error: 'Please sign in to continue.', code: 'SIGNIN_REQUIRED', nextPath: '/signin' });
    return;
  }
  if (!user.isActive) {
    res.status(403).json({ error: inactiveMessage, code: 'ACCOUNT_INACTIVE', nextPath: '/signin' });
    return;
  }
  if (!user.emailVerifiedAt) {
    res.status(403).json({ error: 'Please verify your email before continuing.', code: 'EMAIL_UNVERIFIED', nextPath: '/verify-email' });
    return;
  }
  req.authUser = user;
  next();
}

function requireRole(role: User['role']) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    await requireAuth(req, res, () => {
      if (req.authUser?.role !== role) {
        res.status(403).json({ error: 'You do not have access to this area.', code: 'ROLE_REQUIRED' });
        return;
      }
      next();
    });
  };
}
export const requireAdmin = requireRole('admin');
export const requireVolunteer = requireRole('volunteer');

export async function requireOnboardedVolunteer(req: Request, res: Response, next: NextFunction): Promise<void> {
  let authorized = false;
  await requireVolunteer(req, res, () => { authorized = true; });
  if (!authorized) return;
  const [profile] = await db.select().from(volunteerProfilesTable)
    .where(eq(volunteerProfilesTable.userId, req.authUser!.id));
  if (!profile?.onboardingCompletedAt || missingProfileFields(req.authUser!, profile).length) {
    res.status(403).json({ error: 'Please finish your onboarding first.', code: 'ONBOARDING_REQUIRED', nextPath: '/onboarding' });
    return;
  }
  next();
}

export function csrfGuard(req: Request, res: Response, next: NextFunction): void {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) { next(); return; }
  const origin = req.get('origin');
  if (origin !== appOrigin || !sameSecret(req.session.csrfToken, req.get('x-csrf-token'))) {
    res.status(403).json({ error: 'Please refresh the page and try again.', code: 'CSRF_INVALID' });
    return;
  }
  next();
}
