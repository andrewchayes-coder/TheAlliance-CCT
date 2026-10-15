import { expect, type Page } from '@playwright/test';

/** Real isolated QA personas and API; no production data or delivery. */
export async function checkClaimButtons(admin: Page, ready: Page, active: Page, base: string, date: string) {
  const customId = await admin.evaluate(async date => {
    const { csrfToken } = await (await fetch('/api/auth/session')).json();
    const response = await fetch('/api/admin/schedule/custom-shifts', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
      body: JSON.stringify({ date, startTime: '13:00', endTime: '15:00', capacity: 1,
        label: 'Isolated Fix12 claim buttons', openToVolunteers: true }),
    });
    if (!response.ok) throw new Error(`Create isolated shift: ${response.status}`);
    const data = await response.json();
    return data.customShifts.find((s: { label: string }) => s.label === 'Isolated Fix12 claim buttons').id as string;
  }, date);
  await ready.goto(`${base}/signin`);
  await ready.getByTestId('button-quick-vol-onboarding-ready').click();
  await expect(ready).toHaveURL(/\/dashboard$/);
  for (const width of [375, 1280]) {
    await ready.setViewportSize({ width, height: 900 });
    await ready.goto(`${base}/shifts`);
    await expect(ready.getByTestId(`card-custom-${customId}`)).toContainText('Isolated Fix12 claim buttons');
    await expect(ready.getByTestId('text-one-time-not-active')).toHaveText('You can claim one-time shifts once your account is active.');
    await expect(ready.locator('[data-testid^="button-claim-custom-"]')).toHaveCount(0);
    expect(await ready.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (width === 375) await ready.getByTestId('section-one-time-shifts').screenshot({ path: '/tmp/fix12-onboarding-claims.png' });
  }
  const denied = await ready.evaluate(async id => {
    const { csrfToken } = await (await fetch('/api/auth/session')).json();
    const headers = { 'content-type': 'application/json', 'x-csrf-token': csrfToken };
    const custom = await fetch(`/api/volunteer/custom-shifts/${id}/claim`, { method: 'POST', headers, body: '{}' });
    const customError = await custom.json();
    const weekly = await fetch('/api/volunteer/assignments', {
      method: 'POST', headers, body: JSON.stringify({ slotId: crypto.randomUUID() }),
    });
    return { custom: custom.status, customError: customError.error, weekly: weekly.status };
  }, customId);
  // Preserve the existing routes: weekly booking uses 403; one-time uses 422.
  expect(denied.weekly).toBe(403);
  expect(denied.custom).toBe(422);
  expect(denied.customError).toBe('Only active, verified volunteers can join this shift.');
  for (const width of [375, 1280]) {
    await active.setViewportSize({ width, height: 900 });
    await active.goto(`${base}/shifts`);
    await expect(active.getByTestId(`button-claim-custom-${customId}`)).toBeEnabled();
    await expect(active.getByTestId('text-one-time-not-active')).toHaveCount(0);
  }
  await active.setViewportSize({ width: 375, height: 812 });
  await active.getByTestId(`button-claim-custom-${customId}`).click();
  await expect(active.getByTestId(`card-custom-${customId}`)).toContainText('You are signed up.');
  await active.getByTestId(`button-cancel-custom-${customId}`).click();
  await expect(active.getByTestId(`button-claim-custom-${customId}`)).toBeEnabled();
  console.log('PASS F12: onboarding cards/explanation, no Claim buttons at 375/1280px, weekly API 403/one-time API 422 unchanged; Active claim and cancel work.');
}
