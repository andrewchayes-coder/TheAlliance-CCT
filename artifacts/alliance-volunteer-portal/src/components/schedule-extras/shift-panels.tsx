import { useState } from 'react';
import { getGetAdminScheduleControlsQueryKey, useAssignCustomShift, useBlockScheduleSlots, useCancelCustomShift, useGetAdminScheduleControls, useRemoveCustomShiftAssignment, useUnblockScheduleSlot } from '@workspace/api-client-react';
import { Button } from '@/components/brand-system';
import { Notice } from '@/auth/auth-ui';
import { FETCH_CREDS, readError, useAuth } from '@/auth/auth-context';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { calDate } from '@/components/volunteer-detail/format';
import { TestBadge } from '@/components/test-badge';
import { useDebounced, useInvalidateSchedule } from '@/components/schedule-controls/use-controls';
import { useExtras } from './use-extras';

export function BlockedPanel({ blockId, reason }: { blockId: string | null | undefined; reason: string | null | undefined }) {
  const { request } = useAuth();
  const refresh = useInvalidateSchedule();
  const unblock = useUnblockScheduleSlot({ request });
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="mt-4 rounded-lg bg-gray p-3" data-testid="panel-blocked">
      <p className="font-bold">Blocked{reason ? ` \u2013 ${reason}` : ''}</p>
      <p className="mt-1 text-sm">Assignments are paused for this date.</p>
      {err && <div className="mt-2"><Notice>{err}</Notice></div>}
      <Button type="button" className="mt-3" disabled={!blockId || unblock.isPending} data-testid="button-unblock-shift"
        onClick={() => { if (!blockId) return; setErr(null); unblock.mutate({ blockId }, { onSuccess: () => { void refresh(); }, onError: x => setErr(readError(x).message) }); }}>{unblock.isPending ? 'Unblocking...' : 'Unblock'}</Button>
    </div>
  );
}

export function BlockThisShift({ slotId, date }: { slotId: string; date: string }) {
  const { request } = useAuth();
  const refresh = useInvalidateSchedule();
  const block = useBlockScheduleSlots({ request });
  const [reason, setReason] = useState('');
  const [email, setEmail] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const submit = (e: React.FormEvent) => {
    e.preventDefault(); if (!reason.trim()) return; setErr(null);
    block.mutate({ data: { fromDate: date, toDate: date, slotIds: [slotId], reason: reason.trim(), emailVolunteers: email } }, {
      onSuccess: () => { void refresh(); }, onError: x => setErr(readError(x).message),
    });
  };
  return (
    <form onSubmit={submit} className="mt-6 space-y-2 border-t border-gray pt-4" data-testid="form-block-this-shift">
      <h3 className="alliance-label">Block this shift on {calDate(date)}</h3>
      <label className="block text-sm font-bold" htmlFor="bts-reason">Reason (required)</label>
      <textarea id="bts-reason" className="alliance-input py-2" rows={2} maxLength={1000} value={reason} onChange={e => setReason(e.target.value)} data-testid="input-block-this-reason" />
      <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" className="h-5 w-5" checked={email} onChange={e => setEmail(e.target.checked)} data-testid="checkbox-block-this-email" />Email assigned volunteers</label>
      {err && <Notice>{err}</Notice>}
      <Button type="submit" variant="secondary" disabled={!reason.trim() || block.isPending} data-testid="button-block-this-shift">{block.isPending ? 'Blocking...' : 'Block this shift'}</Button>
    </form>
  );
}

type Confirm = { kind: 'remove'; id: string; name: string } | { kind: 'cancel' };

export function CustomPanel({ shiftId }: { shiftId: string }) {
  const { request } = useAuth();
  const refresh = useInvalidateSchedule();
  const ex = useExtras();
  const assign = useAssignCustomShift({ request });
  const remove = useRemoveCustomShiftAssignment({ request });
  const cancel = useCancelCustomShift({ request });
  const [search, setSearch] = useState('');
  const q = useDebounced(search.trim());
  const params = q ? { q } : {};
  const ctl = useGetAdminScheduleControls(params, { query: { queryKey: getGetAdminScheduleControlsQueryKey(params), staleTime: 0, placeholderData: p => p }, request: FETCH_CREDS });
  const [pick, setPick] = useState('');
  const [override, setOverride] = useState(false);
  const [reason, setReason] = useState('');
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const shift = ex.data?.customShifts.find(c => c.id === shiftId);
  const busy = assign.isPending || remove.isPending || cancel.isPending;
  const onErr = (x: unknown) => setErr(readError(x).message);
  if (ex.isPending) return <p className="mt-4 text-sm" role="status">Loading one-time shift...</p>;
  if (!shift) return <div className="mt-4"><Notice>Could not load this one-time shift.</Notice><Button type="button" variant="secondary" onClick={() => { void ex.refetch(); }} data-testid="button-retry-custom">Try again</Button></div>;
  const full = shift.assignments.length >= shift.capacity;
  const eligibility = (reasons: string[]) => reasons.filter(r => !/weekly|shift limit|hold up to|held|maximum/i.test(r));
  const held = new Set(shift.assignments.map(a => a.userId));
  const vols = ctl.data?.volunteers ?? [];
  const chosen = vols.find(v => v.userId === pick);
  const why = !pick ? 'Choose a volunteer.' : chosen && eligibility(chosen.blockedReasons).length ? 'This volunteer is not eligible.' : full && !override ? 'Shift is full. Check the override to add anyway.' : override && !reason.trim() ? 'A reason is required for an override.' : '';
  const doAssign = () => {
    if (why) return; setErr(null);
    assign.mutate({ customShiftId: shiftId, data: { userId: pick, override: full && override, ...(full && override ? { reason: reason.trim() } : {}) } }, {
      onSuccess: () => { void refresh(); setPick(''); setOverride(false); setReason(''); }, onError: onErr,
    });
  };
  const doConfirm = () => {
    if (!confirm) return; setErr(null);
    const done = { onSuccess: () => { void refresh(); setConfirm(null); }, onError: (x: unknown) => { setConfirm(null); onErr(x); } };
    if (confirm.kind === 'remove') remove.mutate({ customShiftId: shiftId, assignmentId: confirm.id }, done);
    else cancel.mutate({ customShiftId: shiftId }, done);
  };
  return (
    <div className="mt-5" data-testid="panel-custom-shift">
      <h3 className="alliance-label">One-time shift staffing ({shift.assignments.length}/{shift.capacity})</h3>
      <p className="mt-1 text-sm">{shift.openToVolunteers ? 'Open to volunteers to claim.' : 'Staff-assigned only.'}</p>
      {err && <div className="mt-2"><Notice>{err}</Notice></div>}
      {shift.assignments.length === 0 ? <p className="mt-2 text-sm">No one assigned.</p> : (
        <ul className="mt-2 divide-y divide-gray">
          {shift.assignments.map(a => (
            <li key={a.id} className="flex items-center justify-between gap-2 py-2" data-testid={`row-custom-assignment-${a.id}`}>
              <span className="min-w-0 truncate font-bold">{a.firstName} {a.lastName}<TestBadge test={a.isTestAccount} /></span>
              <Button type="button" variant="secondary" disabled={busy} onClick={() => setConfirm({ kind: 'remove', id: a.id, name: `${a.firstName} ${a.lastName}` })} data-testid={`button-remove-custom-${a.id}`}>Remove</Button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-4 space-y-2 border-t border-gray pt-4">
        <label className="block text-sm font-bold" htmlFor="cs-search">Assign a volunteer</label>
        <input id="cs-search" type="search" className="alliance-input" placeholder="Search by name" value={search} onChange={e => setSearch(e.target.value)} data-testid="input-custom-search" />
        {ctl.isError && <Notice>Could not load volunteers.</Notice>}
        <ul className="max-h-52 overflow-y-auto rounded-lg border border-gray" role="listbox" aria-label="Volunteers">
          {ctl.isPending ? <li className="p-3 text-sm">Loading...</li> : vols.length === 0 ? <li className="p-3 text-sm">No volunteers found.</li> : vols.map(v => {
            const reasons = eligibility(v.blockedReasons); const off = reasons.length > 0 || held.has(v.userId);
            return (
              <li key={v.userId}><button type="button" disabled={off} role="option" aria-selected={pick === v.userId} onClick={() => setPick(v.userId)} data-testid={`option-custom-vol-${v.userId}`}
                className={`block min-h-11 w-full px-3 py-2 text-left text-sm ${pick === v.userId ? 'bg-blue/10 font-bold' : ''} disabled:opacity-60`}>
                {v.firstName} {v.lastName}<TestBadge test={v.isTestAccount} />
                {held.has(v.userId) && <span className="block text-xs font-bold">Already assigned</span>}
                {reasons.length > 0 && <span className="block text-xs font-bold text-[var(--alliance-amber-ink)]">Not eligible: {reasons.join('; ')}</span>}
              </button></li>
            );
          })}
        </ul>
        {full && (
          <fieldset className="space-y-2">
            <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" className="h-5 w-5" checked={override} onChange={e => setOverride(e.target.checked)} data-testid="checkbox-custom-override" />Override capacity</label>
            {override && <textarea className="alliance-input py-2" rows={2} maxLength={2000} placeholder="Reason (required)" value={reason} onChange={e => setReason(e.target.value)} data-testid="input-custom-override-reason" />}
          </fieldset>
        )}
        <Button type="button" disabled={!!why || busy} onClick={doAssign} data-testid="button-assign-custom">{assign.isPending ? 'Assigning...' : 'Assign to this shift'}</Button>
        {why && <p className="text-xs" data-testid="text-custom-assign-why">{why}</p>}
      </div>
      <div className="mt-6 border-t border-gray pt-4">
        <Button type="button" variant="secondary" disabled={busy} onClick={() => setConfirm({ kind: 'cancel' })} data-testid="button-cancel-custom-shift">Cancel this one-time shift</Button>
      </div>
      <Dialog open={!!confirm} onOpenChange={o => { if (!o && !busy) setConfirm(null); }}>
        <DialogContent data-testid="dialog-custom-confirm">
          <DialogHeader>
            <DialogTitle>{confirm?.kind === 'cancel' ? 'Cancel this one-time shift?' : 'Remove volunteer?'}</DialogTitle>
            <DialogDescription>{confirm?.kind === 'cancel' ? 'The shift is removed and every assigned volunteer is emailed.' : `${confirm?.kind === 'remove' ? confirm.name : ''} is removed from this shift and emailed.`} This action is logged.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setConfirm(null)} disabled={busy} data-testid="button-custom-confirm-no">Keep</Button>
            <Button type="button" onClick={doConfirm} disabled={busy} data-testid="button-custom-confirm-yes">{busy ? 'Working...' : 'Confirm'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
