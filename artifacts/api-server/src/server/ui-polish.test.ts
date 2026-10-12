import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { operatingWeekStart, shiftStartVerb } from '@workspace/shared/calendar-display';
import { formatPhone } from '@workspace/shared/profileFields';
import { testAccounts, testPersonaLabel, testScheduleLabel } from '@workspace/shared/testAccounts';
import { readFileSync } from 'node:fs';
import { capacityHint, capacityError, volunteerCount } from '@workspace/shared/schedule-copy';
import { resolve } from 'node:path';
import { STANDARD_SHIFT_CAPACITY, standardGrid } from '@workspace/shared/standardGrid';

describe('VIS-08 / ADM-37 presentation helpers', () => {
  it('keeps primary page headings on the shared responsive header system', () => {
    const output = execFileSync(process.execPath, [resolve('../alliance-volunteer-portal/scripts/check-headers.mjs')], { encoding: 'utf8' });
    expect(output).toContain('Header consistency check passed');
    const source = readFileSync(resolve('../alliance-volunteer-portal/src/components/page-header.tsx'), 'utf8');
    expect(source).toContain('sm:items-start');
    expect(source).toContain('flex-wrap');
    expect(source).toContain('min-w-0 flex-1');
    expect(source).toContain('sm:max-w-[55%]');
  });
  it('ADM-04 uses the standard capacity for new slots and preserves existing slot capacity', () => {
    expect(STANDARD_SHIFT_CAPACITY).toBe(2);
    expect(standardGrid.every(slot => slot.capacity === STANDARD_SHIFT_CAPACITY)).toBe(true);
    const source = readFileSync(resolve('../alliance-volunteer-portal/src/components/schedule-settings/slot-dialog.tsx'), 'utf8');
    expect(source).toContain("import { STANDARD_SHIFT_CAPACITY } from '@workspace/shared/standardGrid'");
    expect(source).toContain('slot?.capacity ?? STANDARD_SHIFT_CAPACITY');
  });
  it('ADM-25 invalidates user-specific and general controls and the master week after status changes', () => {
    const source = readFileSync(resolve('../alliance-volunteer-portal/src/components/volunteer-detail/status-panel.tsx'), 'utf8');
    for (const key of ['getGetAdminScheduleControlsQueryKey({ userId })','getGetAdminScheduleControlsQueryKey()','getGetAdminScheduleWeekQueryKey()']) {
      expect(source).toContain(`qc.invalidateQueries({ queryKey: ${key} })`);
    }
  });
  it('ACT-10 points profile email edits to the self-service section without changing onboarding copy', () => {
    const root = resolve('../alliance-volunteer-portal/src');
    const fields = readFileSync(resolve(root,'components/profile-fields.tsx'), 'utf8');
    expect(fields).toContain("emailEditableBelow = false");
    expect(fields).toContain("To change your email, use Email address below.");
    expect(fields).toContain("To change your email, contact Alliance staff.");
    expect(readFileSync(resolve(root,'pages/volunteer-profile.tsx'),'utf8')).toContain('emailEditableBelow showDob');
    expect(readFileSync(resolve(root,'pages/onboarding.tsx'),'utf8')).not.toContain('emailEditableBelow');
  });
  it('PRD-06 admin test-send buttons are not conditional on development mode', () => {
    for (const path of ['components/notifications/usage-cards.tsx','pages/admin-notification-jobs.tsx']) {
      const source = readFileSync(resolve('../alliance-volunteer-portal/src',path),'utf8');
      expect(source).not.toContain('import.meta.env.DEV');
      expect(source).toMatch(/Send test (email|reminder) to me/);
    }
  });
  it('VIS-08 uses a real JSON manifest asset, not the SPA fallback', () => {
    const root = resolve('../alliance-volunteer-portal');
    const manifest = JSON.parse(readFileSync(resolve(root, 'public/manifest.json'), 'utf8'));
    expect(manifest.name).toBe('Community Care Team Volunteer Portal');
    expect(manifest.icons).toHaveLength(2);
    const html = readFileSync(resolve(root, 'index.html'), 'utf8');
    expect(html).toContain('<link rel="manifest" href="%BASE_URL%manifest.json"');
    expect(html).not.toContain('manifest.webmanifest');
  });
  it.each([1, 2])('ADM-37 client capacity hint and server error use correct grammar for %i', count => {
    const phrase = count === 1 ? '1 volunteer is assigned' : '2 volunteers are assigned';
    expect(capacityHint(count)).toBe(`${phrase}, so capacity can't go below ${count}.`);
    expect(capacityError(count)).toBe(`${phrase}. Capacity cannot be reduced below ${count}; move or end assignments first.`);
    expect(volunteerCount(count)).toBe(count === 1 ? '1 volunteer' : '2 volunteers');
  });
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
