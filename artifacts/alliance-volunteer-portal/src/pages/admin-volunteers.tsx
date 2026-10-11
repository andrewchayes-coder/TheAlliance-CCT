import { ContactLink } from '@/components/shift-cards';
import { useEffect, useMemo, useRef, useState } from 'react';
import { z } from 'zod';
import { TestBadge } from '@/components/test-badge';
import { Link, useLocation } from 'wouter';
import { keepPreviousData } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, ArrowUpDown, Columns3, Download, Search } from 'lucide-react';
import {
  getListVolunteerRosterQueryKey, useListVolunteerRoster,
  type ListVolunteerRosterParams, type VolunteerRosterEntry,
} from '@workspace/api-client-react';
import { AppLayout, Button, EmptyState, StatusBadge } from '@/components/brand-system';
import { Skeleton } from '@/components/ui/skeleton';
import { RequireAdmin } from '@/auth/guards';
import { Notice } from '@/auth/auth-ui';
import { FETCH_CREDS, FRESH_MS } from '@/auth/auth-context';
import { appConfig } from '@workspace/shared/appConfig';
import { formatPhone, normalizeVolunteerStatus } from '@workspace/shared/profileFields';
import { VolunteerDetail } from '@/components/volunteer-detail/detail';
import { onMessageSelected as defaultOnMessageSelected } from '@/lib/messaging';

const PAGE = 25;
const POLL_MS = 60_000;
const TZ = appConfig.timezone;
type Badge = 'neutral' | 'good' | 'attention' | 'blocked';
type SortKey = NonNullable<ListVolunteerRosterParams['sortBy']>;
type Dir = NonNullable<ListVolunteerRosterParams['sortDirection']>;

const STATUS: Record<string, [string, Badge]> = {
  onboarding: ['Onboarding', 'attention'], applicant: ['Onboarding', 'attention'], in_training: ['Onboarding', 'attention'],
  active: ['Active', 'good'], inactive: ['Inactive', 'blocked'],
};
const STATUS_FILTER = ['onboarding', 'active', 'inactive'] as const;

const COLS: { key: SortKey; label: string; def: boolean }[] = [
  { key: 'name', label: 'Name', def: true }, { key: 'status', label: 'Status', def: true }, { key: 'phone', label: 'Mobile', def: true },
  { key: 'email', label: 'Email', def: true }, { key: 'city', label: 'City', def: true }, { key: 'startDate', label: 'Start date', def: true },
  { key: 'shiftCount', label: 'Shifts', def: true }, { key: 'lastLoginAt', label: 'Last login', def: true },
  { key: 'dateOfBirth', label: 'Date of birth', def: false }, { key: 'address', label: 'Full address', def: false }, { key: 'zip', label: 'ZIP', def: false },
  { key: 'emergencyContact', label: 'Emergency contact', def: false }, { key: 'county', label: 'County', def: false },
];
const COL_KEYS = COLS.map(c => c.key) as [SortKey, ...SortKey[]];
const colsSchema = z.array(z.enum(COL_KEYS));
const DEFAULT_COLS = COLS.filter(c => c.def).map(c => c.key);
const storeKey = (id: string) => `cct.roster.columns.${id}`;
function loadCols(id: string): SortKey[] {
  try {
    const raw = localStorage.getItem(storeKey(id));
    if (!raw) return DEFAULT_COLS;
    const r = colsSchema.safeParse(JSON.parse(raw));
    return r.success && r.data.length ? r.data : DEFAULT_COLS;
  } catch { return DEFAULT_COLS; }
}
function saveCols(id: string, cols: SortKey[]) { try { localStorage.setItem(storeKey(id), JSON.stringify(cols)); } catch { /* storage unavailable */ } }

const calDate = (d: string) => new Date(`${d.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', dateStyle: 'medium' });
const pacific = (iso: string | null | undefined) => iso
  ? new Date(iso).toLocaleString('en-US', { timeZone: TZ, dateStyle: 'medium', timeStyle: 'short' }) + ' PT' : null;
const fullName = (e: VolunteerRosterEntry) => `${e.user.firstName} ${e.user.lastName}`;
const addressOf = (e: VolunteerRosterEntry) => {
  const p = e.profile; const tail = [p.city, [p.state, p.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  return [p.addressLine1, tail].filter(Boolean).join(', ');
};

const Dash = () => <span className="text-navy-soft" aria-label="Not provided">&mdash;</span>;
const linkCls = 'font-bold text-blue underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-blue';

function Cell({ k, e }: { k: SortKey; e: VolunteerRosterEntry }) {
  const p = e.profile;
  switch (k) {
    case 'name': return <Link href={`/admin/volunteers/${e.user.id}`} className={`inline-flex min-h-11 items-center ${linkCls}`} data-testid={`link-volunteer-${e.user.id}`}>{fullName(e)}<TestBadge test={e.user.isTestAccount} /></Link>;
    case 'status': { const [l, kind] = STATUS[normalizeVolunteerStatus(p.status)] ?? [p.status, 'neutral' as Badge]; return <StatusBadge status={kind}>{l}</StatusBadge>; }
    case 'phone': return e.user.phone ? <a href={`tel:${e.user.phone}`} className={`inline-flex min-h-11 items-center whitespace-nowrap ${linkCls}`} data-testid={`link-phone-${e.user.id}`}>{formatPhone(e.user.phone) || e.user.phone}</a> : <Dash />;
    case 'email': return <a href={`mailto:${e.user.email}`} className={`inline-flex min-h-11 items-center break-all ${linkCls}`} data-testid={`link-email-${e.user.id}`}>{e.user.email}</a>;
    case 'city': return p.city ? <>{p.city}</> : <Dash />;
    case 'startDate': return p.startDate ? <>{calDate(p.startDate)}</> : <Dash />;
    case 'shiftCount':
      return normalizeVolunteerStatus(p.status) === 'active' && e.shiftCount === 0
        ? <StatusBadge status="attention">No shift</StatusBadge> : <span className="tabular-nums">{e.shiftCount}</span>;
    case 'lastLoginAt': return <>{pacific(e.user.lastLoginAt) ?? 'Never'}</>;
    case 'dateOfBirth': return p.dateOfBirth ? <>{calDate(p.dateOfBirth)}</> : <Dash />;
    case 'address': return addressOf(e) ? <>{addressOf(e)}</> : <Dash />;
    case 'zip': return p.zip ? <>{p.zip}</> : <Dash />;
    case 'county': return p.county ? <>{p.county}</> : <Dash />;
    case 'emergencyContact':
      return p.emergencyContactName || p.emergencyContactPhone ? (
        <span>{[p.emergencyContactName, p.emergencyContactRelationship].filter(Boolean).join(' \u00b7 ')}
          {p.emergencyContactPhone && <>{p.emergencyContactName ? ' \u00b7 ' : ''}<a href={`tel:${p.emergencyContactPhone}`} className={`inline-flex min-h-11 items-center whitespace-nowrap ${linkCls}`}>{formatPhone(p.emergencyContactPhone) || p.emergencyContactPhone}</a></>}</span>
      ) : <Dash />;
  }
}

function Loading() {
  return (
    <div className="mt-4 space-y-3" role="status" aria-busy="true"><span className="sr-only">Loading</span>
      {[0, 1, 2, 3, 4].map(i => <Skeleton key={i} className="h-14 w-full" />)}</div>
  );
}

const selectCls = 'alliance-input';

function RosterBody({ adminId, onMessageSelected = defaultOnMessageSelected }: { adminId: string; onMessageSelected?: (userIds: string[], navigate?: (to: string) => void) => void }) {
  const [, nav] = useLocation();
  const [text, setText] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [county, setCounty] = useState('');
  const [city, setCity] = useState('');
  const [presence, setPresence] = useState('');
  const [incomplete, setIncomplete] = useState('');
  const [showTests, setShowTests] = useState(false);
  const [attn, setAttn] = useState(() => { const v = new URLSearchParams(window.location.search).get('needsAttention'); return v === 'true' || v === 'any' ? 'any' : ''; });
  const [sortBy, setSortBy] = useState<SortKey | ''>('');
  const [dir, setDir] = useState<Dir>('asc');
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [cols, setCols] = useState<SortKey[]>(() => loadCols(adminId));
  const [pickerOpen, setPickerOpen] = useState(false);
  const optionsRef = useRef<{ cities: string[]; counties: string[] }>({ cities: [], counties: [] });

  useEffect(() => {
    const t = setTimeout(() => setSearch(text.trim()), 300);
    return () => clearTimeout(t);
  }, [text]);

  const filterKey = [search, status, county, city, presence, incomplete, attn, showTests, sortBy, dir].join('|');
  useEffect(() => { setOffset(0); setSelected(new Set()); }, [filterKey]);

  const filters = {
    ...(search ? { search } : {}), ...(status ? { status } : {}), ...(county ? { county } : {}), ...(city ? { city } : {}),
    ...(presence ? { shiftPresence: presence } : {}), ...(incomplete ? { profileIncomplete: incomplete } : {}), ...(attn ? { needsAttention: attn } : {}),
  };
  const sort = sortBy ? { sortBy, sortDirection: dir } : {};
  const params = { ...filters, ...sort, ...(showTests ? { showTestAccounts: 'true' } : {}), limit: PAGE, offset } as ListVolunteerRosterParams;
  const list = useListVolunteerRoster(params, {
    query: { queryKey: getListVolunteerRosterQueryKey(params), staleTime: FRESH_MS, refetchInterval: POLL_MS, refetchOnWindowFocus: 'always', retry: false, placeholderData: keepPreviousData },
    request: FETCH_CREDS,
  });
  const data = list.data;
  if (data) optionsRef.current = { cities: data.cities, counties: data.counties };
  const cityOpts = Array.from(new Set([...(city ? [city] : []), ...optionsRef.current.cities]));
  const countyOpts = Array.from(new Set([...(county ? [county] : []), ...optionsRef.current.counties]));
  const total = data?.total ?? 0;
  const rows = data?.volunteers ?? [];
  const sum = data?.summary;
  const hasFilters = Object.keys(filters).length > 0;

  const qs = new URLSearchParams({ ...filters, ...sort } as Record<string, string>).toString();
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  const schedQs = new URLSearchParams(Object.fromEntries(Object.entries(filters).filter(([k, v]) => k === 'search' || k === 'status' || k === 'county' || (k === 'needsAttention' && v === 'any'))) as Record<string, string>).toString();
  const csv = (name: string) => name === 'schedule' ? `${base}/api/admin/volunteers/schedule.csv${schedQs ? `?${schedQs}` : ''}` : `${base}/api/admin/volunteers/${name}.csv${qs ? `?${qs}` : ''}`;

  const pageIds = rows.map(r => r.user.id);
  const allOnPage = pageIds.length > 0 && pageIds.every(id => selected.has(id));
  const toggle = (id: string) => setSelected(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const togglePage = () => setSelected(s => { const n = new Set(s); pageIds.forEach(id => allOnPage ? n.delete(id) : n.add(id)); return n; });
  const reset = () => { setText(''); setSearch(''); setStatus(''); setCounty(''); setCity(''); setPresence(''); setIncomplete(''); setAttn(''); };

  const visible = COLS.filter(c => cols.includes(c.key));
  const nameShown = cols.includes('name');
  const toggleCol = (k: SortKey) => {
    const next = cols.includes(k) ? cols.filter(c => c !== k) : COLS.map(c => c.key).filter(c => c === k || cols.includes(c));
    if (next.length === 0) return;
    setCols(next); saveCols(adminId, next);
  };
  const resetCols = () => { setCols(DEFAULT_COLS); saveCols(adminId, DEFAULT_COLS); };
  const sortOn = (k: SortKey) => { if (sortBy === k) setDir(dir === 'asc' ? 'desc' : 'asc'); else { setSortBy(k); setDir('asc'); } };
  const ariaSort = (k: SortKey) => sortBy === k ? (dir === 'asc' ? 'ascending' : 'descending') : 'none';

  const chips = useMemo(() => sum ? [
    { key: 'onboarding', label: 'Onboarding', n: sum.onboarding, on: status === 'onboarding', set: () => setStatus(status === 'onboarding' ? '' : 'onboarding') },
    { key: 'active', label: 'Active', n: sum.active, on: status === 'active', set: () => setStatus(status === 'active' ? '' : 'active') },
    { key: 'inactive', label: 'Inactive', n: sum.inactive, on: status === 'inactive', set: () => setStatus(status === 'inactive' ? '' : 'inactive') },
    { key: 'attention', label: 'Needs attention', n: sum.needsAttention, on: attn === 'any', set: () => setAttn(attn === 'any' ? '' : 'any') },
  ] : [], [sum, status, attn]);

  const open = (id: string) => (event: { target: EventTarget }) => { if (!(event.target as Element).closest('input,button,a,label,select')) nav(`/admin/volunteers/${id}`); };

  return (
    <AppLayout role="admin">
      <p className="alliance-label">Administration</p>
      <h1 className="alliance-display mt-3">Volunteer roster</h1>
      <p className="mt-2 max-w-2xl">Everyone in the program, with the contact details you need to reach them.</p>

      <section aria-label="Roster summary" className="mt-5">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by summary">
          {sum ? chips.map(c => (
            <button key={c.key} type="button" aria-pressed={c.on} onClick={c.set} data-testid={`chip-${c.key}`}
              className={`min-h-11 rounded-full px-4 text-sm font-bold focus-visible:outline-2 focus-visible:outline-blue ${c.on ? 'bg-navy text-white' : 'bg-white shadow-sm'}`}>
              {c.label} <span className="ml-1 tabular-nums">{c.n}</span>
            </button>
          )) : [0, 1, 2, 3].map(i => <Skeleton key={i} className="h-11 w-32 rounded-full" />)}
        </div>
        <p className="mt-2 text-xs text-navy-soft">Summary counts cover real volunteers only and ignore the filters below.</p>
      </section>

      <section className="alliance-card mt-5 min-w-0" aria-labelledby="roster-h">
        <h2 id="roster-h" className="sr-only">Volunteers</h2>
        <label className="mb-3 flex min-h-11 items-center gap-3 text-sm font-bold">
          <input type="checkbox" checked={showTests} onChange={e => setShowTests(e.target.checked)}
            className="h-5 w-5" data-testid="toggle-test-accounts" />Show test accounts
        </label>
        <div className="relative">
          <Search size={18} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" />
          <input type="search" aria-label="Search volunteers" placeholder="Search by name, email, or phone…" maxLength={200}
            className="alliance-input pl-10" value={text} onChange={e => setText(e.target.value)} data-testid="input-search" />
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <label className="text-sm font-bold">Status
            <select className={`${selectCls} mt-1 font-normal`} value={status} onChange={e => setStatus(e.target.value)} data-testid="filter-status">
              <option value="">All statuses</option>
              {STATUS_FILTER.map(v => <option key={v} value={v}>{STATUS[v][0]}</option>)}
            </select></label>
          <label className="text-sm font-bold">City
            <select className={`${selectCls} mt-1 font-normal`} value={city} onChange={e => setCity(e.target.value)} data-testid="filter-city">
              <option value="">All cities</option>{cityOpts.map(c => <option key={c} value={c}>{c}</option>)}
            </select></label>
          <label className="text-sm font-bold">County
            <select className={`${selectCls} mt-1 font-normal`} value={county} onChange={e => setCounty(e.target.value)} data-testid="filter-county">
              <option value="">All counties</option>{countyOpts.map(c => <option key={c} value={c}>{c}</option>)}
            </select></label>
          <label className="text-sm font-bold">Shifts
            <select className={`${selectCls} mt-1 font-normal`} value={presence} onChange={e => setPresence(e.target.value)} data-testid="filter-shift-presence">
              <option value="">Any</option><option value="has_shift">Has a shift</option><option value="no_shift">No shift</option>
            </select></label>
          <label className="text-sm font-bold">Profile
            <select className={`${selectCls} mt-1 font-normal`} value={incomplete} onChange={e => setIncomplete(e.target.value)} data-testid="filter-profile-incomplete">
              <option value="">Any</option><option value="true">Incomplete</option><option value="false">Complete</option>
            </select></label>
          <label className="text-sm font-bold">Needs attention
            <select className={`${selectCls} mt-1 font-normal`} value={attn} onChange={e => setAttn(e.target.value)} data-testid="filter-attention">
              <option value="">Everyone</option><option value="any">Any attention</option>
            </select></label>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
          <a href={csv('roster')} download className="inline-flex min-h-11 items-center gap-1 font-bold text-blue underline underline-offset-4" data-testid="link-roster-csv">
            <Download size={16} aria-hidden="true" />Download roster CSV</a>
          <a href={csv('schedule')} download className="inline-flex min-h-11 items-center gap-1 font-bold text-blue underline underline-offset-4" data-testid="link-schedule-csv">
            <Download size={16} aria-hidden="true" />Download schedule CSV</a>
          <span className="text-navy-soft">The roster CSV includes every volunteer matching your filters and sort, not just this page. The schedule CSV applies only search, status, county and needs attention; city, shift, profile and sort choices are not applied.</span>
          <p className="w-full text-navy-soft">Roster exports include personal information and internal admin notes. Share only with authorized staff.</p>
          {hasFilters && <Button type="button" variant="secondary" onClick={reset} data-testid="button-reset-filters">Clear filters</Button>}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg bg-gray px-4 py-3" role="region" aria-label="Selection" data-testid="bar-selection">
          <span className="font-bold" aria-live="polite" data-testid="text-selected-count">{selected.size} selected</span>
          {selected.size > 0 && <button type="button" className="text-sm font-bold text-blue underline underline-offset-4" onClick={() => setSelected(new Set())}>Clear selection</button>}
          <Button type="button" variant="secondary" className="ml-auto" aria-expanded={pickerOpen} onClick={() => setPickerOpen(o => !o)} data-testid="button-columns"><Columns3 size={16} aria-hidden="true" className="mr-1 inline" />Columns</Button>
          <Button type="button" disabled={selected.size === 0} data-testid="button-message-selected"
            onClick={() => onMessageSelected(Array.from(selected), nav)}>Message selected</Button>
        </div>

        {pickerOpen && (
          <fieldset className="mt-3 rounded-lg border border-gray p-4" data-testid="panel-columns">
            <legend className="px-1 text-sm font-bold">Show columns</legend>
            <div className="grid gap-x-4 sm:grid-cols-2 lg:grid-cols-3">
              {COLS.map(c => (
                <label key={c.key} className="flex min-h-11 items-center gap-3 text-sm">
                  <input type="checkbox" className="h-5 w-5" checked={cols.includes(c.key)} disabled={cols.length === 1 && cols.includes(c.key)} onChange={() => toggleCol(c.key)} data-testid={`column-${c.key}`} />{c.label}
                </label>
              ))}
            </div>
            <button type="button" className="mt-2 min-h-11 text-sm font-bold text-blue underline underline-offset-4" onClick={resetCols} data-testid="button-columns-reset">Restore default columns</button>
            <p className="text-xs text-navy-soft">Saved on this device for your account. Visible to Alliance staff only.</p>
          </fieldset>
        )}

        {list.isPending ? <Loading />
          : list.isError && !data ? (
            <div className="mt-4"><Notice>Something went wrong on our end. Please try again. If it keeps happening, let <ContactLink /> know.</Notice><Button onClick={() => { void list.refetch(); }}>Try again</Button></div>
          ) : data && rows.length === 0 ? (
            <div className="mt-4"><EmptyState title={hasFilters ? 'No volunteers match' : 'No volunteers yet'}
              description={hasFilters ? 'Loosen a filter or try a different search.' : 'Volunteers appear here after they sign up.'}
              action={hasFilters ? <Button type="button" variant="secondary" onClick={reset}>Clear filters</Button> : undefined} /></div>
          ) : data && (
            <div className={list.isFetching ? 'opacity-70' : ''} aria-busy={list.isFetching}>
              {list.isError && <div className="mt-4"><Notice>Couldn't refresh the roster. Showing the last loaded results.</Notice></div>}
              {/* Desktop table */}
              <div className="mt-4 hidden max-h-[70vh] overflow-auto rounded-lg border border-gray lg:block">
                <table className="w-full min-w-max border-separate border-spacing-0 text-left text-sm" data-testid="table-roster">
                  <caption className="sr-only">Volunteer roster</caption>
                  <thead>
                    <tr className="text-xs">
                      <th scope="col" className="sticky left-0 top-0 z-30 w-10 border-b border-gray bg-white px-2 py-2"><input type="checkbox" className="h-5 w-5" aria-label="Select all volunteers on this page" checked={allOnPage} onChange={togglePage} data-testid="checkbox-page" /></th>
                      {visible.map(c => (
                        <th key={c.key} scope="col" aria-sort={ariaSort(c.key)}
                          className={`sticky top-0 border-b border-gray bg-white px-3 py-1 ${c.key === 'name' ? 'left-10 z-30 shadow-[1px_0_0_0_rgb(0_0_0/0.08)]' : 'z-20'}`}>
                          <button type="button" onClick={() => sortOn(c.key)} className="inline-flex min-h-11 items-center gap-1 whitespace-nowrap font-bold focus-visible:outline-2 focus-visible:outline-blue" data-testid={`sort-${c.key}`}>
                            {c.label}
                            {sortBy === c.key ? (dir === 'asc' ? <ArrowUp size={14} aria-hidden="true" /> : <ArrowDown size={14} aria-hidden="true" />) : <ArrowUpDown size={14} aria-hidden="true" className="opacity-40" />}
                          </button>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(e => (
                      <tr key={e.user.id} className="group cursor-pointer" data-testid={`row-volunteer-${e.user.id}`} onClick={open(e.user.id)}>
                        <td className="sticky left-0 z-10 border-b border-gray bg-white px-2 group-hover:bg-gray"><input type="checkbox" className="h-5 w-5" aria-label={`Select ${fullName(e)}`} checked={selected.has(e.user.id)} onChange={() => toggle(e.user.id)} data-testid={`checkbox-${e.user.id}`} /></td>
                        {visible.map(c => (
                          <td key={c.key} className={`border-b border-gray px-3 py-1 group-hover:bg-gray ${c.key === 'name' ? 'sticky left-10 z-10 bg-white shadow-[1px_0_0_0_rgb(0_0_0/0.08)]' : c.key === 'address' || c.key === 'emergencyContact' ? 'min-w-[16rem]' : ''}`}>
                            <Cell k={c.key} e={e} /></td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {/* Mobile cards */}
              <div className="mt-4 lg:hidden">
                <div className="mb-3 flex flex-wrap items-end gap-2">
                  <label className="min-w-0 flex-1 text-sm font-bold">Sort by
                    <select className={`${selectCls} mt-1 font-normal`} value={sortBy} onChange={e => { setSortBy(e.target.value as SortKey | ''); setDir('asc'); }} data-testid="select-sort">
                      <option value="">Default order</option>{visible.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
                    </select></label>
                  <Button type="button" variant="secondary" disabled={!sortBy} onClick={() => setDir(dir === 'asc' ? 'desc' : 'asc')} data-testid="button-sort-direction">{dir === 'asc' ? 'Ascending' : 'Descending'}</Button>
                </div>
                <ul className="space-y-3" aria-label="Volunteers">
                  {rows.map(e => (
                    <li key={e.user.id} className="flex min-w-0 cursor-pointer gap-3 rounded-xl border border-gray p-4" data-testid={`card-volunteer-${e.user.id}`} onClick={open(e.user.id)}>
                      <input type="checkbox" className="mt-3 h-5 w-5 shrink-0" aria-label={`Select ${fullName(e)}`} checked={selected.has(e.user.id)} onChange={() => toggle(e.user.id)} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          {nameShown ? <Cell k="name" e={e} /> : <span className="font-bold">{fullName(e)}</span>}
                          {cols.includes('status') && <Cell k="status" e={e} />}
                        </div>
                        <dl className="mt-2 grid grid-cols-1 gap-x-3 gap-y-2 text-sm min-[420px]:grid-cols-2">
                          {visible.filter(c => c.key !== 'name' && c.key !== 'status').map(c => (
                            <div key={c.key} className={`min-w-0 break-words ${c.key === 'email' || c.key === 'address' || c.key === 'emergencyContact' ? 'min-[420px]:col-span-2' : ''}`}>
                              <dt className="alliance-label">{c.label}</dt><dd><Cell k={c.key} e={e} /></dd></div>
                          ))}
                        </dl>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
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
export const AdminRoster = () => <RequireAdmin>{({ user }) => <RosterBody adminId={user.id} />}</RequireAdmin>;

export const AdminVolunteerDetail = () => <RequireAdmin>{() => <VolunteerDetail />}</RequireAdmin>;
