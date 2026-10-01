import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fresh, watchErrors } from './helpers';

test('export a backup, delete everything, and restore it', async ({ page }) => {
  const errors = watchErrors(page);
  await fresh(page);
  await page.evaluate(() => localStorage.setItem('gym-tracker:sync', JSON.stringify({ phrase: 'abandon ability able about above absent absorb abstract absurd abuse access accident' })));
  await page.getByRole('button', { name: 'Use a starter plan' }).click();
  await page.getByRole('button', { name: /Full body/ }).click();
  await page.getByRole('button', { name: 'Start Full body A' }).click();
  await page.locator('.exercise-card').first().getByLabel('Set 1 weight in kg').fill('100');
  await page.locator('.check-btn').first().click();
  await page.getByRole('button', { name: 'Finish' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Finish workout' }).click();
  await page.getByRole('button', { name: 'Done' }).click();

  await page.goto('./#/settings');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export backup' }).click();
  const file = await (await download).path();
  const text = readFileSync(file, 'utf8');
  expect(text).toContain('"app": "gym-tracker"');
  expect(text).not.toContain('abandon ability');

  page.on('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Delete everything' }).click();
  await page.goto('./#/history');
  await expect(page.getByText('No workouts yet')).toBeVisible();

  await page.goto('./#/settings');
  await page.locator('input[type=file]').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(text) });
  await expect(page.getByText('Restored 1 workout')).toBeVisible();
  await page.goto('./#/history');
  await expect(page.getByRole('link', { name: /Full body A/ })).toBeVisible();
  await page.goto('./#/');
  await expect(page.getByRole('heading', { name: 'Full body B' })).toBeVisible();

  // Another app's file is refused, and nothing changes.
  await page.goto('./#/settings');
  await page.locator('input[type=file]').setInputFiles({ name: 'other.json', mimeType: 'application/json', buffer: Buffer.from('{"version":1,"entries":[]}') });
  await expect(page.getByRole('alert')).toContainText('not a Gym Tracker backup');
  expect(errors).toEqual([]);
});
