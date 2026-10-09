import '../server/startup-check';
import { randomUUID } from 'node:crypto';
import { and, eq, isNotNull } from 'drizzle-orm';
import { db, pool, usersTable } from '@workspace/db';
import { z } from 'zod/v4';
import { testProviderEmail } from '../server/notification-log';
import { sendTestReminder } from '../server/jobs';

try {
  if (process.env.NODE_ENV !== 'production' || process.env.PRODUCTION_DATABASE_ACK !== 'production') {
    throw new Error('Run only in a production-configured operator shell with PRODUCTION_DATABASE_ACK=production. Never point a workspace test command at production.');
  }
  const action = z.enum(['email', 'reminder']).parse(process.argv[2]);
  const email = z.email().parse(process.argv[3]).trim().toLowerCase();
  const [admin] = await db.select({ id: usersTable.id }).from(usersTable).where(and(
    eq(usersTable.email, email), eq(usersTable.role, 'admin'), eq(usersTable.isActive, true), isNotNull(usersTable.emailVerifiedAt),
  ));
  if (!admin) throw new Error('Select an active, verified administrator. No volunteer test recipients are allowed.');
  const result = action === 'email' ? await testProviderEmail(admin.id, randomUUID()) : await sendTestReminder(admin.id, randomUUID());
  if (!result.ok) throw new Error('Test delivery failed. Review the administrator notification log.');
  console.log(`Production ${action} test sent to the selected administrator. Confirm receipt and the sent notification row.`);
} catch {
  console.error('Production delivery test failed. Check required configuration, the verified administrator, command arguments, and notification log. See DEPLOY.md.');
  process.exitCode = 1;
} finally { await pool.end(); }
