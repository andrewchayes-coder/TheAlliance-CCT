import { STAFF_EMAIL, STAFF_NAME } from '@/lib/contact';
import type { VolunteerShiftDate, VolunteerStandingShift } from '@workspace/api-client-react';
import { dateLabel, slotTitle, ymd } from '@/lib/shift-utils';

export function ContactLink({ children }: { email?: string | null; children?: string }) {
  return <a href={`mailto:${STAFF_EMAIL}`} className="font-bold text-blue underline-offset-4 hover:underline" data-testid="link-contact-alliance">{children ?? `${STAFF_NAME} (${STAFF_EMAIL})`}</a>;
}

export function ShiftCards({ assignments, contactEmail, busy, onChange, onDrop, onSkip, onUndo }: {
  assignments: VolunteerStandingShift[]; contactEmail: string | null; busy: boolean;
  onChange: (a: VolunteerStandingShift) => void; onDrop: (a: VolunteerStandingShift) => void;
  onSkip: (a: VolunteerStandingShift) => void; onUndo: (a: VolunteerStandingShift, d: VolunteerShiftDate) => void;
}) {
  return (
    <ul className="grid gap-4 lg:grid-cols-2">
      {assignments.map(a => {
        const next = a.nextDates.slice(0, 4);
        const seen = new Set(next.map(d => ymd(d.date)));
        const extra = a.weeksOff.filter(w => !seen.has(ymd(w.date)));
        const rows = [...next, ...extra];
        const tooLate = next.some(d => !d.skipped && !d.canSkip);
        const canTake = next.some(d => d.canSkip);
        return (
          <li key={a.id} className="rounded-2xl bg-white p-5 shadow-sm" data-testid={`card-shift-${a.id}`}>
            <p className="alliance-section-kicker">Every {slotTitle(a).split(',')[0]}</p>
            <h3 className="alliance-display mt-1">{slotTitle(a).split(', ')[1]}</h3>
            {a.label && <p className="text-sm text-navy-soft">{a.label}</p>}
            <p className="mt-1 text-xs text-navy-soft">Started {dateLabel(a.startDate)}</p>
            <ul className="mt-3 divide-y divide-gray">
              {rows.map(d => (
                <li key={d.date} className="flex min-h-11 items-center gap-3 py-2" data-testid={`date-${a.id}-${d.date}`}>
                  <span className={d.skipped ? 'text-navy-soft line-through' : 'font-semibold'}>{dateLabel(d.date)}</span>
                  {d.skipped && <span className="rounded-full bg-[var(--alliance-amber)] px-2 py-0.5 text-xs font-bold text-[var(--alliance-amber-ink)]">Week off</span>}
                  {d.skipped && d.canUndo && d.skipId && (
                    <button type="button" disabled={busy} onClick={() => onUndo(a, d)} data-testid={`button-undo-${a.id}-${d.date}`}
                      className="ml-auto min-h-11 px-2 font-bold text-blue underline underline-offset-4 disabled:opacity-50">
                      Undo<span className="sr-only"> week off for {dateLabel(d.date)}</span>
                    </button>
                  )}
                </li>
              ))}
            </ul>
            {tooLate && (
              <p className="mt-2 text-sm" data-testid={`text-late-${a.id}`}>
                A shift within 24 hours can't be skipped online. Please contact <ContactLink />.
              </p>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" disabled={busy || !canTake} onClick={() => onSkip(a)} className="alliance-button alliance-button-secondary" data-testid={`button-skip-${a.id}`}>Take a week off</button>
              <button type="button" disabled={busy} onClick={() => onChange(a)} className="alliance-button alliance-button-secondary" data-testid={`button-change-${a.id}`}>Change shift</button>
              <button type="button" disabled={busy} onClick={() => onDrop(a)} className="alliance-button alliance-button-secondary" data-testid={`button-drop-${a.id}`}>Drop shift</button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
