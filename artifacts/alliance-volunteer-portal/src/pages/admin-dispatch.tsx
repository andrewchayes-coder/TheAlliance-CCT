import { Link } from 'wouter';
import { TestBadge } from '@/components/test-badge';
import { AlertTriangle, CalendarDays, ChevronRight, ClipboardList, Mail, Phone, RefreshCw, Users } from 'lucide-react';
import { getGetAdminOverviewQueryKey, useGetAdminOverview, type CoordinatorBlock } from '@workspace/api-client-react';
import { AppLayout, Button } from '@/components/brand-system';
import { Notice } from '@/auth/auth-ui';
import { RequireAdmin } from '@/auth/guards';
import { FETCH_CREDS } from '@/auth/auth-context';
import { Skeleton } from '@/components/ui/skeleton';
import { clock } from '@/components/volunteer-detail/format';
import { POLL, activeVols, activityTime, dayLabel, fullName, humanize, range, updatedLabel } from '@/lib/coordinator';

type OnShift = { userId: string; name: string; phone: string | null; email: string; isTestAccount?: boolean; shifts: { id: string; end: string; label: string | null }[] };

function dedupe(blocks: CoordinatorBlock[]): OnShift[] {
  const m = new Map<string, OnShift>();
  for (const b of blocks) for (const v of activeVols(b)) {
    const e = m.get(v.userId) ?? { userId: v.userId, name: fullName(v), phone: v.phone, email: v.email, isTestAccount: v.isTestAccount, shifts: [] };
    if (!e.shifts.some(s => s.id === b.slotId)) e.shifts.push({ id: b.slotId, end: b.endTime, label: b.label });
    m.set(v.userId, e);
  }
  return [...m.values()].map(e => ({ ...e, shifts: e.shifts.sort((a, b) => a.end.localeCompare(b.end)) }));
}

const H = ({ children, id }: { children: string; id: string }) => <h2 id={id} className="alliance-label mb-3">{children}</h2>;

function Body() {
  const q = useGetAdminOverview({ query: { queryKey: getGetAdminOverviewQueryKey(), ...POLL }, request: FETCH_CREDS });
  const d = q.data;
  const people = d ? dedupe(d.onShiftNow) : [];
  return (
    <AppLayout role="admin">
      <div className="flex flex-wrap items-end justify-between gap-2" data-testid="view-admin-overview">
        <div><p className="alliance-label">Coordinator dispatch</p><h1 className="alliance-display mt-2 text-[22px] md:text-[28px]">Who to call</h1></div>
        {d && <p className="text-sm text-navy-soft" data-testid="text-updated" aria-live="off">Updated {updatedLabel(d.updatedAt)}</p>}
      </div>
      {q.isPending ? (
        <div className="mt-6 space-y-3" role="status" aria-busy="true"><span className="sr-only">Loading dispatch</span>{[0, 1, 2].map(i => <Skeleton key={i} className="h-24 w-full" />)}</div>
      ) : !d ? (
        <div className="mt-6"><Notice>Something went wrong on our end. Please try again — if it keeps happening, let The Alliance know.</Notice><Button onClick={() => { void q.refetch(); }} data-testid="button-retry-overview">Try again</Button></div>
      ) : (<>
        {q.isError && (
          <div role="alert" className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[var(--alliance-red)] p-3 text-[var(--alliance-red-ink)]" data-testid="banner-refresh-error">
            <span className="font-bold">Could not refresh. Showing data from {updatedLabel(d.updatedAt)}; this is not live.</span>
            <Button variant="secondary" onClick={() => { void q.refetch(); }} disabled={q.isFetching} data-testid="button-retry-refresh"><RefreshCw size={16} aria-hidden="true" className="mr-2" />Retry</Button>
          </div>
        )}
        <section aria-labelledby="on-now" className="mt-6" data-testid="section-on-shift">
          <H id="on-now">On shift now</H>
          {people.length === 0 ? (
            d.operatingNow ? (
              <div className="rounded-xl bg-[var(--alliance-amber)] p-5 text-[var(--alliance-amber-ink)]" data-testid="text-no-one-on-shift"><p className="flex items-center gap-2 text-lg font-bold"><AlertTriangle size={20} aria-hidden="true" />No one is on shift right now</p></div>
            ) : <div className="alliance-card" data-testid="text-outside-hours"><p className="font-bold">Outside shift hours</p></div>
          ) : (
            <ul className="grid gap-3 md:grid-cols-2">
              {people.map(p => (
                <li key={p.userId} className="alliance-card border-l-4 border-teal" data-testid={`card-on-shift-${p.userId}`}>
                  <Link href={`/admin/volunteers/${p.userId}`} className="text-lg font-bold text-navy underline-offset-4 hover:underline">{p.name}<TestBadge test={p.isTestAccount} /></Link>
                  <p className="text-sm text-navy-soft" data-testid={`text-ends-${p.userId}`}>
                    {p.shifts.map(s => `Shift ends ${clock(s.end)}${s.label ? ` (${s.label})` : ''}`).join('; ')}
                  </p>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {p.phone ? <a href={`tel:${p.phone}`} data-testid={`link-tel-${p.userId}`} className="flex min-h-11 items-center gap-2 rounded-lg bg-navy px-3 font-bold text-white"><Phone size={18} aria-hidden="true" />{p.phone}</a>
                      : <span className="flex min-h-11 items-center rounded-lg bg-gray px-3 text-sm">No phone on file</span>}
                    <a href={`mailto:${p.email}`} data-testid={`link-mail-${p.userId}`} className="flex min-h-11 min-w-0 items-center gap-2 rounded-lg bg-gray px-3 font-bold"><Mail size={18} aria-hidden="true" className="shrink-0" /><span className="truncate">{p.email}</span></a>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section aria-labelledby="up-next" className="mt-8" data-testid="section-up-next">
          <H id="up-next">Up next</H>
          {d.upNext.length === 0 ? <div className="alliance-card"><p>No upcoming shift is scheduled.</p></div> : (
            <ul className="space-y-3">
              {d.upNext.map(b => {
                const v = activeVols(b);
                return (
                  <li key={`${b.slotId}-${b.date}`} className="alliance-card" data-testid={`card-up-next-${b.slotId}`}>
                    <p className="font-bold">{dayLabel(b.date, { weekday: 'long', month: 'short', day: 'numeric' })}, {range(b)}{b.label ? ` · ${b.label}` : ''}</p>
                    {v.length === 0 ? <p className="mt-2 inline-block rounded-md bg-[var(--alliance-amber)] px-2 py-1 text-sm font-bold text-[var(--alliance-amber-ink)]" data-testid={`text-empty-shift-${b.slotId}`}>Empty shift: no one assigned</p>
                      : <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">{v.map(x => <li key={x.assignmentId}><Link href={`/admin/volunteers/${x.userId}`} className="font-bold text-teal-text underline underline-offset-4">{fullName(x)}<TestBadge test={x.isTestAccount} /></Link></li>)}</ul>}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
        <section aria-labelledby="cover" className="mt-8" data-testid="section-coverage">
          <H id="cover">This week</H>
          <div className="grid gap-3 sm:grid-cols-3">
            <Link href={`/admin/schedule?weekStart=${d.weekStart}`} data-testid="link-open-spots" className="alliance-card hover:shadow-md"><span className="alliance-display block text-[28px]">{d.openSpots}</span><span className="text-sm">Open spots</span></Link>
            <Link href={`/admin/schedule?weekStart=${d.weekStart}`} data-testid="link-under-covered" className="alliance-card hover:shadow-md"><span className="alliance-display block text-[28px]">{d.underCoveredShifts}</span><span className="text-sm">Under-covered shifts</span></Link>
            <Link href="/admin/volunteers?needsAttention=true" data-testid="link-needs-attention" className="alliance-card hover:shadow-md"><span className="alliance-display block text-[28px]">{d.needsAttention}</span><span className="text-sm">Volunteers need attention</span></Link>
          </div>
        </section>
        <section aria-labelledby="act" className="mt-8" data-testid="section-activity">
          <H id="act">Recent activity</H>
          {d.recentActivity.length === 0 ? <div className="alliance-card"><p>No recent activity.</p></div> : (
            <ul className="alliance-card divide-y divide-gray py-0">
              {d.recentActivity.map(a => (
                <li key={a.id} className="py-3" data-testid={`row-activity-${a.id}`}>
                  <p><span className="font-bold">{humanize(a.action)}</span> for <Link href={`/admin/volunteers/${a.userId}`} className="font-bold text-teal-text underline underline-offset-4">{a.volunteerName}</Link></p>
                  <p className="text-xs text-navy-soft">By {a.actorName} · {activityTime(a.createdAt)}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </>)}
      <nav aria-label="Admin shortcuts" className="mt-8 grid gap-3 md:grid-cols-3">
        {[{ href: '/admin/schedule', t: 'Master schedule', I: CalendarDays, id: 'link-admin-schedule' }, { href: '/admin/volunteers', t: 'Roster', I: ClipboardList, id: 'link-admin-roster' }, { href: '/admin/team', t: 'Team accounts', I: Users, id: 'link-admin-team' }].map(({ href, t, I, id }) => (
          <Link key={href} href={href} data-testid={id} className="alliance-card flex items-center gap-3 hover:shadow-md"><I size={22} aria-hidden="true" className="text-teal-text" /><span className="font-bold">{t}</span><ChevronRight size={18} aria-hidden="true" className="ml-auto" /></Link>
        ))}
      </nav>
    </AppLayout>
  );
}
export const AdminOverviewPage = () => <RequireAdmin>{() => <Body />}</RequireAdmin>;
