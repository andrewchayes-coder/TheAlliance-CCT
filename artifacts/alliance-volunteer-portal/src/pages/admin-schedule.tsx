import { ContactLink } from '@/components/shift-cards';
import { useMemo, useState, useRef, type RefObject } from 'react';
import { TestBadge } from '@/components/test-badge';
import { Link, useLocation, useSearch } from 'wouter';
import { keepPreviousData } from '@tanstack/react-query';
import { Plus, ChevronLeft, ChevronRight, Mail, Phone, RefreshCw, Settings } from 'lucide-react';
import { getGetAdminScheduleWeekQueryKey, useGetAdminScheduleWeek, type CoordinatorBlock, type CoordinatorWeek } from '@workspace/api-client-react';
import { AppLayout, Button } from '@/components/brand-system';
import { Notice } from '@/auth/auth-ui';
import { RequireAdmin } from '@/auth/guards';
import { FETCH_CREDS } from '@/auth/auth-context';
import { Skeleton } from '@/components/ui/skeleton';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { clock, pacificToday } from '@/components/volunteer-detail/format';
import { OneTimeTag } from '@/components/schedule-extras/one-time-tag';
import { CustomShiftDialog } from '@/components/schedule-extras/custom-shift-dialog';
import { BlockedPanel, BlockThisShift, CustomPanel } from '@/components/schedule-extras/shift-panels';
import { AdminScheduleControls } from '@/components/schedule-controls/admin-schedule-controls';
import { POLL, addDays, dayLabel, fullName, layoutBlocks, timeGeometry, mondayOf, range, shortName, updatedLabel, validDate } from '@/lib/coordinator';
import { operatingWeekStart } from '@workspace/shared/calendar-display';
import { formatPhone } from '@workspace/shared/profileFields';

const mins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
const STATE_CLS: Record<string, string> = {
  covered: 'border-blue bg-white', under: 'border-[var(--alliance-amber-ink)] bg-gray',
  empty: 'border-[var(--alliance-amber-ink)] bg-[var(--alliance-amber)]', closed: 'border-navy-soft bg-gray opacity-80', blocked: 'border-navy-soft bg-gray',
};
const isCustom = (b: CoordinatorBlock) => b.kind === 'custom';
const cardCls = (b: CoordinatorBlock) => b.state === 'blocked' ? STATE_CLS.blocked : isCustom(b) ? `border-2 border-dashed border-blue ${b.state === 'covered' ? 'bg-white' : 'bg-gray'}` : STATE_CLS[b.state];
function badge(b: CoordinatorBlock) {
  if (b.state === 'blocked') return `Blocked \u2013 ${b.blockedReason ?? 'no reason given'}`;
  if (b.state === 'under') return `${b.openSpots} open`;
  if (b.state === 'empty') return 'Open';
  if (b.state === 'closed') return `Closed${b.closedReason ? ` - ${b.closedReason}` : ''}`;
  return null;
}

function BlockBody({ b, full }: { b: CoordinatorBlock; full?: boolean }) {
  const bd = badge(b);
  return (<>
    <span className="block text-xs font-bold">{clock(b.startTime)}<span className="block">to {clock(b.endTime)}</span></span>
    {isCustom(b) && <OneTimeTag className="mb-0.5" />}
    {b.label && <span className="block truncate text-xs">{b.label}</span>}
    <span className="block text-xs font-bold" data-testid={`filled-${b.slotId}-${b.date}`}>{b.state === 'blocked' ? null : `${b.assignedCount}/${b.capacity}`}</span>
    {bd && <span title={bd} className={`block truncate text-xs font-bold ${b.state === 'closed' || b.state === 'blocked' ? '' : 'text-[var(--alliance-amber-ink)]'}`}>{bd}</span>}
    {b.volunteers.map(v => <span key={v.assignmentId} className="block text-xs">
      <span className={`block truncate ${v.skipped ? 'line-through' : ''}`}>{full ? fullName(v) : shortName(v)}<TestBadge test={v.isTestAccount} /></span>
      {v.skipped && <span className="block text-sm">week off</span>}
    </span>)}
  </>);
}

function Drawer({ block, gone, onClose, returnFocus }: { block: CoordinatorBlock | null; gone: boolean; onClose: () => void; returnFocus: RefObject<HTMLButtonElement | null> }) {
  return (
    <Sheet open={!!block || gone} onOpenChange={o => { if (!o) onClose(); }}>
      <SheetContent className="w-full overflow-y-auto bg-white text-navy sm:max-w-sm" data-testid="drawer-block"
        onCloseAutoFocus={event => {
          event.preventDefault();
          if (returnFocus.current?.isConnected) returnFocus.current.focus();
          else document.querySelector<HTMLButtonElement>('[data-testid="button-prev-week"]')?.focus();
        }}>
        {gone || !block ? (
          <SheetHeader><SheetTitle className="alliance-display text-navy">Shift no longer available</SheetTitle>
            <SheetDescription data-testid="text-drawer-removed">This shift was changed or removed. Volunteer details are hidden to avoid showing stale names.</SheetDescription></SheetHeader>
        ) : (<>
          <SheetHeader className="text-left">
            <SheetTitle className="alliance-display break-words pr-10 text-navy">{block.label || 'Shift'}</SheetTitle>
            <SheetDescription>{dayLabel(block.date, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}, {range(block)} PT</SheetDescription>
          </SheetHeader>
          <dl className="mt-4 grid grid-cols-3 gap-2 text-sm">
            <div><dt className="alliance-label">State</dt><dd className="capitalize" data-testid="text-drawer-state">{block.state}</dd></div>
            <div><dt className="alliance-label">Capacity</dt><dd data-testid="text-drawer-capacity">{block.capacity}</dd></div>
            <div><dt className="alliance-label">Assigned</dt><dd>{block.assignedCount}</dd></div>
          </dl>
          {isCustom(block) && <div className="mt-2"><OneTimeTag /></div>}
          {block.closedReason && <p className="mt-3 rounded-lg bg-gray p-3 text-sm">Closed: {block.closedReason}</p>}
          <h3 className="alliance-label mt-5">Volunteers</h3>
          {block.volunteers.length === 0 ? <p className="mt-2 text-sm">No one assigned.</p> : (
            <ul className="mt-2 divide-y divide-gray">
              {block.volunteers.map(v => (
                <li key={v.assignmentId} className="py-3" data-testid={`row-drawer-vol-${v.userId}`}>
                  <Link href={`/admin/volunteers/${v.userId}`} className={`font-bold text-blue underline underline-offset-4 ${v.skipped ? 'line-through' : ''}`}>{fullName(v)}<TestBadge test={v.isTestAccount} /></Link>
                  {v.skipped && <span className="ml-2 text-xs font-bold">Off this week</span>}
                  {!v.accountActive && <span className="ml-2 text-xs font-bold">Inactive account</span>}
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                    {v.phone && <a href={`tel:${v.phone}`} className="inline-flex items-center gap-1 underline"><Phone size={14} aria-hidden="true" />{formatPhone(v.phone) || v.phone}</a>}
                    <a href={`mailto:${v.email}`} className="inline-flex min-w-0 items-center gap-1 break-all underline"><Mail size={14} aria-hidden="true" />{v.email}</a>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {block.state === 'blocked' ? <BlockedPanel blockId={block.blockId} reason={block.blockedReason} />
            : isCustom(block) ? <CustomPanel key={block.slotId} shiftId={block.slotId} />
            : (<>
              <AdminScheduleControls key={`${block.slotId}-${block.date}`} slotId={block.slotId} closed={block.state === 'closed'} closedReason={block.closedReason} />
              {block.state !== 'closed' && <BlockThisShift key={`b-${block.slotId}-${block.date}`} slotId={block.slotId} date={block.date} />}
            </>)}
        </>)}
      </SheetContent>
    </Sheet>
  );
}

function Desktop({ week, onOpen }: { week: CoordinatorWeek; onOpen: (b: CoordinatorBlock, trigger: HTMLButtonElement) => void }) {
  const { hours, height, position } = useMemo(() => timeGeometry(week.blocks), [week.blocks]);
  return (
    <div className="alliance-card hidden overflow-x-auto lg:block" data-testid="grid-week">
      <div className="grid min-w-[760px]" style={{ gridTemplateColumns: `56px repeat(${week.days.length}, minmax(0, 1fr))` }}>
        <div />
        {week.days.map(day => (
          <div key={day.date} className={`border-b border-gray px-2 pb-2 text-center ${day.date === week.today ? 'font-bold text-blue' : ''}`} data-testid={`head-day-${day.date}`}>
            {dayLabel(day.date)}{day.date === week.today && <span className="ml-1 text-xs">Today</span>}
            {day.closedReason && <span className="block text-xs font-bold text-navy-soft">Closed - {day.closedReason}</span>}
          </div>
        ))}
        <div className="relative" style={{ height }} aria-hidden="true">
          {hours.map(h => <span key={h} className="absolute right-2 -translate-y-1/2 text-[14px]" style={{ top: position(h) }}>{clock(`${String((h / 60) % 24).padStart(2, '0')}:00`)}</span>)}
        </div>
        {week.days.map(day => {
          const lay = layoutBlocks(week.blocks.filter(b => b.date === day.date));
          return (
            <div key={day.date} className={`relative border-l border-gray ${day.date === week.today ? 'bg-blue/5' : ''} ${day.closedReason ? 'bg-gray/60' : ''}`} style={{ height }}>
              {hours.map(h => <div key={h} className="absolute inset-x-0 border-t border-gray" style={{ top: position(h) }} />)}
              {hours.slice(0, -1).map(h => <div key={`half-${h}`} className="absolute inset-x-0 border-t border-dotted border-gray/70" style={{ top: position(h + 30) }} />)}
              {lay.map(({ b, lane, lanes }) => {
                return (
                  <button key={`${b.slotId}-${b.date}`} type="button" onClick={event => onOpen(b, event.currentTarget)} data-testid={`block-${b.slotId}-${b.date}`}
                    aria-label={`${range(b)}, ${b.state}, ${b.assignedCount} of ${b.capacity} assigned`}
                    className={`absolute overflow-hidden rounded-md ${isCustom(b) ? '' : 'border-l-4'} p-1 text-left shadow-sm focus-visible:outline-2 focus-visible:outline-blue ${cardCls(b)}`}
                    style={{ top: position(mins(b.startTime)), height: position(mins(b.endTime)) - position(mins(b.startTime)) - 2, left: `calc(${(lane / lanes) * 100}% + 2px)`, width: `calc(${100 / lanes}% - 4px)` }}>
                    <BlockBody b={b} />
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Mobile({ week, pick, setPick, onOpen }: { week: CoordinatorWeek; pick: string; setPick: (d: string) => void; onOpen: (b: CoordinatorBlock, trigger: HTMLButtonElement) => void }) {
  const day = week.days.find(d => d.date === pick);
  const list = week.blocks.filter(b => b.date === pick).sort((a, b) => a.startTime.localeCompare(b.startTime));
  return (
    <div className="lg:hidden" data-testid="list-day">
      <div role="group" aria-label="Choose a day" className="grid gap-1 rounded-lg bg-gray p-1" style={{ gridTemplateColumns: `repeat(${week.days.length}, minmax(0, 1fr))` }}>
        {week.days.map(d => (
          <button key={d.date} type="button" aria-pressed={d.date === pick} onClick={() => setPick(d.date)} data-testid={`button-day-${d.date}`}
            className={`min-h-12 min-w-11 rounded-md text-xs font-bold ${d.date === pick ? 'bg-white shadow-sm' : ''} ${d.date === week.today ? (d.date === pick ? 'text-blue' : 'underline decoration-blue decoration-2 underline-offset-4') : ''}`}>
            {dayLabel(d.date, { weekday: 'short' })}<span className="block font-normal">{dayLabel(d.date, { day: 'numeric' })}{d.date === week.today ? ' Today' : ''}</span>
          </button>
        ))}
      </div>
      {day?.closedReason && <p className="mt-3 rounded-lg bg-gray p-3 font-bold text-navy-soft" data-testid="banner-day-closed">Closed - {day.closedReason}</p>}
      {list.length === 0 ? <p className="alliance-card mt-3" data-testid="text-no-blocks">Nothing is scheduled for this day yet.</p> : (
        <ul className="mt-3 space-y-2">
          {list.map(b => (
            <li key={`${b.slotId}-${b.date}`}><button type="button" onClick={event => onOpen(b, event.currentTarget)} data-testid={`block-${b.slotId}-${b.date}`}
              className={`w-full rounded-lg ${isCustom(b) ? '' : 'border-l-4'} p-3 text-left ${cardCls(b)}`}><BlockBody b={b} /></button></li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Body() {
  const search = useSearch();
  const [, nav] = useLocation();
  const qp = new URLSearchParams(search).get('weekStart');
  const today = pacificToday();
  const weekStart = validDate(qp) ? mondayOf(qp!) : operatingWeekStart(today);
  const go = (d: string, replace = false) => nav(`/admin/schedule?weekStart=${mondayOf(d)}`, { replace });
  const q = useGetAdminScheduleWeek({ weekStart }, {
    query: { queryKey: getGetAdminScheduleWeekQueryKey({ weekStart }), ...POLL, placeholderData: keepPreviousData }, request: FETCH_CREDS,
  });
  const week = q.data;
  const stale = !!week && week.weekStart !== weekStart;
  const [adding, setAdding] = useState(false);
  const [sel, setSel] = useState<{ slotId: string; date: string } | null>(null);
  const returnFocus = useRef<HTMLButtonElement | null>(null);
  const openBlock = (b: CoordinatorBlock, trigger: HTMLButtonElement) => {
    returnFocus.current = trigger; setSel({ slotId: b.slotId, date: b.date });
  };
  const [pickState, setPick] = useState('');
  const dates = (week?.days ?? []).map(d => d.date);
  const pick = dates.includes(pickState) ? pickState : dates.includes(week?.today ?? '') ? week!.today : dates[0] ?? '';
  const block = sel && week && !stale ? week.blocks.find(b => b.slotId === sel.slotId && b.date === sel.date) ?? null : null;
  const gone = !!sel && !!week && !stale && !block;
  const thisWeek = weekStart === operatingWeekStart(week?.today ?? today);
  const summary = week && !stale ? `${week.openSpots} open spots, ${week.underCoveredShifts} under-covered` : '';
  return (
    <AppLayout role="admin">
      <div data-testid="view-admin-schedule">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div><p className="alliance-label">Coordinator</p><h1 className="alliance-display mt-2">Master schedule</h1></div>
          <div className="flex flex-wrap items-center gap-3">
          <Button variant="secondary" onClick={() => setAdding(true)} data-testid="button-add-one-time"><Plus size={16} aria-hidden="true" className="mr-1" />Add a one-time shift</Button>
          <Link href="/admin/schedule/settings" data-testid="link-schedule-settings" className="inline-flex min-h-11 items-center gap-2 text-sm font-bold text-blue underline underline-offset-4"><Settings size={16} aria-hidden="true" />Schedule settings</Link>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2" data-testid="nav-week">
          <Button variant="secondary" onClick={() => go(addDays(weekStart, -7))} aria-label="Previous week" data-testid="button-prev-week"><ChevronLeft size={18} aria-hidden="true" /></Button>
          <Button variant="secondary" onClick={() => go(operatingWeekStart(week?.today ?? today))} disabled={thisWeek} data-testid="button-today">Today</Button>
          <Button variant="secondary" onClick={() => go(addDays(weekStart, 7))} aria-label="Next week" data-testid="button-next-week"><ChevronRight size={18} aria-hidden="true" /></Button>
          <p className="ml-1 font-bold" data-testid="text-week-label" aria-live="polite">{dayLabel(weekStart, { month: 'short', day: 'numeric' })} to {dayLabel(week?.days[week.days.length - 1]?.date ?? addDays(weekStart, 4), { month: 'short', day: 'numeric', year: 'numeric' })}</p>
          {week && <p className="ml-auto text-sm text-navy-soft" data-testid="text-updated">Updated {updatedLabel(week.updatedAt)}</p>}
        </div>
        {summary && <p className="mt-2 text-sm" data-testid="text-week-summary">{summary}</p>}
        {q.isError && week && !stale && (
          <div role="alert" className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[var(--alliance-red)] p-3 text-[var(--alliance-red-ink)]" data-testid="banner-refresh-error">
            <span className="font-bold">Could not refresh. Showing data from {updatedLabel(week.updatedAt)}; this is not live.</span>
            <Button variant="secondary" onClick={() => { void q.refetch(); }} data-testid="button-retry-refresh"><RefreshCw size={16} aria-hidden="true" className="mr-2" />Retry</Button>
          </div>
        )}
        <div className="mt-4">
          {q.isPending || stale ? (
            <div role="status" aria-busy="true" data-testid="loading-week"><span className="sr-only">Loading week</span><Skeleton className="h-96 w-full" /></div>
          ) : !week ? (
            <div><Notice>Something went wrong on our end. Please try again. If it keeps happening, let <ContactLink /> know.</Notice><Button onClick={() => { void q.refetch(); }} data-testid="button-retry-week">Try again</Button></div>
          ) : (<>
            {week.blocks.length === 0 && <p className="alliance-card mb-3" data-testid="text-empty-week">No shifts are scheduled for this week.</p>}
            <Desktop week={week} onOpen={openBlock} />
            <Mobile week={week} pick={pick} setPick={setPick} onOpen={openBlock} />
          </>)}
        </div>
      </div>
      {adding && <CustomShiftDialog onClose={() => setAdding(false)} onDone={() => undefined} />}
      <Drawer block={block} gone={gone} onClose={() => setSel(null)} returnFocus={returnFocus} />
    </AppLayout>
  );
}
export const AdminSchedule = () => <RequireAdmin>{() => <Body />}</RequireAdmin>;
