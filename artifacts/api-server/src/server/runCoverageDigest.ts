import { runDailyDigest } from './coverageAlerts';
import { pool } from '@workspace/db';
import { logger } from '../lib/logger';
try {
  await runDailyDigest();
} catch (err) {
  logger.error({ err }, 'Coverage digest command failed.');
  process.exitCode = 1;
} finally {
  await pool.end();
}
