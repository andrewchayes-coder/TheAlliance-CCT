import { useState } from 'react';
import { useSearch } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetVolunteerHoursQueryKey, useGetVolunteerHours, usePutVolunteerHours,
  type GetVolunteerHoursParams, type HoursShift,
} from '@workspace/api-client-react';
import { appConfig } from '@workspace/shared/appConfig';
import { Button } from '@/components/brand-system';
import { FETCH_CREDS, readError, useAuth } from '@/auth/auth-context';
import { shiftDate, timeRange } from '@/lib/pacific';

export const fmtHours = (n: number) => `${n} ${n === 1 ? 'hour' : 'hours'}`;
export const hoursKey = (s: Pick<HoursShift, 'shiftSlotId' | 'customShiftId'>) => s.shiftSlotId ?? s.customShiftId ?? '';
const shortDay = (ymd: string) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(Date.UTC(y, m - 1, d)));
};
export const hoursValid = (v: string) => {
  const n = Number(v);
  return v.trim() !== '' && Number.isFinite(n) && n >= 0.25 && n <= appConfig.hoursMax && Number.isInteger(n * 4);
};
export const HOURS_RULE = `Enter hours between 0.25 and ${appConfig.hoursMax}, in quarter hours (for example 1.5).`;

/** Dev-only: forward the page's ?at= clock override. Never forwarded in production builds. */
export function useDevAt(): string | undefined {
  const search = useSearch();
  if (!import.meta.env.DEV) return undefined;
  return new URLSearchParams(search).get('at') ?? undefined;
}

export function useVolunteerHoursData(enabled: boolean) {
  const at = useDevAt();
  const params: GetVolunteerHoursParams | undefined = at ? { at } : undefined;
  const q = useGetVolunteerHours(params, {
    query: { queryKey: getGetVolunteerHoursQueryKey(params), enabled: enabled && appConfig.hoursLogging, staleTime: 15_000, refetchOnWindowFocus: 'always' },
    request: FETCH_CREDS,
  });
  return { q, at };
}

export function HoursRow({ shift, at, variant, onSaved }: { shift: HoursShift; at?: string; variant: 'home' | 'past'; onSaved?: (key: string) => void }) {
  const auth = useAuth();
  const qc = useQueryClient();
  const put = usePutVolunteerHours({ request: auth.request });
  const [editing, setEditing] = useState(false);
  const [hours, setHours] = useState('');
  const [note, setNote] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [flash, setFlash] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const id = hoursKey(shift);
  const idPart = `${shift.date}-${id}`;
  const errId = `hours-err-${idPart}`;

  async function save(h: number, n: string) {
    setBusy(true); setErr(null);
    try {
      await put.mutateAsync({
        data: {
          date: shift.date, source: shift.source, hours: h,
          ...(shift.shiftSlotId ? { shiftSlotId: shift.shiftSlotId } : {}),
          ...(shift.customShiftId ? { customShiftId: shift.customShiftId } : {}),
          ...(n.trim() ? { note: n.trim() } : {}),
        },
        params: at ? { at } : undefined,
      });
      setEditing(false); setFlash(h);
      onSaved?.(idPart);
      await qc.invalidateQueries({ predicate: k => k.queryKey[0] === '/api/volunteer/hours' });
    } catch (e) {
      setErr(readError(e, "We couldn't save your hours. Please try again.").message);
    } finally { setBusy(false); }
  }
  const startEdit = () => {
    setErr(null); setHours(String(shift.logged?.hours ?? shift.defaultHours)); setNote(shift.logged?.note ?? ''); setEditing(true);
  };
  const submit = () => {
    if (!hoursValid(hours)) { setErr(HOURS_RULE); return; }
    if (note.length > 300) { setErr('Keep the note to 300 characters or fewer.'); return; }
    void save(Number(hours), note);
  };
  const logged = shift.logged;
  return (
    <li className="min-w-0 rounded-xl bg-white p-4 shadow-sm" data-testid={`hours-row-${idPart}`}>
      <p className="font-bold break-words">{shortDay(shift.date)} · {timeRange(shift.startTime, shift.endTime)}{shift.label ? ` · ${shift.label}` : ''}</p>
      {flash !== null && variant === 'home' ? (
        <p className="mt-2 font-bold text-blue" role="status" data-testid={`text-hours-logged-${idPart}`}>Logged: {fmtHours(flash)} ✓</p>
      ) : editing ? (
        <form noValidate className="mt-3 grid gap-3" onSubmit={e => { e.preventDefault(); submit(); }}>
          <div>
            <label className="alliance-label" htmlFor={`h-${idPart}`}>Hours served</label>
            <input id={`h-${idPart}`} className="alliance-input min-h-11 w-full" type="number" step={appConfig.hoursIncrement} min={0.25} max={appConfig.hoursMax}
              inputMode="decimal" value={hours} onChange={e => setHours(e.target.value)} data-testid={`input-hours-${idPart}`}
              aria-invalid={!!err} aria-describedby={err ? errId : undefined} />
          </div>
          <div>
            <label className="alliance-label" htmlFor={`n-${idPart}`}>Note (optional)</label>
            <input id={`n-${idPart}`} className="alliance-input min-h-11 w-full" maxLength={300} value={note} onChange={e => setNote(e.target.value)} data-testid={`input-hours-note-${idPart}`} aria-describedby={`nh-${idPart}`} />
            <p id={`nh-${idPart}`} className="mt-1 text-xs text-navy-soft">For example: a callback ran long.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" className="min-h-11" disabled={busy} data-testid={`button-save-hours-${idPart}`}>{busy ? 'Saving...' : 'Save'}</Button>
            <Button type="button" variant="secondary" className="min-h-11" disabled={busy} onClick={() => { setEditing(false); setErr(null); }} data-testid={`button-cancel-hours-${idPart}`}>Cancel</Button>
          </div>
        </form>
      ) : logged ? (
        <div className="mt-2">
          <p data-testid={`text-hours-${idPart}`}><span className="font-bold">{fmtHours(logged.hours)} logged</span>{logged.enteredBy === 'staff' ? ' (entered by the Community Care Team)' : ''}</p>
          {logged.note && <p className="text-sm break-words">{logged.note}</p>}
          {shift.editable && <Button type="button" variant="secondary" className="mt-2 min-h-11" disabled={busy} onClick={startEdit} data-testid={`button-edit-hours-${idPart}`}>Edit</Button>}
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button type="button" className="min-h-11" disabled={busy} onClick={() => { void save(shift.defaultHours, ''); }} data-testid={`button-confirm-hours-${idPart}`}>
            {busy ? 'Saving...' : `Confirm ${fmtHours(shift.defaultHours)}`}
          </Button>
          <button type="button" disabled={busy} onClick={startEdit} className="min-h-11 px-2 font-bold text-blue underline underline-offset-4 disabled:opacity-50" data-testid={`button-different-hours-${idPart}`}>Different hours</button>
        </div>
      )}
      {err && <p id={errId} role="alert" className="mt-2 rounded-lg bg-[var(--alliance-amber)] px-3 py-2 text-sm font-bold text-[var(--alliance-amber-ink)]" data-testid={`error-hours-${idPart}`}>{err}</p>}
    </li>
  );
}

export { shiftDate };
