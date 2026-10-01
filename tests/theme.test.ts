import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AUTO_THEME, contrast, deriveTokens, HARBOR, isThemeId, luminance, PALETTES, paletteTokens, themeOutput, TOKEN_NAMES, type Tokens } from '../src/lib/theme';
import { parseData } from '../src/lib/store';

/** The pairs people actually read: text on its background, labels on buttons. */
function readability(t: Tokens) {
  return {
    'ink on bg': contrast(t.ink, t.bg),
    'ink on surface': contrast(t.ink, t.surface),
    'ink-2 on sunken (tags)': contrast(t['ink-2'], t.sunken),
    'muted on surface': contrast(t.muted, t.surface),
    'muted on bg': contrast(t.muted, t.bg),
    'muted on sunken': contrast(t.muted, t.sunken),
    'main on surface': contrast(t.primary, t.surface),
    'main on bg': contrast(t.primary, t.bg),
    'label on main': contrast(t['on-primary'], t.primary),
    'chip text on soft main': contrast(t['primary-strong'], t['primary-soft']),
    'label on accent': contrast(t['on-accent'], t.accent),
    'accent text on surface': contrast(t['accent-ink'], t.surface),
    'accent text on soft accent': contrast(t['accent-ink'], t['accent-soft']),
    'notice text': contrast(t['on-accent-soft'], t['accent-soft']),
    'danger on surface': contrast(t.danger, t.surface),
    'error banner': contrast(t['on-danger'], t.danger),
    'toast text': contrast(t['on-ink'], t.ink),
    'done set text': contrast(t.ink, t['success-soft']),
    'success text': contrast(t['success-ink'], t['success-soft']),
  };
}

describe('palettes', () => {
  it('Harbor matches the stylesheet defaults exactly', () => {
    const css = readFileSync('src/styles.css', 'utf8');
    const root = css.slice(css.indexOf(':root {'), css.indexOf('}', css.indexOf(':root {')));
    for (const name of TOKEN_NAMES) {
      const m = new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, 'i').exec(root);
      expect(m?.[1]?.toLowerCase(), name).toBe(paletteTokens(HARBOR)[name]);
    }
  });

  it.each(PALETTES.map((p) => [p.name, p] as const))('%s is readable (WCAG AA)', (_, palette) => {
    const t = paletteTokens(palette);
    for (const [pair, ratio] of Object.entries(readability(t))) {
      expect(ratio, `${palette.name}: ${pair}`).toBeGreaterThanOrEqual(4.5);
    }
    // Icons and the done-set tick are graphics, which need 3:1.
    expect(contrast(t['on-success'], t.success), `${palette.name}: done tick`).toBeGreaterThanOrEqual(3);
    expect(contrast(t['accent-icon'], t['accent-soft']), `${palette.name}: trophy`).toBeGreaterThanOrEqual(3);
    // Chart lines need 3:1 on the cards.
    expect(contrast(t['series-1'], t.surface), `${palette.name}: chart line 1`).toBeGreaterThanOrEqual(3);
    expect(contrast(t['series-2'], t.surface), `${palette.name}: chart line 2`).toBeGreaterThanOrEqual(3);
  });

  it('has dark palettes that set a dark color scheme', () => {
    for (const id of ['night', 'espresso', 'oled']) expect(themeOutput(id).scheme).toBe('dark');
    expect(themeOutput('harbor').scheme).toBe('light');
    expect(luminance(paletteTokens(PALETTES.find((p) => p.id === 'oled')!).bg)).toBe(0);
  });

  it('Auto follows the system setting', () => {
    const out = themeOutput(AUTO_THEME);
    expect(out.css).toContain('@media (prefers-color-scheme: dark)');
    expect(out.scheme).toBe('light dark');
    expect(out.bar).toEqual([HARBOR.base.bg, PALETTES.find((p) => p.id === 'night')!.base.bg]);
  });

  it('falls back to Harbor for an unknown palette', () => {
    expect(themeOutput('gone').css).toBe(themeOutput('harbor').css);
    expect(isThemeId('night')).toBe(true);
    expect(isThemeId('x;}body{display:none')).toBe(false);
  });

  it('keeps text readable even when colors clash', () => {
    const t = deriveTokens({ ...HARBOR.base, bg: '#777777', surface: '#808080', ink: '#7a7a7a', primary: '#8a8a8a' });
    expect(contrast(t.ink, t.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t['on-primary'], t.primary)).toBeGreaterThanOrEqual(4.5);
  });

  it('never lets a saved palette inject CSS', () => {
    expect(parseData({ version: 1, settings: { theme: 'x;}body{display:none' } }).settings.theme).toBe('harbor');
  });
});
