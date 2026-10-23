import { randomBytes } from 'node:crypto';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, expect, type Browser, type Page } from '@playwright/test';
import { checkReports } from './reports-smoke';
import { checkClaimButtons } from './claim-buttons-smoke';
import { checkArchiveAccounts } from './archive-accounts-smoke';
import { checkCalendar } from './calendar-smoke';
import bcrypt from 'bcrypt';
import { testProfileFields } from '@workspace/shared/testAccounts';
import lighthouse from 'lighthouse';
import puppeteer from 'puppeteer-core';
import { mkdir, writeFile } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';

/**
 * Real browser + real API/DB; API is intercepted ONLY to the isolated child server.
 * No public token shortcut, API login, shared-user blast, or real email delivery.
 */
async function main() {
  // Focused re-check of changed profile/activation/staff-record UI; default remains the full smoke.
  const profileOnly = process.argv.includes('--profile-only');
  const hoursOnly = process.argv.includes('--hours-only');
  const archiveOnly = process.argv.includes('--archive-only');
  const calendarOnly = process.argv.includes('--calendar-only');
  if (process.argv.includes('--help')) {
    console.log('NODE_ENV=development SMOKE_DATABASE_ENVIRONMENT=development QA_SMOKE_ALLOW_SCHEMA=1 pnpm --filter @workspace/scripts exec tsx src/smoke.ts [--profile-only|--hours-only|--archive-only|--calendar-only]');
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
  let closingBrowser = false;
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
    const probe = createServer();
    await new Promise<void>(r => probe.listen(0, '127.0.0.1', r));
    const port = (probe.address() as { port: number }).port;
    await new Promise<void>(r => probe.close(() => r()));
    child = spawn(process.execPath, ['--import', 'tsx', resolve('src/smoke-api.ts')], {
      cwd: process.cwd(), env: { ...process.env, NODE_ENV: 'development', QA_SMOKE_SCHEMA: schema,
        PGOPTIONS: `-c search_path=${schema},public`, APP_ORIGIN: base, PORT: String(port),
        POSTMARK_SERVER_TOKEN: '', EMAIL_FROM: '', EMAIL_REPLY_TO: '', RUN_JOBS: 'false',
        QUICK_LOGIN_ENABLED: 'true' }, stdio: ['ignore', 'pipe', 'pipe'],
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
    const debugProbe = createServer();
    await new Promise<void>(r => debugProbe.listen(0, '127.0.0.1', r));
    const debugPort = (debugProbe.address() as { port: number }).port;
    await new Promise<void>(r => debugProbe.close(() => r()));
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox', `--remote-debugging-port=${debugPort}`], ...(executablePath ? { executablePath } : {}) });
    async function accessibility(p: Page, name: string) {
      const endpoint = await (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).json() as { webSocketDebuggerUrl: string };
      const driver = await puppeteer.connect({ browserWSEndpoint: endpoint.webSocketDebuggerUrl });
      try {
        const target = (await driver.pages()).find(candidate => candidate.url() === p.url());
        if (!target) throw new Error('Authenticated Lighthouse target is missing.');
        const expectedPath = new URL(p.url()).pathname;
        const result = await lighthouse(p.url(), { onlyCategories: ['accessibility'], disableStorageReset: true,
          logLevel: 'error', output: 'json' }, undefined, target);
        if (!result) throw new Error('Lighthouse did not return an audit.');
        expect(new URL(result.lhr.finalDisplayedUrl).pathname).toBe(expectedPath);
        await mkdir(resolve('../generated-artifacts/regression'), { recursive: true });
        await writeFile(resolve(`../generated-artifacts/regression/lighthouse-${name}.json`), JSON.stringify(result.lhr, null, 2));
        const score = Math.round((result.lhr.categories.accessibility!.score ?? 0) * 100);
        console.log(`Lighthouse accessibility ${name}: ${score}`);
        const failed = Object.values(result.lhr.audits).filter(a => a.score === 0).map(a => a.id);
        expect(score, `${name}: ${failed.join(', ')}`).toBeGreaterThanOrEqual(95);
      } finally { await driver.disconnect(); }
    }
    async function page() {
      const context = await browser!.newContext({ viewport: { width: 375, height: 812 }, timezoneId: 'America/Los_Angeles' });
      await context.route('**/api/**', async route => {
        const request = route.request(), url = new URL(request.url());
        try {
          await route.fulfill({ response: await route.fetch({ url: `${api}${url.pathname}${url.search}`,
            headers: { ...request.headers(), origin: base, 'x-forwarded-proto': 'https' }, maxRedirects: 0, timeout: 120000 }) });
        } catch (error) {
          // Requests still in flight during cleanup must not mask the original assertion.
          if (!closingBrowser) throw error;
        }
      });
      const p = await context.newPage(); p.setDefaultTimeout(30000); return p;
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
    if (hoursOnly || archiveOnly || calendarOnly) {
      const admin = await page();
      await admin.goto(`${base}/signin`);
      await admin.getByTestId('button-quick-admin').click();
      await expect(admin).toHaveURL(/\/admin$/);
      const adminMe = await call(admin, '/me');
      expect(adminMe.user.role).toBe('admin');
      if (calendarOnly) {
        await checkCalendar(admin, await page(), base, api);
        return;
      }
      if (archiveOnly) {
        const fixture = await pool.query<{ id: string }>(`INSERT INTO ${qschema}.users
          (email,password_hash,first_name,last_name,role,email_verified_at,is_active)
          VALUES ($1,'fixture-only','Archive','Browser','volunteer',now(),false) RETURNING id`,
        [`archive-${randomBytes(8).toString('hex')}@example.invalid`]);
        const userId = fixture.rows[0]!.id;
        await pool.query(`INSERT INTO ${qschema}.volunteer_profiles (user_id,status) VALUES ($1,'inactive')`, [userId]);
        const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
        await call(admin, `/admin/volunteers/${userId}/hours`, 'POST', { date: today, source: 'other', hours: 1.5, note: 'Archive preservation check.' });
        await checkArchiveAccounts(admin, base, userId);
        return;
      }

      const volunteer = await page();
      await volunteer.goto(`${base}/signin`);
      await volunteer.getByTestId('button-quick-vol-active').click();
      await expect(volunteer).toHaveURL(/\/dashboard$/);
      const volunteerMe = await call(volunteer, '/me');

      const pacificToday = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
      const firstTuesday = new Date(`${pacificToday}T12:00:00Z`);
      firstTuesday.setUTCDate(firstTuesday.getUTCDate() + ((2 - firstTuesday.getUTCDay() + 7) % 7 || 7));
      const formatDate = (d: Date) => d.toISOString().slice(0, 10);
      const startDate = formatDate(firstTuesday);
      await checkClaimButtons(admin, await page(), volunteer, base, startDate);
      const secondTuesday = new Date(firstTuesday); secondTuesday.setUTCDate(secondTuesday.getUTCDate() + 7);
      const secondDate = formatDate(secondTuesday);
      const settings = await call(admin, '/admin/schedule/slots', 'POST', {
        dayOfWeek: 2, startTime: '10:00', endTime: '12:00', capacity: 1, label: 'Isolated Fix10 hours', isActive: true,
      });
      const slot = settings.slots.find((s: { label: string }) => s.label === 'Isolated Fix10 hours');
      expect(slot, 'isolated Tuesday slot was created').toBeTruthy();
      await call(admin, '/admin/schedule/assignments', 'POST', {
        userId: volunteerMe.user.id, slotId: slot.id, startDate, override: false,
      });
      const schedule = await call(volunteer, '/volunteer/schedule');
      const assignment = schedule.assignments.find((s: { slotId: string }) => s.slotId === slot.id);
      expect(assignment, 'Active persona has the isolated slot assignment').toBeTruthy();
      const firstOccurrence = assignment.nextDates.find((d: { date: string }) => d.date === startDate);
      const secondOccurrence = assignment.nextDates.find((d: { date: string }) => d.date === secondDate);
      expect(firstOccurrence, 'first Tuesday occurrence is available').toBeTruthy();
      expect(secondOccurrence, 'second Tuesday occurrence is available').toBeTruthy();
      const hoursAt = new Date(new Date(secondOccurrence.endsAt).getTime() + 60_000).toISOString();
      const firstKey = `${firstOccurrence.date}-${slot.id}`;
      const secondKey = `${secondOccurrence.date}-${slot.id}`;
      const home = `${base}/dashboard?at=${encodeURIComponent(hoursAt)}`;
      const staffDetail = `${base}/admin/volunteers/${volunteerMe.user.id}?at=${encodeURIComponent(hoursAt)}`;

      await volunteer.setViewportSize({ width: 320, height: 850 });
      await volunteer.goto(home);
      await expect(volunteer.getByTestId('card-log-hours')).toBeVisible();
      const checkMobile = async (p: Page, label: string) => {
        const sizes = await p.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
        expect(sizes.document, `${label}: document has no horizontal overflow at 320px`).toBeLessThanOrEqual(320);
        expect(sizes.body, `${label}: body has no horizontal overflow at 320px`).toBeLessThanOrEqual(320);
      };
      const checkActions = async (p: Page, selectors: string[], label: string) => {
        for (const selector of selectors) {
          await expect.poll(() => p.locator(selector).evaluate(el => el.getBoundingClientRect().height),
            { message: `${label}: ${selector} target height after opening animation` }).toBeGreaterThanOrEqual(44);
        }
      };
      await checkMobile(volunteer, 'Home hours');
      await checkActions(volunteer, [`[data-testid="button-confirm-hours-${firstKey}"]`,
        `[data-testid="button-different-hours-${secondKey}"]`], 'Home hours');
      await volunteer.getByTestId(`button-confirm-hours-${firstKey}`).click();
      await expect(volunteer.getByTestId(`text-hours-logged-${firstKey}`)).toContainText('2 hours');
      await volunteer.getByTestId(`card-log-hours`).screenshot({ path: '/tmp/fix10-hours-home.png' });
      await checkReports(admin, base, volunteerMe.user.id, firstOccurrence.date, hoursAt, true);

      await admin.setViewportSize({ width: 320, height: 850 });
      await admin.goto(staffDetail);
      await expect(admin.getByTestId('card-hours')).toContainText('2 hours');
      await checkMobile(admin, 'Staff hours card');
      const initialStaffHours = await call(admin, `/admin/volunteers/${volunteerMe.user.id}/hours?at=${encodeURIComponent(hoursAt)}`);
      const initialShiftRow = initialStaffHours.rows.find((r: { date: string; shiftSlotId: string | null }) =>
        r.date === firstOccurrence.date && r.shiftSlotId === slot.id);
      expect(initialShiftRow, 'staff sees the first confirmed shift hours').toBeTruthy();
      await checkActions(admin, ['[data-testid="button-add-hours"]',
        `[data-testid="button-edit-hours-${initialShiftRow.id}"]`], 'Staff hours');

      // Use Different hours for the second unlogged shift, then Edit the confirmed
      // entry from My Shifts (the Home card only keeps its just-logged row briefly).
      await volunteer.getByTestId(`button-different-hours-${secondKey}`).click();
      await expect(volunteer.getByTestId(`input-hours-${secondKey}`)).toBeVisible();
      await checkMobile(volunteer, 'Home Different-hours form');
      await checkActions(volunteer, [`[data-testid="button-save-hours-${secondKey}"]`,
        `[data-testid="button-cancel-hours-${secondKey}"]`], 'Home Different-hours form');
      await volunteer.getByTestId(`input-hours-${secondKey}`).fill('1.5');
      await volunteer.getByTestId(`input-hours-note-${secondKey}`).fill('Different hours for this shift.');
      await volunteer.getByTestId(`button-save-hours-${secondKey}`).click();
      await expect(volunteer.getByTestId(`text-hours-logged-${secondKey}`)).toContainText('1.5 hours');

      await volunteer.goto(`${base}/shifts?at=${encodeURIComponent(hoursAt)}#past-shifts`);
      await expect(volunteer.getByTestId('section-past-shifts')).toBeVisible();
      await volunteer.getByTestId(`button-edit-hours-${firstKey}`).click();
      await expect(volunteer.getByTestId(`input-hours-${firstKey}`)).toBeVisible();
      await checkMobile(volunteer, 'My Shifts edit form');
      await checkActions(volunteer, [`[data-testid="button-save-hours-${firstKey}"]`,
        `[data-testid="button-cancel-hours-${firstKey}"]`], 'My Shifts edit form');
      await volunteer.getByTestId(`hours-row-${firstKey}`).screenshot({ path: '/tmp/fix10-hours-volunteer-edit.png' });
      await volunteer.getByTestId(`input-hours-${firstKey}`).fill('1.5');
      await volunteer.getByTestId(`input-hours-note-${firstKey}`).fill('Corrected shift length from My Shifts.');
      await volunteer.getByTestId(`button-save-hours-${firstKey}`).click();
      await expect(volunteer.getByTestId(`text-hours-${firstKey}`)).toContainText('1.5 hours logged');
      await volunteer.getByTestId(`button-edit-hours-${firstKey}`).click();
      await volunteer.getByTestId(`input-hours-${firstKey}`).fill('2.5');
      await volunteer.getByTestId(`button-save-hours-${firstKey}`).click();
      await expect(volunteer.getByTestId(`text-hours-${firstKey}`)).toContainText('2.5 hours logged');

      await admin.goto(staffDetail);
      await expect(admin.getByTestId('card-hours')).toContainText('2.5 hours');
      await admin.getByTestId('button-add-hours').click();
      await expect(admin.getByTestId('dialog-hours')).toBeVisible();
      const dateInput = admin.getByTestId('input-hours-date');
      await expect(dateInput).toHaveAttribute('max', secondDate);
      await dateInput.fill(secondDate);
      await admin.getByTestId('radio-hours-other').check();
      await expect(admin.getByTestId('input-hours-note')).toHaveAttribute('required', '');
      await admin.getByTestId('input-hours-value').fill('1');
      await admin.getByTestId('input-hours-note').fill('   ');
      await admin.getByTestId('button-hours-save').click();
      await expect(admin.getByTestId('error-hours')).toContainText('Add a note');
      await admin.getByTestId('dialog-hours').screenshot({ path: '/tmp/fix10-hours-admin-form.png' });
      await checkMobile(admin, 'Staff Other-time form');
      await checkActions(admin, ['[data-testid="button-hours-save"]', '[data-testid="button-hours-cancel"]'], 'Staff Other-time form');
      await admin.getByTestId('input-hours-note').fill('Volunteer appreciation call.');
      await admin.getByTestId('button-hours-save').click();
      await expect(admin.getByTestId('dialog-hours')).toHaveCount(0);
      let entries = await call(admin, `/admin/volunteers/${volunteerMe.user.id}/hours?at=${encodeURIComponent(hoursAt)}`);
      const other = entries.rows.find((r: { source: string; note: string | null }) => r.source === 'other' && r.note === 'Volunteer appreciation call.');
      expect(other, 'Other time was recorded by staff').toBeTruthy();
      await admin.getByTestId(`button-edit-hours-${other.id}`).click();
      await admin.getByTestId('input-hours-value').fill('1.5');
      await admin.getByTestId('input-hours-note').fill('Updated appreciation call.');
      await admin.getByTestId('button-hours-save').click();
      await expect(admin.getByTestId(`hours-${other.id}`)).toContainText('1.5 hours');
      await expect(admin.getByTestId(`hours-${other.id}`)).toContainText('Updated appreciation call.');
      await admin.getByTestId('card-hours').screenshot({ path: '/tmp/fix10-hours-admin-card.png' });
      await admin.getByTestId(`button-delete-hours-${other.id}`).click();
      await expect(admin.getByTestId('dialog-delete-hours')).toBeVisible();
      await checkActions(admin, ['[data-testid="button-delete-hours-confirm"]', '[data-testid="button-delete-hours-cancel"]'], 'Delete confirmation');
      await admin.getByTestId('button-delete-hours-confirm').click();
      await expect(admin.getByTestId('dialog-delete-hours')).toHaveCount(0);
      await expect(admin.getByTestId(`hours-${other.id}`)).toHaveCount(0);
      await expect(admin.locator('[data-testid^="activity-"]').filter({ hasText: 'Hours removed (1.5 h' })).toHaveCount(1);
      console.log('PASS F12: removing staff Other time updates Recent activity without reloading.');
      console.log(`PASS: isolated Fix10 hours-only flow; Home confirm=2h, Home edit=1.5h+note, Different hours=1.5h+note, My Shifts edit=2.5h, staff Other-time validation/add/edit/delete, 320px overflow/action checks. Screenshots: /tmp/fix10-hours-home.png, /tmp/fix10-hours-volunteer-edit.png, /tmp/fix10-hours-admin-form.png, /tmp/fix10-hours-admin-card.png`);
      return;
    }
    if (!process.argv.includes('--quick-login-regression')) {
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
    if (!profileOnly) await accessibility(volunteer, 'onboarding');
    for (const [id, value] of [['input-dob', testProfileFields.dateOfBirth], ['input-address', testProfileFields.addressLine1],
      ['input-city', testProfileFields.city], ['input-zip', testProfileFields.zip],
      ['input-ec-name', testProfileFields.emergencyContactName], ['input-ec-relationship', testProfileFields.emergencyContactRelationship],
      ['input-ec-phone', testProfileFields.emergencyContactPhone]])
      await volunteer.getByTestId(id!).fill(value!);
    await volunteer.getByTestId('select-state').selectOption('CA');
    await volunteer.getByTestId('button-finish').click();
    await expect(volunteer).toHaveURL(/dashboard/);
    expect((await new AxeBuilder({ page: volunteer }).withRules(['color-contrast']).analyze()).violations, 'ACT-15 onboarding dashboard contrast').toEqual([]);
    if (!profileOnly) await accessibility(volunteer, 'dashboard');
    const me = await call(volunteer, '/me');
    const admin = await page(); await admin.goto(`${base}/signin`);
    await admin.getByLabel(/^email/i).fill(adminEmail); await admin.getByLabel(/^password$/i).fill(password);
    await admin.getByRole('button', { name: /^sign in$/i }).click(); await expect(admin).toHaveURL(/\/admin$/);
    if (!profileOnly) await accessibility(admin, 'admin-home');
    const detail = await call(admin, `/admin/volunteers/${me.user.id}`);
    expect(detail.entry.profile.status).toBe('active');
    await admin.goto(`${base}/admin/volunteers/${me.user.id}`);
    await expect(admin.getByTestId('card-background-check')).toBeVisible();
    await admin.getByTestId('checkbox-background-complete').check();
    await admin.getByTestId('input-background-date').fill(new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' }));
    await admin.getByTestId('button-save-tracking').click();
    await expect(admin.getByText('Saved.', { exact: true })).toBeVisible();
    if (profileOnly) await admin.getByTestId('card-background-check').screenshot({ path: '/tmp/fix8-background-card.png' });
    await admin.goto(`${base}/admin/volunteers`);
    await admin.getByTestId('toggle-test-accounts').check();
    await admin.getByTestId('filter-background-check').selectOption('cleared');
    await admin.getByTestId('input-search').fill(email);
    await expect(admin.getByTestId(`link-volunteer-${me.user.id}`).filter({ visible: true }).first()).toBeVisible();
    await volunteer.goto(`${base}/dashboard`);
    await expect(volunteer.getByTestId('card-choose-shift')).toBeVisible();
    expect((await new AxeBuilder({ page: volunteer }).withRules(['color-contrast']).analyze()).violations, 'ACT-15 active/no-shift dashboard contrast').toEqual([]);
    if (profileOnly) {
      await volunteer.getByTestId('card-choose-shift').screenshot({ path: '/tmp/fix8-choose-shift-card.png' });
      console.log('Fix 8 profile flow passed: automatically Active, staff background date saved, filtered roster match, Choose your weekly shift card.');
      return;
    }
    const settings = await call(admin, '/admin/schedule/slots', 'POST', { dayOfWeek: 2, startTime: '10:00', endTime: '12:00', capacity: 1, label: 'Isolated smoke shift', isActive: true });
    const slot = settings.slots.find((s: { label: string }) => s.label === 'Isolated smoke shift');
    await volunteer.goto(`${base}/shifts`);
    await volunteer.getByTestId('button-shift-day-2').click();
    await volunteer.getByTestId(`slot-${slot.id}`).click(); await volunteer.getByTestId('button-confirm-shift').click();
    await expect(volunteer.getByText(/on the schedule|your shift/i).first()).toBeVisible();
    const schedule = await call(volunteer, '/volunteer/schedule');
    expect(schedule.assignments).toHaveLength(1);
    const assignment = schedule.assignments[0];
    // F10: after this isolated Tuesday 10–12 occurrence, confirm the actual hours on Home.
    const hoursAt = new Date(new Date(assignment.nextDates[0].endsAt).getTime() + 60_000).toISOString();
    await volunteer.goto(`${base}/dashboard?at=${encodeURIComponent(hoursAt)}`);
    await volunteer.getByTestId(`button-confirm-hours-${assignment.nextDates[0].date}-${slot.id}`).click();
    await expect(volunteer.getByTestId('text-hours-this-month')).toContainText('2');
    await admin.goto(`${base}/admin/volunteers/${me.user.id}?at=${encodeURIComponent(hoursAt)}`);
    await expect(admin.getByTestId('card-hours')).toContainText('2 hours');
    const loggedHours = await pool.query(`SELECT hours FROM ${qschema}.volunteer_hours WHERE volunteer_profile_id=$1 AND shift_slot_id=$2 AND shift_date=$3`,
      [me.profile.id, slot.id, assignment.nextDates[0].date]);
    expect(Number(loggedHours.rows[0]?.hours)).toBe(2);
    await checkReports(admin, base, me.user.id, assignment.nextDates[0].date, hoursAt, me.user.isTestAccount);
    await volunteer.goto(`${base}/dashboard`);
    await expect(volunteer.getByTestId('card-next-shift')).toBeVisible();
    expect((await new AxeBuilder({ page: volunteer }).withRules(['color-contrast']).analyze()).violations, 'ACT-15 active/shift dashboard contrast').toEqual([]);
    await volunteer.goto(`${base}/shifts`);
    const start = new Date(assignment.nextDates[0].startsAt);
    const date = assignment.nextDates[0].date;
    await call(admin, '/admin/schedule/blocks', 'POST', { fromDate: date, toDate: date,
      slotIds: [slot.id], reason: 'Isolated staff meeting', emailVolunteers: true });
    const blockEmail = await pool.query(`SELECT status FROM ${qschema}.notification_log WHERE recipient_user_id=$1 AND related_id LIKE 'block:%'`, [me.user.id]);
    expect(blockEmail.rows.some(r => r.status === 'logged')).toBe(true);
    await call(admin, `/admin/notifications/jobs/run?at=${encodeURIComponent(new Date(start.getTime() - 24 * 3600000).toISOString())}`, 'POST', {});
    const blockedReminder = await pool.query(`SELECT id FROM ${qschema}.notification_log WHERE recipient_user_id=$1 AND type='reminder'`, [me.user.id]);
    expect(blockedReminder.rows).toHaveLength(0);
    const extras = await call(admin, '/admin/schedule/custom-shifts', 'POST', {
      date, startTime: '13:00', endTime: '15:00', capacity: 1, label: 'Isolated one-time shift', openToVolunteers: true });
    const custom = extras.customShifts.find((s: { label: string }) => s.label === 'Isolated one-time shift');
    await volunteer.reload();
    await volunteer.getByTestId(`button-claim-custom-${custom.id}`).click();
    const oneTime = await call(volunteer, '/volunteer/schedule');
    const held = oneTime.customShifts.filter((s: {ownAssignmentId: string | null}) => s.ownAssignmentId);
    expect(held).toHaveLength(1);
    // Both fixed Tuesday slots are on the same Pacific day, three hours apart.
    const customStart = new Date(start.getTime() + 3 * 3600000);
    await call(admin, `/admin/notifications/jobs/run?at=${encodeURIComponent(new Date(customStart.getTime() - 24 * 3600000).toISOString())}`, 'POST', {});
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
    }
    const switcher = await page();
    await switcher.goto(`${base}/signin`);
    await switcher.getByTestId('button-quick-vol-active').click();
    await expect(switcher).toHaveURL(/\/dashboard$/);
    for (const [persona, landing] of [['admin','admin'],['vol-active','dashboard'],['admin','admin']] as const) {
      await switcher.getByTestId('button-switch-account').click();
      await switcher.getByTestId(`button-switch-${persona}`).click();
      await expect(switcher).toHaveURL(new RegExp(`/${landing}$`));
      await expect(switcher.getByTestId('button-switch-account')).toBeVisible();
      await expect(switcher.getByText('Taking you to the right place')).toHaveCount(0);
    }
    await switcher.getByTestId('button-switch-account').click();
    await switcher.getByTestId('button-switch-vol-onboarding-new').click();
    await expect(switcher).toHaveURL(/\/onboarding$/);
    for (const path of ['/shifts','/dashboard','/messages','/resources','/profile']) {
      await switcher.goto(`${base}${path}`);
      await expect(switcher).toHaveURL(/\/onboarding$/);
    }
    console.log(process.argv.includes('--quick-login-regression')
      ? 'PASS: ONBN-02 incomplete-page guards and ADM-35 cross-role switching.'
      : 'PASS: full smoke, ONBN-02, ADM-35 cross-role switching, ACT-15 axe contrast in three dashboard states.');
  } finally {
    closingBrowser = true;
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
