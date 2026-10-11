import { SOMETHING_WENT_WRONG } from '@/lib/contact';
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

const when = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('en-US', { timeZone: 'America/Los_Angeles', dateStyle: 'medium', timeStyle: 'short' }); };
const hour = (h: number) => `${h % 12 === 0 ? 12 : h % 12}:00 ${h < 12 ? 'AM' : 'PM'}`;

function Stat({ label, value, id }: { label: string; value: string | number; id: string }) {
  return <div className="min-w-0 rounded-lg bg-gray px-3 py-2"><dt className="text-xs font-bold">{label}</dt><dd className="mt-1 break-words text-lg font-bold tabular-nums" data-testid={id}>{value}</dd></div>;
}

function Counts({ c, prefix }: { c: ReminderRunCounts; prefix: string }) {
  return (
    <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
      {(['eligible', 'sent', 'logged', 'failed', 'skipped', 'suppressed', 'deferred', 'uncertain'] as const).map(k => <Stat key={k} id={`${prefix}-${k}`} label={k} value={c[k] ?? 0} />)}
    </dl>
  );
}

function RunSummary({ r }: { r: ReminderCheckResult }) {
  if (r.skippedRun || !r.run) return <Notice kind="info">Skipped: another reminder check is already running. Nothing was started by this click. Check back shortly.</Notice>;
  return <div data-testid="result-run"><Notice kind={r.run.status === 'failed' ? 'error' : 'success'}>Check {r.run.status === 'running' ? 'is still running' : r.run.status}. Logged copies are development records, not delivered email.{r.run.error ? ` Error: ${r.run.error}` : ''}</Notice><Counts c={r.run.counts} prefix="result" /></div>;
}

function TestSummary({ r }: { r: TestReminderResult }) {
  const label = r.status === 'sent' ? 'Sent to your signed-in admin email.' : r.status === 'logged' ? 'Logged only (development copy). It was not delivered to an inbox.' : 'Failed to send.';
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
        <span className="text-sm">Source: <b data-testid="text-run-source">{run.source}</b></span>
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
  return (
    <>
      <p className="alliance-label">Admin</p>
      <h1 className="alliance-display">Reminder jobs</h1>
      <p className="mt-1 max-w-xl text-sm">What the automated shift reminders did, and safe ways to check them.</p>

      {q.isLoading && <div className="mt-4 space-y-3" role="status" aria-busy="true"><span className="sr-only">Loading</span>{[0, 1, 2].map(i => <Skeleton key={i} className="h-28 w-full" />)}</div>}
      {q.isError && (
        <div className="mt-4"><Notice>{readError(q.error, SOMETHING_WENT_WRONG).message}</Notice>
          <Button type="button" onClick={() => { void q.refetch(); }} data-testid="button-retry-jobs">Try again</Button></div>
      )}
      {d && (
        <div className="mt-4 space-y-4">
          <Card className="p-4">
            <h2 className="alliance-display">Last run</h2>
            <div className="mt-3">{d.lastRun ? <RunCard run={d.lastRun} /> : (
              <p className="text-sm" data-testid="empty-last-run">No reminder check has been recorded yet. Run one below to see results here.</p>)}</div>
          </Card>
          <Card className="p-4">
            <h2 className="alliance-display">Reminders, last 7 days</h2>
            <dl className="mt-3 grid grid-cols-3 gap-2">
              <Stat id="text-7d-sent" label="Sent" value={d.last7Days.sent} />
              <Stat id="text-7d-logged" label="Logged" value={d.last7Days.logged} />
              <Stat id="text-7d-failed" label="Failed" value={d.last7Days.failed} />
            </dl>
            <p className="mt-2 text-xs text-navy-soft">Logged means a development copy was written to the log. It was not delivered.</p>
          </Card>
          <Card className="p-4">
            <h2 className="alliance-display">Schedule</h2>
            <dl className="mt-3 space-y-2 text-sm">
              <div className="flex flex-wrap justify-between gap-2"><dt>Schedule</dt><dd className="font-bold" data-testid="text-schedule">every 15 min {d.timezone}{d.cron ? ` (${d.cron})` : ''}</dd></div>
              <div className="flex flex-wrap justify-between gap-2"><dt>Automatic scheduler</dt><dd><StatusBadge status={d.schedulerEnabled ? 'good' : 'attention'}>{d.schedulerEnabled ? 'enabled' : 'disabled'}</StatusBadge></dd></div>
              <div className="flex flex-wrap justify-between gap-2"><dt>External trigger</dt><dd className="font-bold" data-testid="text-external">{d.externalTriggerConfigured ? 'configured' : 'not configured'}</dd></div>
              <div className="flex flex-wrap justify-between gap-2"><dt>Reminder lead time</dt><dd className="font-bold" data-testid="text-hours-before">{d.reminderHoursBefore} hours</dd></div>
              <div className="flex flex-wrap justify-between gap-2"><dt>Same-morning reminder</dt><dd className="font-bold" data-testid="text-am-hour">{d.sameMorningReminder ? hour(d.sameMorningReminderHour) : 'off'}</dd></div>
            </dl>
            <p className="mt-3 text-xs text-navy-soft">Timers can pause when the app autoscales to zero. Reliable timing needs an always-on runtime or a scheduled POST trigger, configured on the server.</p>
          </Card>
          <Card className="p-4">
            <h2 className="alliance-display">Safe checks</h2>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <Button type="button" onClick={() => { void doRun(); }} disabled={busy} data-testid="button-run-check">Run reminder check now</Button>
        {import.meta.env.DEV && <Button type="button" variant="secondary" onClick={() => { void doTest(); }} disabled={busy} data-testid="button-send-test">Send test reminder to me</Button>}
            </div>
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
