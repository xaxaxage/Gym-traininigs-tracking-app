import { expect, test } from '@playwright/test';
import { fresh } from './helpers';

/** Everything you tap is at least 44 × 44 px (text links inside sentences aside). */
test('touch targets are at least 44 px on every main screen @small', async ({ page }) => {
  await fresh(page);
  await page.getByRole('button', { name: 'Use a starter plan' }).click();
  await page.getByRole('button', { name: /Full body/ }).click();
  await page.getByRole('button', { name: 'Start Full body A' }).click();
  await page.locator('.check-btn').first().click();
  const screens = ['/', '/workout', '/exercises', '/exercise/Barbell_Squat', '/history', '/history?view=calendar', '/settings', '/settings/appearance', '/settings/sync', '/settings/claude', '/settings/data', '/settings/versions', '/settings/about', '/exercise/new'];
  const small: string[] = [];
  for (const s of screens) {
    await page.goto(`./#${s}`);
    await page.waitForTimeout(250);
    const found = await page.evaluate(() => {
      const out: string[] = [];
      const els = document.querySelectorAll<HTMLElement>('button, a, input, select, textarea, summary, [role="radio"], label.toggle-row, label.choice');
      for (const el of els) {
        if (el.closest('[inert], dialog:not([open]), .sr-only') || el.offsetParent === null) continue;
        if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio' || el.type === 'file')) continue;
        // A link inside a sentence is text, not a button.
        if (el.tagName === 'A' && getComputedStyle(el).display === 'inline' && el.closest('p, li, .field-hint, .notice')) continue;
        const r = el.getBoundingClientRect();
        if (r.height < 43.5 || r.width < 43.5) out.push(`${el.tagName.toLowerCase()}.${el.className || '-'} "${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 30)}" ${Math.round(r.width)}×${Math.round(r.height)}`);
      }
      return out;
    });
    small.push(...found.map((f) => `${s}: ${f}`));
  }
  expect([...new Set(small)]).toEqual([]);
});
