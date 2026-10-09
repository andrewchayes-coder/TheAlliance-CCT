import pg from 'pg';
import { spawn } from 'node:child_process';

// Never seed or push. Serialize migrators across Reserved VM/Autoscale restarts.
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for migrations.');
const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 });
let locked = false;
try {
  await client.connect();
  const deadline = Date.now() + 120_000;
  do {
    const result = await client.query("SELECT pg_try_advisory_lock(hashtext('alliance:drizzle-migrations')) AS locked");
    locked = result.rows[0].locked;
    if (!locked) {
      if (Date.now() >= deadline) throw new Error('Timed out waiting for the migration lock.');
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  } while (!locked);
  const existing = await client.query("SELECT to_regclass('public.users') IS NOT NULL AS tables, to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS journal");
  if (existing.rows[0].tables && !existing.rows[0].journal) {
    throw new Error('Existing Alliance tables have no migration history. Refusing to replay the initial migration. Review and baseline the existing schema as described in DEPLOY.md; never drop or seed it.');
  }
  await new Promise((resolve, reject) => {
    const child = spawn('pnpm', ['exec', 'drizzle-kit', 'migrate', '--config', './drizzle.config.ts'], {
      cwd: new URL('../', import.meta.url), stdio: 'inherit', env: process.env,
    });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error('drizzle-kit migrate failed. The API was not started.')));
  });
} catch (error) {
  // Connection errors may contain private connection information.
  console.error(error instanceof Error && /^(Existing Alliance|Timed out waiting|drizzle-kit migrate)/.test(error.message)
    ? error.message : 'Migration connection/execution failed. Check the production database configuration.');
  process.exitCode = 1;
} finally {
  if (locked) await client.query("SELECT pg_advisory_unlock(hashtext('alliance:drizzle-migrations'))").catch(() => {});
  await client.end().catch(() => {});
}
