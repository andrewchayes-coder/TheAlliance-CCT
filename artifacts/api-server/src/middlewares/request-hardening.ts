import type { RequestHandler } from 'express';
import { z } from 'zod';

const objectBody = z.record(z.string(), z.unknown());
const empty = z.object({}).strict();
const noBody = /^(?:\/api\/auth\/signout|\/api\/dev\/email-test|\/api\/admin\/schedule\/copy-monday|\/api\/admin\/notifications\/jobs\/run|\/api\/volunteer\/assignments\/[^/]+\/drop|\/api\/volunteer\/messages\/[^/]+\/read)\/?$/i;

/** Shape validation for all writes; each payload route also validates its domain fields. */
export const validateWriteBoundary: RequestHandler = (req, res, next) => {
  const path = `${req.baseUrl ?? ''}${req.path}`;
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) || !path.startsWith('/api/')) { next(); return; }
  // Multipart metadata is parsed by Zod after the bounded upload parser.
  if (req.is('multipart/form-data')) { next(); return; }
  const schema = req.method === 'DELETE' || noBody.test(path) ? empty : objectBody;
  const parsed = schema.safeParse(req.body === undefined ? {} : req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Please check the request fields and try again.', code: 'INVALID_INPUT' }); return; }
  next();
};

/** Keep existing specific codes/fields while making every error envelope consistent. */
export const errorEnvelope: RequestHandler = (_req, res, next) => {
  const json = res.json.bind(res);
  res.json = ((body: unknown) => {
    if (res.statusCode >= 400 && body && typeof body === 'object' && !Array.isArray(body)) {
      const value = body as Record<string, unknown>;
      const { stack: _stack, ...safe } = value;
      body = { ...safe, error: typeof safe.error === 'string' ? safe.error : 'This request could not be completed.',
        code: typeof safe.code === 'string' ? safe.code :
          ({ 400: 'INVALID_INPUT', 401: 'SIGNIN_REQUIRED', 403: 'ACCESS_DENIED', 404: 'NOT_FOUND',
            409: 'CONFLICT', 413: 'REQUEST_TOO_LARGE', 422: 'VALIDATION_FAILED', 429: 'RATE_LIMITED' } as Record<number, string>)[res.statusCode] ?? 'INTERNAL_ERROR' };
    }
    return json(body);
  }) as typeof res.json;
  next();
};
