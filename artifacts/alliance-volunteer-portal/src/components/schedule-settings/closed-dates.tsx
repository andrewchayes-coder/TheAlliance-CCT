import { useState } from 'react';
import { useAddScheduleClosedDate, useDeleteScheduleClosedDate, type ScheduleSettings } from '@workspace/api-client-react';
import { Button } from '@/components/brand-system';
import { Notice } from '@/auth/auth-ui';
import { readError, useAuth } from '@/auth/auth-context';
import { calDate } from '@/components/volunteer-detail/format';
import { Dlg } from './dialog';
import { useScheduleSync } from './use-schedule';

type Item = ScheduleSettings['closedDates'][number];
const inputCls = 'mt-1 min-h-11 w-full rounded-lg border border-navy/40 bg-white px-3 focus-visible:outline-2 focus-visible:outline-teal';

export function ClosedDates({ items, onDone }: { items: Item[]; onDone: (t: string) => void }) {
  const { request } = useAuth();
  const sync = useScheduleSync();
  const add = useAddScheduleClosedDate({ request });
  const del = useDeleteScheduleClosedDate({ request });
  const [date, setDate] = useState('');
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [target, setTarget] = useState<Item | null>(null);
  const [delErr, setDelErr] = useState<string | null>(null);
  const sorted = [...items].sort((a, b) => a.date.localeCompare(b.date));

  const submit = () => {
    if (!date || !reason.trim()) { setErr('Enter a date and a reason.'); return; }
    setErr(null);
    add.mutate({ data: { date, reason: reason.trim() } }, {
      onSuccess: s => { sync(s); setDate(''); setReason(''); onDone(`${calDate(date)} is now closed.`); },
      onError: e => setErr(readError(e).message),
    });
  };
  const remove = () => {
    if (!target) return;
    setDelErr(null);
    del.mutate({ closedDateId: target.id }, {
      onSuccess: s => { sync(s); setErr(null); onDone(`${calDate(target.date)} is open again.`); setTarget(null); },
      onError: e => setDelErr(readError(e).message),
    });
  };

  return (
    <section className="alliance-card mt-6" aria-labelledby="closed-h" data-testid="section-closed-dates">
      <h2 id="closed-h" className="alliance-display text-[15px]">Closed dates</h2>
      <p className="mt-2 text-sm">On a closed date no occurrences are scheduled, no shift reminders go out, and staffing gap checks skip the day. Assignments themselves stay in place.</p>
      <form noValidate onSubmit={e => { e.preventDefault(); submit(); }} className="mt-4 grid gap-3 sm:grid-cols-[11rem_1fr_auto] sm:items-end">
        <label className="text-sm font-bold">Date<input type="date" value={date} onChange={e => setDate(e.target.value)} className={inputCls} data-testid="input-closed-date" /></label>
        <label className="text-sm font-bold">Reason<input type="text" maxLength={300} value={reason} onChange={e => setReason(e.target.value)} className={inputCls} placeholder="For example, Office closed for training day" data-testid="input-closed-reason" /></label>
        <Button type="submit" disabled={add.isPending} data-testid="button-add-closed">{add.isPending ? 'Adding...' : 'Add closed date'}</Button>
      </form>
      {err && <div className="mt-3" role="alert"><Notice>{err}</Notice></div>}
      {sorted.length === 0 ? (
        <p className="mt-4 rounded-xl border border-dashed border-gray px-4 py-5 text-sm" data-testid="empty-closed">No closed dates. Every weekday slot runs as scheduled.</p>
      ) : (
        <ul className="mt-4 divide-y divide-gray">
          {sorted.map(c => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-3" data-testid={`row-closed-${c.id}`}>
              <div className="min-w-0"><p className="font-bold">{calDate(c.date)}</p><p className="text-sm">{c.reason}</p></div>
              <Button type="button" variant="secondary" onClick={() => { setDelErr(null); setTarget(c); }} data-testid={`button-delete-closed-${c.id}`}>Remove</Button>
            </li>
          ))}
        </ul>
      )}
      {target && (
        <Dlg id="closed-del-h" title={`Reopen ${calDate(target.date)}?`} onClose={() => setTarget(null)} busy={del.isPending} testid="dialog-closed-delete">
          <p className="mt-3 text-sm">Removing this closed date puts occurrences, reminders, and gap checks back on for that day ("{target.reason}").</p>
          {delErr && <div className="mt-3" role="alert"><Notice>{delErr}</Notice></div>}
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setTarget(null)} disabled={del.isPending} data-testid="button-closed-cancel">Keep closed</Button>
            <Button type="button" onClick={remove} disabled={del.isPending} data-testid="button-closed-confirm">{del.isPending ? 'Removing...' : 'Remove closed date'}</Button>
          </div>
        </Dlg>
      )}
    </section>
  );
}
