import express, { type Express } from "express";
import { volunteerContactText } from '@workspace/shared/appConfig';
import { resolve } from 'node:path';
import cors from "cors";
import helmet from 'helmet';
import { errorEnvelope } from './middlewares/request-hardening';
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { appOrigin, sessionMiddleware } from "./auth/session";

const app: Express = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(helmet());
// Public, bundled artwork only. Register before sessions and private API caching.
app.use('/brand', express.static(resolve(import.meta.dirname,
  `../../alliance-volunteer-portal/${process.env.NODE_ENV === 'production' ? 'dist/public' : 'public'}/brand`), {
  maxAge: '365d',
  immutable: true,
  index: false,
  dotfiles: 'deny',
  setHeaders(res) {
    // Email clients may load the public logo from a different origin.
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  },
}));
app.use(errorEnvelope);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          // Calendar paths are bearer capabilities; never retain their tokens in request logs.
          url: req.url?.split("?")[0]?.replace(/^(\/api\/calendar\/)[^/]+$/, '$1[private].ics'),
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors({ origin: appOrigin, credentials: true }));
app.use(express.json({ limit: '128kb' }));
app.use(express.urlencoded({ extended: true }));
app.use(sessionMiddleware());
app.use('/api', (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

app.use("/api", router);
app.use((error: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  req.log.error({ errorName: error instanceof Error ? error.name : 'Error' }, 'API request failed');
  if (!res.headersSent) {
    const status = typeof error === 'object' && error !== null && 'status' in error ? Number(error.status) : 500;
    res.status(status === 413 ? 413 : status === 400 ? 400 : 500).json({
      error: status === 413 ? 'This request is too large. Please shorten the text and try again.' :
        status === 400 ? 'This request could not be read. Please check the fields and try again.' :
          `Something went wrong on our end. Please try again — if it keeps happening, contact ${volunteerContactText}.`,
    });
  }
});

export default app;
