import { chromium, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { testProfileFields } from '@workspace/shared/testAccounts';

// Frontend interaction regression: every API request is intercepted. No database,
// real session, booking, email, or production endpoint is used.
if (process.env.NODE_ENV !== 'development') throw new Error('Run only with NODE_ENV=development.');
const base = 'http://localhost:80';
const browser = await chromium.launch({
  headless: true, args: ['--no-sandbox'],
  executablePath: execFileSync('which', ['chromium'], { encoding: 'utf8' }).trim(),
});
try {
  for (const width of [320, 375, 768, 1280]) {
    const reduced = width === 320;
    const context = await browser.newContext({ viewport: { width, height: 568 }, reducedMotion: reduced ? 'reduce' : 'no-preference' });
    await context.addInitScript(() => {
      const w = window as typeof window & { shiftScrolls: ScrollIntoViewOptions[] };
      w.shiftScrolls = [];
      const original = Element.prototype.scrollIntoView;
      Element.prototype.scrollIntoView = function(options) {
        if (typeof options === 'object') w.shiftScrolls.push(options);
        original.call(this, options);
      };
    });
    const dates = ['2029-01-01', '2029-01-08', '2029-01-15', '2029-01-22'].map(date => ({
      date, startsAt: `${date}T17:00:00Z`, endsAt: `${date}T19:00:00Z`,
      skipped: false, skipId: null, canSkip: true, canUndo: false,
    }));
    const standing = (id: number) => ({
      id: `held-${id}`, slotId: `own-${id}`, dayOfWeek: id, startTime: '09:00', endTime: '11:00',
      label: null, startDate: '2028-12-01', endDate: null, nextDates: dates, weeksOff: [],
    });
    const schedule = {
      canBook: true, blockedReasons: [], contactEmail: 'staff@example.invalid', minShifts: 1, maxShifts: 2, today: '2028-12-25',
      assignments: reduced ? [standing(1)] : [standing(1), standing(2)],
      slots: [
        { id: 'own-1', dayOfWeek: 1, startTime: '09:00', endTime: '11:00', label: null,
          capacity: 1, heldCount: 1, openSpots: 0, ownAssignmentId: 'held-1', startDates: ['2029-01-01'] },
        { id: 'open-slot', dayOfWeek: 1, startTime: '13:00', endTime: '15:00', label: 'Replacement time',
          capacity: 2, heldCount: 0, openSpots: 2, ownAssignmentId: null, startDates: ['2029-01-01'] },
      ],
      customShifts: Array.from({ length: 8 }, (_, i) => ({
        id: `custom-${i}`, date: '2029-01-03', startTime: '10:00', endTime: '12:00', label: 'One-time opportunity',
        openSpots: 1, ownAssignmentId: null, openToVolunteers: true, canCancel: false,
      })),
    };
    let scheduleReads = 0, changed = false;
    const unexpected: string[] = [], errors: string[] = [];
    await context.route('**/api/**', async route => {
      const req = route.request(), path = new URL(req.url()).pathname;
      let body: unknown;
      if (path === '/api/auth/session') body = { csrfToken: 'fixture-only', authenticated: true, verified: true,
        email: 'volunteer@example.invalid', firstName: 'Test', role: 'volunteer', googleEnabled: false,
        appOrigin: base, nextPath: '/dashboard', resendAfterSeconds: 0 };
      else if (path === '/api/me') body = {
        user: { id: 'fixture-volunteer', firstName: 'Test', lastName: 'Volunteer', email: 'volunteer@example.invalid',
          phone: '5555550100', role: 'volunteer', isActive: true, isTestAccount: false, profilePhotoUrl: null },
        role: 'volunteer', verified: true, agreementRequired: false,
        profile: { ...testProfileFields, id: 'fixture-profile', status: 'active', onboardingCompletedAt: '2028-01-01T00:00:00Z' },
      };
      else if (path === '/api/volunteer/schedule') {
        scheduleReads++;
        if (scheduleReads > 1) schedule.slots[1].label = 'Updated availability';
        body = schedule;
      } else if (path === '/api/volunteer/hours') body = { windowDays: 14, monthTotal: 0, shifts: [], hasLoggedHours: false };
      else if (path === '/api/volunteer/messages/context') body = { unreadCount: 0, contactEmail: 'staff@example.invalid' };
      else if (path === '/api/auth/quick-login/status') body = { enabled: false, production: false, personas: [] };
      else if (path === '/api/volunteer/assignments/held-1/change' && req.method() === 'POST') {
        expect(req.postDataJSON()).toEqual({ slotId: 'open-slot', startDate: '2029-01-01' });
        expect(req.headers()['x-csrf-token']).toBe('fixture-only');
        changed = true;
        schedule.assignments = [{ ...standing(1), id: 'replacement-assignment', slotId: 'open-slot', startTime: '13:00', endTime: '15:00' },
          ...schedule.assignments.filter(a => a.id !== 'held-1')];
        body = { message: 'Your weekly shift has been changed.', assignmentId: 'replacement-assignment', emailWarning: null };
      } else { unexpected.push(`${req.method()} ${path}`); await route.abort(); return; }
      await route.fulfill({ json: body });
    });
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`${base}/shifts`);
    const heading = page.locator('#week-h'), change = page.getByTestId('button-change-held-1');
    await expect(change).toBeVisible();
    expect(await heading.evaluate(el => el.getBoundingClientRect().top)).toBeGreaterThan(568);
    await change.focus();
    await page.keyboard.press('Enter');
    await expect(heading).toHaveText('Pick a new shift');
    await expect(heading).toBeFocused();
    const settled = async () => {
      await expect.poll(() => heading.evaluate(el => el.getBoundingClientRect().top)).toBeGreaterThanOrEqual(0);
      await expect.poll(() => heading.evaluate(el => el.getBoundingClientRect().top)).toBeLessThan(60);
    };
    await settled();
    await expect(page.getByTestId('banner-change-mode')).toBeInViewport();
    await expect(page.getByTestId('slot-own-1')).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    const scrolls = await page.evaluate(() => (window as typeof window & { shiftScrolls: ScrollIntoViewOptions[] }).shiftScrolls);
    expect(scrolls.at(-1)?.behavior).toBe(reduced ? 'instant' : 'smooth');
    if (reduced) await page.screenshot({ path: '/tmp/change-shift-320.png' });

    // Refetch visibly changed data: preserve the user's current viewport and mode.
    const reads = scheduleReads;
    await page.evaluate(() => { window.scrollTo({ top: 0, behavior: 'instant' }); window.dispatchEvent(new Event('visibilitychange')); });
    await expect.poll(() => scheduleReads).toBeGreaterThan(reads);
    await expect(page.getByTestId('slot-open-slot')).toContainText('Updated availability');
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    await page.getByTestId('button-jump-to-shifts-held-1').click();
    await settled();
    await page.getByTestId('button-cancel-change').click();
    await expect(change).toBeFocused();
    await expect(page.getByTestId('cue-change-held-1')).toHaveCount(0);

    if (reduced) {
      await page.getByTestId('button-drop-held-1').click();
      await page.getByTestId('button-dialog-change').click();
      await expect(page.getByTestId('dialog-shift')).toHaveCount(0);
      await expect(heading).toBeFocused();
      await settled();
      await page.keyboard.press('Tab');
      await expect(page.getByTestId('button-cancel-change')).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(page.getByTestId('button-drop-held-1')).toBeFocused();
    }
    if (width === 768) {
      await change.click();
      await page.getByTestId('slot-open-slot').click();
      await page.getByTestId('button-confirm-shift').click();
      await expect(page.getByTestId('screen-shift-confirmation')).toContainText('Your weekly shift has been changed.');
      expect(changed).toBe(true);
      await page.getByTestId('button-back-to-shifts').click();
      await expect(page.getByTestId('card-shift-replacement-assignment')).toBeVisible();
      await expect(page.getByTestId('banner-change-mode')).toHaveCount(0);
    }
    expect(errors).toEqual([]);
    expect(unexpected).toEqual([]);
    console.log(`PASS ${width}px: jump, focus, cue, cancellation, no refetch jump${reduced ? ', reduced motion and drop handoff' : ''}${changed ? ', replacement confirmation' : ''}`);
    await context.close();
  }
} finally { await browser.close(); }
