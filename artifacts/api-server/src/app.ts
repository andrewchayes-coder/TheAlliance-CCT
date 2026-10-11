import express, { type Express } from "express";
import cors from "cors";
import helmet from 'helmet';
import { errorEnvelope } from './middlewares/request-hardening';
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { appOrigin, sessionMiddleware } from "./auth/session";
import { qaUnlockRouter } from './routes/quick-login';

const app: Express = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(helmet());
app.use(errorEnvelope);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
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
app.use(qaUnlockRouter);
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
          'Something went wrong on our end. Please try again — if it keeps happening, let The Alliance know.',
    });
  }
});

export default app;
