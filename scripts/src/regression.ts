import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { pool } from '@workspace/db';

// Clone structure only. Never run broad notification tests against shared users.
if (process.env.NODE_ENV !== 'development' || process.env.QA_DATABASE_ENVIRONMENT !== 'development')
  throw new Error('Use NODE_ENV=development QA_DATABASE_ENVIRONMENT=development for isolated regression tests.');
const schema = `qa_regression_${randomBytes(12).toString('hex')}`, quoted = `"${schema}"`;
let created = false;
try {
  await pool.query(`CREATE SCHEMA ${quoted}`); created = true;
  const tables = await pool.query<{ name: string }>("SELECT tablename AS name FROM pg_tables WHERE schemaname='public'");
  for (const { name } of tables.rows) {
    if (!/^\w+$/.test(name)) throw new Error('Unexpected table identifier.');
    await pool.query(`CREATE TABLE ${quoted}."${name}" (LIKE public."${name}" INCLUDING ALL)`);
  }
  const keys = await pool.query<{ name: string; table: string; definition: string }>(`
    SELECT c.conname AS name,t.relname AS table,pg_get_constraintdef(c.oid) AS definition
    FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
    WHERE n.nspname='public' AND c.contype='f'`);
  for (const key of keys.rows) {
    if (!/^\w+$/.test(key.name) || !/^\w+$/.test(key.table)) throw new Error('Unexpected constraint identifier.');
    const definition = key.definition.replace(/REFERENCES (?:public\.)?"?(\w+)"?/g, `REFERENCES ${quoted}."$1"`);
    await pool.query(`ALTER TABLE ${quoted}."${key.table}" ADD CONSTRAINT "${key.name}" ${definition}`);
  }
  const env = { ...process.env, PGOPTIONS: `-c search_path=${schema},public`, QA_REGRESSION_SCHEMA: schema,
    POSTMARK_SERVER_TOKEN: '', EMAIL_FROM: '', EMAIL_REPLY_TO: '', RUN_JOBS: 'false', QUICK_LOGIN_ENABLED: 'false' };
  async function run(args: string[]) {
    const child = spawn('pnpm', ['--filter', '@workspace/api-server', 'exec', ...args], { env, stdio: 'inherit' });
    const code = await new Promise<number>(resolve => child.once('exit', code => resolve(code ?? 1)));
    if (code) process.exitCode = 1;
    return code;
  }
  const check = await run(['tsx', '-e', "import('@workspace/db').then(async ({pool}) => { const r = await pool.query('SELECT current_schema() AS s'); await pool.end(); if (r.rows[0].s !== process.env.QA_REGRESSION_SCHEMA) throw new Error('Regression database isolation failed.'); })"]);
  if (check) throw new Error('Refusing to run tests without database isolation.');
  await run(['vitest', 'run']);
  await run(['tsx', '--test', '--test-concurrency=1', 'src/auth/auth.test.ts', 'src/email.test.ts',
    'src/onboarding.test.ts', 'src/volunteer.test.ts', 'src/admin-roster.test.ts']);
} finally {
  if (created) await pool.query(`DROP SCHEMA ${quoted} CASCADE`);
  await pool.end();
}
