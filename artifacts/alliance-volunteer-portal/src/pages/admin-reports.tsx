import { useMemo, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Download, Mail } from 'lucide-react';
import { getGetAdminHoursReportQueryKey, useGetAdminHoursReport, type GetAdminHoursReportParams, type HoursReportVolunteer } from '@workspace/api-client-react';
import { AppLayout, Button, EmptyState, StatusBadge } from '@/components/brand-system';
import { PageHeader } from '@/components/page-header';
import { TestBadge } from '@/components/test-badge';
import { ContactLink } from '@/components/shift-cards';
import { Notice } from '@/auth/auth-ui';
import { RequireAdmin } from '@/auth/guards';
import { FETCH_CREDS } from '@/auth/auth-context';
import { Skeleton } from '@/components/ui/skeleton';
import { appConfig } from '@workspace/shared/appConfig';
import { onMessageSelected } from '@/lib/messaging';

const pacificMonth = (d: Date) => {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: appConfig.timezone, year: 'numeric', month: '2-digit' }).formatToParts(d);
  return `${p.find(x => x.type === 'year')?.value}-${p.find(x => x.type === 'month')?.value}`;
};
const shiftMonth = (m: string, n: number) => { const [y, mo] = m.split('-').map(Number); const d = new Date(Date.UTC(y, mo - 1 + n, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; };
const monthLabel = (m: string, style: 'long' | 'short' = 'long') => new Date(`${m}-01T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', month: style, year: 'numeric' });
const hrs = (n: number) => String(Math.round(n * 100) / 100);
const day = (d: string | null) => d ? new Date(`${d.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', dateStyle: 'medium' }) : 'None yet';
const STATUS: Record<string, ['neutral' | 'good' | 'attention' | 'blocked', string]> = { onboarding: ['attention', 'Onboarding'], active: ['good', 'Active'], inactive: ['blocked', 'Inactive'] };
const linkCls = 'font-bold text-blue underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-blue';

type SortKey = 'name' | 'status' | 'hours' | 'shiftsLogged' | 'otherEntries' | 'shiftsNotLogged' | 'lastLoggedDate';
const COLS: [SortKey, string][] = [['name', 'Name'], ['status', 'Status'], ['hours', 'Hours'], ['shiftsLogged', 'Shifts logged'], ['otherEntries', 'Other time'], ['shiftsNotLogged', 'Not logged'], ['lastLoggedDate', 'Last logged']];

function Tile({ id, label, value, amber }: { id: string; label: string; value: string; amber?: boolean }) {
  return (
    <div className={`alliance-card ${amber ? '!bg-[var(--alliance-amber)] text-[var(--alliance-amber-ink)]' : ''}`} data-testid={id}>
      <span className="alliance-display block text-[32px] tabular-nums" data-testid={`${id}-value`}>{value}</span>
      <span className="text-sm font-bold">{label}</span>
    </div>
  );
}

function Body() {
  const [, nav] = useLocation();
  const at = import.meta.env.DEV ? new URLSearchParams(window.location.search).get('at') ?? undefined : undefined;
  const [baseline] = useState(() => pacificMonth(at && !Number.isNaN(Date.parse(at)) ? new Date(at) : new Date()));
  const [month, setMonth] = useState(baseline);
  const [tests, setTests] = useState(false);
  const [sortBy, setSortBy] = useState<SortKey>('name');
  const [dir, setDir] = useState<'asc' | 'desc'>('asc');
  const params: GetAdminHoursReportParams = { month, ...(tests ? { includeTest: true } : {}), ...(at ? { at } : {}) };
  const q = useGetAdminHoursReport(params, { query: { queryKey: getGetAdminHoursReportQueryKey(params), staleTime: 15_000, refetchOnWindowFocus: 'always', retry: false }, request: FETCH_CREDS });
  const d = q.data;
  const current = d?.currentMonth ?? baseline;
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  const qs = new URLSearchParams({ month, ...(tests ? { includeTest: 'true' } : {}), ...(at ? { at } : {}) }).toString();
  const rows = useMemo(() => {
    const r = [...(d?.volunteers ?? [])];
    const val = (v: HoursReportVolunteer) => v[sortBy] ?? '';
    r.sort((a, b) => { const x = val(a), y = val(b); const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { sensitivity: 'base' }); return (dir === 'asc' ? c : -c) || a.name.localeCompare(b.name); });
    return r;
  }, [d, sortBy, dir]);
  const sortOn = (k: SortKey) => { if (k === sortBy) setDir(dir === 'asc' ? 'desc' : 'asc'); else { setSortBy(k); setDir('asc'); } };
  const unlogged = (d?.volunteers ?? []).filter(v => v.shiftsNotLogged > 0).map(v => v.userId);
  const empty = d && d.totals.teamHours === 0 && d.volunteers.length === 0;
  const maxTrend = Math.max(1, ...(d?.trend ?? []).map(t => t.teamHours));
  const status = (s: string) => { const [k, l] = STATUS[s] ?? ['neutral', s]; return <StatusBadge status={k}>{l}</StatusBadge>; };
  const nl = (n: number) => n > 0 ? <span className="rounded-md bg-[var(--alliance-amber)] px-2 py-0.5 font-bold tabular-nums text-[var(--alliance-amber-ink)]">{n}</span> : <span className="tabular-nums">0</span>;
  const nameLink = (v: HoursReportVolunteer) => <Link href={`/admin/volunteers/${v.userId}`} className={`inline-flex min-h-11 items-center ${linkCls}`} data-testid={`link-report-volunteer-${v.userId}`}>{v.name}<TestBadge test={v.isTestAccount} /></Link>;

  return (
    <AppLayout role="admin">
      <PageHeader eyebrow="Admin" title="Volunteer hours" description={<p>Hours come from what Resource Coordinators confirm after each shift, plus any time staff add on a volunteer's page. Shifts not logged yet are past shifts with no hours recorded; Cindi can follow up or add them.</p>} />
      <section className="alliance-card" aria-label="Report controls">
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" variant="secondary" onClick={() => setMonth(shiftMonth(month, -1))} data-testid="button-report-prev"><ChevronLeft size={16} aria-hidden="true" className="mr-1" />Previous</Button>
          <h2 className="alliance-display min-w-[10rem] text-center" aria-live="polite" data-testid="report-month">{monthLabel(month)}</h2>
          <Button type="button" variant="secondary" disabled={month >= current} onClick={() => setMonth(shiftMonth(month, 1))} data-testid="button-report-next">Next<ChevronRight size={16} aria-hidden="true" className="ml-1" /></Button>
          <label className="ml-auto flex min-h-11 items-center gap-3 text-sm font-bold">
            <input type="checkbox" className="h-5 w-5" checked={tests} onChange={e => setTests(e.target.checked)} data-testid="toggle-report-test" />Show test accounts</label>
        </div>
      </section>

      {q.isPending ? (
        <div className="mt-6 space-y-3" role="status" aria-busy="true"><span className="sr-only">Loading report</span><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-24" />)}</div><Skeleton className="h-64 w-full" /></div>
      ) : !d ? (
        <div className="mt-6" data-testid="error-report"><Notice>Something went wrong on our end. Please try again. If it keeps happening, let <ContactLink /> know.</Notice><Button onClick={() => { void q.refetch(); }} data-testid="button-retry-report">Try again</Button></div>
      ) : (<>
        {q.isError && <div className="mt-4"><Notice>Couldn't refresh the report. Showing the last loaded numbers.</Notice></div>}
        <div className={`mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 ${q.isFetching ? 'opacity-70' : ''}`} aria-busy={q.isFetching}>
          <Tile id="tile-team-hours" label="Team hours" value={hrs(d.totals.teamHours)} />
          <Tile id="tile-coordinators" label="Resource Coordinators who logged hours" value={String(d.totals.volunteersWithHours)} />
          <Tile id="tile-shifts-logged" label="Shifts logged" value={String(d.totals.shiftsLogged)} />
          <Tile id="tile-shifts-not-logged" label="Shifts not logged yet" value={String(d.totals.shiftsNotLogged)} amber={d.totals.shiftsNotLogged > 0} />
        </div>

        <section className="alliance-card mt-6 min-w-0" aria-labelledby="by-vol">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="by-vol" className="alliance-display">Hours by Resource Coordinator</h2>
            {d.totals.shiftsNotLogged > 0 && <Button type="button" onClick={() => onMessageSelected(unlogged, nav)} data-testid="button-message-unlogged"><Mail size={16} aria-hidden="true" className="mr-2 inline" />Message volunteers with unlogged shifts</Button>}
          </div>
          {empty ? <div className="mt-4"><EmptyState title="Nothing logged yet" description={`No hours have been logged for ${monthLabel(month)} yet.`} /></div> : (<>
            <div className="mt-4 hidden overflow-x-auto rounded-lg border border-gray md:block">
              <table className="w-full text-left text-sm" data-testid="table-hours-by-volunteer">
                <caption className="sr-only">Hours by Resource Coordinator, {monthLabel(month)}</caption>
                <thead><tr>{COLS.map(([k, l]) => (
                  <th key={k} scope="col" aria-sort={sortBy === k ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'} className="border-b border-gray px-3 py-1">
                    <button type="button" onClick={() => sortOn(k)} data-testid={`sort-report-${k}`} className="inline-flex min-h-11 items-center gap-1 whitespace-nowrap font-bold focus-visible:outline-2 focus-visible:outline-blue">{l}
                      {sortBy === k ? (dir === 'asc' ? <ArrowUp size={14} aria-hidden="true" /> : <ArrowDown size={14} aria-hidden="true" />) : <ArrowUpDown size={14} aria-hidden="true" className="opacity-40" />}</button></th>))}</tr></thead>
                <tbody>
                  {rows.map(v => (
                    <tr key={v.userId} data-testid={`row-report-${v.userId}`}>
                      <td className="border-b border-gray px-3">{nameLink(v)}</td>
                      <td className="border-b border-gray px-3">{status(v.status)}</td>
                      <td className="border-b border-gray px-3 tabular-nums font-bold">{hrs(v.hours)}</td>
                      <td className="border-b border-gray px-3 tabular-nums">{v.shiftsLogged}</td>
                      <td className="border-b border-gray px-3 tabular-nums">{v.otherEntries}</td>
                      <td className="border-b border-gray px-3">{nl(v.shiftsNotLogged)}</td>
                      <td className="border-b border-gray px-3">{day(v.lastLoggedDate)}</td>
                    </tr>))}
                </tbody>
                <tfoot><tr className="font-bold" data-testid="row-report-total">
                  <th scope="row" className="px-3 py-3">Team total</th><td />
                  <td className="px-3 tabular-nums">{hrs(d.totals.teamHours)}</td><td className="px-3 tabular-nums">{d.totals.shiftsLogged}</td>
                  <td className="px-3 tabular-nums">{d.totals.otherEntries}</td><td className="px-3 tabular-nums">{d.totals.shiftsNotLogged}</td><td /></tr></tfoot>
              </table>
            </div>
            <div className="mt-4 md:hidden">
              <div className="mb-3 flex items-end gap-2">
                <label className="min-w-0 flex-1 text-sm font-bold">Sort by
                  <select className="alliance-input roster-select mt-1 font-normal" value={sortBy} onChange={e => { setSortBy(e.target.value as SortKey); setDir('asc'); }} data-testid="select-report-sort">
                    {COLS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
                <Button type="button" variant="secondary" onClick={() => setDir(dir === 'asc' ? 'desc' : 'asc')} data-testid="button-report-sort-direction">{dir === 'asc' ? 'Ascending' : 'Descending'}</Button>
              </div>
              <ul className="space-y-3" aria-label="Hours by Resource Coordinator">
                {rows.map(v => (
                  <li key={v.userId} className="rounded-xl border border-gray p-4" data-testid={`card-report-${v.userId}`}>
                    <div className="flex flex-wrap items-center justify-between gap-2">{nameLink(v)}{status(v.status)}</div>
                    <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                      {([['Hours', hrs(v.hours)], ['Shifts logged', String(v.shiftsLogged)], ['Other time', String(v.otherEntries)]] as const).map(([l, x]) => <div key={l}><dt className="alliance-label">{l}</dt><dd className="tabular-nums">{x}</dd></div>)}
                      <div><dt className="alliance-label">Not logged</dt><dd>{nl(v.shiftsNotLogged)}</dd></div>
                      <div className="col-span-2"><dt className="alliance-label">Last logged</dt><dd>{day(v.lastLoggedDate)}</dd></div>
                    </dl>
                  </li>))}
                <li className="rounded-xl bg-gray p-4 font-bold" data-testid="card-report-total">Team total: {hrs(d.totals.teamHours)} hours, {d.totals.shiftsLogged} shifts logged, {d.totals.otherEntries} other, {d.totals.shiftsNotLogged} not logged</li>
              </ul>
            </div>
          </>)}
        </section>

        <section className="alliance-card mt-6 min-w-0" aria-labelledby="trend-h">
          <h2 id="trend-h" className="alliance-display">Team hours by month</h2>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-sm" data-testid="table-team-trend">
              <caption className="sr-only">Team hours for the 12 months ending {monthLabel(month)}</caption>
              <thead><tr className="text-sm font-bold text-blue [overflow-wrap:normal]"><th scope="col" className="py-2 pr-3">Month</th><th scope="col" className="px-2 py-2 whitespace-nowrap">Hours</th><th scope="col" className="py-2 pl-2 whitespace-nowrap"><span>Resource </span><span className="block sm:inline">Coordinators</span></th></tr></thead>
              <tbody>
                {d.trend.map(t => (
                  <tr key={t.month} data-testid={`row-trend-${t.month}`} className={t.month === month ? 'font-bold' : ''}>
                    <th scope="row" className="w-full whitespace-nowrap border-b border-gray py-2 pr-3 font-inherit">
                      <span className="inline-block sm:w-24">{monthLabel(t.month, 'short')}</span>
                      <span className="mt-1 block h-2 rounded-full bg-gray sm:ml-3 sm:inline-block sm:w-[min(30vw,20rem)]" aria-hidden="true"><span className="block h-2 rounded-full bg-blue" style={{ width: `${(t.teamHours / maxTrend) * 100}%` }} /></span>
                    </th>
                    <td className="border-b border-gray px-2 tabular-nums">{hrs(t.teamHours)}</td>
                    <td className="border-b border-gray pl-2 tabular-nums">{t.volunteersWithHours}</td>
                  </tr>))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="mt-6 flex flex-wrap gap-x-6 gap-y-1 text-sm" aria-label="Exports">
          <a href={`${base}/api/admin/reports/hours.csv?${qs}`} download className="inline-flex min-h-11 items-center gap-1 font-bold text-blue underline underline-offset-4" data-testid="link-report-hours-csv"><Download size={16} aria-hidden="true" />Download hours by volunteer (CSV)</a>
          <a href={`${base}/api/admin/reports/hour-entries.csv?${qs}`} download className="inline-flex min-h-11 items-center gap-1 font-bold text-blue underline underline-offset-4" data-testid="link-report-entries-csv"><Download size={16} aria-hidden="true" />Download all hour entries (CSV)</a>
        </section>
      </>)}
    </AppLayout>
  );
}

export const AdminReports = () => <RequireAdmin>{() => <Body />}</RequireAdmin>;
