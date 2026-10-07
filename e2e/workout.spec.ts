import { expect, test, type Page } from '@playwright/test';
import { fresh, watchErrors } from './helpers';

const card = (page: Page, name: string) => page.locator('.exercise-card').filter({ has: page.getByRole('heading', { name }) });
const setRow = (page: Page, exercise: string, n: number) => card(page, exercise).locator('.set-row:not(.set-header)').nth(n - 1);
const field = (page: Page, exercise: string, n: number, what: RegExp) => setRow(page, exercise, n).getByLabel(what);

/**
 * Moves the page's clock on, as if the phone sat idle in between. This sets
 * the wall clock rather than using clock.fastForward: when the machine is
 * busy, Playwright's own running clock can finish a timer pass after a
 * fastForward and wind the time back to before it.
 */
async function later(page: Page, time: string) {
  const [m, s] = time.split(':').map(Number);
  const now = await page.evaluate(() => Date.now());
  await page.clock.setSystemTime(now + (m * 60 + s) * 1000);
}

async function makeRoutine(page: Page) {
  await page.getByRole('button', { name: 'Create a routine' }).click();
  await page.getByLabel('Name').fill('Push day');
  await page.getByRole('button', { name: 'Add exercises' }).click();
  const search = page.getByLabel('Search exercises');
  await search.fill('bench');
  await page.locator('.exercise-row', { hasText: 'Barbell Bench Press' }).first().click();
  await search.fill('lateral raise');
  await page.locator('.exercise-row', { hasText: 'Dumbbell Lateral Raise' }).first().click();
  await page.getByRole('button', { name: 'Add 2 exercises' }).click();
  await expect(page.getByRole('heading', { name: 'Barbell Bench Press' })).toBeVisible();
  // Targets for the first bench set.
  await page.getByLabel('Set 1 target weight in kg').first().fill('60');
  await page.getByLabel('Set 1 target reps').first().fill('5');
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByRole('heading', { name: 'Push day' })).toBeVisible();
}

test('a whole workout: routine, sets, rest timer, reload, finish, history and records @small', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = watchErrors(page);
  await page.clock.install({ time: new Date('2026-10-01T17:00:00') });
  await fresh(page);
  await makeRoutine(page);

  await page.getByRole('button', { name: 'Start Push day' }).click();
  await expect(page.locator('.workout-name')).toHaveText('Push day');
  // The routine's targets are filled in; numbers use the number keypad.
  await expect(field(page, 'Barbell Bench Press', 1, /weight/)).toHaveValue('60');
  await expect(field(page, 'Barbell Bench Press', 1, /reps/)).toHaveValue('5');
  await expect(field(page, 'Barbell Bench Press', 1, /weight/)).toHaveAttribute('inputmode', 'decimal');
  await expect(field(page, 'Barbell Bench Press', 1, /reps/)).toHaveAttribute('inputmode', 'numeric');

  // One tap completes a set and starts the rest timer.
  await setRow(page, 'Barbell Bench Press', 1).getByRole('button', { name: /Complete set 1/ }).click();
  await expect(setRow(page, 'Barbell Bench Press', 1)).toHaveClass(/done/);
  const timer = page.getByRole('timer');
  await expect(timer).toContainText('2:00');
  await later(page, '00:30');
  await expect(timer).toContainText('1:30');
  await timer.getByRole('button', { name: '15 seconds more' }).click();
  await expect(timer).toContainText('1:45');
  await timer.getByRole('button', { name: '15 seconds less' }).click();
  await expect(timer).toContainText('1:30');

  // Typing a weight carries down to the sets below that aren't done.
  await field(page, 'Barbell Bench Press', 2, /weight/).fill('62.5');
  await field(page, 'Barbell Bench Press', 2, /reps/).fill('5');
  await expect(field(page, 'Barbell Bench Press', 3, /weight/)).toHaveValue('62.5');
  await setRow(page, 'Barbell Bench Press', 2).getByRole('button', { name: /Complete set 2/ }).click();

  // A reload (or a crash, or closing the app) loses nothing, and the timer is still right.
  await later(page, '00:20');
  await page.reload();
  await expect(page.locator('.workout-name')).toHaveText('Push day');
  await expect(setRow(page, 'Barbell Bench Press', 2)).toHaveClass(/done/);
  await expect(field(page, 'Barbell Bench Press', 2, /weight/)).toHaveValue('62.5');
  // 2:00 − 0:20, less the second the reload itself may take on a busy machine.
  await expect(page.getByRole('timer')).toContainText(/1:(40|39)/);
  await page.getByRole('timer').getByRole('button', { name: 'Skip' }).click();
  await expect(page.getByRole('timer')).toHaveCount(0);

  // Leave the screen: the bar above the tabs leads back.
  await page.getByRole('button', { name: /Hide the workout/ }).click();
  await page.getByRole('link', { name: /Back to the workout/ }).click();
  await expect(page.locator('.workout-name')).toHaveText('Push day');

  // Lateral raises: 10 kg × 12 once.
  await field(page, 'Dumbbell Lateral Raise', 1, /weight/).fill('10');
  await field(page, 'Dumbbell Lateral Raise', 1, /reps/).fill('12');
  await setRow(page, 'Dumbbell Lateral Raise', 1).getByRole('button', { name: /Complete set 1/ }).click();

  await later(page, '40:00');
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Finish the workout?' });
  await expect(sheet).toContainText('3 sets not checked off are left out');
  await sheet.getByRole('button', { name: 'Finish workout' }).click();

  await expect(page.getByRole('heading', { name: 'Workout done' })).toBeVisible();
  const stats = page.locator('.stat-grid');
  await expect(stats).toContainText('3');
  // 60 × 5 + 62.5 × 5 + 10 × 12 = 732.5, shown rounded.
  await expect(stats).toContainText("733 kg");
  await page.getByRole('button', { name: 'Done' }).click();

  // History lists it; opening it shows the sets.
  await page.getByRole('link', { name: 'History', exact: true }).click();
  await page.getByRole('link', { name: /Push day/ }).click();
  await expect(page.getByRole('heading', { name: 'Push day', level: 1 })).toBeVisible();
  await expect(page.locator('.set-list').first()).toContainText('62.5 × 5');

  // Second time: last time's numbers are shown and filled in, and beating them is a record.
  await page.goto('./#/');
  await page.getByRole('button', { name: 'Start Push day' }).click();
  await expect(setRow(page, 'Barbell Bench Press', 1).locator('.set-prev')).toContainText('60 × 5');
  await expect(field(page, 'Barbell Bench Press', 2, /weight/)).toHaveValue('62.5');
  await field(page, 'Barbell Bench Press', 1, /weight/).fill('65');
  await setRow(page, 'Barbell Bench Press', 1).getByRole('button', { name: /Complete set 1/ }).click();
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Finish workout' }).click();
  const records = page.locator('.records-list');
  await expect(records).toContainText('Heaviest weight: 65 kg (was 62.5 kg)');
  await expect(records).toContainText('Best estimated 1-rep max');

  // The exercise page has the records, the chart and recent sets.
  await page.goto('./#/exercise/Barbell_Bench_Press_-_Medium_Grip');
  await expect(page.locator('.record-tiles')).toContainText('65 kg');
  await expect(page.getByRole('group', { name: /Progress: best estimated 1-rep max/ })).toBeVisible();
  await page.getByRole('button', { name: 'Show the numbers' }).click();
  await expect(page.locator('.data-table').last()).toContainText('75.8');
  expect(errors).toEqual([]);
});

test('one exercise per page: arrows, the overview, moving on when an exercise is done, and a reload', async ({ page }) => {
  const errors = watchErrors(page);
  await fresh(page);
  await makeRoutine(page);
  await page.getByRole('button', { name: 'Start Push day' }).click();
  const here = () => page.locator('.pager-page[data-here] .exercise-name');
  await expect(here()).toHaveText(/Barbell Bench Press$/);
  await expect(page.getByRole('button', { name: /^Exercise 1 of 2/ })).toBeVisible();

  // Arrows move between pages.
  await page.getByRole('button', { name: 'Next exercise' }).click();
  await expect(here()).toHaveText(/Dumbbell Lateral Raise$/);
  await page.getByRole('button', { name: 'Previous exercise' }).click();
  await expect(here()).toHaveText(/Barbell Bench Press$/);

  // The overview jumps to an exercise.
  await page.getByRole('button', { name: /All exercises/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: /Dumbbell Lateral Raise/ }).click();
  await expect(here()).toHaveText(/Dumbbell Lateral Raise$/);

  // Checking off the last set moves on — here, to the page that finishes the workout.
  const raise = page.locator('.exercise-card', { has: page.getByRole('heading', { name: 'Dumbbell Lateral Raise' }) });
  await raise.getByLabel('Set 1 weight in kg').fill('10');
  const sets = await raise.locator('.set-row:not(.set-header)').count();
  for (let i = 1; i <= sets; i++) {
    await raise.getByLabel(`Set ${i} reps`).fill('12');
    await raise.getByRole('button', { name: `Complete set ${i}` }).click();
  }
  await expect(page.locator('.pager-page[data-here] .workout-end')).toBeVisible();
  await expect(page.getByRole('button', { name: /Finish/ }).first()).toBeVisible();

  // A reload comes back to the same page.
  await page.reload();
  await expect(page.locator('.pager-page[data-here] .workout-end')).toBeVisible();
  expect(errors).toEqual([]);
});

test('typing right after a sheet closes is not lost, even when frames are slow', async ({ page }) => {
  // A busy phone (or CI machine) can take a while to paint the next frame.
  await page.addInitScript(() => {
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) => (setTimeout(() => raf(cb), 80), 0);
  });
  await fresh(page);
  await page.getByRole('button', { name: 'Start an empty workout' }).click();
  await page.getByRole('link', { name: 'Add exercises' }).click();
  await page.getByLabel('Search exercises').fill('plank');
  await page.locator('.exercise-row', { hasText: /^Plank/ }).first().click();
  await page.getByLabel('Search exercises').fill('squat');
  await page.locator('.exercise-row', { hasText: 'Barbell Squat' }).first().click();
  await page.getByRole('button', { name: 'Add 2 exercises' }).click();
  await card(page, 'Barbell Squat').getByRole('button', { name: /More for/ }).click();
  await page.getByRole('button', { name: 'Reorder exercises' }).click();
  await page.getByRole('button', { name: 'Move Barbell Squat up' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Done' }).click();
  const time = card(page, 'Plank').getByLabel('Set 1 time');
  await time.fill('45');
  await time.blur();
  await expect(time).toHaveValue('0:45');
});

test('an empty workout: add, swap, reorder and remove exercises; notes; discard', async ({ page }) => {
  const errors = watchErrors(page);
  await fresh(page);
  await page.getByRole('button', { name: 'Start an empty workout' }).click();
  await page.getByRole('link', { name: 'Add exercises' }).click();
  await page.getByLabel('Search exercises').fill('squat');
  await page.locator('.exercise-row', { hasText: 'Barbell Squat' }).first().click();
  await page.getByLabel('Search exercises').fill('plank');
  await page.locator('.exercise-row', { hasText: /^Plank/ }).first().click();
  await page.getByRole('button', { name: 'Add 2 exercises' }).click();
  await expect(card(page, 'Plank').getByLabel('Set 1 time')).toBeVisible();

  // Swap the squat for a front squat.
  await card(page, 'Barbell Squat').getByRole('button', { name: /More for/ }).click();
  await page.getByRole('button', { name: 'Swap for another exercise' }).click();
  await page.getByLabel('Search exercises').fill('front squat');
  await page.locator('.exercise-row', { hasText: 'Front Squat' }).first().click();
  await expect(page.getByRole('heading', { name: 'Front Squat' })).toBeVisible();

  // Reorder: plank first.
  await card(page, 'Plank').getByRole('button', { name: /More for/ }).click();
  await page.getByRole('button', { name: 'Reorder exercises' }).click();
  await page.getByRole('button', { name: 'Move Plank up' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Done' }).click();
  await expect(page.locator('.exercise-card .exercise-name').first()).toHaveText(/Plank/);

  // A time typed as digits: "45" is 0:45.
  await card(page, 'Plank').getByLabel('Set 1 time').fill('45');
  await card(page, 'Plank').getByLabel('Set 1 time').blur();
  await expect(card(page, 'Plank').getByLabel('Set 1 time')).toHaveValue('0:45');

  // Notes per exercise and for the workout.
  await card(page, 'Front Squat').getByRole('button', { name: 'Add a note for Front Squat' }).click();
  await page.getByLabel('Notes for Front Squat').fill('Heels on plates');
  await page.getByLabel('Workout notes').fill('Felt strong');
  await page.reload();
  await expect(page.getByLabel('Notes for Front Squat')).toHaveValue('Heels on plates');
  await expect(page.getByLabel('Workout notes')).toHaveValue('Felt strong');

  // Remove an exercise, with undo.
  await card(page, 'Front Squat').getByRole('button', { name: /More for/ }).click();
  await page.getByRole('button', { name: 'Remove exercise' }).click();
  await expect(card(page, 'Front Squat')).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(card(page, 'Front Squat')).toHaveCount(1);

  page.on('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Workout options' }).click();
  await page.getByRole('button', { name: 'Discard workout' }).click();
  await expect(page.getByRole('heading', { name: 'Train' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start an empty workout' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('pounds: shown and typed in lb, stored in kg', async ({ page }) => {
  await fresh(page);
  await page.goto('./#/settings');
  await page.getByRole('group', { name: 'Units' }).getByRole('button', { name: 'lb', exact: true }).click();
  await page.goto('./#/');
  await page.getByRole('button', { name: 'Start an empty workout' }).click();
  await page.getByRole('link', { name: 'Add exercises' }).click();
  await page.getByLabel('Search exercises').fill('deadlift');
  await page.locator('.exercise-row', { hasText: 'Barbell Deadlift' }).first().click();
  await page.getByRole('button', { name: 'Add 1 exercise' }).click();
  await field(page, 'Barbell Deadlift', 1, /weight in lb/).fill('225');
  const kg = await page.evaluate(() => JSON.parse(localStorage.getItem('gym-tracker:v1')!).workouts[0].exercises[0].sets[0].weight);
  expect(kg).toBeCloseTo(102.058, 3);
  await page.reload();
  await expect(field(page, 'Barbell Deadlift', 1, /weight in lb/)).toHaveValue('225');
});

test('keeps the screen on during a workout where it can, and carries on quietly where it can\'t', async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { wakeRequests: number }).wakeRequests = 0;
    Object.defineProperty(navigator, 'wakeLock', {
      configurable: true,
      value: {
        request: async () => {
          (window as unknown as { wakeRequests: number }).wakeRequests++;
          return { released: false, release: async () => undefined, addEventListener() {} };
        },
      },
    });
  });
  await fresh(page);
  await page.getByRole('button', { name: 'Start an empty workout' }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { wakeRequests: number }).wakeRequests)).toBeGreaterThan(0);

  // Without the API (or when it's refused), nothing breaks.
  const errors = watchErrors(page);
  await page.addInitScript(() => Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request: () => Promise.reject(new Error('NotAllowedError')) } }));
  await page.reload();
  await expect(page.locator('.workout-name')).toBeVisible();
  expect(errors).toEqual([]);
});
