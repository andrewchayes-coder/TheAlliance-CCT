import { expect, type Page } from '@playwright/test';

/** Called only by the existing isolated-development smoke runner. */
export async function checkCalendar(admin: Page, volunteer: Page, base: string, anonymousApi: string) {
  async function call(page: Page, path: string, method = 'GET', body?: unknown) {
    const result = await page.evaluate(async ({ path, method, body }) => {
      const { csrfToken } = await (await fetch('/api/auth/session')).json();
      const r = await fetch(`/api${path}`, { method,
        headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      return { ok: r.ok, status: r.status, data: await r.json() };
    }, { path, method, body });
    expect(result.ok, `${method} ${path}: ${result.status}`).toBe(true);
    return result.data;
  }
  const settings = await call(admin, '/admin/schedule/slots', 'POST', {
    dayOfWeek: 1, startTime: '09:00', endTime: '11:00', capacity: 2, label: 'Isolated calendar smoke', isActive: true,
  });
  const slot = settings.slots.find((s: { label: string }) => s.label === 'Isolated calendar smoke');
  await volunteer.goto(`${base}/signin`);
  await volunteer.getByTestId('button-quick-vol-active').click();
  await expect(volunteer).toHaveURL(/\/dashboard$/);
  const scheduleBefore = await call(volunteer, '/volunteer/schedule');
  if (!scheduleBefore.assignments.some((a: { slotId: string }) => a.slotId === slot.id))
    await call(volunteer, '/volunteer/assignments', 'POST', { slotId: slot.id });
  await volunteer.goto(`${base}/dashboard`);
  await expect(volunteer.getByTestId('link-home-calendar')).toBeVisible();
  await volunteer.setViewportSize({ width: 375, height: 812 });
  await volunteer.goto(`${base}/shifts`);
  await expect(volunteer.getByTestId('card-calendar')).toBeVisible();
  for (const provider of ['google', 'outlook', 'office365', 'apple', 'copy']) {
    const box = await volunteer.getByTestId(`button-calendar-${provider}`).boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
  }
  await volunteer.getByTestId('button-calendar-copy').click();
  await expect(volunteer.locator('[data-testid="text-calendar-copied"], [data-testid="input-calendar-url"]')).toBeVisible();
  const calendar = await call(volunteer, '/volunteer/calendar');
  const fetchFeed = async (url: string) => {
    // Native Node fetch has NO browser cookie jar. Only the isolated API is reached.
    const r = await fetch(`${anonymousApi}${new URL(url).pathname}`);
    expect(r.status).toBe(200); expect(r.headers.get('content-type')).toBe('text/calendar; charset=utf-8');
    return (await r.text()).replace(/\r\n /g, '');
  };
  const schedule = await call(volunteer, '/volunteer/schedule');
  const assignment = schedule.assignments.find((a: { slotId: string }) => a.slotId === slot.id);
  const date = assignment.nextDates.find((d: { canSkip: boolean; skipped: boolean }) => d.canSkip && !d.skipped).date as string;
  const uid = `UID:cct-shift-${assignment.id}-${date.replace(/-/g, '')}@`;
  expect(await fetchFeed(calendar.feedUrl)).toContain(uid);
  // Return immediately, within the old 30-second cache window.
  const refreshedCalendar = volunteer.waitForResponse(r =>
    r.url().endsWith('/api/volunteer/calendar') && r.request().method() === 'GET');
  await volunteer.locator('a[href="/dashboard"]:visible').first().click();
  expect((await (await refreshedCalendar).json()).lastFetchedAt).toBeTruthy();
  await expect(volunteer.getByTestId('link-home-calendar')).toHaveCount(0);
  await volunteer.goto(`${base}/shifts`);
  await expect(volunteer.getByTestId('card-calendar')).toBeVisible();
  await volunteer.getByTestId(`button-skip-${assignment.id}`).click();
  await volunteer.getByTestId('select-skip-date').selectOption(date);
  await volunteer.getByTestId('button-confirm-skip').click();
  await expect(volunteer.getByTestId('screen-shift-confirmation')).toBeVisible();
  expect(await fetchFeed(calendar.feedUrl)).not.toContain(uid);
  await volunteer.getByTestId('button-back-to-shifts').click();
  await volunteer.getByTestId(`button-undo-${assignment.id}-${date}`).click();
  await expect(volunteer.getByTestId('screen-shift-confirmation')).toBeVisible();
  expect(await fetchFeed(calendar.feedUrl)).toContain(uid);
  await volunteer.getByTestId('button-back-to-shifts').click();
  await volunteer.evaluate(() => { window.location.hash = 'calendar'; });
  await expect(volunteer.locator('#calendar-h')).toBeFocused();
  expect(await volunteer.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await volunteer.getByTestId('card-calendar').screenshot({ path: '/tmp/cct-calendar-playwright.png' });
  console.log('PASS F13 Playwright: Active persona, mobile calendar card and 44px controls, Copy link/fallback, anonymous VEVENT, week off removes occurrence, Undo restores same UID, hash focus, no overflow. Isolated schema dropped by runner.');
}
