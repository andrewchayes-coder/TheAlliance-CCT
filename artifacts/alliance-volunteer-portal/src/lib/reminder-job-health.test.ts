import { describe, expect, it } from 'vitest';
import type { ReminderJobRun } from '@workspace/api-client-react';
import { reminderJobHealth } from './reminder-job-health';

const now = Date.parse('2026-10-12T17:00:00Z');
function run(minutes: number, status: ReminderJobRun['status'] = 'completed', error: string | null = null): ReminderJobRun {
  const at = new Date(now - minutes * 60000).toISOString();
  return { id: 'scheduled', source: 'external', status, error, startedAt: at, checkedAt: at, finishedAt: status === 'running' ? null : at,
    counts: { eligible: 0, sent: 0, logged: 0, failed: 0, skipped: 0, suppressed: 0 } };
}
const health = (lastScheduledRun: ReminderJobRun | null, triggerMode = 'external' as 'external' | 'none') =>
  reminderJobHealth({ triggerMode, lastScheduledRun, staleAfterMinutes: 20 }, now);

describe('Reminder job health notice', () => {
  it('shows on-time runs in Pacific time', () => {
    expect(health(run(5))).toEqual({ kind: 'success', message: 'Scheduled runs are on time. Last one at Oct 12, 2026, 9:55 AM.' });
  });
  it('warns in red at 21 minutes, even for a stuck running row', () => {
    expect(health(run(21)).kind).toBe('error');
    expect(health(run(21)).message).toContain('No scheduled run in the last 20 minutes');
    expect(health(run(21, 'running')).kind).toBe('error');
  });
  it('keeps a currently running check within the window healthy', () => {
    expect(health(run(19, 'running')).kind).toBe('success');
  });
  it('reports failure before staleness and includes the error', () => {
    expect(health(run(21, 'failed', 'Database unavailable'))).toMatchObject({ kind: 'error' });
    expect(health(run(21, 'failed', 'Database unavailable')).message).toContain("Database unavailable Check the job's history in cron-job.org.");
  });
  it('warns when neither scheduler is configured', () => {
    expect(health(run(5), 'none')).toEqual({ kind: 'info', message: "Reminders aren't scheduled. They only go out when someone clicks Run reminder check now." });
  });
  it('warns when no scheduled run has ever been recorded', () => {
    expect(health(null)).toEqual({ kind: 'info', message: 'No scheduled run has been recorded yet.' });
  });
  it('re-evaluates unchanged data against the current time', () => {
    const data = { triggerMode: 'external' as const, lastScheduledRun: run(19), staleAfterMinutes: 20 };
    expect(reminderJobHealth(data, now).kind).toBe('success');
    expect(reminderJobHealth(data, now + 2 * 60000).kind).toBe('error');
  });
});
