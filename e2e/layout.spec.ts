import { expect, test } from '@playwright/test';
import { fresh, noSidewaysScroll, watchErrors } from './helpers';

const WIDTHS = [1440, 1024, 768, 430, 390, 375, 320, 280];

test('every screen fits from 1440 px down to 280 px, without sideways scrolling', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = watchErrors(page);
  await fresh(page);
  // Some data, so the screens have content: a starter plan and a workout in progress.
  await page.getByRole('button', { name: 'Use a starter plan' }).click();
  await page.getByRole('button', { name: /Push · Pull · Legs/ }).click();
  await page.getByRole('button', { name: 'Start Push' }).click();
  await expect(page.getByRole('heading', { name: 'Barbell Bench Press' })).toBeVisible();
  const routineId = await page.evaluate(() => JSON.parse(localStorage.getItem('gym-tracker:v1')!).routines[0].id);
  const screens = ['#/', '#/workout', '#/exercises', '#/exercise/Barbell_Bench_Press_-_Medium_Grip', '#/history', '#/history?view=calendar', '#/settings', `#/routine/${routineId}`, '#/exercise/new'];
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 800 });
    for (const hash of screens) {
      await page.goto(`./${hash}`);
      await page.waitForTimeout(150);
      await noSidewaysScroll(page, `${hash} at ${width}px`);
    }
  }
  expect(errors).toEqual([]);
});

test('weights and reps are never cut off, down to 280 px', async ({ page }) => {
  await fresh(page);
  await page.getByRole('button', { name: 'Start an empty workout' }).click();
  await page.getByRole('link', { name: 'Add exercises' }).click();
  await page.locator('.exercise-row', { hasText: 'Barbell Bench Press' }).first().click();
  await page.getByRole('button', { name: /Add 1/ }).click();
  const weight = page.getByRole('textbox', { name: 'Set 1 weight in kg' });
  await weight.fill('183.75');
  await page.getByRole('textbox', { name: 'Set 1 reps' }).fill('12');
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 800 });
    const clipped = await page.$$eval('.num-input', (els) =>
      els.filter((e) => (e as HTMLInputElement).value && e.scrollWidth > e.clientWidth).map((e) => (e as HTMLInputElement).value),
    );
    expect(clipped, `cut off at ${width}px`).toEqual([]);
  }
});

test('works with the keyboard: visible focus and labelled controls @desktop', async ({ page }) => {
  await fresh(page);
  await page.keyboard.press('Tab');
  const focused = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement;
    return { tag: el.tagName, outline: getComputedStyle(el).outlineStyle };
  });
  expect(focused.outline).not.toBe('none');
  // Every button has a name.
  const unnamed = await page.evaluate(() =>
    [...document.querySelectorAll('button, a[href], input, select, textarea')].filter((el) => {
      const e = el as HTMLElement;
      const name = e.getAttribute('aria-label') || e.textContent?.trim() || (e.id && document.querySelector(`label[for="${e.id}"]`)?.textContent);
      return !name && e.offsetParent !== null;
    }).length,
  );
  expect(unnamed).toBe(0);
});
