import { useState } from 'react';
import type { VolunteerAvailableSlot, VolunteerSchedule, VolunteerStandingShift } from '@workspace/api-client-react';
import { Notice } from '@/auth/auth-ui';
import { ShiftModal } from '@/components/shift-modal';
import { ContactLink } from '@/components/shift-cards';
import { dateLabel, slotTitle, ymd } from '@/lib/shift-utils';

export type Dlg =
  | { kind: 'book'; slot: VolunteerAvailableSlot }
  | { kind: 'change'; from: VolunteerStandingShift; slot: VolunteerAvailableSlot }
  | { kind: 'drop'; a: VolunteerStandingShift }
  | { kind: 'skip'; a: VolunteerStandingShift };

export type Actions = {
  book: (slotId: string, startDate: string) => void;
  change: (id: string, slotId: string, startDate: string) => void;
  drop: (id: string) => void;
  skip: (id: string, date: string) => void;
  startChange: (a: VolunteerStandingShift) => void;
};

export function ShiftDialogs({ dlg, schedule, busy, error, onClose, act }: {
  dlg: Dlg; schedule: VolunteerSchedule; busy: boolean; error: string | null; onClose: () => void; act: Actions;
}) {
  const [date, setDate] = useState(() => ('slot' in dlg ? ymd(dlg.slot.startDates[0] ?? '') : dlg.kind === 'skip' ? (dlg.a.nextDates.find(d => d.canSkip)?.date ?? '') : ''));
  const cancel = <button type="button" className="alliance-button alliance-button-secondary" onClick={onClose} disabled={busy} data-testid="button-dialog-cancel">Cancel</button>;
  const err = error && <Notice>{error}</Notice>;
  const email = schedule.contactEmail;

  if (dlg.kind === 'drop') {
    const a = dlg.a;
    if (schedule.assignments.length <= schedule.minShifts) return (
      <ShiftModal title="You need at least one shift" onClose={onClose}
        description={`Volunteers keep at least ${schedule.minShifts} weekly ${schedule.minShifts === 1 ? 'shift' : 'shifts'}. You can swap this one for a different time instead.`}
        footer={<>{cancel}<button type="button" className="alliance-button alliance-button-primary" data-testid="button-dialog-change"
          onClick={() => { onClose(); act.startChange(a); }}>Change this shift</button></>}>
        <p className="text-sm">If you need to step back entirely, please contact <ContactLink email={email}>The Alliance</ContactLink>.</p>
      </ShiftModal>
    );
    return (
      <ShiftModal title="Drop this shift?" busy={busy} onClose={onClose} description={`${slotTitle(a)} will be removed from your schedule and the spot opens to others.`}
        footer={<>{cancel}<button type="button" disabled={busy} className="alliance-button alliance-button-primary" data-testid="button-confirm-drop" onClick={() => act.drop(a.id)}>{busy ? 'Dropping' : 'Drop shift'}</button></>}>
        {err}
      </ShiftModal>
    );
  }

  if (dlg.kind === 'skip') {
    const a = dlg.a;
    const options = a.nextDates.filter(d => d.canSkip);
    return (
      <ShiftModal title="Take a week off" busy={busy} onClose={onClose} description="Pick the date you can't make. Your standing shift stays in place."
        footer={<>{cancel}<button type="button" disabled={busy || !date} className="alliance-button alliance-button-primary" data-testid="button-confirm-skip" onClick={() => act.skip(a.id, ymd(date))}>{busy ? 'Saving' : 'Take week off'}</button></>}>
        {err}
        <label className="grid gap-1 text-sm font-bold" htmlFor="skip-date">Date
          <select id="skip-date" value={date} onChange={e => setDate(e.target.value)} disabled={busy} data-testid="select-skip-date" className="min-h-11 rounded-lg border border-navy/30 bg-white px-3 font-normal">
            {options.map(d => <option key={d.date} value={d.date}>{dateLabel(d.date)}</option>)}
          </select>
        </label>
        {a.nextDates.some(d => !d.skipped && !d.canSkip) && <p className="text-sm">Closer than 24 hours? Please contact <ContactLink email={email}>The Alliance</ContactLink>.</p>}
      </ShiftModal>
    );
  }

  const changing = dlg.kind === 'change';
  const slot = dlg.slot;
  return (
    <ShiftModal title={changing ? 'Move to this shift?' : 'Book this shift'} busy={busy} onClose={onClose}
      description={`${slotTitle(slot)}${slot.label ? `, ${slot.label}` : ''}. It repeats every week.`}
      footer={<>{cancel}<button type="button" disabled={busy || !date} className="alliance-button alliance-button-primary" data-testid="button-confirm-shift"
        onClick={() => (changing ? act.change(dlg.from.id, slot.id, ymd(date)) : act.book(slot.id, ymd(date)))}>{busy ? 'Saving' : changing ? 'Confirm change' : 'Confirm shift'}</button></>}>
      {err}
      {changing && <p className="text-sm">Your current {slotTitle(dlg.from)} shift is released when this one is confirmed.</p>}
      <label className="grid gap-1 text-sm font-bold" htmlFor="start-date">Starting
        <select id="start-date" value={date} onChange={e => setDate(e.target.value)} disabled={busy} data-testid="select-start-date" className="min-h-11 rounded-lg border border-navy/30 bg-white px-3 font-normal">
          {slot.startDates.map(d => <option key={d} value={ymd(d)}>{dateLabel(d)}</option>)}
        </select>
      </label>
    </ShiftModal>
  );
}
