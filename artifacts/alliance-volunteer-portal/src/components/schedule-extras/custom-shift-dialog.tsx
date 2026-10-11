import { useState } from 'react';
import { useCreateCustomShift } from '@workspace/api-client-react';
import { Button } from '@/components/brand-system';
import { Notice } from '@/auth/auth-ui';
import { readError, useAuth } from '@/auth/auth-context';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { pacificToday } from '@/components/volunteer-detail/format';
import { useInvalidateSchedule } from '@/components/schedule-controls/use-controls';

export function CustomShiftDialog({ onClose, onDone }: { onClose: () => void; onDone: (msg: string) => void }) {
  const { request } = useAuth();
  const refresh = useInvalidateSchedule();
  const create = useCreateCustomShift({ request });
  const [date, setDate] = useState(pacificToday());
  const [start, setStart] = useState('09:00');
  const [end, setEnd] = useState('11:00');
  const [capacity, setCapacity] = useState('2');
  const [label, setLabel] = useState('');
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const cap = Number(capacity);
  const why = !date ? 'Choose a date.' : !start || !end ? 'Choose start and end times.' : end <= start ? 'End time must be after the start time.' : !Number.isInteger(cap) || cap < 1 || cap > 10 ? 'Capacity must be 1 to 10.' : '';
  const submit = (e: React.FormEvent) => {
    e.preventDefault(); if (why) return; setErr(null);
    create.mutate({ data: { date, startTime: start, endTime: end, capacity: cap, label: label.trim() || null, openToVolunteers: open } }, {
      onSuccess: () => { void refresh(); onDone('One-time shift created.'); onClose(); },
      onError: x => setErr(readError(x).message),
    });
  };
  return (
    <Dialog open onOpenChange={o => { if (!o && !create.isPending) onClose(); }}>
      <DialogContent data-testid="dialog-custom-shift">
        <form onSubmit={submit} className="space-y-3">
          <DialogHeader><DialogTitle>Add a one-time shift</DialogTitle><DialogDescription>A single date outside the weekly pattern. It never repeats.</DialogDescription></DialogHeader>
          <label className="block min-w-0 text-sm font-bold">Date<input type="date" className="alliance-input mt-1 w-full min-w-0 max-w-full" value={date} onChange={e => setDate(e.target.value)} required data-testid="input-custom-date" /></label>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block min-w-0 text-sm font-bold">Start<input type="time" className="alliance-input mt-1 w-full min-w-0 max-w-full" value={start} onChange={e => setStart(e.target.value)} required data-testid="input-custom-start" /></label>
            <label className="block min-w-0 text-sm font-bold">End<input type="time" className="alliance-input mt-1 w-full min-w-0 max-w-full" value={end} onChange={e => setEnd(e.target.value)} required data-testid="input-custom-end" /></label>
          </div>
          <label className="block min-w-0 text-sm font-bold">Capacity (1 to 10)<input type="number" min={1} max={10} className="alliance-input mt-1 w-full min-w-0 max-w-full" value={capacity} onChange={e => setCapacity(e.target.value)} data-testid="input-custom-capacity" /></label>
          <label className="block min-w-0 text-sm font-bold">Label (optional)<input type="text" maxLength={120} className="alliance-input mt-1 w-full min-w-0 max-w-full" value={label} onChange={e => setLabel(e.target.value)} data-testid="input-custom-label" /></label>
          <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" className="h-5 w-5" checked={open} onChange={e => setOpen(e.target.checked)} data-testid="checkbox-custom-open" />Open to volunteers to claim</label>
          {(err || why) && <Notice>{err ?? why}</Notice>}
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose} disabled={create.isPending} data-testid="button-custom-cancel">Cancel</Button>
            <Button type="submit" disabled={!!why || create.isPending} data-testid="button-custom-save">{create.isPending ? 'Saving...' : 'Create shift'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
