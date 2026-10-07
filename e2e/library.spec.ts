import { expect, test } from '@playwright/test';
import { fresh, watchErrors } from './helpers';

test('find exercises by search, alias and filter; favorite, hide and make your own @small', async ({ page }) => {
  const errors = watchErrors(page);
  await fresh(page);
  await page.getByRole('link', { name: 'Progress' }).click();
  await page.getByRole('link', { name: 'All exercises' }).click();
  await expect(page.getByRole('heading', { name: 'Popular' })).toBeVisible();
  const search = page.getByLabel('Search exercises');

  // Aliases: "RDL", "pull-up" and "chin-up" find the right ones first.
  for (const [q, name] of [
    ['RDL', 'Romanian Deadlift'],
    ['bench', 'Barbell Bench Press'],
    ['pull-up', 'Pull-Up'],
    ['chin up', 'Chin-Up'],
  ]) {
    await search.fill(q);
    await expect(page.locator('.exercise-row').first()).toContainText(name);
  }

  // A muscle group filter.
  await search.fill('');
  await page.getByRole('button', { name: 'Triceps', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: /exercises/ })).toBeVisible();
  await expect(page.locator('.exercise-row').first()).toContainText('Triceps');
  await page.getByRole('button', { name: 'Triceps', exact: true }).click();

  // Favorite one: it gets its own section.
  await search.fill('face pull');
  await page.locator('.exercise-row').first().click();
  await expect(page.getByRole('heading', { name: 'Face Pull', level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'How to do it' })).toBeVisible();
  await page.getByRole('button', { name: 'Add to favorites' }).click();
  await expect(page.getByRole('button', { name: /Favorite\. Remove/ })).toBeVisible();

  // Hide another one: it leaves the list, and comes back with "show hidden".
  await page.goto('./#/exercise/Barbell_Bench_Press_-_Medium_Grip');
  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('button', { name: /Hide from the library/ }).click();
  await page.goto('./#/exercises');
  await expect(page.getByRole('region', { name: 'Favorites' })).toContainText('Face Pull');
  await page.getByLabel('Search exercises').fill('bench');
  await expect(page.locator('.exercise-row').first()).not.toContainText(/^Barbell Bench Press/);
  await page.getByRole('button', { name: /Show 1 hidden exercise/ }).click();
  await expect(page.locator('.exercise-row').first()).toContainText('Barbell Bench Press');

  // Not in the list: make it.
  await page.getByLabel('Search exercises').fill('Meadows row');
  await page.getByRole('link', { name: /Create “Meadows row”/ }).click();
  await expect(page.getByLabel('Name')).toHaveValue('Meadows row');
  await page.getByRole('button', { name: 'Lats' }).first().click();
  await page.getByRole('button', { name: 'Make exercise' }).click();
  await expect(page.getByRole('heading', { name: 'Meadows row', level: 1 })).toBeVisible();
  await page.goto('./#/exercises');
  await expect(page.getByRole('region', { name: 'Your exercises' })).toContainText('Meadows row');
  expect(errors).toEqual([]);
});

test('photos load only on an exercise page, and the page works without them', async ({ page }) => {
  await fresh(page);
  const photos: string[] = [];
  page.on('request', (r) => r.url().includes('raw.githubusercontent.com') && photos.push(r.url()));
  await page.goto('./#/exercises');
  await expect(page.locator('.exercise-row').first()).toBeVisible();
  expect(photos).toEqual([]);
  // The request event can come after the image is laid out, so wait for it.
  const photo = page.waitForRequest((r) => r.url().includes('raw.githubusercontent.com'));
  await page.goto('./#/exercise/Barbell_Squat');
  await expect(page.getByRole('img', { name: /Barbell Squat: start position/ })).toBeVisible();
  expect((await photo).url()).toMatch(/free-exercise-db\/[0-9a-f]{40}\/exercises\/Barbell_Squat\/0\.jpg$/);

  await page.unroute('https://raw.githubusercontent.com/**');
  await page.route('https://raw.githubusercontent.com/**', (r) => r.abort());
  await page.goto('./#/exercise/Barbell_Deadlift');
  await expect(page.getByText(/Photos aren't available right now/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'How to do it' })).toBeVisible();
});
