import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { assertProductionConfig, requiredProductionKeys } from './production-config';
import { createReadinessCheck } from './readiness';

const valid = {
  NODE_ENV: 'production', SESSION_SECRET: 's'.repeat(32), JOBS_SECRET: 'j'.repeat(32),
  APP_BASE_URL: 'https://portal.example.invalid', POSTMARK_SERVER_TOKEN: 'synthetic-provider',
  EMAIL_FROM: 'test@example.invalid', RUN_JOBS: 'true', DATABASE_URL: 'synthetic-private-database',
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
  it('deploy launcher validates before migrate; never pushes or seeds', () => {
    const source = readFileSync(new URL('../../../../scripts/production-start.sh', import.meta.url), 'utf8');
    expect(source.indexOf('dist/preflight.mjs')).toBeLessThan(source.indexOf('run migrate'));
    expect(source.indexOf('run migrate')).toBeLessThan(source.indexOf('dist/index.mjs'));
    expect(source).not.toMatch(/run (push|seed)/);
  });
});
