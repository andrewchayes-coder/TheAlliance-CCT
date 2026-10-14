import { useEffect, useMemo, useState } from 'react';
import { useSearch } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetAdminVolunteerHoursQueryKey, getGetAdminVolunteerQueryKey, useAddAdminVolunteerHours, useDeleteAdminVolunteerHours,
  useGetAdminVolunteerHours, useUpdateAdminVolunteerHours,
  type AdminHoursInput, type GetAdminVolunteerHoursParams, type HoursRow, type HoursShift,
} from '@workspace/api-client-react';
import { appConfig } from '@workspace/shared/appConfig';
import { Button } from '@/components/brand-system';
import { Notice } from '@/auth/auth-ui';
import { FETCH_CREDS, readError, useAuth } from '@/auth/auth-context';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { HOURS_RULE, fmtHours, hoursValid } from '@/components/hours-ui';
import { calDate, clock, pacificToday } from './format';

type Mode = { kind: 'add' } | { kind: 'edit'; row: HoursRow } | { kind: 'log'; shift: HoursShift };
const OTHER = 'other';
const sKey = (s: { shiftSlotId: string | null; customShiftId: string | null }) => s.shiftSlotId ?? s.customShiftId ?? '';
const times = (s: { startTime: string | null; endTime: string | null }) => (s.startTime && s.endTime ? `${clock(s.startTime)} to ${clock(s.endTime)}` : '');

function HoursDialog({ userId, mode, at, onClose }: { userId: string; mode: Mode; at?: string; onClose: () => void }) {
  const { request } = useAuth();
  const qc = useQueryClient();
  const { toast } = useToast();
  const add = useAddAdminVolunteerHours({ request });
  const upd = useUpdateAdminVolunteerHours({ request });
  const today = at
    ? new Date(at).toLocaleDateString('en-CA', { timeZone: appConfig.timezone })
    : pacificToday();
  const init = mode.kind === 'edit' ? mode.row : mode.kind === 'log' ? mode.shift : null;
  const [date, setDate] = useState(init ? init.date : '');
  const [choice, setChoice] = useState<string>(
    mode.kind === 'edit' ? (mode.row.source === 'other' ? OTHER : sKey(mode.row)) : mode.kind === 'log' ? sKey(mode.shift) : OTHER);
  const [touched, setTouched] = useState(mode.kind !== 'add');
  const [hours, setHours] = useState(mode.kind === 'edit' ? String(mode.row.hours) : mode.kind === 'log' ? String(mode.shift.defaultHours) : '');
  const [note, setNote] = useState(mode.kind === 'edit' ? (mode.row.note ?? '') : '');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dateOk = /^\d{4}-\d{2}-\d{2}$/.test(date) && date <= today;
  const dayParams: GetAdminVolunteerHoursParams = { from: date, to: date, ...(at ? { at } : {}) };
  const dayQ = useGetAdminVolunteerHours(userId, dayParams, {
    query: { queryKey: getGetAdminVolunteerHoursQueryKey(userId, dayParams), enabled: mode.kind === 'add' && dateOk }, request: FETCH_CREDS,
  });
  const choices = useMemo(() => (mode.kind === 'add' && dateOk ? (dayQ.data?.unloggedShifts ?? []).filter(s => s.date === date) : []), [mode.kind, dateOk, dayQ.data, date]);
  const loggedToday = mode.kind === 'add' && dateOk ? (dayQ.data?.rows ?? []).filter(r => r.date === date && r.source !== 'other').length : 0;
  useEffect(() => {
    if (mode.kind !== 'add') return;
    setTouched(false); setChoice(choices[0] ? sKey(choices[0]) : OTHER);
  }, [choices, mode.kind]);
  useEffect(() => {
    if (mode.kind !== 'add' || touched) return;
    const c = choices.find(s => sKey(s) === choice);
    if (c) setHours(String(c.defaultHours));
  }, [choice, choices, mode.kind, touched]);

  const shift = choices.find(s => sKey(s) === choice) ?? (mode.kind === 'log' ? mode.shift : null);
  const submit = async () => {
    setErr(null);
    if (!dateOk) { setErr(date > today ? "Hours can't be logged for a future date." : 'Choose the date you served.'); return; }
    if (!hoursValid(hours)) { setErr(HOURS_RULE); return; }
    if (note.length > 300) { setErr('Keep the note to 300 characters or fewer.'); return; }
    const isOther = choice === OTHER;
    if (isOther && !note.trim()) { setErr('Add a note: what was this time for?'); return; }
    let ref: Pick<AdminHoursInput, 'source' | 'shiftSlotId' | 'customShiftId'>;
    if (isOther) ref = { source: 'other' };
    else if (mode.kind === 'edit') ref = { source: mode.row.source, ...(mode.row.shiftSlotId ? { shiftSlotId: mode.row.shiftSlotId } : {}), ...(mode.row.customShiftId ? { customShiftId: mode.row.customShiftId } : {}) };
    else if (shift) ref = { source: shift.source, ...(shift.shiftSlotId ? { shiftSlotId: shift.shiftSlotId } : {}), ...(shift.customShiftId ? { customShiftId: shift.customShiftId } : {}) };
    else { setErr('Choose a shift or Other time.'); return; }
    const data: AdminHoursInput = { date, hours: Number(hours), ...(note.trim() ? { note: note.trim() } : {}), ...ref };
    const params = at ? { at } : undefined;
    setBusy(true);
    try {
      if (mode.kind === 'edit') await upd.mutateAsync({ userId, id: mode.row.id, data, params });
      else await add.mutateAsync({ userId, data, params });
      await Promise.all([
        qc.invalidateQueries({ predicate: k => typeof k.queryKey[0] === 'string' && (k.queryKey[0] as string).startsWith(`/api/admin/volunteers/${userId}/hours`) }),
        qc.invalidateQueries({ predicate: k => k.queryKey[0] === '/api/volunteer/hours' }),
        qc.invalidateQueries({ queryKey: getGetAdminVolunteerQueryKey(userId) }),
      ]);
      toast({ title: mode.kind === 'edit' ? 'Hours updated' : 'Hours saved' });
      onClose();
    } catch (e) {
      const f = readError(e, "We couldn't save those hours. Please try again.");
      if (f.status === 409) {
        void qc.invalidateQueries({ predicate: k => typeof k.queryKey[0] === 'string' && (k.queryKey[0] as string).startsWith(`/api/admin/volunteers/${userId}/hours`) });
        setErr(`${f.message} The list has been refreshed.`);
      } else setErr(f.message);
    } finally { setBusy(false); }
  };
  const title = mode.kind === 'edit' ? 'Correct hours' : mode.kind === 'log' ? 'Log hours' : 'Add hours';
  return (
    <Dialog open onOpenChange={o => { if (!o && !busy) onClose(); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto" data-testid="dialog-hours">
        <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>Hours must be in quarter hours, up to {appConfig.hoursMax}.</DialogDescription></DialogHeader>
        <form noValidate className="grid gap-3" onSubmit={e => { e.preventDefault(); void submit(); }}>
          <div>
            <label className="alliance-label" htmlFor="hours-date">Date</label>
            {mode.kind === 'add'
              ? <input id="hours-date" type="date" max={today} className="alliance-input min-h-11 w-full" value={date} onChange={e => setDate(e.target.value)} data-testid="input-hours-date" />
              : <p className="min-h-11 py-2 font-bold">{calDate(date)}</p>}
          </div>
          {mode.kind === 'add' && dateOk && (
            <fieldset className="grid gap-1" disabled={busy}>
              <legend className="alliance-label">What was this time for?</legend>
              {dayQ.isPending ? <Skeleton className="h-11 w-full" /> : dayQ.isError ? <Notice>We couldn't load that day's shifts. You can still add Other time.</Notice> : null}
              {choices.map(s => (
                <label key={sKey(s)} className="flex min-h-11 items-center gap-2 font-bold">
                  <input type="radio" name="hours-choice" className="size-5" checked={choice === sKey(s)} onChange={() => setChoice(sKey(s))} data-testid={`radio-hours-${sKey(s)}`} />
                  <span>{times(s)}{s.label ? ` · ${s.label}` : ''}</span>
                </label>
              ))}
              <label className="flex min-h-11 items-center gap-2 font-bold">
                <input type="radio" name="hours-choice" className="size-5" checked={choice === OTHER} onChange={() => setChoice(OTHER)} data-testid="radio-hours-other" />
                <span>Other time (not a scheduled shift)</span>
              </label>
              {!dayQ.isPending && choices.length === 0 && loggedToday > 0 && <p className="text-sm text-navy-soft">Scheduled shifts on this date already have hours. Edit the existing entry instead.</p>}
            </fieldset>
          )}
          <div>
            <label className="alliance-label" htmlFor="hours-value">Hours</label>
            <input id="hours-value" type="number" step={appConfig.hoursIncrement} min={0.25} max={appConfig.hoursMax} inputMode="decimal" className="alliance-input min-h-11 w-full"
              value={hours} onChange={e => { setHours(e.target.value); setTouched(true); }} data-testid="input-hours-value" />
          </div>
          <div>
            <label className="alliance-label" htmlFor="hours-note">{choice === OTHER ? 'What was this time for?' : 'Note (optional)'}</label>
            <input id="hours-note" maxLength={300} className="alliance-input min-h-11 w-full" value={note} onChange={e => setNote(e.target.value)} required={choice === OTHER} data-testid="input-hours-note" />
          </div>
          {err && <div role="alert" data-testid="error-hours"><Notice>{err}</Notice></div>}
          <DialogFooter className="gap-2">
            <Button type="button" variant="secondary" className="min-h-11" disabled={busy} onClick={onClose} data-testid="button-hours-cancel">Cancel</Button>
            <Button type="submit" className="min-h-11" disabled={busy} data-testid="button-hours-save">{busy ? 'Saving...' : 'Save hours'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function HoursCard({ userId }: { userId: string }) {
  const { request } = useAuth();
  const qc = useQueryClient();
  const { toast } = useToast();
  const search = useSearch();
  const at = import.meta.env.DEV ? (new URLSearchParams(search).get('at') ?? undefined) : undefined;
  const params: GetAdminVolunteerHoursParams | undefined = at ? { at } : undefined;
  const q = useGetAdminVolunteerHours(userId, params, {
    query: { queryKey: getGetAdminVolunteerHoursQueryKey(userId, params), enabled: !!userId && appConfig.hoursLogging, staleTime: 15_000, refetchOnWindowFocus: 'always' }, request: FETCH_CREDS,
  });
  const del = useDeleteAdminVolunteerHours({ request });
  const [mode, setMode] = useState<Mode | null>(null);
  const [rm, setRm] = useState<HoursRow | null>(null);
  const [rmErr, setRmErr] = useState<string | null>(null);
  const [rmBusy, setRmBusy] = useState(false);
  if (!appConfig.hoursLogging) return null;
  const d = q.data;
  type Item = { date: string; row?: HoursRow; shift?: HoursShift };
  const items: Item[] = d ? [...d.rows.map(row => ({ date: row.date, row })), ...d.unloggedShifts.filter(s => !s.logged).map(shift => ({ date: shift.date, shift }))].sort((a, b) => b.date.localeCompare(a.date)) : [];

  async function remove() {
    if (!rm) return;
    setRmBusy(true); setRmErr(null);
    try {
      await del.mutateAsync({ userId, id: rm.id, params });
      await Promise.all([
        qc.invalidateQueries({ predicate: k => typeof k.queryKey[0] === 'string' && (k.queryKey[0] as string).startsWith(`/api/admin/volunteers/${userId}/hours`) }),
        qc.invalidateQueries({ predicate: k => k.queryKey[0] === '/api/volunteer/hours' }),
        qc.invalidateQueries({ queryKey: getGetAdminVolunteerQueryKey(userId) }),
      ]);
      toast({ title: 'Hours removed' }); setRm(null);
    } catch (e) {
      const f = readError(e, "We couldn't remove those hours. Please try again.");
      if (f.status === 404 || f.status === 409) void qc.invalidateQueries({ predicate: k => typeof k.queryKey[0] === 'string' && (k.queryKey[0] as string).startsWith(`/api/admin/volunteers/${userId}/hours`) });
      setRmErr(f.message);
    } finally { setRmBusy(false); }
  }

  return (
    <section className="alliance-card mt-6" aria-labelledby="v-hours" data-testid="card-hours">
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="v-hours" className="alliance-display">Hours</h2>
        <Button type="button" className="ml-auto min-h-11" onClick={() => setMode({ kind: 'add' })} data-testid="button-add-hours">Add hours</Button>
      </div>
      {q.isPending ? <div className="mt-3 space-y-2" role="status" aria-busy="true"><span className="sr-only">Loading</span><Skeleton className="h-6 w-2/3" /><Skeleton className="h-16 w-full" /></div>
        : !d ? <div className="mt-3"><Notice>We couldn't load hours.</Notice><Button type="button" className="min-h-11" onClick={() => { void q.refetch(); }}>Try again</Button></div>
        : (
          <>
            <p className="mt-2 font-bold" data-testid="text-hours-totals">This month: {fmtHours(d.thisMonthTotal)} · Last month: {fmtHours(d.lastMonthTotal)}</p>
            {items.length === 0 ? <p className="mt-3 text-sm text-navy-soft" data-testid="text-no-hours">No hours or past shifts in the last 90 days.</p> : (
              <ul className="mt-3 divide-y divide-gray">
                {items.map(it => it.row ? (
                  <li key={it.row.id} className="py-3 text-sm" data-testid={`hours-${it.row.id}`}>
                    <p className="font-bold break-words">{calDate(it.row.date)} · {it.row.source === 'other' ? 'Other time' : times(it.row) || 'Scheduled shift'} · {fmtHours(it.row.hours)}</p>
                    {it.row.note && <p className="break-words">{it.row.note}</p>}
                    <p className="text-navy-soft">Entered by {it.row.enteredBy}</p>
                    <div className="mt-1 flex flex-wrap gap-2">
                      <Button type="button" variant="secondary" className="min-h-11" onClick={() => setMode({ kind: 'edit', row: it.row! })} data-testid={`button-edit-hours-${it.row.id}`}>Edit</Button>
                      <Button type="button" variant="secondary" className="min-h-11" onClick={() => { setRmErr(null); setRm(it.row!); }} data-testid={`button-delete-hours-${it.row.id}`}>Delete</Button>
                    </div>
                  </li>
                ) : (
                  <li key={`u-${it.date}-${sKey(it.shift!)}`} className="py-3 text-sm" data-testid={`hours-unlogged-${it.date}-${sKey(it.shift!)}`}>
                    <p className="font-bold break-words">{calDate(it.date)} · {times(it.shift!)}{it.shift!.label ? ` · ${it.shift!.label}` : ''}</p>
                    <p className="mt-1 inline-block rounded-md bg-[var(--alliance-amber)] px-2 py-0.5 font-bold text-[var(--alliance-amber-ink)]">Not logged</p>
                    <div className="mt-1"><Button type="button" className="min-h-11" onClick={() => setMode({ kind: 'log', shift: it.shift! })} data-testid={`button-log-hours-${it.date}-${sKey(it.shift!)}`}>Log hours</Button></div>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      {mode && <HoursDialog userId={userId} mode={mode} at={at} onClose={() => setMode(null)} />}
      <Dialog open={!!rm} onOpenChange={o => { if (!o && !rmBusy) setRm(null); }}>
        <DialogContent data-testid="dialog-delete-hours">
          <DialogHeader><DialogTitle>Remove these hours?</DialogTitle><DialogDescription>This can't be undone.</DialogDescription></DialogHeader>
          {rmErr && <div role="alert"><Notice>{rmErr}</Notice></div>}
          <DialogFooter className="gap-2">
            <Button type="button" variant="secondary" className="min-h-11" disabled={rmBusy} onClick={() => setRm(null)} data-testid="button-delete-hours-cancel">Cancel</Button>
            <Button type="button" className="min-h-11" disabled={rmBusy} onClick={() => { void remove(); }} data-testid="button-delete-hours-confirm">{rmBusy ? 'Removing...' : 'Remove hours'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
