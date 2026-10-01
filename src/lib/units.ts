import type { LogType, Units } from './types';

/**
 * Everything is stored in kilograms, meters and seconds; these helpers show
 * and read values in the chosen units. Stored weights are rounded to grams,
 * so a weight typed in pounds shows the same pounds again.
 */

export const KG_PER_LB = 0.45359237;

const round = (n: number, places: number) => {
  const f = 10 ** places;
  return Math.round(n * f) / f;
};

/** Weight typed in `units` → kg for storage. */
export function toKg(value: number, units: Units): number {
  return round(units === 'lb' ? value * KG_PER_LB : value, 3);
}

/** Stored kg → a number in `units`, rounded for showing (0.01 kg, 0.1 lb). */
export function fromKg(kg: number, units: Units): number {
  return units === 'lb' ? round(kg / KG_PER_LB, 1) : round(kg, 2);
}

/** "82.5", "185", "-" for nothing. */
export function fmtWeight(kg: number | undefined, units: Units): string {
  if (kg === undefined || !Number.isFinite(kg)) return '';
  return trim(fromKg(kg, units));
}

/** "82.5 kg" */
export function weightLabel(kg: number | undefined, units: Units): string {
  const w = fmtWeight(kg, units);
  return w ? `${w} ${units}` : '';
}

function trim(n: number): string {
  return String(n);
}

/** Big totals (volume): whole numbers with thousands separators, "12,480 kg". */
export function fmtVolume(kg: number, units: Units): string {
  const v = Math.round(units === 'lb' ? kg / KG_PER_LB : kg);
  return `${v.toLocaleString('en-US')} ${units}`;
}

/** Step for the − / + buttons on a weight. */
export function weightStep(units: Units): number {
  return units === 'lb' ? 5 : 2.5;
}

/**
 * Read a number as typed: "82,5" (comma keyboards) and "82.5" both work;
 * anything that isn't a number gives NaN.
 */
export function parseNumber(text: string): number {
  const t = text.trim().replace(',', '.');
  if (!/^\d*\.?\d+$|^\d+\.$/.test(t)) return NaN;
  return Number(t);
}

// ── Distance ──────────────────────────────────────────────────────────────

/** Cardio goes in km or miles; carries in meters or yards. */
export function distanceUnit(logType: LogType, units: Units): 'km' | 'mi' | 'm' | 'yd' {
  if (logType === 'weight_distance') return units === 'lb' ? 'yd' : 'm';
  return units === 'lb' ? 'mi' : 'km';
}

const METERS: Record<'km' | 'mi' | 'm' | 'yd', number> = { km: 1000, mi: 1609.344, m: 1, yd: 0.9144 };

export function toMeters(value: number, unit: keyof typeof METERS): number {
  return round(value * METERS[unit], 1);
}

export function fromMeters(m: number, unit: keyof typeof METERS): number {
  return round(m / METERS[unit], unit === 'km' || unit === 'mi' ? 2 : 0);
}

export function fmtDistance(m: number | undefined, logType: LogType, units: Units): string {
  if (m === undefined || !Number.isFinite(m)) return '';
  return String(fromMeters(m, distanceUnit(logType, units)));
}

// ── Time ──────────────────────────────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, '0');

/** 90 → "1:30", 3725 → "1:02:05". */
export function fmtDuration(seconds: number | undefined): string {
  if (seconds === undefined || !Number.isFinite(seconds)) return '';
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}

/** Rest times in words: "90 s", "2 min", "2 min 30 s". */
export function restLabel(seconds: number): string {
  if (seconds < 60) return `${seconds} s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s ? `${m} min ${s} s` : `${m} min`;
}

/**
 * A time as typed: "1:30" or "1.30" (minutes:seconds), "1:02:05", or just
 * digits, read from the right like a microwave ("130" = 1:30, "45" = 0:45).
 * NaN when it isn't a time.
 */
export function parseDuration(text: string): number {
  const t = text.trim();
  if (!t) return NaN;
  if (/^\d+$/.test(t)) {
    const digits = t.slice(-6).padStart(6, '0');
    const h = Number(digits.slice(0, 2));
    const m = Number(digits.slice(2, 4));
    const s = Number(digits.slice(4, 6));
    return h * 3600 + m * 60 + s;
  }
  const parts = t.split(/[:.,]/);
  if (parts.length > 3 || parts.some((p) => !/^\d{1,3}$/.test(p))) return NaN;
  return parts.map(Number).reduce((total, n) => total * 60 + n, 0);
}
