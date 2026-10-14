import { useState } from 'react';
import { Link } from 'wouter';
import { appConfig, volunteerContactText } from '@workspace/shared/appConfig';
import { EmptyState } from '@/components/brand-system';
import { ErrorBlock } from '@/components/volunteer-ui';
import { HoursRow, fmtHours, hoursKey, useVolunteerHoursData } from '@/components/hours-ui';

export function HomeHoursCard({ enabled }: { enabled: boolean }) {
  const { q, at } = useVolunteerHoursData(enabled);
  const [keep, setKeep] = useState<string[]>([]);
  const d = q.data;
  if (!enabled || !appConfig.hoursLogging) return null;
  if (q.isError) return <ErrorBlock what="your past shifts" onRetry={() => { void q.refetch(); }} />;
  if (!d) return null;
  const rows = d.shifts.filter(s => !s.logged || keep.includes(`${s.date}-${hoursKey(s)}`)).slice(0, 3);
  const hasMore = d.shifts.filter(s => !s.logged).length > 3;
  const onSaved = (k: string) => {
    setKeep(p => [...p, k]);
    setTimeout(() => setKeep(p => p.filter(x => x !== k)), 1800);
  };
  return (
    <>
      {rows.length > 0 && (
        <section className="rounded-2xl bg-white/60 p-5 shadow-sm lg:col-span-2" data-testid="card-log-hours" aria-labelledby="lh-h">
          <h2 id="lh-h" className="alliance-section-kicker">Log your hours</h2>
          <p className="mt-2">Thanks for your shift! Confirm the hours you served.</p>
          <ul className="mt-3 grid gap-3">
            {rows.map(s => <HoursRow key={`${s.date}-${hoursKey(s)}`} shift={s} at={at} variant="home" onSaved={onSaved} />)}
          </ul>
          <Link href={`/shifts${at ? `?at=${encodeURIComponent(at)}` : ''}#past-shifts`} className="mt-3 inline-flex min-h-11 items-center font-bold text-blue underline underline-offset-4" data-testid="link-past-shifts">See all past shifts</Link>
          {hasMore && <span className="sr-only"> (more shifts waiting)</span>}
        </section>
      )}
      {(d.shifts.length > 0 || d.hasLoggedHours) && <p className="text-sm font-bold lg:col-span-2" data-testid="text-hours-this-month">Your hours this month: {d.monthTotal}</p>}
    </>
  );
}

export function PastShiftsSection({ enabled }: { enabled: boolean }) {
  const { q, at } = useVolunteerHoursData(enabled);
  if (!enabled || !appConfig.hoursLogging) return null;
  return (
    <section id="past-shifts" className="scroll-mt-20" data-testid="section-past-shifts" aria-labelledby="ps-h">
      <h2 id="ps-h" className="alliance-section-kicker mb-3">Past shifts</h2>
      {q.isPending ? <p className="text-sm" role="status">Loading past shifts...</p> : q.isError || !q.data ? (
        <ErrorBlock what="your past shifts" onRetry={() => { void q.refetch(); }} />
      ) : q.data.shifts.length === 0 ? (
        <EmptyState title="No past shifts yet" description="Your past shifts from the last 14 days will show here so you can log your hours." />
      ) : (
        <>
          <p className="mb-2 text-sm font-bold" data-testid="text-hours-this-month-past">Your hours this month: {fmtHours(q.data.monthTotal)}</p>
          <ul className="grid gap-3">{q.data.shifts.map(s => <HoursRow key={`${s.date}-${hoursKey(s)}`} shift={s} at={at} variant="past" />)}</ul>
        </>
      )}
      <p className="mt-3 text-sm">You can log or change hours for {appConfig.hoursLogWindowDays} days after a shift. For older shifts, contact {volunteerContactText}.</p>
    </section>
  );
}
