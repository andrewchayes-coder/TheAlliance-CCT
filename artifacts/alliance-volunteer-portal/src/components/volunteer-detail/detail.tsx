import { AccountEditor } from '@/components/account-editor';
import { ContactLink } from '@/components/shift-cards';
import { useState, type ReactNode } from 'react';
import { Link, useParams } from 'wouter';
import { PageHeader } from '@/components/page-header';
import { TestBadge } from '@/components/test-badge';
import { ChevronLeft } from 'lucide-react';
import { getGetAdminVolunteerQueryKey, useGetAdminVolunteer, type VolunteerActivity } from '@workspace/api-client-react';
import { AppLayout, Button, EmptyState, StatusBadge } from '@/components/brand-system';
import { Skeleton } from '@/components/ui/skeleton';
import { Notice } from '@/auth/auth-ui';
import { FETCH_CREDS, FRESH_MS } from '@/auth/auth-context';
import { formatPhone, normalizeVolunteerStatus } from '@workspace/shared/profileFields';
import { appConfig } from '@workspace/shared/appConfig';
import { onboardingQuestions, formatOnboardingAnswer } from '@workspace/shared/onboardingQuestions';
import { ATTN, DAYS, STATUS, attnVisible, calDate, clock, flags, stamp, type Badge } from './format';
import { AdminScheduleControls } from '@/components/schedule-controls/admin-schedule-controls';
import { MessageHistory } from '@/components/messages/sent-list';
import { StatusPanel } from './status-panel';
import { TrackingPanel } from './tracking-panel';
import { ProfileCard, StartDateEditor } from './profile-editor';
import { HoursCard } from './hours-card';
import { NotesPanel } from './notes-panel';

function Pill({ map, value }: { map: Record<string, [string, Badge]>; value: string }) {
  const [label, kind] = map[value] ?? [value, 'neutral' as Badge];
  return <StatusBadge status={kind}>{label}</StatusBadge>;
}
function Item({ label, children }: { label: string; children: ReactNode }) {
  return <div><dt className="alliance-label">{label}</dt><dd className="break-words">{children}</dd></div>;
}
const FIELD_LABEL: Record<string, string> = { dateOfBirth: 'date of birth', startDate: 'start date', addressLine1: 'address', city: 'city', state: 'state', zip: 'ZIP', emergencyContactName: 'emergency contact name', emergencyContactRelationship: 'emergency contact relationship', emergencyContactPhone: 'emergency contact phone', county: 'county' };
function ActivityLine({ a }: { a: VolunteerActivity }) {
  if (!appConfig.requireAgreementAcknowledgment && a.action.includes('agreement')) return null;
  const det = a.details ?? {};
  let text: string;
  if (a.action === 'status_changed') {
    const f = String(det.from ?? ''), t = String(det.to ?? '');
    text = `Status changed${f || t ? `: ${STATUS[f]?.[0] ?? (f || 'unknown')} to ${STATUS[t]?.[0] ?? (t || 'unknown')}` : ''}`;
  } else if (a.action === 'tracking_updated') {
    const raw = Array.isArray(det.fields) ? det.fields.map(String) : det.changes && typeof det.changes === 'object' ? Object.keys(det.changes) : [];
    const ch = raw.filter(key => (!key.startsWith('certification') || appConfig.trackCertificationInApp) &&
      (!key.startsWith('backgroundCheck') || appConfig.trackBackgroundCheckInApp) && (!key.startsWith('agreement') || appConfig.requireAgreementAcknowledgment));
    if (!ch.length) return null;
    text = `Profile updated (${ch.map(c => (FIELD_LABEL[c] ?? c.replace(/([A-Z])/g, ' $1').toLowerCase())).join(', ')})`;
  } else if (a.action === 'start_date_changed') text = 'Start date changed';
  else if (a.action === 'hours_logged' || a.action === 'hours_updated' || a.action === 'hours_deleted') {
    const h = typeof det.hours === 'number' ? ` (${det.hours} h${typeof det.shiftDate === 'string' ? `, ${calDate(det.shiftDate)}` : ''})` : '';
    text = `Hours ${a.action === 'hours_logged' ? 'logged' : a.action === 'hours_updated' ? 'updated' : 'removed'}${h}${det.by === 'volunteer' ? ' by volunteer' : ''}`;
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
      <Link href="/admin/volunteers" className="mb-1 inline-flex min-h-11 items-center gap-1 text-sm font-bold text-blue underline underline-offset-4" data-testid="link-back-roster"><ChevronLeft size={16} aria-hidden="true" />Back to roster</Link>
      {q.isPending ? (
        <div className="mt-4 space-y-3" role="status" aria-busy="true"><span className="sr-only">Loading</span>{[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-24 w-full" />)}</div>
      ) : !d || !e || !p ? (
        <div className="mt-6"><Notice>Something went wrong on our end. Please try again. If it keeps happening, let <ContactLink /> know.</Notice><Button onClick={() => { void q.refetch(); }}>Try again</Button></div>
      ) : (
        <>
          {q.isError && <div className="mt-2"><Notice kind="info">Couldn't refresh. Showing the last loaded details.</Notice></div>}
          <PageHeader title={`${e.user.firstName} ${e.user.lastName}`} titleTestId="text-volunteer-name" titleSuffix={<TestBadge test={e.user.isTestAccount} />} className="mb-3" />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Pill map={STATUS} value={normalizeVolunteerStatus(p.status)} />
            {p.county && <StatusBadge status="neutral">{p.county} County</StatusBadge>}
            {e.attention.filter(attnVisible).map(a => <StatusBadge key={a} status="attention">{ATTN[a] ?? a}</StatusBadge>)}
          </div>
          <dl className="volunteer-detail-meta mt-4 grid items-start gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,0.85fr)_minmax(0,0.95fr)_repeat(2,minmax(0,1.15fr))]" data-testid="volunteer-header-details">
            <Item label="Email"><a href={`mailto:${e.user.email}`} className="inline-flex items-start font-bold text-blue underline underline-offset-4" data-testid="link-email">{e.user.email}</a></Item>
            <Item label="Phone">{e.user.phone ? <a href={`tel:${e.user.phone}`} className="inline-flex items-start font-bold text-blue underline underline-offset-4" data-testid="link-phone">{formatPhone(e.user.phone) || e.user.phone}</a> : 'Not provided'}</Item>
            <StartDateEditor userId={userId} detail={d} />
            <Item label="Joined">{stamp(e.user.createdAt)}</Item>
            <Item label="Last login">{stamp(e.user.lastLoginAt) ?? 'Never'}</Item>
          </dl>
          <div className="mt-4 flex flex-wrap gap-4 text-sm font-bold">
            <Link href={`/admin/volunteers/${e.user.id}/onboarding`} className="text-blue underline underline-offset-4" data-testid="link-review-onboarding">Review onboarding</Link>
            <button type="button" onClick={() => document.getElementById('review-account')?.scrollIntoView({ behavior: 'smooth' })} className="text-blue underline underline-offset-4" data-testid="link-manage-account">Manage account details</button>
          </div>

          <StatusPanel userId={userId} detail={d} blockedReason={statusBlock} />
          <div id="review-account" className="mt-6"><h2 className="alliance-display mb-3">Account details (not program approval)</h2><AccountEditor key={userId} userId={userId} managed /></div>
          <div id="review-profile"><ProfileCard userId={userId} detail={d} blockedReason={trackBlock} /></div>
          <div id="review-tracking"><TrackingPanel userId={userId} detail={d} blockedReason={trackBlock} onDirty={setTrackDirty} /></div>

          <section id="review-onboarding" className="alliance-card mt-6" aria-labelledby="v-onb">
            <h2 id="v-onb" className="alliance-display">Onboarding</h2>
            <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
              {flags.agree && <Item label="Agreement acknowledged">{stamp(p.agreementAcknowledgedAt) ?? 'Not recorded'}</Item>}
              {flags.agree && <Item label="Agreement version">{p.agreementVersion ?? 'None'}</Item>}
              <Item label="Onboarding completed">{stamp(p.onboardingCompletedAt) ?? 'Not completed'}</Item>
              {onboardingQuestions.length > 0 && <Item label="Availability notes"><span className="whitespace-pre-wrap">{p.availabilityNotes || 'None'}</span></Item>}
            </dl>
            {onboardingQuestions.length > 0 && <dl className="mt-3 divide-y divide-gray">
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
            </dl>}
          </section>

          <section className="alliance-card mt-6" aria-labelledby="v-shifts">
            <h2 id="v-shifts" className="alliance-display">Current shifts</h2>
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

          <HoursCard userId={userId} />

          <section className="alliance-card mt-6" aria-labelledby="v-msg">
            <h2 id="v-msg" className="alliance-display">Messages</h2>
            <MessageHistory userId={userId} step={10} />
            <Link href={`/admin/messages?userId=${userId}`} className="alliance-button mt-4" data-testid="link-message-volunteer">Message this volunteer</Link>
          </section>

          <NotesPanel userId={userId} serverNotes={d.adminNotes} onPending={setNotesPending} />

          <section className="alliance-card mt-6" aria-labelledby="v-act">
            <h2 id="v-act" className="alliance-display">Recent activity</h2>
            {d.activity.length === 0 ? <p className="mt-2 text-sm text-navy-soft">No activity recorded yet.</p>
              : <ul className="mt-2 divide-y divide-gray">{d.activity.slice(0, 50).map(a => <ActivityLine key={a.id} a={a} />)}</ul>}
            <p className="mt-2 text-xs text-navy-soft">Showing the latest 50 entries.</p>
          </section>
        </>
      )}
    </AppLayout>
  );
}
