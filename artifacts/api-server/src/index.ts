import './server/startup-check';
import app from "./app";
import { logger } from "./lib/logger";
import { startCoverageDigest } from './server/coverageAlerts';
import { startReminderJobs } from './server/jobs';
import { ensureTestAccounts, isQuickLoginEnabled } from './server/testAccounts';

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function start() {
  // Account data only: schema changes remain owned by Replit Publish.
  if (isQuickLoginEnabled()) await ensureTestAccounts();
  app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  startCoverageDigest();
  startReminderJobs();
  });
}
void start().catch(err => {
  logger.error({ err }, 'The application could not prepare its QA accounts.');
  process.exit(1);
});
