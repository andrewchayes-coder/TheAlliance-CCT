import { useMemo, useRef, useState } from 'react';
import { getGetAdminScheduleControlsQueryKey, useAddAdminWeekOff, useAssignAdminShift, useGetAdminScheduleControls, useRemoveAdminShift, useRemoveAdminWeekOff, type AdminScheduleControlsAssignmentsItem, type VolunteerShiftResult } from '@workspace/api-client-react';
import { Button } from '@/components/brand-system';
import { Notice } from '@/auth/auth-ui';
import { FETCH_CREDS, readError, useAuth } from '@/auth/auth-context';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DAYS, calDate, clock, pacificToday } from '@/components/volunteer-detail/format';
import { useDebounced, useInvalidateSchedule } from './use-controls';

const stateOf = (d: { startsAt: string; endsAt: string }) => {
  const now = Date.now(); const st = Date.parse(d.startsAt); const en = Date.parse(d.endsAt);
  if (en <= now) return 'past' as const;
  if (st <= now) return 'progress' as const;
  return st - now <= 86_400_000 ? 'soon' as const : 'future' as const;
};
type Props = { slotId?: string; userId?: string; closed?: boolean; closedReason?: string | null };
type Confirm = { kind: 'remove'; a: AdminScheduleControlsAssignmentsItem } | { kind: 'off'; a: AdminScheduleControlsAssignmentsItem; date: string } | { kind: 'undo'; a: AdminScheduleControlsAssignmentsItem; date: string; skipId: string };

const who = (v: { firstName: string; lastName: string }) => `${v.firstName} ${v.lastName}`.trim();
const field = 'alliance-input';

export function AdminScheduleControls({ slotId, userId, closed, closedReason }: Props) {
  const { request } = useAuth();
  const refresh = useInvalidateSchedule();
  const today = pacificToday();
  const [search, setSearch] = useState('');
  const q = useDebounced(search.trim());
  const params = { ...(slotId ? { slotId } : {}), ...(userId ? { userId } : {}), ...(q && !userId ? { q } : {}) };
  const ctl = useGetAdminScheduleControls(params, { query: { queryKey: getGetAdminScheduleControlsQueryKey(params), staleTime: 0, placeholderData: p => p }, request: FETCH_CREDS });
  const assign = useAssignAdminShift({ request });
  const remove = useRemoveAdminShift({ request });
  const addOff = useAddAdminWeekOff({ request });
  const undoOff = useRemoveAdminWeekOff({ request });
  const busy = assign.isPending || remove.isPending || addOff.isPending || undoOff.isPending;

  const [pickUser, setPickUser] = useState('');
  const [pickSlot, setPickSlot] = useState('');
  const [startDate, setStartDate] = useState('');
  const [override, setOverride] = useState(false);
  const [reason, setReason] = useState('');
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const open = (c: Confirm, e: { currentTarget: HTMLElement }) => { trigger.current = e.currentTarget; setConfirm(c); };
  const [email, setEmail] = useState(true);
  const [ok, setOk] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const data = ctl.data;
  const effUser = userId ?? pickUser;
  const effSlotId = slotId ?? pickSlot;
  const slot = data?.slots.find(s => s.id === effSlotId);
  const vol = data?.volunteers.find(v => v.userId === effUser);
  const dates = useMemo(() => (slot?.startDates ?? []).filter(d => d >= today), [slot, today]);
  const date = dates.includes(startDate) ? startDate : dates[0] ?? '';
  const blocked = vol?.blockedReasons ?? [];
  const full = !!slot && slot.heldCount >= slot.capacity;
  const heavy = !!vol && vol.heldCount >= 2;
  const needsOverride = full || heavy;
  const reasonOk = reason.trim().length > 0;
  const why = !effUser ? 'Choose a volunteer.' : !effSlotId ? 'Choose a shift.' : !slot ? 'This shift is not available.' : blocked.length ? 'This volunteer is not eligible.'
    : !date ? 'No future start date is open for this shift.' : needsOverride && !override ? 'Over the limit. Tick the override box to continue.' : needsOverride && !reasonOk ? 'Enter a reason for the override.' : '';

  const done = (r: VolunteerShiftResult) => {
    setOk(r.message + (r.emailWarning ? ` ${r.emailWarning}` : '')); setErr(null); setConfirm(null);
    void refresh();
  };
  const fail = (e: unknown) => { setErr(readError(e).message); setOk(null); setConfirm(null); };

  const submit = () => {
    if (why || busy) return;
    setOk(null); setErr(null);
    assign.mutate({ data: { userId: effUser, slotId: effSlotId, startDate: date, override: needsOverride && override, ...(needsOverride && override ? { reason: reason.trim() } : {}) } }, {
      onSuccess: r => { done(r); setOverride(false); setReason(''); }, onError: fail,
    });
  };
  const run = () => {
    if (!confirm || busy) return;
    setOk(null); setErr(null);
    if (confirm.kind === 'remove') remove.mutate({ assignmentId: confirm.a.id, data: { emailVolunteer: email } }, { onSuccess: done, onError: fail });
    else if (confirm.kind === 'off') addOff.mutate({ assignmentId: confirm.a.id, data: { date: confirm.date } }, { onSuccess: done, onError: fail });
    else undoOff.mutate({ assignmentId: confirm.a.id, skipId: confirm.skipId }, { onSuccess: done, onError: fail });
  };

  const list = (data?.assignments ?? []).filter(a => (!slotId || a.slotId === slotId) && (!userId || a.userId === userId));

  return (
    <div className="mt-4 space-y-5" data-testid="admin-schedule-controls">
      <div>{ok && <Notice kind="success">{ok}</Notice>}</div>
      {err && <div><Notice>{err}</Notice></div>}
      {ctl.isError && !data && (
        <div><Notice>{readError(ctl.error, "Something went wrong on our end. Please try again — if it keeps happening, let The Alliance know.").message}</Notice>
          <Button type="button" onClick={() => { void ctl.refetch(); }} data-testid="button-retry-controls">Try again</Button></div>
      )}
      {ctl.isPending && <div role="status" aria-busy="true"><span className="sr-only">Loading controls</span><Skeleton className="h-24 w-full" /></div>}
      {data && (<>
        <section aria-labelledby={`ctl-held-${slotId ?? userId}`}>
          <h3 id={`ctl-held-${slotId ?? userId}`} tabIndex={-1} className="alliance-label">{slotId ? 'Standing assignments' : 'Standing shifts and dates'}</h3>
          {list.length === 0 ? <p className="mt-2 text-sm" data-testid="text-no-assignments">No standing assignments here.</p> : (
            <ul className="mt-2 space-y-3">
              {list.map(a => (
                <li key={a.id} className="rounded-lg border border-gray p-3" data-testid={`ctl-assignment-${a.id}`}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <p className="min-w-0 text-sm font-bold">{userId ? `${DAYS[a.dayOfWeek]}, ${clock(a.startTime)} to ${clock(a.endTime)}` : who(a)}<span className="block font-normal">From {calDate(a.startDate)}</span></p>
                    <Button type="button" variant="secondary" disabled={busy} onClick={e => { setEmail(true); open({ kind: 'remove', a }, e); }} data-testid={`button-remove-${a.id}`}>Remove</Button>
                  </div>
                  <p className="mt-2 text-xs text-navy-soft">{closed ? `The selected block is closed${closedReason ? ` (${closedReason})` : ''}. Closed dates cannot get a new week off; existing future week offs can be undone.` : 'Upcoming dates'}</p>
                  <ul className="mt-1 divide-y divide-gray">
                    {a.dates.map(d => {
                      const st = stateOf(d); const past = st === 'past'; const closedDate = !!d.closedReason;
                      return (
                        <li key={d.date} className="flex min-h-11 flex-wrap items-center justify-between gap-2 py-1 text-sm" data-testid={`ctl-date-${a.id}-${d.date}`}>
                          <span className={d.skipId ? 'line-through' : ''}>{calDate(d.date)}{d.skipId && <span className="ml-2 text-xs font-bold no-underline">Week off</span>}{st === 'soon' && !d.skipId && <span className="ml-2 text-xs">Within 24 hours</span>}{st === 'progress' && <span className="ml-2 text-xs">In progress</span>}{closedDate && <span className="ml-2 text-xs font-bold">Closed: {d.closedReason}</span>}</span>
                          {past ? <span className="text-xs text-navy-soft">Past, no action</span> : d.skipId
                            ? <Button type="button" variant="secondary" disabled={busy} onClick={e => open({ kind: 'undo', a, date: d.date, skipId: d.skipId! }, e)} data-testid={`button-undo-off-${a.id}-${d.date}`}>Undo week off</Button>
                            : closedDate ? <span className="text-xs text-navy-soft">Closed, cannot add</span> : <Button type="button" variant="secondary" disabled={busy} onClick={e => open({ kind: 'off', a, date: d.date }, e)} data-testid={`button-week-off-${a.id}-${d.date}`}>Mark week off</Button>}
                        </li>
                      );
                    })}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </section>

        <form className="space-y-3 rounded-lg bg-gray p-3" onSubmit={e => { e.preventDefault(); submit(); }} data-testid="form-assign">
          <h3 className="alliance-label">Assign a shift</h3>
          {closed && <p className="text-sm font-bold" data-testid="text-closed-assign">This date is closed{closedReason ? ` (${closedReason})` : ''}. You can still assign the next open date below.</p>}
          {!userId && (<div>
            <label htmlFor="ctl-search" className="text-sm font-bold">Find a volunteer</label>
            <input id="ctl-search" type="search" className={`${field} mt-1`} value={search} onChange={e => setSearch(e.target.value)} placeholder="Name or email" maxLength={120} data-testid="input-volunteer-search" />
            <ul className="mt-2 max-h-52 overflow-y-auto rounded-lg bg-white" role="radiogroup" aria-label="Volunteers" data-testid="list-volunteers">
              {data.volunteers.length === 0 && <li className="p-3 text-sm" data-testid="text-no-volunteers">No active volunteers match.</li>}
              {data.volunteers.map(v => {
                const off = v.blockedReasons.length > 0; const on = pickUser === v.userId;
                return (
                  <li key={v.userId} className="border-b border-gray last:border-0">
                    <button type="button" role="radio" aria-checked={on} disabled={off} onClick={() => setPickUser(v.userId)} data-testid={`option-volunteer-${v.userId}`}
                      className={`block min-h-11 w-full px-3 py-2 text-left text-sm focus-visible:outline-2 focus-visible:outline-teal disabled:opacity-60 ${on ? 'bg-teal/10 font-bold' : ''}`}>
                      <span className="block">{who(v)} <span className="font-normal">holds {v.heldCount}</span></span>
                      <span className="block break-all text-xs">{v.email}</span>
                      {off && <span className="block text-xs font-bold text-[var(--alliance-amber-ink)]">Not eligible: {v.blockedReasons.join('; ')}</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>)}
          {userId && vol && <p className="text-sm">{who(vol)} holds {vol.heldCount} of 2 standing shifts.{blocked.length > 0 && <span className="block font-bold text-[var(--alliance-amber-ink)]" data-testid="text-blocked">Not eligible: {blocked.join('; ')}</span>}</p>}
          {!slotId && (<div>
            <label htmlFor="ctl-slot" className="text-sm font-bold">Shift</label>
            <select id="ctl-slot" className={`${field} mt-1`} value={pickSlot} onChange={e => setPickSlot(e.target.value)} data-testid="select-slot">
              <option value="">Choose a shift</option>
              {data.slots.map(s => <option key={s.id} value={s.id}>{DAYS[s.dayOfWeek]} {clock(s.startTime)} to {clock(s.endTime)}{s.label ? ` - ${s.label}` : ''} ({s.heldCount}/{s.capacity}){s.ownAssignmentId ? ' - already held' : ''}</option>)}
            </select>
          </div>)}
          {slot && (<div>
            <label htmlFor="ctl-date" className="text-sm font-bold">Start date</label>
            <select id="ctl-date" className={`${field} mt-1`} value={date} onChange={e => setStartDate(e.target.value)} disabled={dates.length === 0} data-testid="select-start-date">
              {dates.length === 0 && <option value="">No open dates</option>}
              {dates.map(d => <option key={d} value={d}>{calDate(d)}</option>)}
            </select>
            <p className="mt-1 text-xs" data-testid="text-counts">Shift holds {slot.heldCount} of {slot.capacity} seats. {vol ? `${who(vol)} holds ${vol.heldCount} of 2.` : ''}</p>
          </div>)}
          {needsOverride && !blocked.length && (
            <fieldset className="rounded-lg border border-[var(--alliance-amber-ink)] bg-white p-3" data-testid="box-override">
              <legend className="px-1 text-sm font-bold">Limit override</legend>
              <p className="text-sm">{[full && 'This shift is at capacity.', heavy && 'This volunteer already holds 2 shifts.'].filter(Boolean).join(' ')} An override exceeds only these limits. It never bypasses eligibility or overlapping shifts.</p>
              <label className="mt-2 flex min-h-11 items-center gap-2 text-sm font-bold"><input type="checkbox" className="h-5 w-5" checked={override} onChange={e => setOverride(e.target.checked)} data-testid="checkbox-override" />Override the limit</label>
              <label htmlFor="ctl-reason" className="mt-1 block text-sm font-bold">Reason (required, logged)</label>
              <textarea id="ctl-reason" className={`${field} mt-1 py-2`} rows={2} maxLength={2000} value={reason} onChange={e => setReason(e.target.value)} disabled={!override} data-testid="input-override-reason" />
            </fieldset>
          )}
          <Button type="submit" disabled={!!why || busy} data-testid="button-assign">{assign.isPending ? 'Assigning...' : 'Assign shift'}</Button>
          {why && <p className="text-xs" data-testid="text-assign-why">{why}</p>}
        </form>
      </>)}

      <Dialog open={!!confirm} onOpenChange={o => { if (!o && !busy) setConfirm(null); }}>
        <DialogContent data-testid="dialog-confirm"
          onEscapeKeyDown={e => { if (busy) e.preventDefault(); }} onPointerDownOutside={e => { if (busy) e.preventDefault(); }} onInteractOutside={e => { if (busy) e.preventDefault(); }}
          onCloseAutoFocus={e => {
            e.preventDefault();
            if (trigger.current?.isConnected) trigger.current.focus();
            else document.getElementById(`ctl-held-${slotId ?? userId}`)?.focus();
          }}>
          {confirm && (<>
            <DialogHeader>
              <DialogTitle>{confirm.kind === 'remove' ? 'Remove standing shift?' : confirm.kind === 'off' ? 'Mark week off?' : 'Undo week off?'}</DialogTitle>
              <DialogDescription>
                {confirm.kind === 'remove' ? `${who(confirm.a)} will be removed from ${DAYS[confirm.a.dayOfWeek]} ${clock(confirm.a.startTime)} to ${clock(confirm.a.endTime)}.`
                  : `${who(confirm.a)}, ${calDate(confirm.date)}, ${clock(confirm.a.startTime)} to ${clock(confirm.a.endTime)}.`}
                {confirm.kind === 'off' && confirm.a.dates.some(x => x.date === confirm.date && stateOf(x) !== 'future') && ' This date is within 24 hours or already in progress. Staff may still do this.'} This action is logged.
              </DialogDescription>
            </DialogHeader>
            {confirm.kind === 'remove' && <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" className="h-5 w-5" checked={email} onChange={e => setEmail(e.target.checked)} data-testid="checkbox-email-volunteer" />Email the volunteer about this change</label>}
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => setConfirm(null)} disabled={busy} data-testid="button-confirm-cancel">Cancel</Button>
              <Button type="button" onClick={run} disabled={busy} data-testid="button-confirm-ok">{busy ? 'Working...' : confirm.kind === 'remove' ? 'Remove shift' : confirm.kind === 'off' ? 'Mark week off' : 'Undo week off'}</Button>
            </DialogFooter>
          </>)}
        </DialogContent>
      </Dialog>
    </div>
  );
}
