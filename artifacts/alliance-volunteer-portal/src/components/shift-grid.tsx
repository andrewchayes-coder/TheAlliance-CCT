import type { VolunteerAvailableSlot, VolunteerSchedule, VolunteerStandingShift } from '@workspace/api-client-react';
import { DAYS, WEEKDAYS, slotState, type SlotState } from '@/lib/shift-utils';
import { timeRange } from '@/lib/pacific';

function badge(st: SlotState, open: number) {
  if (st === 'own') return 'Your shift';
  if (st === 'full') return 'Full';
  if (st === 'open' || st === 'max' || st === 'overlap') return `${open} ${open === 1 ? 'spot' : 'spots'} open`;
  return 'Not available';
}
const hint: Partial<Record<SlotState, string>> = {
  overlap: 'Overlaps one of your shifts', max: 'You are at the weekly shift limit', closed: 'No start dates open',
};

export function ShiftGrid({ schedule, changing, disabled, onPick }: {
  schedule: VolunteerSchedule; changing: VolunteerStandingShift | null; disabled: boolean; onPick: (s: VolunteerAvailableSlot) => void;
}) {
  return (
    <div className="grid gap-4 md:grid-cols-5" data-testid="grid-shifts">
      {WEEKDAYS.map(d => {
        const slots = schedule.slots.filter(s => s.dayOfWeek === d);
        return (
          <section key={d} aria-label={DAYS[d]} className="min-w-0">
            <h3 className="alliance-section-kicker mb-2">{DAYS[d]}</h3>
            <ul className="grid gap-2">
              {slots.length === 0 && <li className="rounded-xl border border-dashed border-navy/25 px-3 py-3 text-sm text-navy-soft">No shifts</li>}
              {slots.map(s => {
                const st = slotState(s, schedule, changing);
                const can = st === 'open' && !disabled;
                const own = st === 'own';
                return (
                  <li key={s.id}>
                    <button type="button" disabled={!can} onClick={() => onPick(s)} data-testid={`slot-${s.id}`}
                      aria-label={`${DAYS[d]} ${timeRange(s.startTime, s.endTime)}${s.label ? `, ${s.label}` : ''}: ${badge(st, s.openSpots)}${hint[st] ? `. ${hint[st]}` : ''}`}
                      className={`flex min-h-16 w-full flex-col items-start rounded-xl px-3 py-2.5 text-left shadow-sm transition-colors focus-visible:outline-2 focus-visible:outline-teal ${
                        own ? 'bg-navy text-white' : can ? 'bg-white hover:bg-white/70' : 'bg-white/60 text-navy-soft'} disabled:cursor-not-allowed`}>
                      <span className="font-bold">{timeRange(s.startTime, s.endTime)}</span>
                      {s.label && <span className="text-xs">{s.label}</span>}
                      <span className={`mt-1 text-xs font-bold uppercase tracking-wide ${can ? 'text-teal-text' : ''}`}>{badge(st, s.openSpots)}</span>
                      {hint[st] && <span className="text-xs">{hint[st]}</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
