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
      <p className="alliance-label">{kicker}</p>
      <h1 className="alliance-display mt-2 text-[22px] text-navy md:text-[28px]">{title}</h1>
      <div className="mt-6 grid gap-5">{children}</div>
    </>
  );
}

export const volunteerRoute = (render: (me: Me) => ReactNode) => () => (
  <RequireVerified>{me => <AppLayout role="volunteer">{render(me)}</AppLayout>}</RequireVerified>
);

export function LoadingBlock() {
  return <div role="status" aria-busy="true" className="grid gap-3"><span className="sr-only">Loading</span><Skeleton className="h-24 w-full" /><Skeleton className="h-24 w-full" /></div>;
}

export function ErrorBlock({ onRetry, what }: { onRetry: () => void; what: string }) {
  return (
    <Card>
      <Notice>We couldn't load {what}. Your information is safe.</Notice>
      <Button variant="secondary" onClick={onRetry} data-testid="button-retry">Try again</Button>
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
                <span className="block text-[11px] font-bold uppercase">{dayLabel(s.date, now).slice(0, 3)}</span>
                <span className="block text-lg font-bold leading-tight">{Number(s.date.slice(8))}</span>
              </div>
              <div className="min-w-0"><p className="font-bold">{shiftWhen(s, now)}</p>{s.label && <p className="text-sm text-navy-soft">{s.label}</p>}</div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="rounded-xl border border-dashed border-navy/25 bg-white px-5 py-6" data-testid="empty-upcoming">
          <p className="font-bold">{schedulingOpen ? 'No upcoming shifts yet' : 'Shift scheduling is coming soon'}</p>
          <p className="mt-1 text-sm">{schedulingOpen ? 'Your upcoming shifts will appear here.' : "Choosing and booking shifts isn't open yet. Your upcoming shifts will show here once it is."}</p>
        </div>
      )}
    </section>
  );
}
