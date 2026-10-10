import { AsyncLocalStorage } from 'node:async_hooks';

export const JOB_BUDGET_MS = 20_000;
// Reserve time for eligibility checks, audit writes, and settled delivery.
// No provider call is abandoned with Promise.race or continued after a response.
export const DELIVERY_RESERVE_MS = 15_000;
export class JobBudget {
  private readonly started: number;
  deferred = false;
  retryNeeded = false;
  constructor(private readonly clock = () => performance.now(), readonly limitMs = JOB_BUDGET_MS) {
    this.started = clock();
  }
  get elapsedMs() { return Math.ceil(this.clock() - this.started); }
  get remainingMs() { return Math.max(0, this.limitMs - this.elapsedMs); }
  canStart(reserveMs = DELIVERY_RESERVE_MS) {
    if (this.remainingMs >= reserveMs) return true;
    this.deferred = true;
    return false;
  }
}
const scope = new AsyncLocalStorage<JobBudget>();
export const currentJobBudget = () => scope.getStore();
export const automaticJobsEnabled = (env: NodeJS.ProcessEnv = process.env) =>
  env.NODE_ENV !== 'production' && env.RUN_JOBS === 'true';
export function withJobBudget<T>(work: () => Promise<T>, budget = new JobBudget()) {
  return scope.run(budget, work);
}
