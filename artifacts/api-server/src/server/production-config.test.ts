import { describe, it, expect } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assertProductionConfig, requiredProductionKeys } from './production-config';
import { createReadinessCheck } from './readiness';

const valid = {
  NODE_ENV: 'production', SESSION_SECRET: 's'.repeat(32), JOBS_SECRET: 'j'.repeat(32),
  APP_BASE_URL: 'https://portal.example.invalid', POSTMARK_SERVER_TOKEN: 'synthetic-provider',
  EMAIL_FROM: 'Test Team <test@example.invalid>', RUN_JOBS: 'true', DATABASE_URL: 'synthetic-private-database',
};
describe('production configuration and readiness', () => {
  it('lists every missing required key without values; leaves development alone', () => {
    for (const key of [...requiredProductionKeys, 'DATABASE_URL']) {
      expect(() => assertProductionConfig({ ...valid, [key]: '' })).toThrow(key);
    }
    expect(() => assertProductionConfig({ NODE_ENV: 'development' })).not.toThrow();
    expect(() => assertProductionConfig(valid)).not.toThrow();
    expect(() => assertProductionConfig({ ...valid, RUN_JOBS: 'false' })).not.toThrow();
  });
  it('rejects weak secrets, bad flags/senders/URLs and origin mismatch', () => {
    for (const patch of [{ SESSION_SECRET: 'short' }, { JOBS_SECRET: 'short' }, { RUN_JOBS: '1' },
      { EMAIL_FROM: 'bad' }, { APP_BASE_URL: 'http://portal.example.invalid' },
      { APP_BASE_URL: 'https://portal.example.invalid/path' }, { APP_ORIGIN: 'https://other.example.invalid' }]) {
      expect(() => assertProductionConfig({ ...valid, ...patch })).toThrow('Production startup refused');
    }
    try { assertProductionConfig({ ...valid, RUN_JOBS: 'private-bad-value' }); }
    catch (err) { expect(String(err)).not.toContain('private-bad-value'); }
  });
  it('returns status only; coalesces concurrent readiness checks', async () => {
    let calls = 0;
    const check = createReadinessCheck(async () => { calls++; }, () => true);
    expect(await Promise.all([check(), check()])).toEqual([
      { status: 'ok', db: 'ok', email: { configured: true } }, { status: 'ok', db: 'ok', email: { configured: true } },
    ]);
    await check(); expect(calls).toBe(1);
    const failed = createReadinessCheck(async () => { throw new Error('private-connection-string'); }, () => false);
    const result = await failed();
    expect(result).toEqual({ status: 'degraded', db: 'unavailable', email: { configured: false } });
    expect(JSON.stringify(result)).not.toContain('private');
  });
  it('bounds database readiness wait', async () => {
    const check = createReadinessCheck(() => new Promise(() => {}), () => true, 5);
    expect((await check()).db).toBe('unavailable');
  });
  it('deploy launcher validates then starts the API; no schema writes or history guard', () => {
    const source = readFileSync(new URL('../../../../scripts/production-start.sh', import.meta.url), 'utf8');
    expect(source).toContain('dist/preflight.mjs');
    expect(source).toContain('exec node --enable-source-maps');
    expect(source.indexOf('dist/preflight.mjs')).toBeLessThan(source.indexOf('dist/index.mjs'));
    expect(source).not.toMatch(/drizzle|migrat|push|seed/i);
    expect(existsSync(new URL('../../../../lib/db/scripts/migrate.mjs', import.meta.url))).toBe(false);
    const rootPackage = JSON.parse(readFileSync(new URL('../../../../package.json', import.meta.url), 'utf8'));
    const dbPackage = JSON.parse(readFileSync(new URL('../../../../lib/db/package.json', import.meta.url), 'utf8'));
    expect(rootPackage.scripts['db:migrate']).toBeUndefined();
    expect(dbPackage.scripts.migrate).toBeUndefined();
  });
  it.each([0, 9])('launcher honors configuration preflight exit %i without contacting a database', (preflightExit) => {
    const directory = mkdtempSync(join(tmpdir(), 'alliance-launcher-'));
    const trace = join(directory, 'trace');
    try {
      // A fake Node executable records launch order; no API, jobs or database run.
      writeFileSync(join(directory, 'node'), `#!/bin/sh
printf '%s\\n' "$*" >> "$LAUNCH_TRACE"
case "$*" in
  *dist/preflight.mjs*) exit "$PREFLIGHT_EXIT" ;;
esac
`, { mode: 0o700 });
      const result = spawnSync('/bin/sh', [
        fileURLToPath(new URL('../../../../scripts/production-start.sh', import.meta.url)),
      ], {
        env: { PATH: directory, NODE_ENV: 'production', LAUNCH_TRACE: trace, PREFLIGHT_EXIT: String(preflightExit) },
        encoding: 'utf8',
      });
      expect(result.status).toBe(preflightExit);
      expect(readFileSync(trace, 'utf8').trim().split('\n')).toEqual(preflightExit === 0
        ? ['artifacts/api-server/dist/preflight.mjs', '--enable-source-maps artifacts/api-server/dist/index.mjs']
        : ['artifacts/api-server/dist/preflight.mjs']);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
