import { describe, expect, it, vi } from 'vitest';
import { automaticJobsEnabled, currentJobBudget, JobBudget, withJobBudget } from './job-budget';
import { createScheduledCheck } from './scheduled-check';
import { isUncertainDelivery, providerRejected } from './delivery-state';
import { createEmailService } from '../email';
vi.hoisted(() => {
  process.env.NODE_ENV = 'development';
  process.env.APP_ORIGIN = 'https://budget-fixture.example.invalid';
});

describe('bounded external scheduling', () => {
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
