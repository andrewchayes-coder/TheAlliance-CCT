import { useState } from 'react';
import { capacityHint } from '@workspace/shared/schedule-copy';
import { useUpdateScheduleSlot, useCreateScheduleSlot, type ScheduleSettings, type ScheduleSlot, type ScheduleSlotUpdate } from '@workspace/api-client-react';
import { Button } from '@/components/brand-system';
import { Notice } from '@/auth/auth-ui';
import { readError, useAuth } from '@/auth/auth-context';
import { DAYS, calDate, clock, daysUntil, pacificToday } from '@/components/volunteer-detail/format';
import { Dlg } from './dialog';
import { addHours, emailText, overlaps, plural, useScheduleSync } from './use-schedule';

const inputCls = 'alliance-input mt-1 font-normal';
const isScheduled = (s: ScheduleSlot) => s.isActive && !!s.retireAfterDate && daysUntil(s.retireAfterDate) >= 0;

export function SlotDialog({ slot, defaultDay, all, onClose, onDone, onRefresh }: {
  slot: ScheduleSlot | null; defaultDay: number; all: ScheduleSlot[]; onClose: () => void;
  onDone: (text: string) => void; onRefresh: () => Promise<ScheduleSettings | undefined>;
}) {
  const { request } = useAuth();
  const sync = useScheduleSync();
  const create = useCreateScheduleSlot({ request });
  const update = useUpdateScheduleSlot({ request });
  const busy = create.isPending || update.isPending;
  // Snapshot of the slot the admin is reviewing; replaced only by explicit refresh.
  const [snap, setSnap] = useState<ScheduleSlot | null>(slot);
  const [day, setDay] = useState(slot?.dayOfWeek ?? defaultDay);
  const [start, setStart] = useState(slot?.startTime ?? '09:00');
  const [end, setEnd] = useState(slot?.endTime ?? '11:00');
  const [endTouched, setEndTouched] = useState(!!slot);
  const [cap, setCap] = useState(String(slot?.capacity ?? 1));
  const [label, setLabel] = useState(slot?.label ?? '');
  const [active, setActive] = useState(slot?.isActive ?? true);
  const [cancelRet, setCancelRet] = useState(false);
  const [choice, setChoice] = useState<'' | 'now' | 'keep_until'>('');
  const [until, setUntil] = useState('');
  const [step, setStep] = useState<'form' | 'confirm'>('form');
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [tried, setTried] = useState(false);

  const assigned = snap?.assignedCount ?? 0;
  const deactivating = !!snap && snap.isActive && !active;
  const scheduled = !!snap && isScheduled(snap);
  const capN = Number(cap);
  const errs = {
    end: !end ? 'Choose an end time later than the start, on the same day.' : end <= start ? 'End time must be later than start time on the same day.' : '',
    cap: !Number.isInteger(capN) || capN < 1 || capN > 10 ? 'Capacity must be a whole number from 1 to 10.' : '',
    until: deactivating && assigned > 0 && choice === 'keep_until' && (!until || until < pacificToday()) ? 'Choose today or a later date.' : '',
    choice: deactivating && assigned > 0 && !choice ? 'Choose what happens to existing assignments.' : '',
  };
  const invalid = Object.values(errs).some(Boolean);
  const clash = all.filter(o => o.id !== snap?.id && o.isActive && o.dayOfWeek === day && !!end && end > start && overlaps({ startTime: start, endTime: end }, o));

  const onStart = (v: string) => { setStart(v); if (!endTouched) setEnd(addHours(v, 2)); };

  const finish = (s: ScheduleSettings, what: string) => {
    sync(s);
    const rel = s.releasedAssignmentCount ?? 0;
    onDone(`${what}${rel ? ` ${plural(rel, 'assignment')} ended.` : ''}${emailText(s)}`);
  };
  const fail = (e: unknown) => {
    const f = readError(e);
    setStep('form');
    if (f.status === 409) { setStale(true); setError('This slot or its assignments changed after you opened it. Nothing was saved. Refresh to review the latest, then save again.'); }
    else setError(f.message);
  };

  const submit = () => {
    setTried(true); setError(null);
    if (invalid) { setStep('form'); return; }
    const base = { dayOfWeek: day, startTime: start, endTime: end, capacity: capN, label: label.trim() || null, isActive: active };
    if (!snap) {
      create.mutate({ data: base }, { onSuccess: s => finish(s, 'Slot added.'), onError: fail });
      return;
    }
    const data: ScheduleSlotUpdate = { ...base, expectedUpdatedAt: snap.updatedAt, expectedAssignmentIds: [...snap.assignmentIds] };
    if (deactivating) data.deactivation = assigned > 0 && choice === 'keep_until' ? { mode: 'keep_until', keepUntilDate: until } : { mode: 'now' };
    if (scheduled && active && cancelRet) data.cancelRetirement = true;
    update.mutate({ slotId: snap.id, data }, {
      onSuccess: s => finish(s, deactivating && choice === 'keep_until' && assigned > 0 ? `Existing assignments continue through ${calDate(until)}. This slot is closed to new bookings.` : 'Slot saved.'),
      onError: fail,
    });
  };
  const next = () => {
    setTried(true);
    if (invalid) return;
    if (deactivating && assigned > 0 && choice === 'now') setStep('confirm'); else submit();
  };
  const refresh = async () => {
    const s = await onRefresh();
    const fresh = s?.slots.find(x => x.id === snap?.id);
    if (!fresh) { setError('This slot no longer exists. Close this window and review the list.'); return; }
    setSnap(fresh); setStale(false); setError(null);
    setNote(`Latest loaded: ${plural(fresh.assignedCount, 'volunteer')} currently assigned. Your entries are unchanged. Review them, then save again.`);
  };
  const title = snap ? `Edit ${DAYS[snap.dayOfWeek]} slot` : 'Add slot';

  if (step === 'confirm' && snap) return (
    <Dlg id="slot-confirm-h" title={`End ${plural(assigned, 'assignment')} now?`} onClose={() => setStep('form')} busy={busy} testid="dialog-slot-endnow">
      <p className="mt-3 text-sm">This slot will close immediately and the {plural(assigned, 'volunteer')} assigned to {DAYS[snap.dayOfWeek]} {clock(snap.startTime)} to {clock(snap.endTime)} will lose their seats today. Future reservations are cancelled too. This cannot be undone here.</p>
      <p className="mt-2 text-sm">Each affected volunteer is sent a cancellation email. After you confirm, this page reports how many were sent, logged for testing, or failed. Reminders and gap alerts will be added later.</p>
      {error && <div className="mt-3"><Notice>{error}</Notice></div>}
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <Button type="button" variant="secondary" onClick={() => setStep('form')} disabled={busy} data-testid="button-endnow-back">Go back</Button>
        <Button type="button" onClick={submit} disabled={busy} data-testid="button-endnow-confirm">{busy ? 'Ending...' : `End ${plural(assigned, 'assignment')} now`}</Button>
      </div>
    </Dlg>
  );

  return (
    <Dlg id="slot-dlg-h" title={title} onClose={onClose} busy={busy} testid="dialog-slot">
      <form noValidate onSubmit={e => { e.preventDefault(); next(); }} className="mt-3 space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm font-bold">Day
            <select value={day} onChange={e => setDay(Number(e.target.value))} className={inputCls} data-testid="select-slot-day">
              {[1, 2, 3, 4, 5].map(d => <option key={d} value={d}>{DAYS[d]}</option>)}
            </select>
          </label>
          <label className="text-sm font-bold">Capacity (1 to 10)
            <input type="number" min={1} max={10} inputMode="numeric" value={cap} onChange={e => setCap(e.target.value)} className={inputCls}
              aria-invalid={!!errs.cap && tried} aria-describedby="cap-hint" data-testid="input-slot-capacity" />
          </label>
          <label className="text-sm font-bold">Start time
            <input type="time" required value={start} onChange={e => onStart(e.target.value)} className={inputCls} data-testid="input-slot-start" />
          </label>
          <label className="text-sm font-bold">End time
            <input type="time" required value={end} onChange={e => { setEnd(e.target.value); setEndTouched(true); }} className={inputCls}
              aria-invalid={!!errs.end} aria-describedby="end-hint" data-testid="input-slot-end" />
          </label>
        </div>
        <p id="end-hint" className={`text-xs ${errs.end ? 'font-bold' : 'text-navy-soft'}`} role={errs.end ? 'alert' : undefined}>{errs.end || 'End defaults to two hours after start.'}</p>
        <p id="cap-hint" className={`text-xs ${errs.cap && tried ? 'font-bold' : 'text-navy-soft'}`}>{errs.cap && tried ? errs.cap : assigned > 0 ? capacityHint(assigned) : 'How many volunteers can hold this slot.'}</p>
        <label className="block text-sm font-bold">Label (optional)
          <input type="text" maxLength={120} value={label} onChange={e => setLabel(e.target.value)} className={inputCls} placeholder="For example, Front desk" data-testid="input-slot-label" />
        </label>
        {clash.length > 0 && (
          <p className="rounded-lg bg-gray px-3 py-2 text-xs" role="status" data-testid="text-slot-overlap">
            Overlaps with {clash.map(o => `${clock(o.startTime)} to ${clock(o.endTime)}${o.label ? ` (${o.label})` : ''}`).join(', ')}. You can still save.
          </p>
        )}
        <label className="flex min-h-11 items-center gap-3 text-sm font-bold">
          <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} className="h-5 w-5 accent-blue" data-testid="toggle-slot-active" />
          Active slot
        </label>
        {snap && !snap.isActive && active && <p className="text-xs text-navy-soft">Reactivating opens the slot again. Seats that already ended are not restored.</p>}
        {scheduled && snap?.retireAfterDate && active && (
          <div className="rounded-lg border border-navy/30 p-3 text-sm">
            <p>Scheduled inactive after {calDate(snap.retireAfterDate)}. Existing assignments only until then. Saving other changes keeps this date.</p>
            <label className="mt-2 flex min-h-11 items-center gap-3 font-bold">
              <input type="checkbox" checked={cancelRet} onChange={e => setCancelRet(e.target.checked)} className="h-5 w-5 accent-blue" data-testid="checkbox-cancel-retirement" />
              Cancel the scheduled end date and keep this slot active
            </label>
          </div>
        )}
        {deactivating && assigned > 0 && (
          <fieldset className="rounded-lg border border-navy/30 p-3 text-sm" data-testid="group-deactivation">
            <legend className="px-1 font-bold">{plural(assigned, 'volunteer')} assigned to this slot</legend>
            <label className="flex min-h-11 items-start gap-3 py-2">
              <input type="radio" name="deact" checked={choice === 'keep_until'} onChange={() => setChoice('keep_until')} className="mt-1 h-5 w-5 accent-blue" data-testid="radio-keep-until" />
              <span><b>Keep until a date.</b> The slot takes no new bookings. Planned assignments end on that date, inclusive. Future reservations after it are cancelled now, and those volunteers get a cancellation email.</span>
            </label>
            {choice === 'keep_until' && (
              <label className="ml-8 block font-bold">Keep through
                <input type="date" min={pacificToday()} value={until} onChange={e => setUntil(e.target.value)} className={inputCls} aria-invalid={!!errs.until} data-testid="input-keep-until" />
                {errs.until && tried && <span role="alert" className="text-xs">{errs.until}</span>}
              </label>
            )}
            <label className="flex min-h-11 items-start gap-3 py-2">
              <input type="radio" name="deact" checked={choice === 'now'} onChange={() => setChoice('now')} className="mt-1 h-5 w-5 accent-blue" data-testid="radio-end-now" />
              <span><b>End now.</b> Every assignment ends today and volunteers are emailed. You will confirm next.</span>
            </label>
            {errs.choice && tried && <p role="alert" className="text-xs font-bold">{errs.choice}</p>}
          </fieldset>
        )}
        {deactivating && assigned === 0 && <p className="text-xs text-navy-soft">No volunteers are assigned, so this slot closes immediately.</p>}
        {note && <div><Notice kind="info">{note}</Notice></div>}
        {error && <div data-testid="text-slot-error"><Notice>{error}</Notice></div>}
        <div className="flex flex-wrap justify-end gap-2">
          {stale && <Button type="button" variant="secondary" onClick={() => { void refresh(); }} data-testid="button-slot-refresh">Refresh latest</Button>}
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy} data-testid="button-slot-cancel">Cancel</Button>
          <Button type="submit" disabled={busy || stale} data-testid="button-slot-save">{busy ? 'Saving...' : snap ? 'Save changes' : 'Add slot'}</Button>
        </div>
      </form>
    </Dlg>
  );
}
