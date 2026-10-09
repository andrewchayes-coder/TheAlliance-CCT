import type { RequestHandler } from 'express';
import { requireAuth, requireAdmin, requireVolunteer, requireOnboardedVolunteer } from './session';
import { requireJobsSecret } from '../server/jobs-auth';

export type Guard = 'public' | 'auth' | 'admin' | 'volunteer' | 'onboardedVolunteer' | 'job';
const declarations: Array<{ method: string; path: string | RegExp; guard: Guard }> = [
  { method: 'GET', path: '/admin/resources', guard: 'admin' },
  { method: 'GET', path: '/admin/resources/context', guard: 'admin' },
  { method: 'POST', path: '/admin/resources', guard: 'admin' },
  { method: 'POST', path: '/admin/resources/reorder', guard: 'admin' },
  { method: 'PATCH', path: /^\/admin\/resources\/[^/]+$/, guard: 'admin' },
  { method: 'PATCH', path: /^\/admin\/resources\/[^/]+\/publish$/, guard: 'admin' },
  { method: 'DELETE', path: /^\/admin\/resources\/[^/]+$/, guard: 'admin' },
  { method: 'GET', path: '/resources', guard: 'auth' },
  { method: 'GET', path: /^\/resources\/[^/]+$/, guard: 'auth' },
  { method: 'GET', path: /^\/resources\/[^/]+\/file$/, guard: 'auth' },
  { method: 'POST', path: '/agreements/acknowledge', guard: 'volunteer' },
  { method: 'GET', path: '/admin/notifications', guard: 'admin' },
  { method: 'GET', path: '/admin/notifications/summary', guard: 'admin' },
  { method: 'PATCH', path: '/admin/notifications/settings', guard: 'admin' },
  { method: 'POST', path: '/admin/notifications/test', guard: 'admin' },
  { method: 'POST', path: /^\/admin\/notifications\/[^/]+\/retry$/, guard: 'admin' },
  { method: 'POST', path: '/jobs/run', guard: 'job' },
  { method: 'GET', path: '/admin/notifications/jobs', guard: 'admin' },
  { method: 'POST', path: '/admin/notifications/jobs/run', guard: 'admin' },
  { method: 'POST', path: '/admin/notifications/jobs/test', guard: 'admin' },
  { method: 'GET', path: '/admin/messages', guard: 'admin' },
  { method: 'POST', path: '/admin/messages', guard: 'admin' },
  { method: 'POST', path: '/admin/messages/preview', guard: 'admin' },
  { method: 'GET', path: '/admin/messages/volunteers', guard: 'admin' },
  { method: 'GET', path: /^\/admin\/messages\/[^/]+$/, guard: 'admin' },
  { method: 'GET', path: '/volunteer/messages/context', guard: 'onboardedVolunteer' },
  { method: 'GET', path: '/volunteer/schedule', guard: 'volunteer' },
  { method: 'POST', path: '/volunteer/assignments', guard: 'volunteer' },
  { method: 'POST', path: /^\/volunteer\/assignments\/[^/]+\/(change|drop|skips)$/, guard: 'volunteer' },
  { method: 'DELETE', path: /^\/volunteer\/assignments\/[^/]+\/skips\/[^/]+$/, guard: 'volunteer' },
  { method: 'GET', path: '/healthz', guard: 'public' },
  { method: 'GET', path: '/health', guard: 'public' },
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
  { method: 'GET', path: '/admin/schedule/settings', guard: 'admin' },
  { method: 'GET', path: '/admin/schedule/controls', guard: 'admin' },
  { method: 'POST', path: '/admin/schedule/assignments', guard: 'admin' },
  { method: 'POST', path: /^\/admin\/schedule\/assignments\/[^/]+\/(remove|skips)$/, guard: 'admin' },
  { method: 'DELETE', path: /^\/admin\/schedule\/assignments\/[^/]+\/skips\/[^/]+$/, guard: 'admin' },
  { method: 'GET', path: '/admin/schedule/alerts', guard: 'admin' },
  { method: 'PATCH', path: '/admin/schedule/alerts', guard: 'admin' },
  { method: 'GET', path: '/admin/overview', guard: 'admin' },
  { method: 'GET', path: '/admin/schedule/week', guard: 'admin' },
  { method: 'POST', path: '/admin/schedule/slots', guard: 'admin' },
  { method: 'PATCH', path: /^\/admin\/schedule\/slots\/[^/]+$/, guard: 'admin' },
  { method: 'POST', path: '/admin/schedule/copy-monday', guard: 'admin' },
  { method: 'POST', path: '/admin/schedule/closed-dates', guard: 'admin' },
  { method: 'DELETE', path: /^\/admin\/schedule\/closed-dates\/[^/]+$/, guard: 'admin' },
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
  declarations.push({ method: 'POST', path: '/dev/email-test', guard: 'admin' });
}

export function declaredGuard(method: string, requestPath: string): Guard | undefined {
  const path = requestPath.replace(/\/+$/, '').toLowerCase() || '/';
  if (process.env.NODE_ENV !== 'development' && ['/dev/email-test', '/admin/notifications/test', '/admin/notifications/jobs/test'].includes(path)) return undefined;
  return declarations.find(route => route.method === (method === 'HEAD' ? 'GET' : method)
    && (typeof route.path === 'string' ? route.path === path : route.path.test(path)))?.guard;
}

/** Runs BEFORE every API handler. An undeclared route cannot execute, even for an admin. */
export const apiAccessPolicy: RequestHandler = (req, res, next) => {
  const path = req.path.replace(/\/+$/, '').toLowerCase() || '/';
  const method = req.method === 'HEAD' ? 'GET' : req.method;
  const guard = declaredGuard(method, path);
  if (!guard) {
    res.status(403).json({ error: 'This API route is not available.', code: 'ROUTE_NOT_DECLARED' });
    return;
  }
  const guards: Record<Exclude<Guard, 'public'>, RequestHandler> = {
    auth: requireAuth, admin: requireAdmin, volunteer: requireVolunteer, onboardedVolunteer: requireOnboardedVolunteer, job: requireJobsSecret,
  };
  if (guard === 'public') { next(); return; }
  return guards[guard](req, res, next);
};
