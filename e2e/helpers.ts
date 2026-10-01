import { expect, type Page } from '@playwright/test';

/** A tiny JPEG for exercise photos, so tests never download the real ones. */
const PIXEL = Buffer.from(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/yQALCAABAAEBAREA/8wABgAQEAX/2gAIAQEAAD8A0s8g/9k=',
  'base64',
);

export async function stubNetwork(page: Page) {
  await page.route('https://raw.githubusercontent.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'image/jpeg', body: PIXEL, headers: { 'access-control-allow-origin': '*' } }),
  );
  // Sync relays and the connector are never reached from these tests.
  await page.route(/^wss?:\/\/(?!localhost|127\.0\.0\.1)/, (route) => route.abort());
}

/** Fail the test on any uncaught error or console error. */
export function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  return errors;
}

export async function noSidewaysScroll(page: Page, label: string) {
  const { scroll, client } = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(scroll, `${label}: page is ${scroll}px wide in a ${client}px window`).toBeLessThanOrEqual(client);
  // The page clips sideways overflow, so also look for anything that would be cut off at the edges
  // (except inside the rows that scroll sideways on purpose).
  const out = await page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const bad: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>('body *')) {
      if (el.closest('.chip-row, .table-wrap, dialog:not([open]), .sr-only, svg') || el.offsetParent === null) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.right > width + 1 || r.left < -1) bad.push(`${el.tagName.toLowerCase()}.${el.className} (${Math.round(r.left)}–${Math.round(r.right)})`);
    }
    return bad.slice(0, 5);
  });
  expect(out, `${label}: sticks out of the window`).toEqual([]);
}

/** Start from an empty app. */
export async function fresh(page: Page) {
  await stubNetwork(page);
  await page.goto('./');
  await page.evaluate(() => localStorage.clear());
  await page.goto('./');
}
