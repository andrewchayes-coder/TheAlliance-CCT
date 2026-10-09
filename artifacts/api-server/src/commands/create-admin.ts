import '../server/startup-check';
import { pool } from '@workspace/db';
import { inviteAdministrator } from '../auth/admin-management';

const [email, firstName, lastName, ...extra] = process.argv.slice(2);
try {
  if (!email || !firstName || !lastName || extra.length) {
    throw new Error('Usage: npm run create-admin -- email@domain.org "First" "Last"');
  }
  const result = await inviteAdministrator({ email, firstName, lastName }, { bootstrap: true });
  console.log(`Pending administrator: ${result.user.email}`);
  console.log('Accept within seven days. Keep this one-time invitation link private:');
  console.log(result.inviteUrl);
  console.log(result.message);
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Administrator creation failed.');
  process.exitCode = 1;
} finally {
  await pool.end();
}
