import { withJobDatabase } from '@workspace/db';
import { runReminderCheck } from './jobs';
import { runDailyDigest } from './coverageAlerts';
import { checkMonthlyEmailLimit } from './monthly-email-limit';
import { JobBudget, withJobBudget } from './job-budget';

/** Persist only existing audit/settings rows; no queue and no detached work. */
export function createScheduledCheck(overrides: Partial<{
  reminders: typeof runReminderCheck;
  digest: typeof runDailyDigest;
  monthly: typeof checkMonthlyEmailLimit;
}> = {}) {
  const deps = { reminders: runReminderCheck, digest: runDailyDigest, monthly: checkMonthlyEmailLimit, ...overrides };
  return async (budget = new JobBudget()) => withJobDatabase(() => withJobBudget(async () => {
    const now = new Date();
    // Complete the small daily admin digest first; confirmed recipient keys
    // ensure subsequent requests can devote their budget to reminders.
    await deps.digest(now);
    const result = await deps.reminders({ at: now, source: 'external' });
    await deps.monthly(now);
    return { ...result, elapsedMs: budget.elapsedMs, budgetMs: budget.limitMs,
      incomplete: budget.deferred || budget.retryNeeded || (result.run?.counts.deferred ?? 0) > 0 || (result.run?.counts.failed ?? 0) > 0 };
  }, budget));
}
export const runScheduledCheck = createScheduledCheck();
