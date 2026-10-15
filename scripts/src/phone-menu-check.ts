/// <reference lib="dom" />
import { chromium, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';

// Only navigation and the approved synthetic admin session; no record edits or email actions.
const base = new URL(`https://${process.env.REPLIT_DEV_DOMAIN}`);
if (!base.hostname.endsWith('.replit.dev')) throw new Error('Phone menu check requires the development preview.');
const browser = await chromium.launch({
  headless: true, executablePath: execFileSync('which', ['chromium'], { encoding: 'utf8' }).trim(),
  args: ['--no-sandbox'],
});
try {
  const page = await browser.newPage({ viewport: { width: 375, height: 667 } });
  await page.goto(`${base.origin}/signin`);
  await page.getByTestId('button-quick-admin').click();
  await expect(page).toHaveURL(/\/admin$/);
  for (const [width, height] of [[320, 568], [375, 667], [390, 844], [768, 1024]]) {
    await page.setViewportSize({ width: width!, height: height! });
    const trigger = page.getByTestId('button-admin-menu');
    await trigger.click();
    const nav = page.getByTestId('admin-menu-nav');
    await expect(nav).toBeVisible();
    await expect(nav.locator('a')).toHaveCount(11);
    await expect(nav.getByTestId('admin-menu-link-reports')).toHaveAttribute('href', '/admin/reports');
    await expect(nav.getByTestId('admin-menu-link-my-profile')).toBeAttached();
    const dimensions = await nav.evaluate(el => ({
      overflow: getComputedStyle(el).overflowY,
      minTapHeight: Math.min(...Array.from(el.querySelectorAll('a'), a => a.getBoundingClientRect().height)),
      bodyLocked: document.body.hasAttribute('data-scroll-locked'),
    }));
    expect(dimensions.overflow).toBe('auto');
    expect(dimensions.minTapHeight).toBeGreaterThanOrEqual(44);
    expect(dimensions.bodyLocked).toBe(true);
    await nav.evaluate(el => { el.scrollTop = el.scrollHeight; });
    const resources = page.getByTestId('admin-menu-link-resources');
    await resources.click();
    await expect(page).toHaveURL(/\/admin\/resources$/);
    await expect(nav).toBeHidden();
    await trigger.click();
    await expect(nav).toBeVisible();
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(nav).toBeHidden();
    await expect(trigger).toBeFocused();
    console.log(`PASS admin menu ${width}×${height}: Resources, 44px targets, body lock, focus and Escape.`);
  }
  for (const width of [1280, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    const nav = page.locator('header nav[aria-label="Admin navigation"]');
    await expect(nav).toBeVisible();
    await expect(nav.locator('a')).toHaveCount(10);
    await expect(nav.getByRole('link', { name: 'Reports', exact: true })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'My Profile', exact: true })).toHaveCount(0);
    const bounds = await nav.locator('a').evaluateAll(links => links.map(el => {
      const r = el.getBoundingClientRect(); return { top: r.top, right: r.right };
    }));
    expect(new Set(bounds.map(r => r.top)).size).toBe(1);
    expect(Math.max(...bounds.map(r => r.right))).toBeLessThanOrEqual(width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    console.log(`PASS desktop admin nav ${width}px: Reports, single line, no My Profile duplicate or overflow.`);
  }
} finally { await browser.close(); }
