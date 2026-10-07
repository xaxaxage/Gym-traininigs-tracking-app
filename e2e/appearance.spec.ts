import { expect, test, type Page } from '@playwright/test';
import { fresh } from './helpers';

const PALETTES = ['harbor', 'auto', 'matcha', 'berry', 'ocean', 'lavender', 'graphite', 'night', 'espresso', 'oled'];

/**
 * Every visible piece of text on the screen, checked against the background
 * it actually sits on (the nearest ancestor with a solid color): 4.5:1, or
 * 3:1 for large text (WCAG AA). Returns what fails.
 */
async function lowContrast(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const parse = (c: string) => {
      const m = c.match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const [r, g, b, a = '1'] = m[1].split(/[,\s/]+/).filter(Boolean);
      return { r: +r, g: +g, b: +b, a: +a };
    };
    const lum = ({ r, g, b }: { r: number; g: number; b: number }) => {
      const f = (v: number) => {
        const s = v / 255;
        return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const ratio = (a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }) => {
      const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
      return (hi + 0.05) / (lo + 0.05);
    };
    const background = (el: Element | null): { r: number; g: number; b: number } => {
      for (let e = el; e; e = e.parentElement) {
        const c = parse(getComputedStyle(e).backgroundColor);
        if (c && c.a >= 0.9) return c;
      }
      return parse(getComputedStyle(document.body).backgroundColor) ?? { r: 255, g: 255, b: 255 };
    };
    const out: string[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = n.textContent?.trim();
      const el = n.parentElement;
      if (!text || !el) continue;
      const style = getComputedStyle(el);
      const box = el.getBoundingClientRect();
      if (box.width === 0 || style.visibility === 'hidden' || +style.opacity < 0.5 || el.closest('[aria-hidden="true"], .sr-only, :disabled, [inert]')) continue;
      if (el.closest('dialog:not([open])')) continue;
      const fg = parse(style.color);
      if (!fg) continue;
      const size = parseFloat(style.fontSize);
      const bold = +style.fontWeight >= 700;
      const large = size >= 24 || (bold && size >= 18.66);
      const r = ratio(fg, background(el));
      if (r < (large ? 3 : 4.5)) out.push(`"${text.slice(0, 40)}" ${r.toFixed(2)}:1 (${style.color} on ${getComputedStyle(el).backgroundColor})`);
    }
    return out;
  });
}

test('text is readable in every palette, on every main screen', async ({ page }) => {
  test.setTimeout(180_000);
  await fresh(page);
  // Some of everything: a routine, a finished workout with a record, one in progress with a done set.
  await page.getByRole('button', { name: 'Use a starter plan' }).click();
  await page.getByRole('button', { name: /Full body/ }).click();
  for (const weight of ['60', '65']) {
    await page.goto('./#/');
    await page.getByRole('button', { name: 'Start Full body A' }).click();
    await page.locator('.exercise-card').first().getByLabel('Set 1 weight in kg').fill(weight);
    await page.locator('.check-btn').first().click();
    await page.getByRole('button', { name: 'Finish', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Finish workout' }).click();
    await expect(page.getByRole('heading', { name: 'Workout done' })).toBeVisible();
  }
  const summary = page.url().split('#')[1];
  await page.goto('./#/');
  await page.getByRole('button', { name: 'Start Full body B' }).click();
  await page.locator('.exercise-card').first().getByLabel('Set 1 weight in kg').fill('100');
  await page.locator('.check-btn').first().click();
  const screens = ['/', '/workout', '/exercises', '/exercise/Barbell_Squat', '/history', '/history?view=calendar', '/settings', '/settings/appearance', '/settings/sync', '/settings/claude', '/settings/data', '/settings/versions', summary];

  const failures: string[] = [];
  for (const id of PALETTES) {
    await page.evaluate((theme) => {
      const data = JSON.parse(localStorage.getItem('gym-tracker:v1')!);
      data.settings.theme = theme;
      data.settings.animations = false;
      localStorage.setItem('gym-tracker:v1', JSON.stringify(data));
    }, id);
    for (const scheme of id === 'auto' ? (['light', 'dark'] as const) : (['light'] as const)) {
      await page.emulateMedia({ colorScheme: scheme });
      for (const s of screens) {
        await page.goto(`./#${s}`);
        await page.reload();
        await page.waitForTimeout(250);
        for (const f of await lowContrast(page)) failures.push(`${id}${id === 'auto' ? `/${scheme}` : ''} ${s}: ${f}`);
      }
    }
  }
  expect([...new Set(failures)]).toEqual([]);
});

test('palettes apply at once and stay on this device; dark ones set a dark color scheme', async ({ page }) => {
  await fresh(page);
  await page.goto('./#/settings/appearance');
  await page.getByRole('radio', { name: 'Night' }).click();
  await expect(page.getByRole('radio', { name: 'Night' })).toHaveAttribute('aria-checked', 'true');
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(14, 23, 25)');
  await expect(page.locator('meta[name="color-scheme"]')).toHaveAttribute('content', 'dark');
  // Applied before the app loads next time (no flash of the light palette).
  await page.reload();
  expect(await page.evaluate(() => document.getElementById('theme-vars')?.textContent ?? '')).toContain('--bg:#0e1719');
});

test('animations: on by default, off with the switch, and off when the system asks for reduced motion', async ({ page }) => {
  await fresh(page);
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'on');
  await page.goto('./#/settings/appearance');
  await page.getByLabel('Animations').uncheck();
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'off');
  await page.getByLabel('Animations').check();
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'on');

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'off');
  await expect(page.getByText(/Off while your device’s Reduce Motion setting is on/)).toBeVisible();
});
