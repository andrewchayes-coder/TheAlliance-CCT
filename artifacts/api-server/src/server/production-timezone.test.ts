import { describe, expect, it } from 'vitest';
import { developmentClock } from './development-clock';
import { pacificDay } from './scheduleService';
import { readFileSync } from 'node:fs';
process.env.NODE_ENV = 'development';
process.env.APP_ORIGIN ||= 'https://qa.example.invalid';
const { declaredGuard } = await import('../auth/access-policy');

describe('production exclusions and Pacific DST boundaries', () => {
  it('refuses development clocks and dev email but permits admin-only test-send APIs in production', () => {
    const old = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'production';
      expect(() => developmentClock('2026-10-08T16:00:00Z')).toThrow(/development-only/);
      expect(declaredGuard('POST', '/dev/email-test')).toBeUndefined();
      for (const path of ['/admin/notifications/test', '/admin/notifications/jobs/test'])
        expect(declaredGuard('POST', path)).toBe('admin');
      expect(declaredGuard('POST', '/admin/notifications/jobs/run')).toBe('admin');
      const viteSource = readFileSync('../alliance-volunteer-portal/src/App.tsx', 'utf8');
      expect(viteSource).toMatch(/import\.meta\.env\.DEV/);
      const seed = readFileSync('../../scripts/src/seed.ts', 'utf8');
      expect(seed.indexOf("process.env.NODE_ENV !== 'development'")).toBeLessThan(seed.indexOf("await import('@workspace/db')"));
      expect(seed).toContain("process.env.SEED_DATABASE_ENVIRONMENT !== 'development'");
    } finally { if (old === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = old; }
  });
  it('Pacific calendar dates differ from UTC near midnight and across both DST transitions', () => {
    expect(pacificDay(new Date('2026-03-08T07:59:00Z'))).toBe('2026-03-07');
    expect(pacificDay(new Date('2026-03-08T08:00:00Z'))).toBe('2026-03-08');
    expect(pacificDay(new Date('2026-11-01T06:59:00Z'))).toBe('2026-10-31');
    expect(pacificDay(new Date('2026-11-01T07:00:00Z'))).toBe('2026-11-01');
    const time = (iso: string) => new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Los_Angeles', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).format(new Date(iso));
    expect(time('2026-03-08T09:59:00Z')).toBe('01:59');
    expect(time('2026-03-08T10:00:00Z')).toBe('03:00');
    expect(time('2026-11-01T08:59:00Z')).toBe('01:59');
    expect(time('2026-11-01T09:00:00Z')).toBe('01:00');
  });
});
