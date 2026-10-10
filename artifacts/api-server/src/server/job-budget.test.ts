import { describe, expect, it, vi } from 'vitest';
import { automaticJobsEnabled, currentJobBudget, JobBudget, withJobBudget } from './job-budget';
import { createScheduledCheck } from './scheduled-check';
import { isUncertainDelivery, providerRejected } from './delivery-state';
import { createEmailService } from '../email';
import { createServer } from 'node:net';
import { pool, withJobDatabase } from '@workspace/db';
vi.hoisted(() => {
  process.env.NODE_ENV = 'development';
  process.env.APP_ORIGIN = 'https://budget-fixture.example.invalid';
});

describe('bounded external scheduling', () => {
  it('allows a cold database handshake longer than 500ms while retaining bounded waits', async () => {
    const options = await withJobDatabase(async () => {
      const selected = pool as typeof pool & { options: {
        connectionTimeoutMillis?: number; statement_timeout?: number; query_timeout?: number;
      } };
      return { connectionTimeoutMillis: selected.options.connectionTimeoutMillis,
        statement_timeout: selected.options.statement_timeout, query_timeout: selected.options.query_timeout };
    });
    expect(options).toEqual({ connectionTimeoutMillis: 5000, statement_timeout: 500, query_timeout: 650 });
    // A local protocol fixture exercises pg's actual connection timeout without
    // connecting to production, changing data, or sending any email.
    const server = createServer(socket => {
      socket.once('data', () => {
        const timer = setTimeout(() => {
          if (!socket.destroyed) socket.write(Buffer.from([
            82, 0, 0, 0, 8, 0, 0, 0, 0, // AuthenticationOk
            90, 0, 0, 0, 5, 73, // ReadyForQuery (idle)
          ]));
        }, 750);
        socket.once('close', () => clearTimeout(timer));
      });
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    // Reuse the installed driver's class; the API package does not depend on pg directly.
    const FixturePool = Object.getPrototypeOf(pool).constructor as new (options: Record<string, unknown>) => typeof pool;
    const fixture = new FixturePool({ ...options, host: '127.0.0.1', port,
      user: 'fixture', database: 'fixture', ssl: false });
    const budget = new JobBudget();
    try {
      const client = await fixture.connect();
      client.release();
      expect(budget.elapsedMs).toBeGreaterThanOrEqual(700);
      expect(budget.canStart()).toBe(true);
    } finally {
      await fixture.end();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });
  it('uses a shared twenty-second budget and defers before starting an unsafe batch', async () => {
    let elapsed = 0;
    const budget = new JobBudget(() => elapsed);
    const digest = vi.fn(async () => { expect(currentJobBudget()).toBe(budget); elapsed = 8000; });
    const reminders = vi.fn(async () => {
      expect(currentJobBudget()).toBe(budget);
      expect(budget.canStart()).toBe(false);
      return { skippedRun: true, run: null };
    });
    const monthly = vi.fn(async () => { expect(currentJobBudget()).toBe(budget); });
    const result = await createScheduledCheck({ digest, reminders, monthly })(budget);
    expect(result).toMatchObject({ budgetMs: 20000, elapsedMs: 8000, incomplete: true });
    expect(digest).toHaveBeenCalledTimes(1);
    expect(reminders).toHaveBeenCalledTimes(1);
    expect(currentJobBudget()).toBeUndefined();
  });
  it('settles started work before responding, with no asynchronous continuation', async () => {
    const order: string[] = [];
    await createScheduledCheck({
      digest: async () => { await Promise.resolve(); order.push('digest'); },
      reminders: async () => { await Promise.resolve(); order.push('reminders'); return { skippedRun: false, run: null }; },
      monthly: async () => { await Promise.resolve(); order.push('monthly'); },
    })();
    order.push('response');
    expect(order).toEqual(['digest', 'reminders', 'monthly', 'response']);
  });
  it('does not even connect or create a notification row for budget-deferred mail', async () => {
    let elapsed = 0;
    const budget = new JobBudget(() => elapsed);
    elapsed = 15000;
    const connect = vi.fn();
    const send = createEmailService({ connect });
    const result = await withJobBudget(() => send({
      type: 'reminder', to: 'fixture@example.invalid', subject: 'Fixture', html: '<p>Fixture</p>', text: 'Fixture',
    }), budget);
    expect(result).toMatchObject({ ok: false, deferred: true });
    expect(connect).not.toHaveBeenCalled();
  });
  it('disables production timers even if RUN_JOBS accidentally remains true', () => {
    expect(automaticJobsEnabled({ NODE_ENV: 'production', RUN_JOBS: 'true' })).toBe(false);
    expect(automaticJobsEnabled({ NODE_ENV: 'development', RUN_JOBS: 'false' })).toBe(false);
    expect(automaticJobsEnabled({ NODE_ENV: 'development', RUN_JOBS: 'true' })).toBe(true);
  });
  it('distinguishes explicit provider rejection from delivery uncertainty, including old audit markers', () => {
    expect(providerRejected({ statusCode: 422 })).toBe(true);
    expect(providerRejected({ statusCode: 429 })).toBe(true);
    expect(providerRejected({ statusCode: 408 })).toBe(false);
    expect(providerRejected(new Error('Socket hang up'))).toBe(false);
    expect(isUncertainDelivery('DELIVERY_UNCERTAIN: timeout')).toBe(true);
    expect(isUncertainDelivery('Delivery started but has not been confirmed.')).toBe(true);
    expect(isUncertainDelivery('Postmark accepted this email (id), but the notification log could not be finalized.')).toBe(true);
    expect(isUncertainDelivery('Request timed out')).toBe(true);
    expect(isUncertainDelivery('socket hang up')).toBe(true);
    expect(isUncertainDelivery('Recipient rejected')).toBe(false);
  });
});
