import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { serveCopyOfBuild } from './static';

test.use({ serviceWorkers: 'allow' });

const PIXEL = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/yQALCAABAAEBAREA/8wABgAQEAX/2gAIAQEAAD8A0s8g/9k=', 'base64');

async function stubPhotos(context: BrowserContext) {
  await context.route('https://raw.githubusercontent.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'image/jpeg', body: PIXEL, headers: { 'access-control-allow-origin': '*' } }),
  );
}

/** Load the app and wait until its service worker controls the page. */
async function install(page: Page) {
  await page.goto('./');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise((r) => navigator.serviceWorker.addEventListener('controllerchange', r, { once: true }));
    }
  });
}

test('works offline after the first visit: the app, the exercise list and viewed photos', async ({ page, context }) => {
  await stubPhotos(context);
  await install(page);
  await page.goto('./#/exercise/Barbell_Squat');
  await expect(page.getByRole('img', { name: /Barbell Squat: start position/ })).toBeVisible();
  // Wait for the photos to be kept.
  await expect
    .poll(() => page.evaluate(async () => (await (await caches.open('gym-tracker-photos')).keys()).length))
    .toBeGreaterThan(0);

  await context.setOffline(true);
  await page.goto('./#/');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Train' })).toBeVisible();
  await page.getByRole('link', { name: 'Progress' }).click();
  await page.getByRole('link', { name: 'All exercises' }).click();
  await page.getByLabel('Search exercises').fill('squat');
  await expect(page.locator('.exercise-row').first()).toContainText('Barbell Squat');
  await page.locator('.exercise-row').first().click();
  await expect(page.getByRole('heading', { name: 'How to do it' })).toBeVisible();
  const loaded = await page.getByRole('img', { name: /start position/ }).evaluate((img: HTMLImageElement) =>
    img.complete ? img.naturalWidth : new Promise((r) => img.addEventListener('load', () => r(img.naturalWidth))),
  );
  expect(loaded).toBeGreaterThan(0);

  // A workout offline at the gym.
  await page.goto('./#/');
  await page.getByRole('button', { name: 'Start an empty workout' }).click();
  await expect(page.getByRole('link', { name: 'Add exercises' })).toBeVisible();
});

test('only an HTML page is kept as the app, never a file download', async ({ page, context }) => {
  await install(page);
  // A navigation to something that isn't HTML (like a download) must not replace the cached app page.
  await page.goto('./manifest.webmanifest');
  await page.goto('./');
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Train' })).toBeVisible();
  const cached = await page.evaluate(async () => {
    const hit = await caches.match('./');
    return hit ? hit.headers.get('content-type') : null;
  });
  expect(cached).toContain('text/html');
});

test('offers "Reload" when a new version is ready, and Settings shows the version', async ({ page }) => {
  const site = await serveCopyOfBuild();
  try {
    await page.goto(site.url);
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) {
        await new Promise((r) => navigator.serviceWorker.addEventListener('controllerchange', r, { once: true }));
      }
    });
    await page.reload();
    await page.goto(`${site.url}#/settings`);
    await expect(page.getByText(/^Version \d{4}-\d{2}-\d{2} \d{2}:\d{2} · \S+$/)).toBeVisible();

    // A new deploy: the service worker script changes.
    const sw = join(site.dir, 'sw.js');
    writeFileSync(sw, readFileSync(sw, 'utf8').replace(/const VERSION = '[^']+'/, "const VERSION = 'next-version'"));
    // Coming back to the app looks for it.
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    const toast = page.getByRole('status').filter({ hasText: 'A new version of the app is ready' });
    await expect(toast).toBeVisible({ timeout: 15_000 });
    await expect(toast.getByRole('button', { name: 'Reload' })).toBeVisible();
    // Still there on another screen, until it's used.
    await page.goto(`${site.url}#/`);
    await expect(toast).toBeVisible();
  } finally {
    await site.close();
  }
});
