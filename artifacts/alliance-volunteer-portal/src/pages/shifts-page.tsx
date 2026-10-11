import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import { CheckCircle2 } from 'lucide-react';
import {
  getGetVolunteerDashboardQueryKey, getGetVolunteerScheduleQueryKey, useBookVolunteerShift, useChangeVolunteerShift,
  useClaimCustomShift, useCancelOwnCustomShift, useDropVolunteerShift, useGetVolunteerSchedule, useSkipVolunteerShift, useUndoVolunteerSkip,
  type VolunteerShiftResult, type VolunteerStandingShift,
} from '@workspace/api-client-react';
import { EmptyState } from '@/components/brand-system';
import { FETCH_CREDS, readError, useAuth } from '@/auth/auth-context';
import { Notice } from '@/auth/auth-ui';
import { ErrorBlock, LoadingBlock, VolunteerPage, volunteerRoute } from '@/components/volunteer-ui';
import { ShiftGrid } from '@/components/shift-grid';
import { ShiftCards, ContactLink } from '@/components/shift-cards';
import { ShiftDialogs, type Actions, type Dlg } from '@/components/shift-dialogs';
import { OneTimeTag } from '@/components/schedule-extras/one-time-tag';
import { Button } from '@/components/brand-system';
import { clock, calDate } from '@/components/volunteer-detail/format';
import { slotTitle } from '@/lib/shift-utils';

function Confirmation({ r, onBack }: { r: VolunteerShiftResult; onBack: () => void }) {
  return (
    <section className="rounded-2xl bg-navy p-6 text-white shadow-md" data-testid="screen-shift-confirmation" role="status">
      <CheckCircle2 size={28} aria-hidden="true" />
      <h2 className="alliance-display mt-3" tabIndex={-1} ref={el => el?.focus()}>{r.message}</h2>
      {r.emailWarning && <p className="mt-3 rounded-lg bg-white/15 px-3 py-2 text-sm" data-testid="text-email-warning">{r.emailWarning}</p>}
      <div className="mt-5 flex flex-wrap gap-3">
        <button type="button" onClick={onBack} className="alliance-button alliance-button-primary" data-testid="button-back-to-shifts">Back to my shifts</button>
        <Link href="/dashboard" className="alliance-button alliance-button-secondary" data-testid="link-go-dashboard">Go to home</Link>
      </div>
    </section>
  );
}

function ShiftsBody() {
  const auth = useAuth();
  const qc = useQueryClient();
  const q = useGetVolunteerSchedule({
    query: { queryKey: getGetVolunteerScheduleQueryKey(), refetchInterval: 60_000, staleTime: 15_000, refetchOnWindowFocus: 'always' }, request: FETCH_CREDS,
  });
  const opts = { request: auth.request };
  const book = useBookVolunteerShift(opts), change = useChangeVolunteerShift(opts), drop = useDropVolunteerShift(opts);
  const skip = useSkipVolunteerShift(opts), undo = useUndoVolunteerSkip(opts);
  const claim = useClaimCustomShift(opts), cancelOwn = useCancelOwnCustomShift(opts);
  const [customBusy, setCustomBusy] = useState<string | null>(null);
  const [customErr, setCustomErr] = useState<string | null>(null);
  const runCustom = (id: string, fn: () => Promise<unknown>) => {
    setCustomBusy(id); setCustomErr(null);
    fn().then(r => {
      qc.setQueryData(getGetVolunteerScheduleQueryKey(), r);
      void qc.invalidateQueries({ queryKey: getGetVolunteerScheduleQueryKey() });
      void qc.invalidateQueries({ queryKey: getGetVolunteerDashboardQueryKey() });
    }).catch(e => {
      setCustomErr(readError(e, "We couldn't save that change. Please try again.").message);
      void qc.invalidateQueries({ queryKey: getGetVolunteerScheduleQueryKey() });
    }).finally(() => setCustomBusy(null));
  };
  const [dlg, setDlg] = useState<Dlg | null>(null);
  const [changing, setChanging] = useState<VolunteerStandingShift | null>(null);
  const [done, setDone] = useState<VolunteerShiftResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const s = q.data;

  async function run(fn: () => Promise<VolunteerShiftResult>) {
    setBusy(true); setErr(null);
    try {
      const r = await fn();
      await Promise.all([
        qc.invalidateQueries({ queryKey: getGetVolunteerScheduleQueryKey() }),
        qc.invalidateQueries({ queryKey: getGetVolunteerDashboardQueryKey() }),
      ]);
      setDlg(null); setChanging(null); setDone(r);
    } catch (e) {
      setErr(readError(e, "We couldn't save that change. Please try again.").message);
      void qc.invalidateQueries({ queryKey: getGetVolunteerScheduleQueryKey() });
      void qc.invalidateQueries({ queryKey: getGetVolunteerDashboardQueryKey() });
    } finally { setBusy(false); }
  }
  const act: Actions = {
    book: (slotId, startDate) => { void run(() => book.mutateAsync({ data: { slotId, startDate } })); },
    change: (assignmentId, slotId, startDate) => { void run(() => change.mutateAsync({ assignmentId, data: { slotId, startDate } })); },
    drop: assignmentId => { void run(() => drop.mutateAsync({ assignmentId })); },
    skip: (assignmentId, date) => { void run(() => skip.mutateAsync({ assignmentId, data: { date } })); },
    startChange: a => { setErr(null); setChanging(a); },
  };
  const open = (d: Dlg | null) => { setErr(null); setDlg(d); };

  return (
    <VolunteerPage kicker="My shifts" title="Your weekly shifts">
      <span id="shifts-heading" tabIndex={-1} className="sr-only">Shifts</span>
      {done ? <Confirmation r={done} onBack={() => setDone(null)} /> : q.isPending ? <LoadingBlock /> : !s ? <ErrorBlock what="your shifts" onRetry={() => { void q.refetch(); }} /> : (
        <>
          {q.isError && <Notice>This page may be out of date: we couldn't refresh your shifts. <button type="button" className="font-bold underline" onClick={() => { void q.refetch(); }}>Try again</button></Notice>}
          {err && !dlg && <Notice>{err}</Notice>}
          {!s.canBook && (
            <div className="rounded-2xl bg-white p-5 shadow-sm" data-testid="card-blocked">
              <h2 className="alliance-section-kicker">Why you can't book yet</h2>
              <ul className="mt-2 list-disc pl-5">{s.blockedReasons.map(r => <li key={r}>{r}</li>)}</ul>
              <p className="mt-3 text-sm">Questions? Contact <ContactLink email={s.contactEmail} />.</p>
            </div>
          )}
          <section aria-labelledby="mine-h">
            <h2 id="mine-h" className="alliance-section-kicker mb-3">Your standing shifts ({s.assignments.length} of {s.maxShifts})</h2>
            {s.assignments.length === 0 ? (
              <EmptyState title="No shifts yet" description={s.canBook ? 'Choose a weekly time to start helping local families find their way to support.' : 'Your shifts will show here once you can book.'} />
            ) : (
              <ShiftCards assignments={s.assignments} contactEmail={s.contactEmail} busy={busy}
                onChange={a => { setChanging(a); }} onDrop={a => open({ kind: 'drop', a })} onSkip={a => open({ kind: 'skip', a })}
                onUndo={(a, d) => { if (d.skipId) { const skipId = d.skipId; void run(() => undo.mutateAsync({ assignmentId: a.id, skipId })); } }} />
            )}
          </section>
          {(s.customShifts?.length ?? 0) > 0 && (
            <section aria-labelledby="one-time-h" data-testid="section-one-time-shifts">
              <h2 id="one-time-h" className="alliance-section-kicker mb-3">One-time shifts</h2>
              {customErr && <Notice>{customErr}</Notice>}
              <ul className="grid gap-2">
                {s.customShifts!.map(c => (
                  <li key={c.id} className="rounded-xl border-2 border-dashed border-blue bg-white p-4" data-testid={`card-custom-${c.id}`}>
                    <p className="font-bold">{calDate(c.date)}, {clock(c.startTime)} to {clock(c.endTime)} <OneTimeTag className="ml-1 align-middle" /></p>
                    {c.label && <p className="text-sm">{c.label}</p>}
                    <p className="mt-1 text-sm">{c.ownAssignmentId ? 'You are signed up.' : `${c.openSpots} ${c.openSpots === 1 ? 'spot' : 'spots'} open`}</p>
                    <div className="mt-3">
                      {c.ownAssignmentId ? (c.canCancel
                        ? <Button type="button" variant="secondary" disabled={customBusy === c.id} onClick={() => runCustom(c.id, () => cancelOwn.mutateAsync({ customShiftId: c.id }))} data-testid={`button-cancel-custom-${c.id}`}>{customBusy === c.id ? 'Cancelling...' : 'Cancel my spot'}</Button>
                        : <p className="text-sm" data-testid={`text-contact-custom-${c.id}`}>This shift is less than 24 hours away. To cancel, contact <ContactLink email={s.contactEmail} />.</p>)
                        : c.openToVolunteers && c.openSpots > 0 && (
                          <Button type="button" disabled={!s.canBook || customBusy === c.id} onClick={() => runCustom(c.id, () => claim.mutateAsync({ customShiftId: c.id }))} data-testid={`button-claim-custom-${c.id}`}>{customBusy === c.id ? 'Claiming...' : 'Claim this shift'}</Button>)}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <section aria-labelledby="week-h">
            <h2 id="week-h" className="alliance-section-kicker mb-3">{changing ? 'Pick a new shift' : 'Weekly schedule, Monday to Friday'}</h2>
            {changing && (
              <div className="mb-3 flex flex-wrap items-center gap-3 rounded-xl bg-[var(--alliance-amber)] px-4 py-3 text-[var(--alliance-amber-ink)]" data-testid="banner-change-mode">
                <span className="text-sm font-bold">Changing {slotTitle(changing)}. Choose an open shift.</span>
                <button type="button" className="ml-auto min-h-11 font-bold underline" onClick={() => setChanging(null)} data-testid="button-cancel-change">Cancel change</button>
              </div>
            )}
            <ShiftGrid schedule={s} changing={changing} disabled={!s.canBook || busy}
              onPick={slot => open(changing ? { kind: 'change', from: changing, slot } : { kind: 'book', slot })} />
          </section>
          {dlg && <ShiftDialogs dlg={dlg} schedule={s} busy={busy} error={err} onClose={() => open(null)} act={act} />}
        </>
      )}
    </VolunteerPage>
  );
}
export const ShiftsPage = volunteerRoute(() => <ShiftsBody />);
