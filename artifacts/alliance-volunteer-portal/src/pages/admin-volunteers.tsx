import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useLocation, useParams } from 'wouter';
import { keepPreviousData } from '@tanstack/react-query';
import { ChevronLeft, Download, Search } from 'lucide-react';
import {
  getGetAdminVolunteerQueryKey, getListVolunteerRosterQueryKey, useGetAdminVolunteer, useListVolunteerRoster,
  type ListVolunteerRosterParams, type PublicVolunteerProfile, type VolunteerRosterEntry,
} from '@workspace/api-client-react';
import { AppLayout, Button, EmptyState, StatusBadge } from '@/components/brand-system';
import { Skeleton } from '@/components/ui/skeleton';
import { RequireAdmin } from '@/auth/guards';
import { Notice } from '@/auth/auth-ui';
import { FETCH_CREDS, FRESH_MS } from '@/auth/auth-context';
import { appConfig } from '@workspace/shared/appConfig';
import { onboardingQuestions, formatOnboardingAnswer } from '@workspace/shared/onboardingQuestions';
import { onMessageSelected as defaultOnMessageSelected } from '@/lib/messaging';

const PAGE = 25;
const POLL_MS = 60_000;
const TZ = appConfig.timezone;
type Badge = 'neutral' | 'good' | 'attention' | 'blocked';

const STATUS: Record<string, [string, Badge]> = {
  applicant: ['Applicant', 'neutral'], in_training: ['In training', 'attention'], active: ['Active', 'good'], inactive: ['Inactive', 'blocked'],
};
const CERT: Record<string, [string, Badge]> = {
  not_started: ['Not started', 'neutral'], in_progress: ['In progress', 'attention'], complete: ['Complete', 'good'],
};
const BG: Record<string, [string, Badge]> = {
  not_started: ['Not started', 'neutral'], pending: ['Pending', 'attention'], cleared: ['Cleared', 'good'], not_cleared: ['Not cleared', 'blocked'],
};
const ATTN: Record<string, string> = {
  any: 'Any attention', no_shift: 'No shift', certification_expiring: 'Certification expiring',
  background_pending: 'Background pending', onboarding_incomplete: 'Onboarding incomplete',
};
const DAYS = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

const pacific = (iso: string | null | undefined, withTime = true) => iso
  ? /^\d{4}-\d{2}-\d{2}$/.test(iso) ? calDate(iso) :
    new Date(iso).toLocaleString('en-US', { timeZone: TZ, dateStyle: 'medium', ...(withTime ? { timeStyle: 'short' } : {}) }) + (withTime ? ' PT' : '')
  : null;
const calDate = (d: string) => new Date(`${d.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', dateStyle: 'medium' });
const clock = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};
const fullName = (e: VolunteerRosterEntry) => `${e.user.firstName} ${e.user.lastName}`;

function Pill({ map, value }: { map: Record<string, [string, Badge]>; value: string }) {
  const [label, kind] = map[value] ?? [value, 'neutral' as Badge];
  return <StatusBadge status={kind}>{label}</StatusBadge>;
}
function ShiftCell({ e }: { e: VolunteerRosterEntry }) {
  if (e.profile.status === 'active' && e.shiftCount === 0) return <StatusBadge status="attention">No shift</StatusBadge>;
  return <span>{e.shiftCount}</span>;
}

function Loading() {
  return (
    <div className="mt-4 space-y-3" role="status" aria-busy="true"><span className="sr-only">Loading</span>
      {[0, 1, 2, 3, 4].map(i => <Skeleton key={i} className="h-14 w-full" />)}</div>
  );
}

const selectCls = 'alliance-input';

function RosterBody({ onMessageSelected = defaultOnMessageSelected }: { onMessageSelected?: (userIds: string[]) => void }) {
  const [, nav] = useLocation();
  const [text, setText] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [county, setCounty] = useState('');
  const [cert, setCert] = useState('');
  const [bg, setBg] = useState('');
  const [attn, setAttn] = useState('');
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setSearch(text.trim()), 300);
    return () => clearTimeout(t);
  }, [text]);

  const filterKey = [search, status, county, cert, bg, attn].join('|');
  useEffect(() => { setOffset(0); setSelected(new Set()); setNotice(false); }, [filterKey]);

  const filters = {
    ...(search ? { search } : {}), ...(status ? { status } : {}), ...(county ? { county } : {}),
    ...(cert ? { certificationStatus: cert } : {}), ...(bg ? { backgroundCheckStatus: bg } : {}), ...(attn ? { needsAttention: attn } : {}),
  };
  const params = { ...filters, limit: PAGE, offset } as ListVolunteerRosterParams;
  const list = useListVolunteerRoster(params, {
    query: { queryKey: getListVolunteerRosterQueryKey(params), staleTime: FRESH_MS, refetchInterval: POLL_MS, refetchOnWindowFocus: 'always', retry: false, placeholderData: keepPreviousData },
    request: FETCH_CREDS,
  });
  const data = list.data;
  const total = data?.total ?? 0;
  const rows = data?.volunteers ?? [];
  const sum = data?.summary;
  const hasFilters = Object.keys(filters).length > 0;

  const qs = new URLSearchParams(filters as Record<string, string>).toString();
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  const csv = (name: string) => `${base}/api/admin/volunteers/${name}.csv${qs ? `?${qs}` : ''}`;

  const pageIds = rows.map(r => r.user.id);
  const allOnPage = pageIds.length > 0 && pageIds.every(id => selected.has(id));
  const toggle = (id: string) => setSelected(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const togglePage = () => setSelected(s => { const n = new Set(s); pageIds.forEach(id => allOnPage ? n.delete(id) : n.add(id)); return n; });
  const reset = () => { setText(''); setSearch(''); setStatus(''); setCounty(''); setCert(''); setBg(''); setAttn(''); };

  const chips = useMemo(() => sum ? [
    { key: 'applicant', label: 'Applicants', n: sum.applicant, on: status === 'applicant', set: () => setStatus(status === 'applicant' ? '' : 'applicant') },
    { key: 'in_training', label: 'In training', n: sum.in_training, on: status === 'in_training', set: () => setStatus(status === 'in_training' ? '' : 'in_training') },
    { key: 'active', label: 'Active', n: sum.active, on: status === 'active', set: () => setStatus(status === 'active' ? '' : 'active') },
    { key: 'inactive', label: 'Inactive', n: sum.inactive, on: status === 'inactive', set: () => setStatus(status === 'inactive' ? '' : 'inactive') },
    { key: 'attention', label: 'Needs attention', n: sum.needsAttention, on: attn === 'any', set: () => setAttn(attn === 'any' ? '' : 'any') },
  ] : [], [sum, status, attn]);

  return (
    <AppLayout role="admin">
      <p className="alliance-label">Administration</p>
      <h1 className="alliance-display mt-3 text-[22px] md:text-[28px]">Volunteer roster</h1>
      <p className="mt-2 max-w-2xl">Everyone in the program, with what needs a follow-up.</p>

      <section aria-label="Roster summary" className="mt-5">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by summary">
          {sum ? chips.map(c => (
            <button key={c.key} type="button" aria-pressed={c.on} onClick={c.set} data-testid={`chip-${c.key}`}
              className={`min-h-11 rounded-full px-4 text-sm font-bold focus-visible:outline-2 focus-visible:outline-teal ${c.on ? 'bg-navy text-white' : 'bg-white shadow-sm'}`}>
              {c.label} <span className="ml-1 tabular-nums">{c.n}</span>
            </button>
          )) : [0, 1, 2, 3, 4].map(i => <Skeleton key={i} className="h-11 w-32 rounded-full" />)}
        </div>
        <p className="mt-2 text-xs text-navy-soft">Summary counts cover all volunteers and ignore the filters below.</p>
      </section>

      <section className="alliance-card mt-5" aria-labelledby="roster-h">
        <h2 id="roster-h" className="sr-only">Volunteers</h2>
        <div className="relative">
          <Search size={18} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" />
          <input type="search" aria-label="Search volunteers" placeholder="Search by name, email, or phone…" maxLength={200}
            className="alliance-input pl-10" value={text} onChange={e => setText(e.target.value)} data-testid="input-search" />
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <label className="text-sm font-bold">Status
            <select className={`${selectCls} mt-1 font-normal`} value={status} onChange={e => setStatus(e.target.value)} data-testid="filter-status">
              <option value="">All statuses</option>
              {Object.entries(STATUS).map(([v, [l]]) => <option key={v} value={v}>{l}</option>)}
            </select></label>
          <label className="text-sm font-bold">County
            <select className={`${selectCls} mt-1 font-normal`} value={county} onChange={e => setCounty(e.target.value)} data-testid="filter-county">
              <option value="">All counties</option>
              {appConfig.counties.map(c => <option key={c} value={c}>{c}</option>)}
            </select></label>
          <label className="text-sm font-bold">Certification
            <select className={`${selectCls} mt-1 font-normal`} value={cert} onChange={e => setCert(e.target.value)} data-testid="filter-cert">
              <option value="">Any certification</option>
              {Object.entries(CERT).map(([v, [l]]) => <option key={v} value={v}>{l}</option>)}
            </select></label>
          <label className="text-sm font-bold">Background check
            <select className={`${selectCls} mt-1 font-normal`} value={bg} onChange={e => setBg(e.target.value)} data-testid="filter-bg">
              <option value="">Any background check</option>
              {Object.entries(BG).map(([v, [l]]) => <option key={v} value={v}>{l}</option>)}
            </select></label>
          <label className="text-sm font-bold">Needs attention
            <select className={`${selectCls} mt-1 font-normal`} value={attn} onChange={e => setAttn(e.target.value)} data-testid="filter-attention">
              <option value="">Everyone</option>
              {Object.entries(ATTN).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select></label>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
          <a href={csv('roster')} download className="inline-flex items-center gap-1 font-bold text-teal-text underline underline-offset-4" data-testid="link-roster-csv">
            <Download size={16} aria-hidden="true" />Download roster CSV</a>
          <a href={csv('schedule')} download className="inline-flex items-center gap-1 font-bold text-teal-text underline underline-offset-4" data-testid="link-schedule-csv">
            <Download size={16} aria-hidden="true" />Download schedule CSV</a>
          <span className="text-navy-soft">Exports include all {hasFilters ? 'matching' : ''} volunteers, not just this page.</span>
          <p className="w-full text-navy-soft">Roster exports include personal information and internal admin notes. Share only with authorized staff.</p>
          {hasFilters && <Button type="button" variant="secondary" onClick={reset} data-testid="button-reset-filters">Clear filters</Button>}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg bg-gray px-4 py-3" role="region" aria-label="Selection" data-testid="bar-selection">
          <span className="font-bold" aria-live="polite" data-testid="text-selected-count">{selected.size} selected</span>
          {selected.size > 0 && <button type="button" className="text-sm font-bold text-teal-text underline underline-offset-4" onClick={() => setSelected(new Set())}>Clear selection</button>}
          <Button type="button" className="ml-auto" disabled={selected.size === 0} data-testid="button-message-selected"
            onClick={() => { onMessageSelected(Array.from(selected)); setNotice(true); }}>Message selected</Button>
        </div>
        {notice && <div className="mt-3" aria-live="polite"><Notice kind="info">Messaging is coming later. Nothing was sent, and your selection is unchanged.</Notice></div>}

        {list.isPending ? <Loading />
          : list.isError && !data ? (
            <div className="mt-4"><Notice>We couldn't load the roster.</Notice><Button onClick={() => { void list.refetch(); }}>Try again</Button></div>
          ) : data && rows.length === 0 ? (
            <div className="mt-4"><EmptyState title={hasFilters ? 'No volunteers match' : 'No volunteers yet'}
              description={hasFilters ? 'Loosen a filter or try a different search.' : 'Volunteers appear here after they sign up.'}
              action={hasFilters ? <Button type="button" variant="secondary" onClick={reset}>Clear filters</Button> : undefined} /></div>
          ) : data && (
            <div className={list.isFetching ? 'opacity-70' : ''} aria-busy={list.isFetching}>
              {list.isError && <div className="mt-4"><Notice>Couldn't refresh the roster. Showing the last loaded results.</Notice></div>}
              {/* Desktop table */}
              <div className="mt-4 hidden overflow-x-auto md:block">
                <table className="w-full min-w-[960px] text-left text-sm" data-testid="table-roster">
                  <caption className="sr-only">Volunteer roster</caption>
                  <thead>
                    <tr className="border-b border-gray text-xs uppercase tracking-wide">
                      <th scope="col" className="w-10 py-2"><input type="checkbox" className="h-5 w-5" aria-label="Select all volunteers on this page" checked={allOnPage} onChange={togglePage} data-testid="checkbox-page" /></th>
                      <th scope="col" className="py-2 pr-3">Name</th><th scope="col" className="pr-3">County</th><th scope="col" className="pr-3">Status</th>
                      <th scope="col" className="pr-3">Certification</th><th scope="col" className="pr-3">Background</th><th scope="col" className="pr-3">Shifts held</th>
                      <th scope="col" className="pr-3">Email verified</th><th scope="col">Last login</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray">
                    {rows.map(e => (
                      <tr key={e.user.id} className="cursor-pointer hover:bg-gray/60" data-testid={`row-volunteer-${e.user.id}`}
                        onClick={event => { if (!(event.target as Element).closest('input,button,a,label')) nav(`/admin/volunteers/${e.user.id}`); }}>
                        <td className="py-3"><input type="checkbox" className="h-5 w-5" aria-label={`Select ${fullName(e)}`} checked={selected.has(e.user.id)} onChange={() => toggle(e.user.id)} data-testid={`checkbox-${e.user.id}`} /></td>
                        <td className="py-3 pr-3">
                          <Link href={`/admin/volunteers/${e.user.id}`} className="font-bold text-teal-text underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-teal" data-testid={`link-volunteer-${e.user.id}`}>{fullName(e)}</Link>
                          <span className="block break-all text-xs text-navy-soft">{e.user.email}</span>
                        </td>
                        <td className="pr-3">{e.profile.county}</td>
                        <td className="pr-3"><Pill map={STATUS} value={e.profile.status} /></td>
                        <td className="pr-3"><Pill map={CERT} value={e.profile.certificationStatus} /></td>
                        <td className="pr-3"><Pill map={BG} value={e.profile.backgroundCheckStatus} /></td>
                        <td className="pr-3"><ShiftCell e={e} /></td>
                        <td className="pr-3">{e.user.emailVerifiedAt ? 'Yes' : 'No'}</td>
                        <td>{pacific(e.user.lastLoginAt) ?? 'Never'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {/* Mobile cards */}
              <ul className="mt-4 space-y-3 md:hidden" aria-label="Volunteers">
                {rows.map(e => (
                  <li key={e.user.id} className="flex cursor-pointer gap-3 rounded-xl border border-gray p-4" data-testid={`card-volunteer-${e.user.id}`}
                    onClick={event => { if (!(event.target as Element).closest('input,button,a,label')) nav(`/admin/volunteers/${e.user.id}`); }}>
                    <input type="checkbox" className="mt-1 h-6 w-6 shrink-0" aria-label={`Select ${fullName(e)}`} checked={selected.has(e.user.id)} onChange={() => toggle(e.user.id)} />
                    <div className="min-w-0 flex-1">
                      <Link href={`/admin/volunteers/${e.user.id}`} className="font-bold text-teal-text underline underline-offset-4">{fullName(e)}</Link>
                      <p className="break-all text-xs text-navy-soft">{e.user.email}</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <Pill map={STATUS} value={e.profile.status} /><Pill map={CERT} value={e.profile.certificationStatus} /><Pill map={BG} value={e.profile.backgroundCheckStatus} />
                      </div>
                      <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                        <div><dt className="alliance-label">County</dt><dd>{e.profile.county}</dd></div>
                        <div><dt className="alliance-label">Shifts held</dt><dd><ShiftCell e={e} /></dd></div>
                        <div><dt className="alliance-label">Email verified</dt><dd>{e.user.emailVerifiedAt ? 'Yes' : 'No'}</dd></div>
                        <div><dt className="alliance-label">Last login</dt><dd>{pacific(e.user.lastLoginAt) ?? 'Never'}</dd></div>
                      </dl>
                    </div>
                  </li>
                ))}
              </ul>
              <nav aria-label="Pagination" className="mt-4 flex items-center justify-between gap-3 text-sm">
                <span data-testid="text-range">{total === 0 ? 0 : offset + 1}–{Math.min(offset + PAGE, total)} of {total}</span>
                <div className="flex gap-2">
                  <Button type="button" variant="secondary" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))} data-testid="button-prev">Previous</Button>
                  <Button type="button" variant="secondary" disabled={offset + PAGE >= total} onClick={() => setOffset(offset + PAGE)} data-testid="button-next">Next</Button>
                </div>
              </nav>
            </div>
          )}
      </section>
    </AppLayout>
  );
}
export const AdminRoster = () => <RequireAdmin>{() => <RosterBody />}</RequireAdmin>;

function Item({ label, children }: { label: string; children: ReactNode }) {
  return <div><dt className="alliance-label">{label}</dt><dd className="break-words">{children}</dd></div>;
}

function Profile({ p }: { p: PublicVolunteerProfile }) {
  return (
    <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
      <Item label="Certification completed">{pacific(p.certificationCompletedAt, false) ?? 'Not recorded'}</Item>
      <Item label="Certification expires">{pacific(p.certificationExpiresAt, false) ?? 'Not recorded'}</Item>
      <Item label="Background check submitted">{pacific(p.backgroundCheckSubmittedAt, false) ?? 'Not recorded'}</Item>
      <Item label="Background check cleared">{pacific(p.backgroundCheckClearedAt, false) ?? 'Not recorded'}</Item>
      <Item label="Agreement acknowledged">{pacific(p.agreementAcknowledgedAt) ?? 'Not recorded'}</Item>
      <Item label="Agreement version">{p.agreementVersion ?? 'None'}</Item>
      <Item label="Onboarding completed">{pacific(p.onboardingCompletedAt) ?? 'Not completed'}</Item>
      <Item label="Availability notes"><span className="whitespace-pre-wrap">{p.availabilityNotes || 'None'}</span></Item>
    </dl>
  );
}

function DetailBody() {
  const { userId = '' } = useParams<{ userId: string }>();
  const q = useGetAdminVolunteer(userId, {
    query: { queryKey: getGetAdminVolunteerQueryKey(userId), enabled: !!userId, staleTime: FRESH_MS, refetchInterval: POLL_MS, refetchOnWindowFocus: 'always', retry: false },
    request: FETCH_CREDS,
  });
  const d = q.data;
  const e = d?.entry;
  const p = e?.profile;
  return (
    <AppLayout role="admin">
      <Link href="/admin/volunteers" className="mb-3 inline-flex items-center gap-1 text-sm font-bold text-teal-text underline underline-offset-4"><ChevronLeft size={16} aria-hidden="true" />Back to roster</Link>
      {q.isPending ? <Loading />
        : q.isError || !d || !e || !p ? <div className="mt-6"><Notice>We couldn't load this volunteer.</Notice><Button onClick={() => { void q.refetch(); }}>Try again</Button></div>
        : (
          <>
            <h1 className="alliance-display text-[22px] md:text-[28px]" data-testid="text-volunteer-name">{fullName(e)}</h1>
            <div className="mt-3 flex flex-wrap gap-2">
              <Pill map={STATUS} value={p.status} /><Pill map={CERT} value={p.certificationStatus} /><Pill map={BG} value={p.backgroundCheckStatus} />
              {e.attention.map(a => <StatusBadge key={a} status="attention">{ATTN[a] ?? a}</StatusBadge>)}
            </div>
            <div className="mt-4 flex flex-wrap gap-4 text-sm font-bold">
              <Link href={`/admin/volunteers/${e.user.id}/onboarding`} className="text-teal-text underline underline-offset-4" data-testid="link-review-onboarding">Review onboarding</Link>
              <Link href="/admin/team" className="text-teal-text underline underline-offset-4" data-testid="link-manage-account">Manage account</Link>
            </div>

            <section className="alliance-card mt-6" aria-labelledby="v-contact">
              <h2 id="v-contact" className="alliance-display text-[15px]">Contact</h2>
              <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
                <Item label="Email">{e.user.email}</Item>
                <Item label="Phone">{e.user.phone || 'Not provided'}</Item>
                <Item label="County">{p.county}</Item>
                <Item label="Email verified">{e.user.emailVerifiedAt ? `Yes, ${pacific(e.user.emailVerifiedAt, false)}` : 'No'}</Item>
                <Item label="Last login">{pacific(e.user.lastLoginAt) ?? 'Never'}</Item>
                <Item label="Account">{e.user.isActive ? 'Active' : 'Deactivated'}</Item>
              </dl>
            </section>

            <section className="alliance-card mt-6" aria-labelledby="v-profile">
              <h2 id="v-profile" className="alliance-display text-[15px]">Training and clearance</h2>
              <Profile p={p} />
            </section>

            <section className="alliance-card mt-6" aria-labelledby="v-shifts">
              <h2 id="v-shifts" className="alliance-display text-[15px]">Assigned shifts</h2>
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
            </section>

            <section className="alliance-card mt-6" aria-labelledby="v-answers">
              <h2 id="v-answers" className="alliance-display text-[15px]">Onboarding answers</h2>
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

            <section className="alliance-card mt-6" aria-labelledby="v-notes">
              <h2 id="v-notes" className="alliance-display text-[15px]">Internal admin notes</h2>
              <p className="mt-1 text-xs text-navy-soft">Visible to admins only.</p>
              <p className="mt-3 whitespace-pre-wrap break-words" data-testid="text-admin-notes">{d.adminNotes || <span className="text-navy-soft">No notes</span>}</p>
            </section>
          </>
        )}
    </AppLayout>
  );
}
export const AdminVolunteerDetail = () => <RequireAdmin>{() => <DetailBody />}</RequireAdmin>;
