import { describe, expect, it } from 'vitest';
import { operatingWeekStart, shiftStartVerb } from '@workspace/shared/calendar-display';
import { formatPhone } from '@workspace/shared/profileFields';
import { testAccounts, testPersonaLabel, testScheduleLabel } from '@workspace/shared/testAccounts';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('VIS-08 / ADM-37 presentation helpers', () => {
  it.each([
    ['2026-10-09','2026-10-05'], ['2026-10-10','2026-10-12'], ['2026-10-11','2026-10-12'],
    ['2026-10-12','2026-10-12'], ['2026-03-07','2026-03-09'], ['2026-03-08','2026-03-09'],
    ['2026-10-31','2026-11-02'], ['2026-11-01','2026-11-02'], ['2027-01-02','2027-01-04'],
  ])('defaults %s to operating week %s', (date, monday) => expect(operatingWeekStart(date)).toBe(monday));
  it('uses Starts for a future date and Started for a past date', () => {
    expect(shiftStartVerb('2026-10-12','2026-10-11')).toBe('Starts');
    expect(shiftStartVerb('2026-10-10','2026-10-11')).toBe('Started');
  });
  it('shares sign-in labels and distinguishes both active test personas without changing real names', () => {
    for (const person of testAccounts) expect(testPersonaLabel(person.key, 'fallback')).toBe(person.label);
    expect(testScheduleLabel({isTestAccount:true,email:'qa-vol-active@example.org'})).toBe('Test · Active');
    expect(testScheduleLabel({isTestAccount:true,email:'qa-vol-active-noshift@example.org'})).toBe('Test · Active, no shift');
    expect(testScheduleLabel({isTestAccount:false,email:'qa-vol-active@example.org'})).toBeNull();
  });
  it('formats stored and already-formatted US phone numbers consistently', () => {
    expect(formatPhone('5555550100')).toBe('(555) 555-0100');
    expect(formatPhone('(555) 555-0100')).toBe('(555) 555-0100');
  });
  it('explicitly links every staff Profile-card label to its control', () => {
    const source = readFileSync(resolve('../alliance-volunteer-portal/src/components/volunteer-detail/profile-editor.tsx'), 'utf8');
    for (const key of ['dob','county','address','city','state','zip','ec-name','ec-relationship','ec-phone']) {
      expect(source).toContain('htmlFor={`profile-${userId}-' + key + '`}');
      expect(source).toContain('id={`profile-${userId}-' + key + '`}');
    }
  });
});
