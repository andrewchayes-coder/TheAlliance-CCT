/// <reference lib="dom" />
import { expect, type Page } from '@playwright/test';

/** Called by both the full smoke and its isolated hours-only path, after a real
 * volunteer PUT of two hours. The caller intercepts all API traffic to its
 * disposable database; this helper never sends a message or modifies hours.
 */
export async function checkReports(page: Page, base: string, userId: string, date: string, at: string, testAccount: boolean) {
  const month = date.slice(0, 7);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${base}/admin/reports?at=${encodeURIComponent(at)}`);
  await expect(page.getByTestId('report-month')).toBeVisible();
  const current = await page.evaluate(async at => {
    const r = await fetch(`/api/admin/reports/hours?at=${encodeURIComponent(at)}`);
    if (!r.ok) throw new Error(`Report returned ${r.status}`);
    return (await r.json() as { currentMonth: string }).currentMonth;
  }, at);
  if (month < current) await page.getByTestId('button-report-prev').click();
  if (testAccount) await page.getByTestId('toggle-report-test').check();
  await expect(page.getByTestId('tile-team-hours-value')).toHaveText('2');
  const row = page.getByTestId(`row-report-${userId}`);
  await expect(row).toContainText('2');
  await expect(page.getByTestId('table-team-trend').locator('tbody tr')).toHaveCount(12);
  for (const key of ['hours', 'entries']) {
    const link = page.getByTestId(`link-report-${key}-csv`);
    const href = await link.getAttribute('href');
    expect(href).toContain(`month=${month}`);
    const download = await page.evaluate(async href => {
      const r = await fetch(href!);
      return { status: r.status, text: await r.text(), filename: r.headers.get('content-disposition') };
    }, href);
    expect(download.status).toBe(200);
    expect(download.filename).toContain(`${month}.csv`);
    expect(download.text).toContain(key === 'hours' ? '"Team total"' : '"Date","Volunteer","Shift"');
  }
  for (const width of [1280, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    const nav = page.locator('header nav[aria-label="Admin navigation"]');
    await expect(nav.locator('a')).toHaveCount(10);
    await expect(nav.getByRole('link', { name: 'Reports', exact: true })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'My Profile', exact: true })).toHaveCount(0);
    const boxes = await nav.locator('a').evaluateAll(links => links.map(l => {
      const r = l.getBoundingClientRect(); return { top: r.top, right: r.right };
    }));
    expect(new Set(boxes.map(b => b.top)).size, `${width}px navigation fits one line`).toBe(1);
    expect(Math.max(...boxes.map(b => b.right))).toBeLessThanOrEqual(width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const headerFits = await page.getByRole('banner').evaluate(el => {
      const children = Array.from(el.firstElementChild!.children)
        .map(e => e.getBoundingClientRect()).filter(r => r.width && r.height);
      return children.every((r, i) => r.left >= 0 && r.right <= innerWidth &&
        (i === 0 || children[i - 1]!.right <= r.left + 1));
    });
    expect(headerFits).toBe(true);
    if (width === 1280) await page.screenshot({ path: '/tmp/reports-1280.png' });
  }
  for (const width of [375, 768]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (width === 375) {
      expect(await page.getByTestId('table-team-trend').locator('thead').evaluate(el => el.getBoundingClientRect().height))
        .toBeLessThan(100);
      await expect(page.getByTestId(`card-report-${userId}`)).toContainText('2');
      await expect(page.getByTestId('table-hours-by-volunteer')).toBeHidden();
      await page.screenshot({ path: '/tmp/reports-375.png', fullPage: true });
    }
    await page.getByTestId('button-admin-menu').click();
    const nav = page.getByTestId('admin-menu-nav');
    await expect(nav.locator('a')).toHaveCount(11);
    await expect(nav.getByTestId('admin-menu-link-my-profile')).toBeAttached();
    await expect(nav.getByTestId('admin-menu-link-reports')).toHaveAttribute('href', '/admin/reports');
    await page.keyboard.press('Escape');
    await expect(nav).toBeHidden();
  }
  if (testAccount) {
    await page.getByTestId('toggle-report-test').uncheck();
    await expect(page.getByTestId('tile-team-hours-value')).toHaveText('0');
    await expect(page.getByTestId(`link-report-volunteer-${userId}`)).toHaveCount(0);
    await page.getByTestId('toggle-report-test').check();
    await expect(page.getByTestId('tile-team-hours-value')).toHaveText('2');
  }
  // Verify composer handoff against the report's actual not-logged set without sending.
  if (await page.getByTestId('button-message-unlogged').count()) {
    const expectedIds = await page.evaluate(async ({ month, at, testAccount }) => {
      const r = await fetch(`/api/admin/reports/hours?month=${month}&includeTest=${testAccount}&at=${encodeURIComponent(at)}`);
      const data = await r.json() as { volunteers: { userId: string; shiftsNotLogged: number }[] };
      return data.volunteers.filter(v => v.shiftsNotLogged > 0).map(v => v.userId).sort();
    }, { month, at, testAccount });
    await page.getByTestId('button-message-unlogged').click();
    await expect(page).toHaveURL(/\/admin\/messages\?userIds=/);
    expect(new URL(page.url()).searchParams.get('userIds')!.split(',').sort()).toEqual(expectedIds);
    await expect(page.getByTestId('input-subject')).toHaveValue('');
  }
  console.log('PASS F11: real confirmed 2h appears in Reports, both CSVs, 12-month trend, test toggle, exact composer audience and responsive nav at375/768/1280/1440/1920px.');
}
