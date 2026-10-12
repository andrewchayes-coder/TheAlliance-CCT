import type { ReminderJobStatus } from '@workspace/api-client-react';

export const jobTime = (iso: string) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString('en-US', {
    timeZone: 'America/Los_Angeles', dateStyle: 'medium', timeStyle: 'short',
  });
};

export function reminderJobHealth(
  status: Pick<ReminderJobStatus, 'triggerMode' | 'lastScheduledRun' | 'staleAfterMinutes'>,
  now = Date.now(),
): { kind: 'info' | 'error' | 'success'; message: string } {
  if (status.triggerMode === 'none') return { kind: 'info', message: "Reminders aren't scheduled. They only go out when someone clicks Run reminder check now." };
  const run = status.lastScheduledRun;
  if (!run) return { kind: 'info', message: 'No scheduled run has been recorded yet.' };
  const time = jobTime(run.startedAt);
  if (run.status === 'failed') return { kind: 'error', message: `The last scheduled run failed at ${time}.${run.error ? ` ${run.error}` : ''} Check the job's history in cron-job.org.` };
  if (now - new Date(run.startedAt).getTime() > status.staleAfterMinutes * 60000) return {
    kind: 'error', message: `No scheduled run in the last ${status.staleAfterMinutes} minutes (the last one was at ${time}). Reminders may not be going out. Check the job in cron-job.org.`,
  };
  return { kind: 'success', message: `Scheduled runs are on time. Last one at ${time}.` };
}
