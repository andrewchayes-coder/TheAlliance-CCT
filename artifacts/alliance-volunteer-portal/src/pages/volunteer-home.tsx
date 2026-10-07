import { Link } from 'wouter';
import { CheckCircle2, Circle, ExternalLink, Mail } from 'lucide-react';
import { getGetVolunteerDashboardQueryKey, useGetVolunteerDashboard, type Me } from '@workspace/api-client-react';
import { FETCH_CREDS } from '@/auth/auth-context';
import { ErrorBlock, LoadingBlock, UpcomingShifts, useNow, volunteerRoute } from '@/components/volunteer-ui';
import { countdown, safeHttps, shiftWhen, shiftDate, timeRange } from '@/lib/pacific';

const cert = { not_started: 'Not started', in_progress: 'In progress', complete: 'Complete' } as const;
const bg = { not_started: 'Not started', pending: 'Pending', cleared: 'Cleared', not_cleared: 'Needs follow-up' } as const;

function Row({ done, label, value }: { done: boolean; label: string; value: string }) {
  const Icon = done ? CheckCircle2 : Circle;
  return (
    <li className="flex items-center gap-3 py-2.5">
      <Icon size={20} className={done ? 'text-teal' : 'text-navy-soft'} aria-hidden="true" />
      <span className="font-bold">{label}</span><span className="ml-auto text-sm">{value}</span>
    </li>
  );
}

function Home({ me }: { me: Me }) {
  const now = useNow();
  const q = useGetVolunteerDashboard({
    query: { queryKey: getGetVolunteerDashboardQueryKey(), refetchInterval: 60_000, staleTime: 15_000, refetchOnWindowFocus: 'always' },
    request: FETCH_CREDS,
  });
  const p = me.profile;
  const d = q.data;
  const status = p?.status ?? 'applicant';
  const Top = () => {
    if (status === 'applicant' || status === 'in_training') return (
      <section className="rounded-2xl bg-white p-5 shadow-sm" data-testid="card-status-pending" aria-labelledby="st-h">
        <h2 id="st-h" className="alliance-section-kicker">Getting you ready</h2>
        <ul className="mt-2 divide-y divide-gray">
          <Row done={!!p?.onboardingCompletedAt} label="Onboarding" value={p?.onboardingCompletedAt ? 'Checked' : 'Not finished'} />
          <Row done={p?.certificationStatus === 'complete'} label="Training certification" value={cert[p?.certificationStatus ?? 'not_started']} />
          <Row done={p?.backgroundCheckStatus === 'cleared'} label="Background check" value={bg[p?.backgroundCheckStatus ?? 'not_started']} />
          <Row done={false} label="Approval" value="Pending" />
        </ul>
        <p className="mt-3 font-bold">We'll email you when you're ready to pick a shift.</p>
      </section>
    );
    if (status === 'inactive') return (
      <section className="rounded-2xl bg-white p-5 shadow-sm" data-testid="card-status-inactive">
        <h2 className="alliance-section-kicker">Your account</h2>
        <p className="mt-2">Your volunteer account isn't active right now. If you'd like to return, please contact the Alliance and we'll help you get set up.</p>
      </section>
    );
    if (!d) return null;
    if (d.shiftCount === 0) return (
      <section className="rounded-2xl bg-navy p-6 text-white shadow-md" data-testid="card-choose-shift">
        <h2 className="alliance-display text-[16px]">Choose your weekly shift</h2>
        <p className="mt-2">{d.schedulingOpen ? "You're approved. Pick the weekly shift that fits your life." : "You're approved. Weekly shift selection is coming soon; we'll let you know when it opens."}</p>
        <Link href="/shifts" className="alliance-button alliance-button-primary mt-4" data-testid="link-choose-shift">Choose your weekly shift</Link>
      </section>
    );
    return (
      <section className="rounded-2xl bg-navy p-6 text-white shadow-md" data-testid="card-next-shift">
        <p className="text-xs font-bold uppercase tracking-[.13em] text-white/80">Your next shift</p>
        {d.nextShift ? (
          <>
            <p className="alliance-display mt-2 text-[18px]">{shiftDate(d.nextShift.date)}</p>
            <p className="mt-2 font-bold">{timeRange(d.nextShift.startTime, d.nextShift.endTime)} Pacific</p>
            <p className="mt-2" aria-live="polite">{shiftWhen(d.nextShift, now)} · {countdown(d.nextShift, now)}</p>
          </>
        ) : <p className="mt-2">Your next date is still being confirmed. We'll show it here as soon as it's set.</p>}
      </section>
    );
  };
  const links = status === 'active' ? (d?.quickLinks ?? []).map(l => ({ l, href: safeHttps(l.href) })).filter(x => x.href) : [];
  const m = d?.unreadMessage;
  return (
    <>
      <p className="alliance-label">Volunteer home</p>
      <h1 className="alliance-display mt-2 text-[22px] md:text-[28px]">Welcome back, {me.user.firstName}.</h1>
      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        {q.isPending ? <div className="lg:col-span-2"><LoadingBlock /></div> : q.isError ? (
          <div className="lg:col-span-2"><ErrorBlock what="your dashboard" onRetry={() => { void q.refetch(); }} /></div>
        ) : (
          <>
            <Top />
            {m && (
              <section className="rounded-2xl bg-white p-5 shadow-sm" data-testid="card-unread-message">
                <h2 className="alliance-section-kicker flex items-center gap-2"><Mail size={14} aria-hidden="true" />New message{d && d.unreadCount > 1 ? ` (${d.unreadCount} unread)` : ''}</h2>
                <p className="mt-2 font-bold">{m.subject}</p>
                <p className="mt-1 line-clamp-3 text-sm">{m.body.length > 160 ? `${m.body.slice(0, 160)}…` : m.body}</p>
                <Link href="/messages" className="mt-3 inline-flex min-h-11 items-center font-bold text-teal-text underline underline-offset-4" data-testid="link-read-message">Read in Messages</Link>
              </section>
            )}
            {d && (
              <div className="lg:col-span-2"><UpcomingShifts shifts={d.upcomingShifts} schedulingOpen={d.schedulingOpen} max={4} now={now} /></div>
            )}
            {links.length > 0 && (
              <section className="lg:col-span-2" aria-labelledby="ql-h" data-testid="section-quick-links">
                <h2 id="ql-h" className="alliance-section-kicker mb-3">Quick links</h2>
                <ul className="grid gap-2 sm:grid-cols-2">
                  {links.map(({ l, href }) => (
                    <li key={l.id}>
                      <a href={href!} target="_blank" rel="noopener noreferrer" data-testid={`link-quick-${l.id}`}
                        className="flex min-h-12 items-center gap-3 rounded-xl bg-white px-4 py-3 font-bold text-teal-text shadow-sm hover:bg-white/70 focus-visible:outline-2 focus-visible:outline-teal">
                        {l.title}<ExternalLink size={14} className="ml-auto" aria-hidden="true" /><span className="sr-only"> (opens in a new tab)</span>
                      </a>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
    </>
  );
}

export const Dashboard = volunteerRoute(me => <Home me={me} />);
