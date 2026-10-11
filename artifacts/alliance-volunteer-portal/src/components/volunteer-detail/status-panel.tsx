import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetAdminVolunteerQueryKey, getListVolunteerRosterQueryKey, useChangeVolunteerStatus,
  type AdminAssignedShift, type AdminVolunteerDetail, type VolunteerStatusUpdate,
} from '@workspace/api-client-react';
import { Button } from '@/components/brand-system';
import { Notice } from '@/auth/auth-ui';
import { readError, useAuth } from '@/auth/auth-context';
import { DAYS, STATUS, STATUS_ORDER, calDate, clock } from './format';

type Target = VolunteerStatusUpdate['status'];
type Snapshot = { target: Target; expectedUpdatedAt: string; shifts: AdminAssignedShift[] };

const COPY: Record<string, string> = {
  applicant: 'This moves the volunteer back to Applicant. They stay in the roster and keep their shifts.',
  in_training: 'This marks the volunteer as In training. They stay in the roster and keep their shifts.',
  active: 'This approves the volunteer as Active and sends them an approval email.',
  inactive: 'This marks the volunteer Inactive. Every shift below ends today, and those seats open up for others.',
};

function ShiftLine({ s }: { s: AdminAssignedShift }) {
  return (
    <li className="py-2 text-sm" data-testid={`release-${s.assignmentId}`}>
      <p className="font-bold">{DAYS[s.dayOfWeek] ?? `Day ${s.dayOfWeek}`}, {clock(s.startTime)} to {clock(s.endTime)}{s.label ? ` · ${s.label}` : ''}</p>
      <p>From {calDate(s.startDate)}{s.endDate ? ` until ${calDate(s.endDate)}` : ', ongoing'}</p>
    </li>
  );
}

function Confirm({ snap, current, busy, error, onCancel, onConfirm }: {
  snap: Snapshot; current: AdminVolunteerDetail; busy: boolean; error: string | null; onCancel: () => void; onConfirm: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current; const back = document.activeElement as HTMLElement | null;
    if (d && !d.open) d.showModal();
    return () => { if (back?.isConnected) back.focus(); };
  }, []);
  const label = STATUS[snap.target][0];
  const nowIds = current.assignmentsToRelease.map(a => a.assignmentId).sort().join(',');
  const snapIds = snap.shifts.map(a => a.assignmentId).sort().join(',');
  const changed = snap.target === 'inactive' && (nowIds !== snapIds || current.entry.profile.updatedAt !== snap.expectedUpdatedAt);
  return (
    <dialog ref={ref} onCancel={e => { e.preventDefault(); if (!busy) onCancel(); }} aria-labelledby="status-dlg-h" data-testid="dialog-status"
      className="m-auto w-[min(92vw,34rem)] max-h-[88dvh] overflow-y-auto rounded-2xl bg-white p-5 text-navy">
      <h2 id="status-dlg-h" className="alliance-display">Change status to {label}?</h2>
      <p className="mt-2 text-sm">{COPY[snap.target]}</p>
      {snap.target === 'inactive' && (
        snap.shifts.length === 0 ? <p className="mt-3 text-sm font-bold">No current or future shifts will be released.</p> : (
          <div className="mt-3">
            <p className="text-sm font-bold">{snap.shifts.length} {snap.shifts.length === 1 ? 'shift' : 'shifts'} will end today:</p>
            <ul className="mt-1 divide-y divide-gray rounded-lg bg-gray px-3" data-testid="list-release">{snap.shifts.map(s => <ShiftLine key={s.assignmentId} s={s} />)}</ul>
          </div>
        ))}
      {changed && <div className="mt-3"><Notice>This volunteer's shifts or record changed while this window was open. Close it and review the latest before confirming. Nothing was changed.</Notice></div>}
      {error && <div className="mt-3"><Notice>{error}</Notice></div>}
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel} disabled={busy} data-testid="button-status-cancel">{error || changed ? 'Close' : 'Cancel'}</Button>
        <Button type="button" onClick={onConfirm} disabled={busy || changed} data-testid="button-status-confirm">{busy ? 'Saving…' : `Confirm ${label}`}</Button>
      </div>
    </dialog>
  );
}

export function StatusPanel({ userId, detail, blockedReason }: { userId: string; detail: AdminVolunteerDetail; blockedReason: string | null }) {
  const { request } = useAuth();
  const qc = useQueryClient();
  const m = useChangeVolunteerStatus({ request });
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ kind: 'good' | 'warn'; text: string } | null>(null);
  const cur = detail.entry.profile.status;
  const missing = detail.approvalRequirements.filter(r => !r.met);

  const open = (t: Target) => {
    setError(null); setResult(null);
    setSnap({ target: t, expectedUpdatedAt: detail.entry.profile.updatedAt, shifts: t === 'inactive' ? [...detail.assignmentsToRelease] : [] });
  };
  const confirm = () => {
    if (!snap) return;
    const data: VolunteerStatusUpdate = { status: snap.target, expectedUpdatedAt: snap.expectedUpdatedAt,
      ...(snap.target === 'inactive' ? { releaseAssignmentIds: snap.shifts.map(s => s.assignmentId) } : {}) };
    setError(null);
    m.mutate({ userId, data }, {
      onSuccess: r => {
        qc.setQueryData(getGetAdminVolunteerQueryKey(userId), r.detail);
        void qc.invalidateQueries({ queryKey: getGetAdminVolunteerQueryKey(userId) });
        void qc.invalidateQueries({ queryKey: getListVolunteerRosterQueryKey() });
        const label = STATUS[snap.target][0];
        let text = `Status changed to ${label}.`; let kind: 'good' | 'warn' = 'good';
        if (snap.target === 'inactive') text += ` ${r.releasedAssignmentCount} ${r.releasedAssignmentCount === 1 ? 'shift' : 'shifts'} ended today.`;
        if (snap.target === 'active' && r.emailDelivery) {
          if (r.emailDelivery.ok) text += r.emailDelivery.status === 'logged' ? ' Approval email logged for testing (not sent).' :
            r.emailDelivery.status === 'sent' ? ' Approval email sent.' : ' Approval email processed.';
          else { kind = 'warn'; text += r.emailDelivery.skipped ? ' The approval email was skipped and was not sent. Let the volunteer know directly.' : ' The approval email failed to send. The approval stands, so let the volunteer know directly.'; }
        }
        setResult({ kind, text }); setSnap(null);
      },
      onError: e => {
        const f = readError(e);
        setError(f.status === 409 ? 'This volunteer or their shifts changed since you opened this window. Nothing was changed. Close it and review the latest before confirming again.' : f.message);
      },
    });
  };

  return (
    <section className="alliance-card mt-6" aria-labelledby="v-status">
      <h2 id="v-status" className="alliance-display">Program status</h2>
      <ol className="mt-3 grid gap-2 sm:grid-cols-4" aria-label="Volunteer status steps">
        {STATUS_ORDER.map((s, i) => {
          const on = s === cur;
          const dis = !on && (!!blockedReason || m.isPending || (s === 'active' && missing.length > 0));
          return (
            <li key={s}>
              <button type="button" disabled={dis} aria-current={on ? 'step' : undefined} onClick={() => !on && open(s)} data-testid={`step-${s}`}
                className={`flex min-h-11 w-full items-center gap-2 rounded-xl border px-3 text-left text-sm font-bold focus-visible:outline-2 focus-visible:outline-blue disabled:opacity-50 ${on ? 'border-navy bg-navy text-white' : 'border-gray bg-white'}`}>
                <span className="tabular-nums" aria-hidden="true">{i + 1}.</span>{STATUS[s][0]}{on && <span className="sr-only"> (current)</span>}
              </button>
            </li>
          );
        })}
      </ol>
      <p className="mt-2 text-xs text-navy-soft">Move in any direction. You'll confirm before anything changes.</p>
      {blockedReason && <p className="mt-2 text-sm font-bold" role="status">{blockedReason}</p>}
      {cur !== 'active' && missing.length > 0 && (
        <div className="mt-3 text-sm" data-testid="list-missing">
          <p className="font-bold">Active is unavailable until these are done:</p>
          <ul className="mt-1 list-disc pl-5">{missing.map(r => <li key={r.key}>{r.label}</li>)}</ul>
        </div>
      )}
      <div className="mt-3">{result && <Notice kind={result.kind === 'good' ? 'success' : 'info'}>{result.text}</Notice>}</div>
      {snap && <Confirm snap={snap} current={detail} busy={m.isPending} error={error} onCancel={() => { setSnap(null); setError(null); }} onConfirm={confirm} />}
    </section>
  );
}
