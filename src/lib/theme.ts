/**
 * Color palettes (ported from the calorie tracker). A palette is a few base
 * colors — background, cards, text, main, accent and a warning red — and
 * every other shade the app uses is derived from them, with text shades
 * nudged until they are readable (WCAG AA).
 */

export interface ThemeBase {
  bg: string;
  surface: string;
  ink: string;
  primary: string;
  accent: string;
  danger: string;
}

export const TOKEN_NAMES = [
  'bg', 'surface', 'sunken', 'quiet', 'line', 'line-control', 'line-field', 'divider',
  'ink', 'ink-2', 'muted', 'faint', 'disabled', 'on-ink',
  'primary', 'primary-strong', 'primary-soft', 'primary-pale', 'primary-disabled', 'on-primary',
  'accent', 'accent-strong', 'accent-ink', 'accent-soft', 'accent-icon', 'accent-line', 'on-accent', 'on-accent-soft',
  'track',
  'danger', 'danger-soft', 'on-danger',
  'success', 'success-soft', 'success-ink', 'on-success',
  'series-1', 'series-2',
] as const;

export type TokenName = (typeof TOKEN_NAMES)[number];
export type Tokens = Record<TokenName, string>;

export interface Palette {
  id: string;
  name: string;
  base: ThemeBase;
  /** Exact shades, where a palette was tuned by hand. */
  tokens?: Partial<Tokens>;
}

/** The original look (the calorie tracker's Harbor); these shades match styles.css exactly. */
const HARBOR_TOKENS: Tokens = {
  bg: '#f7f3ee',
  surface: '#ffffff',
  sunken: '#efe8e0',
  quiet: '#f4eee7',
  line: '#ece5dc',
  'line-control': '#e8e0d6',
  'line-field': '#d9d0c5',
  divider: '#f1ebe4',
  ink: '#16262b',
  'ink-2': '#3e484c',
  muted: '#5b6468',
  faint: '#9aa3a6',
  disabled: '#b7b0a8',
  'on-ink': '#ffffff',
  primary: '#0f4c5c',
  'primary-strong': '#0a3642',
  'primary-soft': '#e3eef0',
  'primary-pale': '#a9c4ca',
  'primary-disabled': '#9fb8be',
  'on-primary': '#ffffff',
  accent: '#fb8b24',
  'accent-strong': '#e36414',
  'accent-ink': '#b8480c',
  'accent-soft': '#fdebdd',
  'accent-icon': '#c1510c',
  'accent-line': '#f5c9a6',
  'on-accent': '#2a1405',
  'on-accent-soft': '#3e2a1c',
  track: '#f4e7dc',
  danger: '#9a031e',
  'danger-soft': '#f6e1e4',
  'on-danger': '#ffffff',
  success: '#2f8a4a',
  'success-soft': '#e4efe6',
  'success-ink': '#2f6b3a',
  'on-success': '#ffffff',
  'series-1': '#2a78d6',
  'series-2': '#eb6834',
};

/**
 * Chart series colors: blue and orange from the dataviz reference palette,
 * stepped for light and dark surfaces and checked for color-blind separation
 * and 3:1 contrast on every palette's cards (tests/theme.test.ts).
 */
const SERIES = { light: ['#2a78d6', '#eb6834'], dark: ['#3987e5', '#d95926'] };

export const DEFAULT_THEME = 'harbor';
/** Harbor in light mode, Night in dark mode. */
export const AUTO_THEME = 'auto';

export const PALETTES: Palette[] = [
  {
    id: 'harbor',
    name: 'Harbor',
    base: { bg: '#f7f3ee', surface: '#ffffff', ink: '#16262b', primary: '#0f4c5c', accent: '#fb8b24', danger: '#9a031e' },
    tokens: HARBOR_TOKENS,
  },
  {
    id: 'matcha',
    name: 'Matcha',
    base: { bg: '#f1f4ec', surface: '#ffffff', ink: '#1b2a1e', primary: '#2d6a4f', accent: '#e9a23b', danger: '#b5323f' },
  },
  {
    id: 'berry',
    name: 'Berry',
    base: { bg: '#fbf2f4', surface: '#ffffff', ink: '#2b1625', primary: '#7b1e57', accent: '#ff7a85', danger: '#b3261e' },
  },
  {
    id: 'ocean',
    name: 'Ocean',
    base: { bg: '#eef3f8', surface: '#ffffff', ink: '#122238', primary: '#1d4e89', accent: '#ff6f59', danger: '#c1121f' },
  },
  {
    id: 'lavender',
    name: 'Lavender',
    base: { bg: '#f5f3fa', surface: '#ffffff', ink: '#221d33', primary: '#5b4b9a', accent: '#f2a65a', danger: '#b8336a' },
  },
  {
    id: 'graphite',
    name: 'Graphite',
    base: { bg: '#f2f2f0', surface: '#ffffff', ink: '#151515', primary: '#222222', accent: '#ffb000', danger: '#b3261e' },
  },
  {
    id: 'night',
    name: 'Night',
    base: { bg: '#0e1719', surface: '#172326', ink: '#e8efee', primary: '#6cc0cf', accent: '#fb8b24', danger: '#ff7088' },
  },
  {
    id: 'espresso',
    name: 'Espresso',
    base: { bg: '#17120f', surface: '#231c18', ink: '#f2e9e1', primary: '#e2a86b', accent: '#ff7b54', danger: '#ff7070' },
  },
  {
    id: 'oled',
    name: 'OLED black',
    base: { bg: '#000000', surface: '#121212', ink: '#f2f2f2', primary: '#8ab4f8', accent: '#fdd663', danger: '#f28b82' },
  },
];

export const HARBOR = PALETTES[0];
const NIGHT = PALETTES.find((p) => p.id === 'night')!;

// ── Color math ────────────────────────────────────────────────────────────

export function isHex(value: unknown): value is string {
  return typeof value === 'string' && /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value.trim());
}

/** "#ABC", "abc" or "#aabbcc" → "#aabbcc". */
export function normalizeHex(value: string): string {
  let h = value.trim().replace(/^#/, '').toLowerCase();
  if (h.length === 3) h = h.replace(/./g, (c) => c + c);
  return `#${h}`;
}

function rgb(hex: string): [number, number, number] {
  const h = normalizeHex(hex);
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}

function toHex([r, g, b]: number[]): string {
  return `#${[r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')}`;
}

/** Mix `b` into `a` by `t` (0 = a, 1 = b). */
export function mix(a: string, b: string, t: number): string {
  const x = rgb(a);
  const y = rgb(b);
  return toHex(x.map((v, i) => v + (y[i] - v) * t));
}

export function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio, 1–21. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Darken or lighten `fg` just enough to reach `min` contrast on `bg`. */
export function ensureContrast(fg: string, bg: string, min: number): string {
  if (contrast(fg, bg) >= min) return normalizeHex(fg);
  const lightBg = luminance(bg) > 0.18;
  for (const target of lightBg ? ['#000000', '#ffffff'] : ['#ffffff', '#000000']) {
    for (let t = 0.05; t <= 1.001; t += 0.05) {
      const c = mix(fg, target, t);
      if (contrast(c, bg) >= min) return c;
    }
  }
  return lightBg ? '#000000' : '#ffffff';
}

/** Text color for a filled button: white, or a very dark tint of the fill. */
function textOn(fill: string): string {
  const dark = mix(fill, '#000000', 0.85);
  return contrast('#ffffff', fill) >= 4.5 || contrast('#ffffff', fill) >= contrast(dark, fill) ? '#ffffff' : dark;
}

export function isDark(base: ThemeBase): boolean {
  return luminance(base.bg) < 0.2;
}

/** Every shade the app uses, from a palette's base colors. */
export function deriveTokens(input: ThemeBase): Tokens {
  const base = cleanBase(input);
  const dark = isDark(base);
  const { bg, surface } = base;
  const ink = ensureContrast(ensureContrast(base.ink, surface, 7), bg, 7);
  const shade = (t: number) => mix(surface, ink, t);
  // Text sits on both cards and the page, so it must read on both.
  const readable = (fg: string, min: number) => ensureContrast(ensureContrast(fg, surface, min), bg, min);
  const ground = (t: number) => mix(bg, ink, t);

  const primary = readable(base.primary, 4.5);
  const accent = base.accent;
  const accentSoft = mix(surface, accent, dark ? 0.2 : 0.15);
  const danger = readable(base.danger, 4.5);
  const success = ensureContrast(dark ? '#4cc36e' : '#2f8a4a', surface, 3);
  const successSoft = mix(surface, success, 0.16);

  const sunken = ground(dark ? 0.08 : 0.05);
  return {
    bg,
    surface,
    sunken,
    // Round buttons sit on cards; in the dark they need a visibly lighter circle.
    quiet: dark ? shade(0.1) : ground(0.03),
    line: shade(dark ? 0.12 : 0.08),
    'line-control': shade(dark ? 0.16 : 0.1),
    'line-field': shade(dark ? 0.26 : 0.18),
    divider: shade(dark ? 0.08 : 0.05),
    ink,
    'ink-2': ensureContrast(mix(ink, surface, 0.18), surface, 7),
    // Muted text sits on cards, the page and sunken panels.
    muted: ensureContrast(readable(mix(ink, surface, 0.38), 4.6), sunken, 4.6),
    faint: ensureContrast(mix(ink, surface, 0.55), surface, 2.4),
    disabled: mix(ink, surface, 0.66),
    'on-ink': textOn(ink),
    primary,
    'primary-strong': dark ? mix(primary, '#ffffff', 0.2) : mix(primary, '#000000', 0.3),
    'primary-soft': mix(surface, primary, dark ? 0.18 : 0.11),
    'primary-pale': mix(surface, primary, 0.35),
    'primary-disabled': mix(surface, primary, 0.42),
    'on-primary': textOn(primary),
    accent,
    'accent-strong': ensureContrast(dark ? accent : mix(accent, '#000000', 0.1), surface, 3),
    'accent-ink': readable(accent, 4.6),
    'accent-soft': accentSoft,
    'accent-icon': ensureContrast(accent, accentSoft, 3.5),
    'accent-line': mix(surface, accent, 0.4),
    'on-accent': textOn(accent),
    'on-accent-soft': ensureContrast(mix(ink, accent, 0.2), accentSoft, 7),
    track: mix(surface, accent, dark ? 0.16 : 0.12),
    danger,
    'danger-soft': mix(surface, danger, dark ? 0.2 : 0.12),
    'on-danger': textOn(danger),
    success,
    'success-soft': successSoft,
    'success-ink': ensureContrast(success, successSoft, 4.6),
    'on-success': textOn(success),
    'series-1': SERIES[dark ? 'dark' : 'light'][0],
    'series-2': SERIES[dark ? 'dark' : 'light'][1],
  };
}

export function paletteTokens(p: Pick<Palette, 'base' | 'tokens'>): Tokens {
  return { ...deriveTokens(p.base), ...(p.tokens ?? {}) };
}

export function cleanBase(raw: Partial<ThemeBase> | undefined, fallback: ThemeBase = HARBOR.base): ThemeBase {
  const out = { ...fallback };
  for (const key of Object.keys(fallback) as (keyof ThemeBase)[]) {
    const v = raw?.[key];
    if (isHex(v)) out[key] = normalizeHex(v);
  }
  return out;
}

// ── Choosing and applying ─────────────────────────────────────────────────

export function findPalette(id: string): Palette | undefined {
  return PALETTES.find((p) => p.id === id);
}

export function isThemeId(value: unknown): value is string {
  return value === AUTO_THEME || (typeof value === 'string' && !!findPalette(value));
}

function block(tokens: Tokens, dark: boolean): string {
  const vars = TOKEN_NAMES.map((n) => `--${n}:${tokens[n]};`).join('');
  return `${vars}color-scheme:${dark ? 'dark' : 'light'};`;
}

/** Beats the stylesheet's own :root defaults, which may load after this. */
const ROOT = 'html:root';

export interface ThemeOutput {
  css: string;
  /** Status bar color: [light mode, dark mode]. */
  bar: [string, string];
  scheme: 'light' | 'dark' | 'light dark';
}

export function themeOutput(themeId: string): ThemeOutput {
  if (themeId === AUTO_THEME) {
    const light = paletteTokens(HARBOR);
    const dark = paletteTokens(NIGHT);
    return {
      css: `${ROOT}{${block(light, false)}}@media (prefers-color-scheme: dark){${ROOT}{${block(dark, true)}}}`,
      bar: [light.bg, dark.bg],
      scheme: 'light dark',
    };
  }
  return paletteOutput(findPalette(themeId) ?? HARBOR);
}

export function paletteOutput(palette: Pick<Palette, 'base' | 'tokens'>): ThemeOutput {
  const tokens = paletteTokens(palette);
  const dark = isDark(palette.base);
  return { css: `${ROOT}{${block(tokens, dark)}}`, bar: [tokens.bg, tokens.bg], scheme: dark ? 'dark' : 'light' };
}

/** Where index.html finds the theme before the app loads, so it doesn't flash the default colors. */
export const THEME_CACHE_KEY = 'gym-tracker:theme';

let mediaListener: (() => void) | null = null;

export function applyThemeOutput(out: ThemeOutput) {
  let style = document.getElementById('theme-vars') as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement('style');
    style.id = 'theme-vars';
    document.head.appendChild(style);
  }
  if (style.textContent !== out.css) style.textContent = out.css;
  document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', out.scheme);

  const media = window.matchMedia?.('(prefers-color-scheme: dark)');
  const setBar = () => {
    const color = media?.matches ? out.bar[1] : out.bar[0];
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', color);
  };
  setBar();
  if (mediaListener) media?.removeEventListener?.('change', mediaListener);
  mediaListener = out.bar[0] !== out.bar[1] ? setBar : null;
  if (mediaListener) media?.addEventListener?.('change', mediaListener);
}

export function applyTheme(themeId: string) {
  const out = themeOutput(themeId);
  applyThemeOutput(out);
  try {
    localStorage.setItem(THEME_CACHE_KEY, JSON.stringify(out));
  } catch {
    // The theme still applies; it just may flash on the next launch.
  }
}
