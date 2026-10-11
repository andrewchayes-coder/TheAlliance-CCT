import { SOMETHING_WENT_WRONG } from '@/lib/contact';
import { useEffect, useMemo, useRef, useState } from 'react';
import { keepPreviousData, useQueryClient } from '@tanstack/react-query';
import {
  getGetNotificationLogQueryKey, getGetNotificationSummaryQueryKey, getGetReminderJobStatusQueryKey,
  useGetNotificationLog, useRetryNotificationEmail,
  type EmailLogStatus, type EmailLogType, type GetNotificationLogParams, type NotificationLogRow,
} from '@workspace/api-client-react';
import { Button, EmptyState, StatusBadge } from '@/components/brand-system';
import { Notice } from '@/auth/auth-ui';
import { FETCH_CREDS, readError, useAuth } from '@/auth/auth-context';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { TYPES, typeLabel, when } from './shared';

const realDate = (v: string) => { if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false; const d = new Date(`${v}T00:00:00Z`); return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v; };
const tone = (s: EmailLogStatus) => (s === 'sent' ? 'good' : s === 'failed' ? 'blocked' : 'neutral');
const sel = 'alliance-input';

function RetryAction({ r, onRetry }: { r: NotificationLogRow; onRetry: (r: NotificationLogRow) => void }) {
  if (r.status !== 'failed') return null;
  if (r.deliveryUncertain) return <span className="text-xs font-bold" data-testid={`text-uncertain-${r.id}`}>Delivery uncertain. Do not resend; review in Postmark.</span>;
  if (!r.canRetry) return <span className="text-xs" data-testid={`text-no-retry-${r.id}`}>Retry unavailable: older emails have no stored content.</span>;
  return <Button type="button" variant="secondary" onClick={() => onRetry(r)} data-testid={`button-retry-${r.id}`}>Retry</Button>;
}

export function LogSection() {
  const auth = useAuth();
  const qc = useQueryClient();
  const [type, setType] = useState(''); const [status, setStatus] = useState('');
  const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const [text, setText] = useState(''); const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [target, setTarget] = useState<NotificationLogRow | null>(null);
  const [outcome, setOutcome] = useState<{ kind: 'success' | 'info' | 'error'; msg: string } | null>(null);
  const retry = useRetryNotificationEmail({ request: auth.request });
  const retryLock = useRef(false);

  useEffect(() => { const t = setTimeout(() => { setSearch(text.trim()); setPage(1); }, 350); return () => clearTimeout(t); }, [text]);
  const dateErr = (from && !realDate(from)) || (to && !realDate(to)) ? 'Enter real dates as YYYY-MM-DD.' : from && to && from > to ? 'The start date must be on or before the end date.' : null;
  const params = useMemo(() => {
    const p: GetNotificationLogParams = {};
    if (type) p.type = type as EmailLogType;
    if (status) p.status = status as EmailLogStatus;
    if (from && realDate(from)) p.from = from;
    if (to && realDate(to)) p.to = to;
    if (search) p.search = search;
    if (page > 1) p.page = page;
    return p;
  }, [type, status, from, to, search, page]);
  const q = useGetNotificationLog(params, { query: { queryKey: getGetNotificationLogQueryKey(params), enabled: !dateErr, refetchInterval: 30000, placeholderData: keepPreviousData }, request: FETCH_CREDS });
  const d = q.data;
  const pages = d ? Math.max(1, Math.ceil(d.total / d.pageSize)) : 1;
  const filtered = !!(type || status || from || to || search);
  const set = <T,>(fn: (v: T) => void) => (v: T) => { fn(v); setPage(1); };
  const clear = () => { setType(''); setStatus(''); setFrom(''); setTo(''); setText(''); setSearch(''); setPage(1); };

  async function confirm() {
    if (!target || retry.isPending || retryLock.current) return;
    retryLock.current = true;
    const row = target; setOutcome(null);
    try {
      const r = await retry.mutateAsync({ id: row.id });
      setOutcome(r.skipped ? { kind: 'info', msg: `This email was already confirmed ${r.status === 'logged' ? 'as logged (not delivered)' : 'as sent'}. It was not sent again.` }
        : r.status === 'sent' ? { kind: 'success', msg: `Email to ${row.recipient} was sent.` }
        : r.status === 'logged' ? { kind: 'info', msg: `Logged only. The email to ${row.recipient} was not delivered.` }
        : { kind: 'error', msg: `Retry failed for ${row.recipient}.${r.error ? ` ${r.error}` : ''}` });
    } catch (e) { setOutcome({ kind: 'error', msg: readError(e).message }); }
    finally {
      retryLock.current = false;
      setTarget(null);
      void qc.invalidateQueries({ queryKey: getGetNotificationSummaryQueryKey() });
      void qc.invalidateQueries({ queryKey: getGetNotificationLogQueryKey() });
      void qc.invalidateQueries({ queryKey: getGetReminderJobStatusQueryKey() });
    }
  }

  return (
    <section aria-labelledby="log-h" data-testid="section-log">
      <h2 id="log-h" className="alliance-display">Email log</h2>
      <div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-6">
        <label className="text-xs font-bold">Type<select className={`${sel} mt-1 w-full`} value={type} onChange={e => set(setType)(e.target.value)} data-testid="select-type"><option value="">All types</option>{TYPES.map(t => <option key={t.type} value={t.type}>{t.label}</option>)}</select></label>
        <label className="text-xs font-bold">Status<select className={`${sel} mt-1 w-full`} value={status} onChange={e => set(setStatus)(e.target.value)} data-testid="select-status"><option value="">All statuses</option><option value="sent">Sent</option><option value="logged">Logged</option><option value="failed">Failed</option><option value="suppressed">Suppressed (test account)</option></select></label>
        <label className="text-xs font-bold">From (Pacific)<input type="date" className={`${sel} mt-1 w-full`} value={from} onChange={e => set(setFrom)(e.target.value)} data-testid="input-from" /></label>
        <label className="text-xs font-bold">To (Pacific)<input type="date" className={`${sel} mt-1 w-full`} value={to} onChange={e => set(setTo)(e.target.value)} data-testid="input-to" /></label>
        <label className="col-span-2 text-xs font-bold">Recipient email<input type="search" className={`${sel} mt-1 w-full`} value={text} onChange={e => setText(e.target.value)} placeholder="Search recipient" data-testid="input-search" /></label>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {filtered && <Button type="button" variant="secondary" onClick={clear} data-testid="button-clear-filters">Clear filters</Button>}
        {dateErr && <p role="alert" className="text-sm font-bold" data-testid="error-dates">{dateErr}</p>}
      </div>
      <div className="mt-2">{outcome && <div data-testid="retry-outcome"><Notice kind={outcome.kind}>{outcome.msg}</Notice></div>}</div>

      {q.isLoading && !dateErr && <div className="mt-3 space-y-2" role="status" aria-busy="true"><span className="sr-only">Loading log</span>{[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-12 w-full" />)}</div>}
      {q.isError && <div className="mt-3"><Notice>{readError(q.error, SOMETHING_WENT_WRONG).message}</Notice><Button type="button" onClick={() => { void q.refetch(); }} data-testid="button-retry-log">Try again</Button></div>}
      {d && !dateErr && (d.rows.length === 0 ? (
        <div className="mt-3"><EmptyState title={filtered ? 'No emails match' : 'No emails logged yet'} description={filtered ? 'Try widening or clearing the filters.' : 'Sent and logged emails will appear here.'} action={filtered ? <Button type="button" onClick={clear}>Clear filters</Button> : undefined} /></div>
      ) : (<>
        <div className="mt-3 hidden max-h-[560px] overflow-auto rounded-xl border border-gray bg-white xl:block">
          <table className="w-full min-w-[860px] text-left text-sm" data-testid="table-log">
            <thead className="sticky top-0 bg-navy text-white"><tr>{['Time (Pacific)', 'Type', 'Recipient', 'Subject', 'Status', 'Error'].map(h => <th key={h} className="px-3 py-2 text-xs">{h}</th>)}<th className="px-3 py-2"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>{d.rows.map(r => (
              <tr key={r.id} className="border-t border-gray align-top" data-testid={`row-log-${r.id}`}>
                <td className="whitespace-nowrap px-3 py-2">{when(r.time)}</td><td className="px-3 py-2">{typeLabel(r.type)}</td>
                <td className="break-all px-3 py-2">{r.recipient}</td><td className="px-3 py-2">{r.subject}</td>
                <td className="px-3 py-2"><StatusBadge status={tone(r.status)}>{r.deliveryUncertain ? 'Delivery uncertain' : r.status}</StatusBadge></td>
                <td className="max-w-[200px] break-words px-3 py-2 text-xs">{r.error ?? ''}</td>
                <td className="px-3 py-2"><RetryAction r={r} onRetry={setTarget} /></td>
              </tr>))}</tbody>
          </table>
        </div>
        <ul className="mt-3 space-y-2 xl:hidden">{d.rows.map(r => (
          <li key={r.id} className="rounded-xl border border-gray bg-white p-3 text-sm" data-testid={`card-log-${r.id}`}>
            <div className="flex items-center justify-between gap-2"><b>{typeLabel(r.type)}</b><StatusBadge status={tone(r.status)}>{r.deliveryUncertain ? 'Delivery uncertain' : r.status}</StatusBadge></div>
            <p className="mt-1 text-xs">{when(r.time)}</p><p className="mt-1 break-all">{r.recipient}</p><p className="break-words">{r.subject}</p>
            {r.error && <p className="mt-1 break-words text-xs">Error: {r.error}</p>}
            <div className="mt-2"><RetryAction r={r} onRetry={setTarget} /></div>
          </li>))}</ul>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
          <p data-testid="text-log-total">Page {d.page} of {pages}. {d.total.toLocaleString()} {d.total === 1 ? 'email' : 'emails'} in total.</p>
          <div className="flex gap-2">
            <Button type="button" variant="secondary" disabled={page <= 1} onClick={() => setPage(p => p - 1)} data-testid="button-prev">Previous</Button>
            <Button type="button" variant="secondary" disabled={page >= pages} onClick={() => setPage(p => p + 1)} data-testid="button-next">Next</Button>
          </div>
        </div>
      </>))}

      <Dialog open={!!target} onOpenChange={o => { if (!o && !retry.isPending) setTarget(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Retry this email?</DialogTitle>
            <DialogDescription>The server resends the original message to the same recipient. The address cannot be edited.</DialogDescription></DialogHeader>
          <dl className="space-y-1 break-words text-sm"><div><dt className="font-bold">Recipient</dt><dd data-testid="text-confirm-recipient">{target?.recipient}</dd></div><div><dt className="font-bold">Subject</dt><dd data-testid="text-confirm-subject">{target?.subject}</dd></div></dl>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setTarget(null)} disabled={retry.isPending} data-testid="button-cancel-retry">Cancel</Button>
            <Button type="button" onClick={() => { void confirm(); }} disabled={retry.isPending} data-testid="button-confirm-retry">{retry.isPending ? 'Retrying' : 'Retry email'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
