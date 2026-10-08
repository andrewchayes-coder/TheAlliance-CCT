import { useState, type ReactNode } from 'react';
import { Link, useParams } from 'wouter';
import { ChevronLeft } from 'lucide-react';
import { getGetAdminVolunteerQueryKey, useGetAdminVolunteer, type VolunteerActivity } from '@workspace/api-client-react';
import { AppLayout, Button, EmptyState, StatusBadge } from '@/components/brand-system';
import { Skeleton } from '@/components/ui/skeleton';
import { Notice } from '@/auth/auth-ui';
import { FETCH_CREDS, FRESH_MS } from '@/auth/auth-context';
import { onboardingQuestions, formatOnboardingAnswer } from '@workspace/shared/onboardingQuestions';
import { ATTN, BG, CERT, DAYS, STATUS, calDate, clock, stamp, type Badge } from './format';
import { AdminScheduleControls } from '@/components/schedule-controls/admin-schedule-controls';
import { MessageHistory } from '@/components/messages/sent-list';
import { StatusPanel } from './status-panel';
import { TrackingPanel } from './tracking-panel';
import { NotesPanel } from './notes-panel';

function Pill({ map, value }: { map: Record<string, [string, Badge]>; value: string }) {
  const [label, kind] = map[value] ?? [value, 'neutral' as Badge];
  return <StatusBadge status={kind}>{label}</StatusBadge>;
}
function Item({ label, children }: { label: string; children: ReactNode }) {
  return <div><dt className="alliance-label">{label}</dt><dd className="break-words">{children}</dd></div>;
}
function ActivityLine({ a }: { a: VolunteerActivity }) {
  const det = a.details ?? {};
  let text: string;
  if (a.action === 'status_changed') {
    const f = String(det.from ?? ''), t = String(det.to ?? '');
    text = `Status changed${f || t ? `: ${STATUS[f]?.[0] ?? (f || 'unknown')} to ${STATUS[t]?.[0] ?? (t || 'unknown')}` : ''}`;
  } else if (a.action === 'tracking_updated') {
    const ch = det.changes && typeof det.changes === 'object' ? Object.keys(det.changes) : [];
    text = ch.length ? `Tracking updated (${ch.map(c => String(c).replace(/([A-Z])/g, ' $1').toLowerCase()).join(', ')})` : 'Tracking updated';
  } else text = a.action.replace(/_/g, ' ');
  return (
    <li className="py-2 text-sm" data-testid={`activity-${a.id}`}>
      <span className="font-bold">{text}</span>
      {det.override === true && <span className="block text-[var(--alliance-amber-ink)]">Staff override{Array.isArray(det.overrides) && det.overrides.length ? `: ${det.overrides.map(v => String(v).replace(/_/g, ' ')).join(', ')}` : ''}</span>}
      {typeof det.reason === 'string' && det.reason.trim() && <span className="block">Reason: {det.reason}</span>}
      <span className="block text-navy-soft">{a.actorName || 'Staff'} · {stamp(a.createdAt)}</span>
    </li>
  );
}

export function VolunteerDetail() {
  const { userId = '' } = useParams<{ userId: string }>();
  const q = useGetAdminVolunteer(userId, {
    query: { queryKey: getGetAdminVolunteerQueryKey(userId), enabled: !!userId, staleTime: FRESH_MS, refetchInterval: 60_000, refetchOnWindowFocus: 'always', retry: false },
    request: FETCH_CREDS,
  });
  const [notesPending, setNotesPending] = useState(false);
  const [trackDirty, setTrackDirty] = useState(false);
  const d = q.data; const e = d?.entry; const p = e?.profile;
  const statusBlock = notesPending ? 'Admin notes are still saving. Wait for "Saved" before changing status.' : trackDirty ? 'Save or discard your tracking edits before changing status.' : null;
  const trackBlock = notesPending ? 'Admin notes are still saving. Wait for "Saved" before saving tracking.' : null;

  return (
    <AppLayout role="admin">
      <Link href="/admin/volunteers" className="mb-3 inline-flex items-center gap-1 text-sm font-bold text-teal-text underline underline-offset-4" data-testid="link-back-roster"><ChevronLeft size={16} aria-hidden="true" />Back to roster</Link>
      {q.isPending ? (
        <div className="mt-4 space-y-3" role="status" aria-busy="true"><span className="sr-only">Loading</span>{[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-24 w-full" />)}</div>
      ) : !d || !e || !p ? (
        <div className="mt-6"><Notice>We couldn't load this volunteer.</Notice><Button onClick={() => { void q.refetch(); }}>Try again</Button></div>
      ) : (
        <>
          {q.isError && <div className="mt-2"><Notice kind="info">Couldn't refresh. Showing the last loaded details.</Notice></div>}
          <h1 className="alliance-display text-[22px] md:text-[28px]" data-testid="text-volunteer-name">{e.user.firstName} {e.user.lastName}</h1>
          <div className="mt-3 flex flex-wrap gap-2">
            <Pill map={STATUS} value={p.status} />
            <StatusBadge status="neutral">{p.county} County</StatusBadge>
            {e.attention.map(a => <StatusBadge key={a} status="attention">{ATTN[a] ?? a}</StatusBadge>)}
          </div>
          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <Item label="Email"><a href={`mailto:${e.user.email}`} className="break-all font-bold text-teal-text underline underline-offset-4" data-testid="link-email">{e.user.email}</a></Item>
            <Item label="Phone">{e.user.phone ? <a href={`tel:${e.user.phone}`} className="font-bold text-teal-text underline underline-offset-4" data-testid="link-phone">{e.user.phone}</a> : 'Not provided'}</Item>
            <Item label="Joined">{stamp(e.user.createdAt)}</Item>
            <Item label="Last login">{stamp(e.user.lastLoginAt) ?? 'Never'}</Item>
          </dl>
          <div className="mt-4 flex flex-wrap gap-4 text-sm font-bold">
            <Link href={`/admin/volunteers/${e.user.id}/onboarding`} className="text-teal-text underline underline-offset-4" data-testid="link-review-onboarding">Review onboarding</Link>
            <Link href="/admin/team" className="text-teal-text underline underline-offset-4" data-testid="link-manage-account">Manage account</Link>
          </div>

          <StatusPanel userId={userId} detail={d} blockedReason={statusBlock} />
          <TrackingPanel userId={userId} detail={d} blockedReason={trackBlock} onDirty={setTrackDirty} />

          <section className="alliance-card mt-6" aria-labelledby="v-onb">
            <h2 id="v-onb" className="alliance-display text-[15px]">Onboarding</h2>
            <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
              <Item label="Agreement acknowledged">{stamp(p.agreementAcknowledgedAt) ?? 'Not recorded'}</Item>
              <Item label="Agreement version">{p.agreementVersion ?? 'None'}</Item>
              <Item label="Onboarding completed">{stamp(p.onboardingCompletedAt) ?? 'Not completed'}</Item>
              <Item label="Availability notes"><span className="whitespace-pre-wrap">{p.availabilityNotes || 'None'}</span></Item>
            </dl>
            <dl className="mt-3 divide-y divide-gray">
              {onboardingQuestions.map(qn => {
                const v = p.onboardingAnswers?.[qn.id];
                const text = v === undefined ? '' : formatOnboardingAnswer(v);
                return (
                  <div key={qn.id} className="py-3" data-testid={`answer-${qn.id}`}>
                    <dt className="text-sm font-bold">{qn.label}</dt>
                    <dd className="mt-1 whitespace-pre-wrap break-words">{text || <span className="text-navy-soft">No answer</span>}</dd>
                  </div>
                );
              })}
            </dl>
          </section>

          <section className="alliance-card mt-6" aria-labelledby="v-shifts">
            <h2 id="v-shifts" className="alliance-display text-[15px]">Current shifts</h2>
            {d.shifts.length === 0 ? (
              <div className="mt-3"><EmptyState title="No shifts assigned" description="This volunteer does not hold a recurring shift." /></div>
            ) : (
              <ul className="mt-3 divide-y divide-gray">
                {d.shifts.map(s => (
                  <li key={s.assignmentId} className="py-3 text-sm" data-testid={`shift-${s.assignmentId}`}>
                    <p className="font-bold">{DAYS[s.dayOfWeek] ?? `Day ${s.dayOfWeek}`}, {clock(s.startTime)} to {clock(s.endTime)}{s.label ? ` · ${s.label}` : ''}</p>
                    <p>From {calDate(s.startDate)}{s.endDate ? ` until ${calDate(s.endDate)}` : ', ongoing'}</p>
                    {s.upcomingSkipDates.length > 0 && <p className="mt-1 text-[#785213]">Skipping: {s.upcomingSkipDates.map(calDate).join(', ')}</p>}
                  </li>
                ))}
              </ul>
            )}
            <AdminScheduleControls userId={userId} />
          </section>

          <section className="alliance-card mt-6" aria-labelledby="v-msg">
            <h2 id="v-msg" className="alliance-display text-[15px]">Messages</h2>
            <MessageHistory userId={userId} step={10} />
            <Link href={`/admin/messages?userId=${userId}`} className="alliance-button mt-4" data-testid="link-message-volunteer">Message this volunteer</Link>
          </section>

          <NotesPanel userId={userId} serverNotes={d.adminNotes} onPending={setNotesPending} />

          <section className="alliance-card mt-6" aria-labelledby="v-act">
            <h2 id="v-act" className="alliance-display text-[15px]">Recent activity</h2>
            {d.activity.length === 0 ? <p className="mt-2 text-sm text-navy-soft">No activity recorded yet.</p>
              : <ul className="mt-2 divide-y divide-gray">{d.activity.slice(0, 50).map(a => <ActivityLine key={a.id} a={a} />)}</ul>}
            <p className="mt-2 text-xs text-navy-soft">Showing the latest 50 entries.</p>
          </section>
        </>
      )}
    </AppLayout>
  );
}
