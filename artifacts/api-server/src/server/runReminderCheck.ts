import { runReminderCheck } from './jobs';
import { pool } from '@workspace/db';
try {
  await runReminderCheck({ source: 'command' });
} catch {
  process.exitCode = 1;
} finally {
  await pool.end();
}
