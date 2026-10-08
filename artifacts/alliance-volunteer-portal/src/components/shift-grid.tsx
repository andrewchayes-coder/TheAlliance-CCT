import { useState } from 'react';
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
  const [day, setDay] = useState<number>(WEEKDAYS[0]);
  return (
    <div data-testid="grid-shifts-wrap">
    <div role="group" aria-label="Choose a day" className="mb-4 grid grid-cols-5 gap-1 rounded-xl bg-gray p-1 lg:hidden" data-testid="tabs-shift-days">
      {WEEKDAYS.map(d => (
        <button key={d} type="button" aria-pressed={d === day} aria-label={DAYS[d]} onClick={() => setDay(d)} data-testid={`button-shift-day-${d}`}
          className={`min-h-11 min-w-11 rounded-lg text-sm font-bold focus-visible:outline-2 focus-visible:outline-teal ${d === day ? 'bg-white shadow-sm' : ''}`}>{DAYS[d].slice(0, 3)}</button>
      ))}
    </div>
    <div className="grid gap-4 lg:grid-cols-5" data-testid="grid-shifts">
      {WEEKDAYS.map(d => {
        const slots = schedule.slots.filter(s => s.dayOfWeek === d);
        return (
          <section key={d} aria-label={DAYS[d]} className={`min-w-0 ${d === day ? '' : 'hidden lg:block'}`}>
            <h3 className="alliance-section-kicker mb-2">{DAYS[d]}</h3>
            <ul className="grid gap-2">
              {slots.length === 0 && <li className="rounded-xl border border-dashed border-navy/40 px-3 py-3 text-sm text-navy-soft">No shifts this day</li>}
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
                      {s.label && <span className="text-sm">{s.label}</span>}
                      <span className={`mt-1 text-[14px] font-bold uppercase tracking-wide ${can ? 'text-teal-text' : ''}`}>{badge(st, s.openSpots)}</span>
                      {hint[st] && <span className="text-sm">{hint[st]}</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
    </div>
  );
}
