import { SOMETHING_WENT_WRONG } from '@/lib/contact';
import { PageHeader } from '@/components/page-header';
import { useState } from 'react';
import { useGetScheduleSettings, useCopyMondaySlots, useLoadStandardGrid, type ScheduleSlot } from '@workspace/api-client-react';
import { AppLayout, Button, StatusBadge } from '@/components/brand-system';
import { Notice } from '@/auth/auth-ui';
import { RequireAdmin } from '@/auth/guards';
import { FETCH_CREDS, FRESH_MS, readError, useAuth } from '@/auth/auth-context';
import { Skeleton } from '@/components/ui/skeleton';
import { DAYS, calDate, clock, daysUntil } from '@/components/volunteer-detail/format';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useInvalidateSchedule } from '@/components/schedule-controls/use-controls';
import { CustomShiftDialog } from '@/components/schedule-extras/custom-shift-dialog';
import { BlockShiftsForm, BlockList } from '@/components/schedule-extras/block-shifts';
import { DigestToggle } from '@/components/schedule-controls/digest-toggle';
import { SlotDialog } from '@/components/schedule-settings/slot-dialog';
import { ClosedDates } from '@/components/schedule-settings/closed-dates';
import { plural, useScheduleSync } from '@/components/schedule-settings/use-schedule';

type Editing = { slot: ScheduleSlot | null; day: number } | null;

function SlotRow({ s, onEdit }: { s: ScheduleSlot; onEdit: () => void }) {
  const scheduled = s.isActive && !!s.retireAfterDate && daysUntil(s.retireAfterDate) >= 0;
  return (
    <li className="flex flex-wrap items-start justify-between gap-3 py-3" data-testid={`row-slot-${s.id}`}>
      <div className="min-w-0">
        <p className="font-bold tabular-nums">{clock(s.startTime)} to {clock(s.endTime)}{s.label ? <span className="font-normal"> · {s.label}</span> : null}</p>
        <p className="mt-1 text-sm">{plural(s.assignedCount, 'volunteer')} of {s.capacity} seats</p>
        {scheduled && s.retireAfterDate && <p className="mt-1 text-sm font-bold">Scheduled inactive after {calDate(s.retireAfterDate)}. Existing assignments only.</p>}
        {s.overlaps.length > 0 && <p className="mt-1 text-xs">Overlaps with {s.overlaps.map(o => `${clock(o.startTime)} to ${clock(o.endTime)}${o.label ? ` (${o.label})` : ''}`).join(', ')}</p>}
      </div>
      <div className="flex items-center gap-2">
        <StatusBadge status={!s.isActive ? 'neutral' : scheduled ? 'attention' : 'good'}>{!s.isActive ? 'Inactive' : scheduled ? 'Closing' : 'Active'}</StatusBadge>
        <Button type="button" variant="secondary" onClick={onEdit} data-testid={`button-edit-slot-${s.id}`}>Edit</Button>
      </div>
    </li>
  );
}

function Body() {
  const { request } = useAuth();
  const sync = useScheduleSync();
  const q = useGetScheduleSettings({ query: { queryKey: ['/api/admin/schedule/settings'], staleTime: FRESH_MS, refetchOnWindowFocus: 'always', retry: false }, request: FETCH_CREDS });
  const copy = useCopyMondaySlots({ request });
  const refreshAll = useInvalidateSchedule();
  const grid = useLoadStandardGrid({ request });
  const [confirmGrid, setConfirmGrid] = useState(false);
  const [oneTime, setOneTime] = useState(false);
  const doGrid = () => {
    setCopyErr(null); setResult(null);
    grid.mutate(undefined, {
      onSuccess: r => { void refreshAll(); setConfirmGrid(false); setResult(`Standard grid loaded: ${r.created} created, ${r.skipped} already existed.`); },
      onError: e => { setConfirmGrid(false); setCopyErr(readError(e).message); },
    });
  };
  const [editing, setEditing] = useState<Editing>(null);
  const [result, setResult] = useState<string | null>(null);
  const [copyErr, setCopyErr] = useState<string | null>(null);
  const data = q.data;

  const doCopy = () => {
    setCopyErr(null); setResult(null);
    copy.mutate(undefined, {
      onSuccess: s => {
        sync(s);
        const n = s.addedSlotIds?.length ?? 0;
        setResult(n === 0 ? 'Nothing was added. Tuesday to Friday already have every Monday slot.' : `${plural(n, 'slot')} added to Tuesday through Friday. Existing slots were not changed.`);
      },
      onError: e => setCopyErr(readError(e).message),
    });
  };

  return (
    <>
      <PageHeader eyebrow="Admin" title="Schedule settings" description="Weekly volunteer time slots and the dates the office is closed." actions={<>
          <Button type="button" variant="secondary" className="h-auto min-h-11 w-full max-w-full whitespace-normal text-center sm:w-auto" onClick={() => setConfirmGrid(true)} data-testid="button-load-standard-grid">Load Community Care Team standard grid</Button>
          <Button type="button" variant="secondary" className="h-auto min-h-11 w-full max-w-full whitespace-normal sm:w-auto" onClick={() => setOneTime(true)} data-testid="button-add-one-time">Add a one-time shift</Button>
          <Button type="button" variant="secondary" onClick={doCopy} disabled={copy.isPending || !data} data-testid="button-copy-monday">{copy.isPending ? 'Copying...' : 'Copy Monday to all weekdays'}</Button>
          <Button type="button" onClick={() => setEditing({ slot: null, day: 1 })} disabled={!data} data-testid="button-add-slot">Add slot</Button>
      </>} />
      <p className="mb-2 text-xs text-navy-soft">Copying only adds Monday slots that are missing on other days. It never changes or removes existing slots.</p>
      <div className="mt-3">{result && <Notice kind="success">{result}</Notice>}</div>
      {copyErr && <div className="mt-3"><Notice>{copyErr}</Notice></div>}

      <Dialog open={confirmGrid} onOpenChange={o => { if (!o && !grid.isPending) setConfirmGrid(false); }}>
        <DialogContent data-testid="dialog-load-grid">
          <DialogHeader><DialogTitle>Load the standard grid?</DialogTitle>
            <DialogDescription>Adds the standard Monday to Friday grid of two-hour slots, 9:00 AM to 6:00 PM. Slots that already exist are skipped, so it is safe to run again.</DialogDescription></DialogHeader>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setConfirmGrid(false)} disabled={grid.isPending} data-testid="button-grid-no">Cancel</Button>
            <Button type="button" onClick={doGrid} disabled={grid.isPending} data-testid="button-grid-yes">{grid.isPending ? 'Loading...' : 'Load grid'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {oneTime && <CustomShiftDialog onClose={() => setOneTime(false)} onDone={setResult} />}

      <DigestToggle />

      {q.isLoading && <div className="mt-4 space-y-3" role="status" aria-busy="true"><span className="sr-only">Loading</span>{[0, 1, 2].map(i => <Skeleton key={i} className="h-24 w-full" />)}</div>}
      {q.isError && (
        <div className="mt-4"><Notice>{readError(q.error, SOMETHING_WENT_WRONG).message}</Notice>
          <Button type="button" className="mt-3" onClick={() => { void q.refetch(); }} data-testid="button-retry-settings">Try again</Button></div>
      )}
      {data && (<>
        {[1, 2, 3, 4, 5].map(d => {
          const list = data.slots.filter(s => s.dayOfWeek === d).sort((a, b) => a.startTime.localeCompare(b.startTime));
          return (
            <section key={d} className="alliance-card mt-4" aria-labelledby={`day-${d}`} data-testid={`section-day-${d}`}>
              <div className="flex items-center justify-between gap-2">
                <h2 id={`day-${d}`} className="alliance-display">{DAYS[d]}</h2>
                <Button type="button" variant="secondary" onClick={() => setEditing({ slot: null, day: d })} data-testid={`button-add-slot-${d}`}>Add to {DAYS[d]}</Button>
              </div>
              {list.length === 0 ? <p className="mt-3 text-sm" data-testid={`empty-day-${d}`}>No slots yet for {DAYS[d]}.</p> : (
                <ul className="mt-2 divide-y divide-gray">{list.map(s => <SlotRow key={s.id} s={s} onEdit={() => setEditing({ slot: s, day: d })} />)}</ul>
              )}
            </section>
          );
        })}
        <BlockShiftsForm slots={data.slots} />
        <BlockList slots={data.slots} />
        <ClosedDates items={data.closedDates} onDone={setResult} />
        {editing && (
          <SlotDialog slot={editing.slot} defaultDay={editing.day} all={data.slots} onClose={() => setEditing(null)}
            onDone={t => { setEditing(null); setResult(t); }} onRefresh={async () => (await q.refetch()).data} />
        )}
      </>)}
    </>
  );
}

export const AdminScheduleSettings = () => (
  <RequireAdmin>{() => <AppLayout role="admin"><Body /></AppLayout>}</RequireAdmin>
);
