import { describe, expect, it } from 'vitest';
import { reminderEmail, selectReminders, shiftTime, type ReminderSnapshot } from './reminders';
import { slotInstant } from './scheduleService';
const config = { reminderHoursBefore: 24, sameMorningReminder: false, sameMorningReminderHour: 7 };
const slot = { id: 'slot', dayOfWeek: 2, startTime: '09:00', endTime: '11:00', capacity: 2, label: null, isActive: true };
const person = { profileId: 'profile', userId: 'user', firstName: 'Jordan', email: 'jordan@example.invalid', status: 'active', isActive: true, verified: true };
const assignment = { id: 'assignment', shiftSlotId: slot.id, volunteerProfileId: person.profileId, startDate: '2026-01-01', endDate: null };
function data(): ReminderSnapshot {
  return { schedule: { slots: [{ ...slot }], assignments: [{ ...assignment }], skips: [], closedDates: [] },
    people: [{ ...person }], links: [{ label: 'Find Help', url: 'https://example.org/help' }, { label: 'Phone Portal', url: 'https://example.org/phone' }] };
}
describe('Pacific shift reminder selection and copy', () => {
  it('includes assigned admins and links them to the admin schedule', () => {
    const snapshot = data();
    snapshot.people = [{ ...person, role: 'admin' }];
    const candidates = selectReminders(snapshot, slotInstant('2026-10-12', '09:00'), config, true);
    expect(candidates).toHaveLength(1);
    const copy = reminderEmail(candidates[0]!, snapshot.links, slotInstant('2026-10-12', '09:00'), 'https://portal.example.org');
    expect(copy.html).toContain('https://portal.example.org/admin/schedule');
    expect(copy.text).toContain('https://portal.example.org/admin/schedule');
    snapshot.people[0]!.isActive = false;
    expect(selectReminders(snapshot, slotInstant('2026-10-12', '09:00'), config, true)).toHaveLength(0);
  });
  it('catches reminders 15/30 minutes and hours late, but never before due or after shift start', () => {
    const due = slotInstant('2026-10-12', '09:00');
    expect(selectReminders(data(), new Date(due.getTime() - 1), config, true)).toHaveLength(0);
    for (const minutes of [0, 15, 30, 120, 1439]) {
      expect(selectReminders(data(), new Date(due.getTime() + minutes * 60000), config, true)
        .map(c => c.relatedId)).toEqual(['assignment:2026-10-13:24h']);
    }
    expect(selectReminders(data(), slotInstant('2026-10-13', '09:00'), config, true)).toHaveLength(0);
    expect(selectReminders(data(), slotInstant('2026-10-13', '09:15'), config, true)).toHaveLength(0);
  });
  it('catches a delayed same-morning reminder after the configured hour, without sending past shifts', () => {
    const cfg = { ...config, sameMorningReminder: true };
    expect(selectReminders(data(), slotInstant('2026-10-13', '06:59'), cfg, true).some(c => c.variant === 'am')).toBe(false);
    expect(selectReminders(data(), slotInstant('2026-10-13', '08:15'), cfg, true)
      .filter(c => c.variant === 'am').map(c => c.relatedId)).toEqual(['assignment:2026-10-13:am']);
    expect(selectReminders(data(), slotInstant('2026-10-13', '09:00'), cfg, true)).toHaveLength(0);
  });
  it('keeps elapsed-hour catch-up and future-only checks correct on both DST transitions', () => {
    for (const date of ['2026-03-08', '2026-11-01']) {
      const d = data(); d.schedule.slots = [{ ...slot, dayOfWeek: 0 }];
      const due = new Date(slotInstant(date, '09:00').getTime() - 24 * 3600000);
      expect(selectReminders(d, new Date(due.getTime() + 15 * 60000), config, true).map(c => c.occurrence.date)).toEqual([date]);
      expect(selectReminders(d, slotInstant(date, '09:00'), config, true)).toHaveLength(0);
      d.schedule.closedDates = [{ date }];
      expect(selectReminders(d, new Date(due.getTime() + 15 * 60000), config, true)).toHaveLength(0);
    }
  });
  it('uses the half-open 15 minute window, with the requested assignment/date key', () => {
    const at = slotInstant('2026-10-12', '09:00');
    const candidates = selectReminders(data(), at, config);
    expect(candidates.map(c => c.relatedId)).toEqual(['assignment:2026-10-13:24h']);
    expect(selectReminders(data(), slotInstant('2026-10-12', '08:45'), config)).toHaveLength(0);
    expect(selectReminders(data(), new Date(at.getTime() + 1), config)).toHaveLength(0);
  });
  it('excludes week-offs, closed dates, inactive slots, retired slots and ended or future assignments', () => {
    const at = slotInstant('2026-10-12', '09:00');
    const d = data(); d.schedule.skips = [{ shiftAssignmentId: assignment.id, skipDate: '2026-10-13' }];
    expect(selectReminders(d, at, config)).toHaveLength(0);
    d.schedule.skips = []; d.schedule.closedDates = [{ date: '2026-10-13' }];
    expect(selectReminders(d, at, config)).toHaveLength(0);
    for (const change of [{ isActive: false }, { retireAfterDate: '2026-10-12' }])
      expect(selectReminders({ ...data(), schedule: { ...data().schedule, slots: [{ ...slot, ...change }] } }, at, config)).toHaveLength(0);
    for (const change of [{ endDate: '2026-10-12' }, { endedReason: 'admin_removed', endDate: '2026-10-13' }, { startDate: '2026-10-14' }])
      expect(selectReminders({ ...data(), schedule: { ...data().schedule, assignments: [{ ...assignment, ...change }] } }, at, config)).toHaveLength(0);
  });
  it('excludes inactive profiles/accounts and unverified users', () => {
    const at = slotInstant('2026-10-12', '09:00');
    for (const change of [{ status: 'inactive' }, { status: 'onboarding' }, { isActive: false }, { verified: false }])
      expect(selectReminders({ ...data(), people: [{ ...person, ...change }] }, at, config)).toHaveLength(0);
  });
  it('keeps overlapping occurrences and different assignment keys separate', () => {
    const d = data();
    d.schedule.slots = [slot, { ...slot, id: 'overlap', startTime: '09:10' }];
    d.schedule.assignments = [assignment, { ...assignment, id: 'other', shiftSlotId: 'overlap' }];
    expect(selectReminders(d, slotInstant('2026-10-12', '09:00'), config).map(c => c.relatedId))
      .toEqual(['assignment:2026-10-13:24h', 'other:2026-10-13:24h']);
  });
  it('uses elapsed reminder hours across spring-forward and fall-back, not a guessed UTC offset', () => {
    for (const date of ['2026-03-08', '2026-11-01']) {
      const d = data(); d.schedule.slots = [{ ...slot, dayOfWeek: 0 }];
      const at = new Date(slotInstant(date, '09:00').getTime() - 24 * 3600_000);
      expect(selectReminders(d, at, config).map(c => c.occurrence.date)).toEqual([date]);
      const yesterday = date === '2026-03-08' ? '2026-03-07' : '2026-10-31';
      expect(selectReminders(d, slotInstant(yesterday, '09:00'), config)).toHaveLength(0);
    }
  });
  it('uses a separate morning key only in the configured Pacific hour for not-yet-started shifts', () => {
    const cfg = { ...config, sameMorningReminder: true };
    for (const date of ['2026-03-09', '2026-11-02']) {
      const d = data(); d.schedule.slots = [{ ...slot, dayOfWeek: 1 }];
      expect(selectReminders(d, slotInstant(date, '06:59'), cfg)).toHaveLength(0);
      expect(selectReminders(d, slotInstant(date, '07:00'), cfg).map(c => c.relatedId)).toEqual([`assignment:${date}:am`]);
      expect(selectReminders(d, slotInstant(date, '07:45'), cfg)).toHaveLength(1);
      expect(selectReminders(d, slotInstant(date, '08:00'), cfg)).toHaveLength(0);
    }
    const d = data(); d.schedule.slots = [{ ...slot, startTime: '07:00', endTime: '09:00' }];
    expect(selectReminders(d, slotInstant('2026-10-13', '07:00'), cfg)).toHaveLength(0);
    d.schedule.slots = [slot]; d.schedule.closedDates = [{ date: '2026-10-13' }];
    expect(selectReminders(d, slotInstant('2026-10-13', '07:00'), cfg)).toHaveLength(0);
  });
  it('builds warm HTML and text with both quick link buttons, shift management and honest test copy', () => {
    const at = slotInstant('2026-10-12', '09:00'), d = data();
    const c = selectReminders(d, at, config)[0]!;
    const copy = reminderEmail(c, d.links, at, 'https://portal.example.org');
    expect(copy.subject).toBe('Reminder: your shift tomorrow, 9:00–11:00 AM');
    for (const url of ['https://example.org/help', 'https://example.org/phone', 'https://portal.example.org/shifts']) {
      expect(copy.html).toContain(`href="${url}"`); expect(copy.text).toContain(url);
    }
    expect(copy.text).toContain('Hi Jordan,');
    expect(copy.text).toContain('Need the week off? Update it in the portal or let us know as soon as you can.');
    expect(copy.html).not.toContain('javascript:');
    expect(reminderEmail(c, [{ label: 'Bad', url: 'javascript:alert(1)' }], at, 'https://portal.example.org').text).not.toContain('javascript:');
    expect(reminderEmail(c, d.links, at, 'https://portal.example.org', true).text).toContain('not a shift assignment');
    expect(shiftTime('11:00', '13:00')).toBe('11:00 AM–1:00 PM');
    expect(reminderEmail(c, d.links, slotInstant('2026-10-13', '08:00'), 'https://portal.example.org').subject).toContain('today');
  });
});
