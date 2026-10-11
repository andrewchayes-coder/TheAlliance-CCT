import { describe, expect, it } from 'vitest';
import type { CoordinatorBlock } from '@workspace/api-client-react';
import { layoutBlocks, timeGeometry } from './coordinator';

const blk = (start: string, end: string, kind: 'regular' | 'custom' = 'regular'): CoordinatorBlock => ({
  slotId: `${kind}-${start}`, date: '2025-01-06', dayOfWeek: 1, startTime: start, endTime: end, startsAt: '', endsAt: '', label: null,
  capacity: 2, assignedCount: 0, openSpots: 2, state: 'empty', kind, closedReason: null, volunteers: [],
});

describe('timeGeometry', () => {
  it('defines every half hour strictly between its hours', () => {
    const { hours, position } = timeGeometry([blk('09:00', '11:00')]);
    for (const h of hours.slice(0, -1)) {
      const mid = position(h + 30);
      expect(mid).toBeDefined();
      expect(mid).toBeGreaterThan(position(h));
      expect(mid).toBeLessThan(position(h + 60));
    }
  });
  it('expands for early and late extras', () => {
    const { hours } = timeGeometry([blk('07:00', '08:00', 'custom'), blk('18:00', '20:00', 'custom')]);
    expect(hours[0]).toBe(420); expect(hours[hours.length - 1]).toBe(1200);
  });
});

describe('layoutBlocks', () => {
  it('keeps a 10 AM start in lane B even when 9 AM is missing', () => {
    const l = layoutBlocks([blk('10:00', '12:00')]);
    expect(l[0]!.lane).toBe(1); expect(l[0]!.lanes).toBe(2);
  });
  it('puts 9 AM in lane A', () => {
    expect(layoutBlocks([blk('09:00', '11:00'), blk('10:00', '12:00')]).map(x => x.lane)).toEqual([0, 1]);
  });
});
