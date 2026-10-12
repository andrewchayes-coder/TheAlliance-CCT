import { SOMETHING_WENT_WRONG } from '@/lib/contact';
import { PageHeader } from '@/components/page-header';
import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetReminderJobStatus, getGetReminderJobStatusQueryKey, useRunAdminReminderCheck, useSendAdminTestReminder,
  type ReminderCheckResult, type ReminderJobRun, type ReminderRunCounts, type TestReminderResult,
} from '@workspace/api-client-react';
import { AppLayout, Button, Card, StatusBadge } from '@/components/brand-system';
import { Notice } from '@/auth/auth-ui';
import { RequireAdmin } from '@/auth/guards';
import { FETCH_CREDS, readError, useAuth } from '@/auth/auth-context';
import { Skeleton } from '@/components/ui/skeleton';
import { jobTime as when, reminderJobHealth } from '@/lib/reminder-job-health';

const hour = (h: number) => `${h % 12 === 0 ? 12 : h % 12}:00 ${h < 12 ? 'AM' : 'PM'}`;
const loggedNote = 'Logged means the email was recorded but not delivered (no email service connected, as in development). In production, reminders should show as Sent.';
const countLabels = { eligible: 'Due', sent: 'Sent', logged: 'Logged (not delivered)', failed: 'Failed',
  skipped: 'Skipped', suppressed: 'Test accounts (not sent)', deferred: 'Carried to next run', uncertain: 'Unconfirmed' };
const sourceLabels: Record<string, string> = { external: 'Scheduled (cron-job.org)', cron: 'Scheduled (built-in timer)',
  admin: 'Manual (Run reminder check now)', command: 'Manual (command line)' };
const schedulerLabels = { external: 'cron-job.org (outside service), every 15 minutes', builtin: 'Built-in timer, every 15 minutes',
  both: 'Two schedulers are on. Turn the built-in timer off in production (RUN_JOBS=false).', none: 'Not scheduled' };

function Stat({ label, value, id }: { label: string; value: string | number; id: string }) {
  return <div className="min-w-0 rounded-lg bg-gray px-3 py-2"><dt className="text-xs font-bold">{label}</dt><dd className="mt-1 break-words text-lg font-bold tabular-nums" data-testid={id}>{value}</dd></div>;
}

function Counts({ c, prefix }: { c: ReminderRunCounts; prefix: string }) {
  return (
    <>
      <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {(['eligible', 'sent', 'logged', 'failed', 'skipped', 'suppressed', 'deferred', 'uncertain'] as const).map(k => <Stat key={k} id={`${prefix}-${k}`} label={countLabels[k]} value={c[k] ?? 0} />)}
      </dl>
      <p className="mt-3 text-sm text-navy-soft">Carried to next run: there wasn't time in this run; the next run picks them up. Nobody gets the same reminder twice.</p>
    </>
  );
}

function RunSummary({ r }: { r: ReminderCheckResult }) {
  if (r.skippedRun || !r.run) return <Notice kind="info">Skipped: another reminder check is already running. Nothing was started by this click. Check back shortly.</Notice>;
  return <div data-testid="result-run"><Notice kind={r.run.status === 'failed' ? 'error' : 'success'}>Check {r.run.status === 'running' ? 'is still running' : r.run.status}.{r.run.counts.logged > 0 ? ` ${loggedNote}` : ''}{r.run.error ? ` Error: ${r.run.error}` : ''}</Notice><Counts c={r.run.counts} prefix="result" /></div>;
}

function TestSummary({ r }: { r: TestReminderResult }) {
  const label = r.status === 'sent' ? 'Sent to your signed-in admin email.' : r.status === 'logged' ? 'Logged only (development copy). It was not delivered to an inbox.' : r.status === 'suppressed' ? 'Not sent: emails to test accounts are suppressed.' : 'Failed to send.';
  return (
    <div data-testid="result-test">
      <Notice kind={r.ok && r.status !== 'failed' ? 'success' : 'error'}>
        {r.skipped ? 'Skipped. ' : ''}{label} This is an explicit test message, not an actual assigned shift.{r.error ? ` ${r.error}` : ''}
      </Notice>
    </div>
  );
}

function RunCard({ run }: { run: ReminderJobRun }) {
  const tone = run.status === 'completed' ? 'good' : run.status === 'failed' ? 'blocked' : 'attention';
  return (
    <div data-testid="card-last-run">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={tone}>{run.status}</StatusBadge>
        <span className="text-sm">Source: <b data-testid="text-run-source">{sourceLabels[run.source] ?? run.source}</b></span>
      </div>
      <p className="mt-2 text-sm" data-testid="text-run-times">
        Checked at {when(run.checkedAt)}. {run.finishedAt ? `Finished ${when(run.finishedAt)}.` : `Started ${when(run.startedAt)}, not finished.`}
      </p>
      {run.error && <p className="mt-2 break-words rounded-lg bg-[var(--alliance-red)] px-3 py-2 text-sm text-[var(--alliance-red-ink)]" data-testid="text-run-error">{run.error}</p>}
      <Counts c={run.counts} prefix="last" />
    </div>
  );
}

function Body() {
  const auth = useAuth();
  const qc = useQueryClient();
  const q = useGetReminderJobStatus({ query: { queryKey: getGetReminderJobStatusQueryKey(), refetchInterval: 30000, refetchOnWindowFocus: true, retry: false }, request: FETCH_CREDS });
  const run = useRunAdminReminderCheck({ request: auth.request });
  const test = useSendAdminTestReminder({ request: auth.request });
  const lock = useRef(false);
  const testId = useRef<string>(crypto.randomUUID());
  const [runRes, setRunRes] = useState<ReminderCheckResult | null>(null);
  const [testRes, setTestRes] = useState<TestReminderResult | null>(null);
  const [runErr, setRunErr] = useState<string | null>(null);
  const [testErr, setTestErr] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const busy = run.isPending || test.isPending;
  const refresh = () => qc.invalidateQueries({ queryKey: getGetReminderJobStatusQueryKey() });

  async function doRun() {
    if (lock.current) return;
    lock.current = true; setRunErr(null); setRunRes(null);
    try { setRunRes(await run.mutateAsync({})); }
    catch (e) { const f = readError(e); setRunErr(`${f.message}${(f.status ?? 500) >= 500 || !f.status ? ' The job may have partly delivered; reminders are de-duplicated, so running again is safe.' : ''}`); }
    finally { lock.current = false; void refresh(); }
  }
  async function doTest() {
    if (lock.current) return;
    lock.current = true; setTestErr(null); setTestRes(null);
    try {
      setTestRes(await test.mutateAsync({ data: { requestId: testId.current } }));
      testId.current = crypto.randomUUID(); setRetrying(false);
    } catch (e) {
      const f = readError(e);
      if (f.status !== undefined && f.status >= 400 && f.status < 500) { testId.current = crypto.randomUUID(); setRetrying(false); setTestErr(f.message); }
      else { setRetrying(true); setTestErr(`${f.message} The result is uncertain. Retrying uses the same request ID, so it will not send a duplicate.`); }
    } finally { lock.current = false; void refresh(); }
  }

  const d = q.data;
  // Reading dataUpdatedAt also re-renders when a refetch returns identical data.
  const health = d ? reminderJobHealth(d, Math.max(Date.now(), q.dataUpdatedAt)) : null;
  return (
    <>
      <PageHeader eyebrow="Admin" title="Reminder jobs" description="Shift reminders go out automatically. An outside scheduler (cron-job.org) runs a check every 15 minutes. Use this page to confirm it's running, run a check yourself, or send yourself a test reminder." />

      {q.isLoading && <div className="mt-4 space-y-3" role="status" aria-busy="true"><span className="sr-only">Loading</span>{[0, 1, 2].map(i => <Skeleton key={i} className="h-28 w-full" />)}</div>}
      {q.isError && (
        <div className="mt-4"><Notice>{readError(q.error, SOMETHING_WENT_WRONG).message}</Notice>
          <Button type="button" onClick={() => { void q.refetch(); }} data-testid="button-retry-jobs">Try again</Button></div>
      )}
      {d && (
        <div className="mt-4 space-y-4">
          {health && <div data-testid="notice-run-health" className={health.kind === 'success' ? '[&>div]:bg-[#E6F2E9] [&>div]:text-[#245C36]' : ''}><Notice kind={health.kind}>{health.message}</Notice></div>}
          <Card className="p-4">
            <h2 className="alliance-display">Last run</h2>
            <div className="mt-3">{d.lastRun ? <RunCard run={d.lastRun} /> : (
              <p className="text-sm" data-testid="empty-last-run">No reminder check has been recorded yet. Run one below to see results here.</p>)}</div>
            {(!d.lastScheduledRun || d.lastRun?.id !== d.lastScheduledRun.id) && <p className="mt-3 text-sm" data-testid="text-last-scheduled">{d.lastScheduledRun ? `Last scheduled run: ${when(d.lastScheduledRun.startedAt)}, ${d.lastScheduledRun.status}.` : 'No scheduled run yet.'}</p>}
          </Card>
          <Card className="p-4">
            <h2 className="alliance-display">Reminders, last 7 days</h2>
            <dl className="mt-3 grid grid-cols-3 gap-2">
              <Stat id="text-7d-sent" label="Sent" value={d.last7Days.sent} />
              <Stat id="text-7d-logged" label="Logged" value={d.last7Days.logged} />
              <Stat id="text-7d-failed" label="Failed" value={d.last7Days.failed} />
            </dl>
            <p className="mt-2 text-sm text-navy-soft">{loggedNote}</p>
          </Card>
          <Card className="p-4">
            <h2 className="alliance-display">How reminders run</h2>
            <dl className="mt-3 space-y-2 text-sm">
              <div className="flex flex-wrap justify-between gap-2"><dt>Runs</dt><dd className="font-bold" data-testid="text-schedule">Every 15 minutes, Pacific time</dd></div>
              <div className="flex flex-wrap justify-between gap-2"><dt>Scheduler</dt><dd className="min-w-0 max-w-full [&_div]:whitespace-normal [&_div]:max-w-full [&_[data-testid=status-good]]:bg-[#E6F2E9] [&_[data-testid=status-good]]:text-[#245C36]" data-testid="text-scheduler"><span data-testid="text-external"><StatusBadge status={d.triggerMode === 'external' || d.triggerMode === 'builtin' ? 'good' : 'attention'}>{schedulerLabels[d.triggerMode]}</StatusBadge></span></dd></div>
              <div className="flex flex-wrap justify-between gap-2"><dt>Reminder lead time</dt><dd className="font-bold" data-testid="text-hours-before">{d.reminderHoursBefore} hours</dd></div>
              <div className="flex flex-wrap justify-between gap-2"><dt>Same-morning reminder</dt><dd className="font-bold" data-testid="text-am-hour">{d.sameMorningReminder ? hour(d.sameMorningReminderHour) : 'off'}</dd></div>
            </dl>
            <p className="mt-3 text-sm text-navy-soft">Each scheduled run also sends the weekday coverage email (after 7 AM Pacific, when it's on and shifts need volunteers) and the monthly email-limit warning. Lead time and the same-morning reminder are set in the app's configuration; changing them is a developer change.</p>
          </Card>
          <Card className="p-4">
            <h2 className="alliance-display">Safe checks</h2>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <Button type="button" onClick={() => { void doRun(); }} disabled={busy} data-testid="button-run-check">Run reminder check now</Button>
              <Button type="button" variant="secondary" onClick={() => { void doTest(); }} disabled={busy} data-testid="button-send-test">Send test reminder to me</Button>
            </div>
            <p className="mt-3 text-sm text-navy-soft">Run reminder check now runs the reminder step only (not the coverage email). It's safe to repeat: nobody gets the same reminder twice.</p>
            <p className="mt-2 text-xs text-navy-soft">The test goes only to the email of the admin signed in now. The address cannot be changed.{retrying ? ' Next click retries the previous test request.' : ''}</p>
            <div className="mt-3 break-words" aria-live="polite">
              {run.isPending && <p className="text-sm">Running check...</p>}
              {test.isPending && <p className="text-sm">Sending test...</p>}
              {runRes && <RunSummary r={runRes} />}
              {runErr && <div data-testid="error-run"><Notice>{runErr}</Notice></div>}
              {testRes && <TestSummary r={testRes} />}
              {testErr && <div data-testid="error-test"><Notice>{testErr}</Notice></div>}
            </div>
          </Card>
        </div>
      )}
    </>
  );
}

export function AdminNotificationJobs() {
  return <RequireAdmin>{() => <AppLayout role="admin"><Body /></AppLayout>}</RequireAdmin>;
}
