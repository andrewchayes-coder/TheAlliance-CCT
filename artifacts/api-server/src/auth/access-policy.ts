import type { RequestHandler } from 'express';
import { requireAuth, requireAdmin, requireVolunteer, requireOnboardedVolunteer } from './session';

type Guard = 'public' | 'auth' | 'admin' | 'volunteer' | 'onboardedVolunteer';
const declarations: Array<{ method: string; path: string | RegExp; guard: Guard }> = [
  { method: 'GET', path: '/healthz', guard: 'public' },
  { method: 'GET', path: '/auth/session', guard: 'public' },
  ...['signup', 'signin', 'resend-verification', 'verify', 'forgot-password', 'reset-password', 'signout', 'accept-invite']
    .map(path => ({ method: 'POST', path: `/auth/${path}`, guard: 'public' as const })),
  { method: 'GET', path: '/auth/google', guard: 'public' },
  { method: 'GET', path: '/auth/google/callback', guard: 'public' },
  { method: 'GET', path: '/me', guard: 'auth' },
  ...['dashboard', 'messages', 'resources'].map(path =>
    ({ method: 'GET', path: `/volunteer/${path}`, guard: 'onboardedVolunteer' as const })),
  { method: 'PATCH', path: '/volunteer/profile', guard: 'onboardedVolunteer' },
  { method: 'POST', path: '/volunteer/password', guard: 'onboardedVolunteer' },
  { method: 'PATCH', path: /^\/volunteer\/messages\/[^/]+\/read$/, guard: 'onboardedVolunteer' },
  { method: 'PATCH', path: '/onboarding', guard: 'volunteer' },
  { method: 'GET', path: '/onboarding/agreements', guard: 'auth' },
  { method: 'GET', path: /^\/onboarding\/agreements\/[^/]+$/, guard: 'auth' },
  { method: 'GET', path: '/admin/volunteers/onboarding.csv', guard: 'admin' },
  { method: 'GET', path: '/admin/volunteers', guard: 'admin' },
  { method: 'GET', path: '/admin/volunteers/roster.csv', guard: 'admin' },
  { method: 'GET', path: '/admin/volunteers/schedule.csv', guard: 'admin' },
  { method: 'GET', path: /^\/admin\/volunteers\/[^/]+$/, guard: 'admin' },
  { method: 'POST', path: /^\/admin\/volunteers\/[^/]+\/status$/, guard: 'admin' },
  { method: 'PATCH', path: /^\/admin\/volunteers\/[^/]+\/tracking$/, guard: 'admin' },
  { method: 'PATCH', path: /^\/admin\/volunteers\/[^/]+\/notes$/, guard: 'admin' },
  { method: 'GET', path: /^\/admin\/volunteers\/[^/]+\/onboarding$/, guard: 'admin' },
  { method: 'GET', path: '/admin/users', guard: 'admin' },
  { method: 'POST', path: '/admin/invites', guard: 'admin' },
  { method: 'PATCH', path: /^\/admin\/users\/[^/]+\/status$/, guard: 'admin' },
];
if (process.env.NODE_ENV === 'development') {
  declarations.push({ method: 'POST', path: '/dev/email-test', guard: 'public' });
}

/** Runs BEFORE every API handler. An undeclared route cannot execute, even for an admin. */
export const apiAccessPolicy: RequestHandler = (req, res, next) => {
  const path = req.path.replace(/\/+$/, '').toLowerCase() || '/';
  const method = req.method === 'HEAD' ? 'GET' : req.method;
  const declaration = declarations.find(route =>
    route.method === method && (typeof route.path === 'string' ? route.path === path : route.path.test(path)));
  if (!declaration) {
    res.status(403).json({ error: 'This API route is not available.', code: 'ROUTE_NOT_DECLARED' });
    return;
  }
  const guards: Record<Exclude<Guard, 'public'>, RequestHandler> = {
    auth: requireAuth, admin: requireAdmin, volunteer: requireVolunteer, onboardedVolunteer: requireOnboardedVolunteer,
  };
  if (declaration.guard === 'public') { next(); return; }
  return guards[declaration.guard](req, res, next);
};
