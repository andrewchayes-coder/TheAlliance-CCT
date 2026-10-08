import { describe, expect, it, vi } from 'vitest';
import { createMonthlyLimitChecker, emailSettings, monthRange } from './monthly-email-limit';
import { pool } from '@workspace/db';
const connectClient = async () => pool.connect();
type PoolClient = Awaited<ReturnType<typeof connectClient>>;
vi.mock('../auth/session', () => ({ appOrigin: 'https://portal.example.invalid' }));

function fixture() {
  let month: string | null = null;
  let count = 79;
  let busy = false;
  const recipients = [{ id: 'admin-a', email: 'quota-a@example.invalid', firstName: 'A' },
    { id: 'admin-b', email: 'quota-b@example.invalid', firstName: 'B' }];
  const sent = new Set<string>();
  let failB = false;
  const send = vi.fn(async (options: { to: string; relatedId?: string }) => {
    const key = `${options.to}:${options.relatedId}`;
    if (sent.has(key)) return { ok: true, skipped: true as const };
    if (failB && options.to === recipients[1]!.email) return { ok: false, error: 'temporary failure' };
    sent.add(key); return { ok: true };
  });
  const release = vi.fn();
  const checker = createMonthlyLimitChecker({
    connect: async () => ({ query: async () => ({ rows: [{ locked: !busy }] }), release } as unknown as PoolClient),
    settings: async () => ({ postmarkMonthlyLimit: 100, lastMonthlyAlertMonth: month } as Awaited<ReturnType<typeof emailSettings>>),
    count: async () => count, admins: async () => recipients, send,
    acknowledge: async value => { month = value; return {} as never; },
  });
  return { checker, send, sent, release, setCount: (n: number) => { count = n; }, busy: () => { busy = true; },
    fail: (value: boolean) => { failB = value; } };
}
describe('Pacific monthly quota', () => {
  it('uses local calendar boundaries across DST and year boundaries', () => {
    expect(monthRange(new Date('2027-01-01T07:59:59Z')).month).toBe('2026-12');
    expect(monthRange(new Date('2027-01-01T08:00:00Z')).month).toBe('2027-01');
    const march = monthRange(new Date('2026-03-15T12:00Z'));
    expect(march.from.toISOString()).toBe('2026-03-01T08:00:00.000Z');
    expect(march.to.toISOString()).toBe('2026-04-01T07:00:00.000Z');
    expect((march.to.getTime() - march.from.getTime()) / 3600000).toBe(743);
    const nov = monthRange(new Date('2026-11-15T12:00Z'));
    expect((nov.to.getTime() - nov.from.getTime()) / 3600000).toBe(721);
    expect(monthRange(new Date('2027-01-15T12:00Z'), -5).month).toBe('2026-08');
  });
  it('does not alert below 80%, alerts all recipients once, and resets next month', async () => {
    const f = fixture(); const now = new Date('2026-10-08T12:00Z');
    await f.checker(now); expect(f.send).not.toHaveBeenCalled();
    f.setCount(80); await f.checker(now);
    expect(f.send).toHaveBeenCalledTimes(2);
    expect(f.send.mock.calls[0]![0]).toMatchObject({ relatedId: 'monthly-limit:2026-10', subject: 'Heads up: the volunteer app has sent 80 of 100 emails this month' });
    f.setCount(96); await f.checker(now); expect(f.send).toHaveBeenCalledTimes(2);
    await f.checker(new Date('2026-11-08T12:00Z')); expect(f.send).toHaveBeenCalledTimes(4);
  });
  it('recovers partial alerts without repeating confirmed recipients', async () => {
    const f = fixture(); f.setCount(80); f.fail(true);
    await f.checker(new Date('2026-10-08T12:00Z')); expect(f.sent.size).toBe(1);
    f.fail(false); await f.checker(new Date('2026-10-08T12:00Z')); expect(f.sent.size).toBe(2);
    const calls = f.send.mock.calls.length;
    await f.checker(new Date('2026-10-08T12:00Z')); expect(f.send.mock.calls.length).toBe(calls);
  });
  it('skips overlapping workers and releases its connection', async () => {
    const f = fixture(); f.setCount(80); f.busy();
    await f.checker(); expect(f.send).not.toHaveBeenCalled(); expect(f.release).toHaveBeenCalledOnce();
  });
});
