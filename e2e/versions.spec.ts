import { existsSync, readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { fresh, watchErrors } from './helpers';

/*
 * Settings → Design versions opens earlier designs (built by
 * scripts/build-versions.mjs) as previews over your real data.
 * Build them first: npm run build && npm run build:versions
 */
const manifest = 'dist/versions.json';
const saved = (): { tag: string; label: string }[] => (existsSync(manifest) ? JSON.parse(readFileSync(manifest, 'utf8')).versions : []);

const SYNC = JSON.stringify({ phrase: 'legal winner thank year wave sausage worth useful legal winner thank yellow', relays: ['ws://127.0.0.1:1'], seen: {}, lastSyncAt: 0, devices: {} });

test('a saved version opens with my data, keeps nothing it changes, and never syncs', async ({ page }) => {
  expect(saved().length, 'build the saved versions first: npm run build:versions').toBeGreaterThan(0);
  const oldest = saved().at(-1)!;
  const errors = watchErrors(page);
  await fresh(page);
  await page.getByRole('button', { name: 'Use a starter plan' }).click();
  await page.getByRole('button', { name: /Push · Pull · Legs/ }).click();
  // A sync key on this device (to a relay nothing can reach), to show a preview can't use it.
  await page.evaluate((s) => localStorage.setItem('gym-tracker:sync', s), SYNC);
  const before = await page.evaluate(() => localStorage.getItem('gym-tracker:v1'));

  await page.goto('./#/settings/versions');
  await expect(page.getByText('In use')).toBeVisible();
  await page.getByRole('link', { name: new RegExp(`Open ${oldest.label}`) }).click();

  // The old design, with my routines in it.
  await expect(page.locator('.gym-preview-bar')).toContainText(oldest.label);
  await expect(page.getByRole('heading', { name: 'Push', exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('gym-tracker:sync'))).toBeNull();
  expect(await page.evaluate(() => { try { new WebSocket('ws://127.0.0.1:1'); return 'opened'; } catch { return 'refused'; } })).toBe('refused');
  expect(await page.evaluate(async () => (await navigator.serviceWorker?.getRegistrations?.())?.length ?? 0)).toBe(0);

  // Change something there: delete a routine.
  await page.getByRole('button', { name: 'More for Push' }).click();
  await page.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByRole('heading', { name: 'Push', exact: true })).toHaveCount(0);

  // The bar folds away after a moment; its tab brings it back.
  await expect(page.getByRole('link', { name: 'Back to current' })).toBeHidden({ timeout: 10_000 });
  await page.getByRole('button', { name: /Preview of an earlier design/ }).click();
  // Back in this version, nothing changed — the routine, the data and the sync key are as they were.
  await page.getByRole('link', { name: 'Back to current' }).click();
  await expect(page.getByRole('heading', { name: 'Design versions' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('gym-tracker:v1'))).toBe(before);
  expect(await page.evaluate(() => localStorage.getItem('gym-tracker:sync'))).toBe(SYNC);
  await page.goto('./#/');
  await expect(page.getByRole('heading', { name: 'Push', exact: true })).toBeVisible();
  await expect(page.locator('.gym-preview-bar')).toHaveCount(0);

  // What was changed in the preview is gone, and the next preview starts again from my data.
  expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('gym-tracker:preview:')))).toEqual([]);
  await page.goto('./#/settings/versions');
  await page.getByRole('link', { name: new RegExp(`Open ${oldest.label}`) }).click();
  await expect(page.getByRole('heading', { name: 'Push', exact: true })).toBeVisible();
  // Within one preview, a reload keeps what was changed in it.
  await page.getByRole('button', { name: 'More for Push' }).click();
  await page.getByRole('button', { name: 'Delete' }).click();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Pull', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Push', exact: true })).toHaveCount(0);

  expect(errors.filter((e) => !/WebSocket|ERR_|net::|Service Worker/.test(e))).toEqual([]);
});

test.describe('with the service worker', () => {
  test.use({ serviceWorkers: 'allow' });
  test('opening a saved version never replaces the current one offline', async ({ page, context }) => {
    expect(saved().length).toBeGreaterThan(0);
    const oldest = saved().at(-1)!;
    await page.goto('./');
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) {
        await new Promise((r) => navigator.serviceWorker.addEventListener('controllerchange', r, { once: true }));
      }
    });
    await page.goto(`./versions/${oldest.tag}/`);
    await expect(page.locator('.gym-preview-bar')).toBeVisible();
    // Its files were not added to the current version's offline cache.
    const cached = await page.evaluate(async () => {
      const urls: string[] = [];
      for (const name of await caches.keys()) for (const r of await (await caches.open(name)).keys()) urls.push(r.url);
      return urls;
    });
    expect(cached.filter((u) => u.includes('/versions/'))).toEqual([]);

    await context.setOffline(true);
    await page.goto('./');
    await expect(page.getByRole('button', { name: 'Start an empty workout' })).toBeVisible();
    await expect(page.locator('.gym-preview-bar')).toHaveCount(0);
    await context.setOffline(false);
  });
});
