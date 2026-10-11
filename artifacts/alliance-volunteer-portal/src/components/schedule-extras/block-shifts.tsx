import { useState } from 'react';
import { useBlockScheduleSlots, useUnblockScheduleSlot, type ScheduleSlot } from '@workspace/api-client-react';
import { Button } from '@/components/brand-system';
import { Notice } from '@/auth/auth-ui';
import { readError, useAuth } from '@/auth/auth-context';
import { DAYS, calDate, clock, pacificToday } from '@/components/volunteer-detail/format';
import { useInvalidateSchedule } from '@/components/schedule-controls/use-controls';
import { useExtras } from './use-extras';

export function BlockShiftsForm({ slots }: { slots: ScheduleSlot[] }) {
  const { request } = useAuth();
  const refresh = useInvalidateSchedule();
  const block = useBlockScheduleSlots({ request });
  const [from, setFrom] = useState(pacificToday());
  const [to, setTo] = useState(pacificToday());
  const [mode, setMode] = useState<'all' | 'selected'>('all');
  const [sel, setSel] = useState<string[]>([]);
  const [reason, setReason] = useState('');
  const [email, setEmail] = useState(true);
  const [ok, setOk] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const active = slots.filter(s => s.isActive).sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.startTime.localeCompare(b.startTime));
  const why = !from || !to ? 'Choose dates.' : to < from ? 'End date is before start date.' : !reason.trim() ? 'A reason is required.' : mode === 'selected' && sel.length === 0 ? 'Select at least one slot.' : '';
  const submit = (e: React.FormEvent) => {
    e.preventDefault(); if (why) return; setOk(null); setErr(null);
    block.mutate({ data: { fromDate: from, toDate: to, ...(mode === 'selected' ? { slotIds: sel } : {}), reason: reason.trim(), emailVolunteers: email } }, {
      onSuccess: () => { void refresh(); setOk('Shifts blocked.'); setReason(''); setSel([]); },
      onError: x => setErr(readError(x).message),
    });
  };
  return (
    <section className="alliance-card mt-4" aria-labelledby="block-h" data-testid="section-block-shifts">
      <h2 id="block-h" className="alliance-display">Block shifts</h2>
      <p className="mt-1 text-sm">Take shifts off the schedule for a date range. Assigned volunteers are released for those dates.</p>
      <form onSubmit={submit} className="mt-3 space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block min-w-0 text-sm font-bold">From<input type="date" className="alliance-input mt-1 w-full min-w-0 max-w-full" value={from} onChange={e => setFrom(e.target.value)} data-testid="input-block-from" /></label>
          <label className="block min-w-0 text-sm font-bold">To<input type="date" className="alliance-input mt-1 w-full min-w-0 max-w-full" value={to} onChange={e => setTo(e.target.value)} data-testid="input-block-to" /></label>
        </div>
        <fieldset className="text-sm"><legend className="font-bold">Slots</legend>
          <label className="flex min-h-11 items-center gap-2"><input type="radio" name="bm" className="h-5 w-5" checked={mode === 'all'} onChange={() => setMode('all')} data-testid="radio-block-all" />All slots</label>
          <label className="flex min-h-11 items-center gap-2"><input type="radio" name="bm" className="h-5 w-5" checked={mode === 'selected'} onChange={() => setMode('selected')} data-testid="radio-block-selected" />Selected slots</label>
        </fieldset>
        {mode === 'selected' && (
          <div className="max-h-64 overflow-y-auto rounded-lg border border-gray p-2" data-testid="list-block-slots">
            {active.map(s => (
              <label key={s.id} className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" className="h-5 w-5" checked={sel.includes(s.id)} onChange={e => setSel(e.target.checked ? [...sel, s.id] : sel.filter(x => x !== s.id))} data-testid={`checkbox-block-slot-${s.id}`} />
                <span>{DAYS[s.dayOfWeek]} {clock(s.startTime)} to {clock(s.endTime)}</span></label>
            ))}
          </div>
        )}
        <label className="block min-w-0 text-sm font-bold">Reason (required)<textarea className="alliance-input mt-1 w-full min-w-0 max-w-full py-2" rows={2} maxLength={1000} value={reason} onChange={e => setReason(e.target.value)} data-testid="input-block-reason" /></label>
        <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" className="h-5 w-5" checked={email} onChange={e => setEmail(e.target.checked)} data-testid="checkbox-block-email" />Email affected volunteers</label>
        {ok && <Notice kind="success">{ok}</Notice>}
        {err && <Notice>{err}</Notice>}
        <Button type="submit" disabled={!!why || block.isPending} data-testid="button-block-submit">{block.isPending ? 'Blocking...' : 'Block shifts'}</Button>
        {why && <p className="text-xs" data-testid="text-block-why">{why}</p>}
      </form>
    </section>
  );
}

export function BlockList({ slots }: { slots: ScheduleSlot[] }) {
  const { request } = useAuth();
  const refresh = useInvalidateSchedule();
  const ex = useExtras();
  const unblock = useUnblockScheduleSlot({ request });
  const [err, setErr] = useState<string | null>(null);
  const blocks = [...(ex.data?.blocks ?? [])].sort((a, b) => a.date.localeCompare(b.date));
  return (
    <section className="alliance-card mt-4" aria-labelledby="blocks-h" data-testid="section-block-list">
      <h2 id="blocks-h" className="alliance-display">Blocked shifts</h2>
      {err && <div className="mt-2"><Notice>{err}</Notice></div>}
      {ex.isPending ? <p className="mt-2 text-sm">Loading...</p> : ex.isError ? (
        <div className="mt-2"><Notice>Could not load blocks.</Notice><Button type="button" variant="secondary" onClick={() => { void ex.refetch(); }} data-testid="button-retry-blocks">Try again</Button></div>
      ) : blocks.length === 0 ? <p className="mt-2 text-sm" data-testid="text-no-blocks">No shifts are blocked.</p> : (
        <ul className="mt-2 divide-y divide-gray">
          {blocks.map(b => {
            const s = slots.find(x => x.id === b.shiftSlotId);
            return (
              <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 py-3" data-testid={`row-block-${b.id}`}>
                <div className="min-w-0"><p className="font-bold">{calDate(b.date)}{s ? `, ${clock(s.startTime)} to ${clock(s.endTime)}` : ''}</p><p className="text-sm">{b.reason}</p></div>
                <Button type="button" variant="secondary" disabled={unblock.isPending} data-testid={`button-unblock-${b.id}`}
                  onClick={() => { setErr(null); unblock.mutate({ blockId: b.id }, { onSuccess: () => { void refresh(); }, onError: x => setErr(readError(x).message) }); }}>Unblock</Button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
