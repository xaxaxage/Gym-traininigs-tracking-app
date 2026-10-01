import { devices, expect, test, type BrowserContext, type Page } from '@playwright/test';
import { startRelay } from '../tests/fakeRelay';
import { routeRelays } from './relays';
import { stubNetwork, watchErrors } from './helpers';

/**
 * Two devices (an iPhone and a computer) syncing through a local mock relay.
 * The app keeps its default relay list; the routes send two of them to the
 * mock relay, leave one connected but silent and refuse the last one.
 */

const relay = startRelay();
test.afterAll(() => relay.close());

async function device(ctx: BrowserContext): Promise<Page> {
  await routeRelays(ctx, relay.url());
  const page = await ctx.newPage();
  await stubNetwork(page);
  await page.goto('./');
  await page.evaluate(() => localStorage.clear());
  await page.goto('./#/settings');
  await page.reload();
  return page;
}

const status = (page: Page) => page.locator('.sync-status');

test('two devices: sync key, live updates, the workout in progress, devices and a new key', async ({ browser }) => {
  test.setTimeout(180_000);
  const phoneCtx = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: 390, height: 844 } });
  const laptopCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const phone = await device(phoneCtx);
  const laptop = await device(laptopCtx);
  const errors = [...watchErrors(phone), ...watchErrors(laptop)];

  // Phone: make a sync key.
  await phone.getByRole('button', { name: 'Create sync key' }).click();
  // The words appear once the crypto code has loaded.
  await expect(phone.locator('.words li')).toHaveCount(12);
  const words = (await phone.locator('.words li').allInnerTexts()).map((w) => w.trim());
  expect(words).toHaveLength(12);
  await phone.getByLabel("I've saved my sync key").check();
  await phone.getByRole('button', { name: 'Start syncing' }).click();
  await expect(status(phone)).toContainText(/Synced/, { timeout: 30_000 });
  const before = relay.events.size;

  // Phone: a finished workout.
  await phone.goto('./#/');
  await phone.getByRole('button', { name: 'Start an empty workout' }).click();
  await phone.getByRole('link', { name: 'Add exercises' }).click();
  await phone.getByLabel('Search exercises').fill('bench');
  await phone.locator('.exercise-row').first().click();
  await phone.getByRole('button', { name: 'Add 1 exercise' }).click();
  await phone.getByLabel('Set 1 weight in kg').fill('80');
  await phone.getByLabel('Set 1 reps').fill('8');
  await phone.locator('.check-btn').first().click();
  await phone.getByRole('button', { name: 'Finish' }).click();
  await phone.getByRole('dialog').getByRole('button', { name: 'Finish workout' }).click();
  await expect(phone.getByRole('heading', { name: 'Workout done' })).toBeVisible();
  // Uploaded a moment after the change (the month's part is new on the relay).
  await expect.poll(() => relay.events.size, { timeout: 20_000 }).toBeGreaterThan(before);

  // Laptop: join with the key; the workout arrives.
  await laptop.getByRole('button', { name: 'I have a key' }).click();
  await laptop.getByLabel('Sync key from your other device').fill(words.join(' '));
  await expect.poll(async () => {
    await laptop.waitForTimeout(500);
    return laptop.getByRole('button', { name: 'Connect' }).isEnabled();
  }, { timeout: 20_000 }).toBe(true);
  await laptop.getByRole('button', { name: 'Connect' }).click();
  await expect(laptop.getByText(/1 workout added from your other devices/)).toBeVisible({ timeout: 40_000 });
  await laptop.goto('./#/history');
  await expect(laptop.getByRole('link', { name: /workout/i }).first()).toBeVisible();

  // The workout in progress syncs too: start on the phone, carry on on the laptop.
  await phone.goto('./#/');
  await phone.getByRole('button', { name: 'Start an empty workout' }).click();
  await phone.getByRole('link', { name: 'Add exercises' }).click();
  await phone.getByLabel('Search exercises').fill('squat');
  await phone.locator('.exercise-row').first().click();
  await phone.getByRole('button', { name: 'Add 1 exercise' }).click();
  await phone.getByLabel('Set 1 weight in kg').fill('100');
  await phone.getByLabel('Set 1 reps').fill('5');

  await laptop.goto('./#/');
  const back = laptop.getByRole('link', { name: /Back to the workout/ });
  await expect(back).toBeVisible({ timeout: 30_000 });
  await back.click();
  await expect(laptop.getByLabel('Set 1 weight in kg')).toHaveValue('100', { timeout: 30_000 });
  await laptop.getByRole('button', { name: /Complete set 1/ }).click();
  // ...and the phone sees the set checked off, live.
  await expect(phone.locator('.set-row.done')).toHaveCount(1, { timeout: 30_000 });

  // Devices: both listed; a new name travels.
  await laptop.goto('./#/settings');
  await expect(laptop.getByRole('heading', { name: 'Devices (2)' })).toBeVisible({ timeout: 30_000 });
  await laptop.getByRole('button', { name: 'Rename this device' }).click();
  await laptop.getByLabel('Name for this device').fill('Gym laptop');
  await laptop.getByRole('button', { name: 'Save', exact: true }).click();
  await phone.goto('./#/settings');
  await expect(phone.getByText('Gym laptop')).toBeVisible({ timeout: 30_000 });
  await expect(phone.getByText(/^This device ·/)).toBeVisible();

  // The relays only ever saw ciphertext.
  const stored = JSON.stringify([...relay.events.values()]);
  expect(stored).not.toMatch(/Bench|Squat|Gym laptop|workout/i);

  // A new sync key: the phone moves to it, the laptop stops and asks for it.
  await phone.getByRole('button', { name: 'Change sync key' }).click();
  await expect(phone.locator('.change-key .words li')).toHaveCount(12);
  const fresh = (await phone.locator('.change-key .words li').allInnerTexts()).map((w) => w.trim());
  await phone.getByLabel("I've saved the new key").check();
  await phone.getByRole('button', { name: 'Switch to the new key' }).click();
  await expect(phone.getByText(/Sync key changed/)).toBeVisible({ timeout: 60_000 });
  await expect(status(phone)).toContainText(/Synced/, { timeout: 30_000 });

  await laptop.reload();
  await expect(laptop.getByText(/The sync key was changed on another device/)).toBeVisible({ timeout: 30_000 });
  await laptop.getByRole('button', { name: 'Enter the new key' }).click();
  await laptop.getByLabel('Sync key from your other device').fill(fresh.join(' '));
  await expect(laptop.getByRole('button', { name: 'Connect' })).toBeEnabled({ timeout: 10_000 });
  await laptop.getByRole('button', { name: 'Connect' }).click();
  await expect(status(laptop)).toContainText(/Synced/, { timeout: 40_000 });
  await laptop.goto('./#/history');
  await expect(laptop.getByRole('link', { name: /workout/i }).first()).toBeVisible();

  expect(errors.filter((e) => !/WebSocket|ERR_|net::/.test(e))).toEqual([]);
  await phoneCtx.close();
  await laptopCtx.close();
});
