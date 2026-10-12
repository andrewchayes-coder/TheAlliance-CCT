import { OneTimeTag } from '@/components/schedule-extras/one-time-tag';
import { PageHeader } from '@/components/page-header';
import { ContactLink } from '@/components/shift-cards';
import { useEffect, useState, type ReactNode } from 'react';
import { AppLayout, Button, Card } from '@/components/brand-system';
import { Skeleton } from '@/components/ui/skeleton';
import { Notice } from '@/auth/auth-ui';
import { RequireVerified } from '@/auth/guards';
import { dayLabel, shiftWhen } from '@/lib/pacific';
import type { Me, ShiftOccurrence } from '@workspace/api-client-react';

export function useNow(ms = 30_000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}

export function VolunteerPage({ kicker, title, children }: { kicker: string; title: string; children: ReactNode }) {
  return (
    <>
      <PageHeader eyebrow={kicker} title={title} />
      <div className="grid gap-5">{children}</div>
    </>
  );
}

export const volunteerRoute = (render: (me: Me) => ReactNode) => () => (
  <RequireVerified>{me => <AppLayout role="volunteer">{render(me)}</AppLayout>}</RequireVerified>
);

export const volunteerRouteIncomplete = (render: (me: Me) => ReactNode) => () => (
  <RequireVerified allowIncomplete>{me => <AppLayout role="volunteer">{render(me)}</AppLayout>}</RequireVerified>
);

export function LoadingBlock() {
  return <div role="status" aria-busy="true" className="grid gap-3"><span className="sr-only">Loading</span><Skeleton className="h-24 w-full" /><Skeleton className="h-24 w-full" /></div>;
}

export function ErrorBlock({ onRetry, what }: { onRetry: () => void; what: string }) {
  return (
    <Card>
      <Notice>Something went wrong on our end. Please try again. If it keeps happening, let <ContactLink /> know.</Notice>
      <Button variant="secondary" onClick={onRetry} data-testid="button-retry" data-what={what}>Try again</Button>
    </Card>
  );
}

export function UpcomingShifts({ shifts, schedulingOpen, max, now }: { shifts: ShiftOccurrence[]; schedulingOpen: boolean; max?: number; now?: Date }) {
  const list = max ? shifts.slice(0, max) : shifts;
  return (
    <section aria-labelledby="upcoming-h" data-testid="section-upcoming-shifts">
      <h2 id="upcoming-h" className="alliance-section-kicker mb-3">Upcoming shifts</h2>
      {list.length > 0 ? (
        <ul className="grid gap-2">
          {list.map(s => (
            <li key={`${s.assignmentId}-${s.date}`} className="flex items-center gap-4 rounded-xl bg-white px-4 py-3 shadow-sm" data-testid={`shift-${s.assignmentId}-${s.date}`}>
              <div className="w-14 shrink-0 rounded-lg bg-navy py-1.5 text-center text-white">
                <span className="block text-xs font-bold">{dayLabel(s.date, now).slice(0, 3)}</span>
                <span className="block text-lg font-bold leading-tight">{Number(s.date.slice(8))}</span>
              </div>
              <div className="min-w-0"><p className="font-bold">{shiftWhen(s, now)}{s.kind === 'custom' && <OneTimeTag className="ml-2 align-middle" />}</p>{s.label && <p className="text-sm text-navy-soft">{s.label}</p>}</div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="rounded-xl border border-dashed border-navy/25 bg-white px-5 py-6" data-testid="empty-upcoming">
          <p className="font-bold">{schedulingOpen ? 'No shifts yet' : 'No shifts on your calendar'}</p>
          <p className="mt-1 text-sm">{schedulingOpen ? 'Choose a weekly time to start helping local families find their way to support.' : 'Once you pick a weekly shift, your upcoming dates show here.'}</p>
        </div>
      )}
    </section>
  );
}
