import { randomBytes } from 'node:crypto';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, expect, type Browser, type Page } from '@playwright/test';
import bcrypt from 'bcrypt';
import { onboardingQuestions } from '@workspace/shared/onboardingQuestions';

/**
 * Real browser + real API/DB; API is intercepted ONLY to the isolated child server.
 * No public token shortcut, API login, shared-user blast, or real email delivery.
 */
async function main() {
  if (process.argv.includes('--help')) {
    console.log('NODE_ENV=development SMOKE_DATABASE_ENVIRONMENT=development QA_SMOKE_ALLOW_SCHEMA=1 pnpm --filter @workspace/scripts run smoke');
    return;
  }
  if (process.env.NODE_ENV !== 'development' || process.env.SMOKE_DATABASE_ENVIRONMENT !== 'development'
    || process.env.QA_SMOKE_ALLOW_SCHEMA !== '1') throw new Error('Explicit development smoke-test confirmation is required.');
  const origin = new URL(process.env.SMOKE_BASE_URL || `https://${process.env.REPLIT_DEV_DOMAIN}`);
  if (!(origin.hostname.endsWith('.replit.dev') || ['localhost', '127.0.0.1'].includes(origin.hostname)))
    throw new Error('Use the development preview, never a published app.');
  const base = origin.origin;
  const schema = `qa_smoke_${randomBytes(12).toString('hex')}`;
  const qschema = `"${schema}"`;
  const { pool } = await import('@workspace/db');
  let child: ChildProcess | undefined, browser: Browser | undefined;
  let created = false, output = '';
  try {
    await pool.query(`CREATE SCHEMA ${qschema}`); created = true;
    // Clone DDL, not data; copy constraints so uniqueness/FK checks remain real.
    const tables = await pool.query<{ name: string }>("SELECT tablename AS name FROM pg_tables WHERE schemaname='public'");
    for (const { name } of tables.rows) {
      if (!/^[a-zA-Z0-9_]+$/.test(name)) throw new Error('Unexpected table identifier.');
      await pool.query(`CREATE TABLE ${qschema}."${name}" (LIKE public."${name}" INCLUDING ALL)`);
    }
    const fks = await pool.query<{ name: string; table: string; definition: string }>(`
      SELECT c.conname AS name, t.relname AS table, pg_get_constraintdef(c.oid) AS definition
      FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
      WHERE n.nspname='public' AND c.contype='f'`);
    for (const fk of fks.rows) {
      if (!/^[a-zA-Z0-9_]+$/.test(fk.name) || !/^[a-zA-Z0-9_]+$/.test(fk.table)) throw new Error('Unexpected constraint identifier.');
      const definition = fk.definition.replace(/REFERENCES (?:public\.)?"?([a-zA-Z0-9_]+)"?/g, `REFERENCES ${qschema}."$1"`);
      await pool.query(`ALTER TABLE ${qschema}."${fk.table}" ADD CONSTRAINT "${fk.name}" ${definition}`);
    }
    const password = `Smoke-${randomBytes(16).toString('hex')}!`;
    const email = `${schema}@example.invalid`, adminEmail = `${schema}-admin@example.invalid`;
    const administrator = await pool.query<{ id: string }>(`INSERT INTO ${qschema}.users(email,password_hash,first_name,last_name,role,email_verified_at)
      VALUES($1,$2,'Smoke','Coordinator','admin',now()) RETURNING id`, [adminEmail, await bcrypt.hash(password, 12)]);
    for (const title of ['User Agreement', 'Safety Guidelines'])
      await pool.query(`INSERT INTO ${qschema}.resources(type,title,category,body,is_published,created_by_user_id)
        VALUES('article',$1,'Agreements','Temporary isolated QA agreement, not Alliance policy.',true,$2)`, [title, administrator.rows[0]!.id]);
    const probe = createServer();
    await new Promise<void>(r => probe.listen(0, '127.0.0.1', r));
    const port = (probe.address() as { port: number }).port;
    await new Promise<void>(r => probe.close(() => r()));
    child = spawn(process.execPath, ['--import', 'tsx', resolve('src/smoke-api.ts')], {
      cwd: process.cwd(), env: { ...process.env, NODE_ENV: 'development', QA_SMOKE_SCHEMA: schema,
        PGOPTIONS: `-c search_path=${schema},public`, APP_ORIGIN: base, PORT: String(port),
        POSTMARK_SERVER_TOKEN: '', EMAIL_FROM: '', RUN_JOBS: 'false' }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout?.on('data', data => { output += String(data); });
    child.stderr?.on('data', data => { output += String(data); });
    const api = `http://127.0.0.1:${port}`;
    let ready = false;
    for (let i = 0; i < 120; i++) {
      if (child.exitCode !== null) throw new Error('The isolated smoke API did not start. No child logs are printed because they contain test verification links.');
      try { ready = (await fetch(`${api}/api/healthz`)).ok; } catch {}
      if (ready) break; await delay(500);
    }
    if (!ready) throw new Error('Isolated smoke API timed out.');
    let executablePath = process.env.CHROMIUM_EXECUTABLE_PATH;
    if (!executablePath) {
      // Replit's system Chromium has its Nix dependencies; downloaded Linux shells may not.
      try { executablePath = execFileSync('which', ['chromium'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch {}
    }
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox'], ...(executablePath ? { executablePath } : {}) });
    async function page() {
      const context = await browser!.newContext({ viewport: { width: 375, height: 812 }, timezoneId: 'America/Los_Angeles' });
      await context.route('**/api/**', async route => {
        const request = route.request(), url = new URL(request.url());
        await route.fulfill({ response: await route.fetch({ url: `${api}${url.pathname}${url.search}`,
          headers: { ...request.headers(), origin: base, 'x-forwarded-proto': 'https' }, maxRedirects: 0, timeout: 120000 }) });
      });
      const p = await context.newPage(); p.setDefaultTimeout(120000); return p;
    }
    async function call(p: Page, path: string, method = 'GET', body?: unknown) {
      const result = await p.evaluate(async ({ path, method, body }) => {
        const state = await (await fetch('/api/auth/session')).json() as { csrfToken: string };
        const res = await fetch(`/api${path}`, { method, headers: { 'content-type': 'application/json', 'x-csrf-token': state.csrfToken },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
        return { ok: res.ok, status: res.status, data: await res.json() as any };
      }, { path, method, body });
      expect(result.ok, `${method} ${path}: ${result.status}`).toBe(true); return result.data;
    }
    const volunteer = await page();
    await volunteer.goto(`${base}/signup`);
    for (const [name, value] of [['First name', 'Smoke'], ['Last name', 'Neighbor'], ['Email', email], ['Mobile phone', '9165550101'],
      ['Password', password], ['Confirm password', password]])
      await volunteer.getByLabel(new RegExp(`^${name}`, 'i'), { exact: name === 'Password' }).fill(value);
    await volunteer.getByRole('button', { name: /create account|sign up/i }).click();
    await expect(volunteer).toHaveURL(/verify-email/);
    const logged = output.split('EMAIL LOGGED').find(part => part.includes(`To: ${email}\n`));
    const token = logged?.match(/\/verify\?token=([a-f0-9]{64})/)?.[1];
    if (!token) throw new Error('Signup did not log its verification link.');
    await volunteer.goto(`${base}/verify?token=${token}`);
    await expect(volunteer).toHaveURL(/onboarding/);
    for (const step of [1, 2]) {
      for (const question of onboardingQuestions.filter(q => q.step === step)) {
        const label = new RegExp(question.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        if (question.type === 'select') await volunteer.getByRole('combobox', { name: label }).selectOption(question.options![0]!);
        else if (question.type === 'text' || question.type === 'textarea') await volunteer.getByLabel(label).fill('Isolated smoke-test response.');
        else if (question.type === 'date') await volunteer.getByLabel(label).fill('2026-10-08');
        else {
          const group = volunteer.getByRole('group', { name: label });
          await group.getByRole(question.type === 'multiselect' ? 'checkbox' : 'radio', {
            name: question.type === 'yesno' ? 'No' : question.options![0]!, exact: true }).check();
        }
      }
      if (step === 2) await volunteer.getByTestId('checkbox-agreement').check();
      await volunteer.getByTestId(step === 1 ? 'button-next' : 'button-finish').click();
    }
    await expect(volunteer).toHaveURL(/dashboard/);
    const me = await call(volunteer, '/me');
    const admin = await page(); await admin.goto(`${base}/signin`);
    await admin.getByLabel(/^email/i).fill(adminEmail); await admin.getByLabel(/^password$/i).fill(password);
    await admin.getByRole('button', { name: /^sign in$/i }).click(); await expect(admin).toHaveURL(/\/admin$/);
    const detail = await call(admin, `/admin/volunteers/${me.user.id}`);
    const tracking = await call(admin, `/admin/volunteers/${me.user.id}/tracking`, 'PATCH', {
      expectedUpdatedAt: detail.entry.profile.updatedAt, certificationStatus: 'complete',
      certificationCompletedAt: '2026-10-08', certificationExpiresAt: null,
      backgroundCheckStatus: 'cleared', backgroundCheckSubmittedAt: '2026-10-08', backgroundCheckClearedAt: '2026-10-08',
    });
    await call(admin, `/admin/volunteers/${me.user.id}/status`, 'POST', { status: 'active', expectedUpdatedAt: tracking.entry.profile.updatedAt });
    const settings = await call(admin, '/admin/schedule/slots', 'POST', { dayOfWeek: 1, startTime: '09:00', endTime: '11:00', capacity: 1, label: 'Isolated smoke shift', isActive: true });
    const slot = settings.slots.find((s: { label: string }) => s.label === 'Isolated smoke shift');
    await volunteer.goto(`${base}/shifts`);
    await volunteer.getByTestId(`slot-${slot.id}`).click(); await volunteer.getByTestId('button-confirm-shift').click();
    await expect(volunteer.getByText(/on the schedule|your shift/i).first()).toBeVisible();
    const schedule = await call(volunteer, '/volunteer/schedule');
    expect(schedule.assignments).toHaveLength(1);
    const assignment = schedule.assignments[0];
    const start = new Date(assignment.nextDates[0].startsAt);
    await call(admin, `/admin/notifications/jobs/run?at=${encodeURIComponent(new Date(start.getTime() - 24 * 3600000).toISOString())}`, 'POST', {});
    const reminder = await pool.query(`SELECT status FROM ${qschema}.notification_log WHERE recipient_user_id=$1 AND type='reminder'`, [me.user.id]);
    expect(reminder.rows.some(r => r.status === 'logged')).toBe(true);
    await admin.goto(`${base}/admin/messages?selected=${me.user.id}`);
    await admin.getByTestId('input-subject').fill('Isolated smoke message');
    await admin.getByTestId('input-body').fill('Thank you for the care you share with neighbors.');
    await admin.getByTestId('button-preview').click(); await admin.getByTestId('button-send-start').click();
    await admin.getByTestId('button-send-confirm').click();
    await expect(admin.getByTestId('result-send')).toBeVisible();
    await volunteer.goto(`${base}/messages`);
    const readRequest = volunteer.waitForResponse(response =>
      response.request().method() === 'PATCH' && /\/volunteer\/messages\/[^/]+\/read$/.test(new URL(response.url()).pathname));
    await volunteer.getByRole('button', { name: /Isolated smoke message/ }).click();
    expect((await readRequest).ok()).toBe(true);
    const receipts = await pool.query(`SELECT read_at FROM ${qschema}.message_recipients WHERE recipient_user_id=$1`, [me.user.id]);
    expect(receipts.rows.some(r => r.read_at)).toBe(true);
    console.log('PASS: signup → email verification → onboarding → approval → shift → logged reminder → message → read receipt.');
  } finally {
    await browser?.close();
    if (child && child.exitCode === null) {
      child.kill('SIGTERM'); await Promise.race([new Promise(r => child!.once('exit', r)), delay(5000)]);
      if (child.exitCode === null) child.kill('SIGKILL');
    }
    if (created) await pool.query(`DROP SCHEMA ${qschema} CASCADE`);
    await pool.end();
  }
}
await main();
