import { useState } from 'preact/hooks';
import type { LogType, Units } from '../lib/types';
import {
  distanceUnit,
  fmtDistance,
  fmtDuration,
  fmtWeight,
  parseDuration,
  parseNumber,
  toKg,
  toMeters,
} from '../lib/units';
import { MAX_METERS, MAX_REPS, MAX_SECONDS, MAX_WEIGHT } from '../lib/schema';

export type Field = 'weight' | 'reps' | 'seconds' | 'meters';

export function show(field: Field, value: number | undefined, units: Units, logType: LogType): string {
  if (value === undefined) return '';
  switch (field) {
    case 'weight':
      return fmtWeight(value, units);
    case 'reps':
      return String(value);
    case 'seconds':
      return fmtDuration(value);
    case 'meters':
      return fmtDistance(value, logType, units);
  }
}

/** What was typed, in stored units (kg, seconds, meters); undefined when empty, NaN when not a number. */
export function read(field: Field, text: string, units: Units, logType: LogType): number | undefined {
  const t = text.trim();
  if (!t) return undefined;
  switch (field) {
    case 'weight': {
      const n = parseNumber(t);
      return Number.isNaN(n) ? NaN : Math.min(MAX_WEIGHT, toKg(n, units));
    }
    case 'reps': {
      const n = parseNumber(t);
      return Number.isNaN(n) ? NaN : Math.min(MAX_REPS, Math.round(n));
    }
    case 'seconds': {
      const n = parseDuration(t);
      return Number.isNaN(n) ? NaN : Math.min(MAX_SECONDS, n);
    }
    case 'meters': {
      const n = parseNumber(t);
      return Number.isNaN(n) ? NaN : Math.min(MAX_METERS, toMeters(n, distanceUnit(logType, units)));
    }
  }
}

export function unitFor(field: Field, units: Units, logType: LogType): string {
  switch (field) {
    case 'weight':
      return logType === 'bodyweight' ? `+${units}` : units;
    case 'reps':
      return 'reps';
    case 'seconds':
      return 'time';
    case 'meters':
      return distanceUnit(logType, units);
  }
}

/**
 * A number in a set. While it has focus it keeps exactly what was typed (so
 * "8" on the way to "82.5" isn't reformatted); every valid change is saved
 * straight away.
 */
export function NumberInput({
  id,
  field,
  value,
  units,
  logType,
  label,
  placeholder,
  onChange,
  class: className = '',
}: {
  id: string;
  field: Field;
  value: number | undefined;
  units: Units;
  logType: LogType;
  label: string;
  placeholder?: string;
  onChange: (value: number | undefined) => void;
  class?: string;
}) {
  const [text, setText] = useState<string | null>(null);
  const [bad, setBad] = useState(false);
  return (
    <input
      id={id}
      class={`num-input num${bad ? ' invalid' : ''} ${className}`}
      type="text"
      inputMode={field === 'weight' || field === 'meters' ? 'decimal' : 'numeric'}
      autoComplete="off"
      enterKeyHint="done"
      aria-label={label}
      aria-invalid={bad || undefined}
      placeholder={placeholder}
      value={text ?? show(field, value, units, logType)}
      onFocus={(e) => {
        setText(show(field, value, units, logType));
        (e.target as HTMLInputElement).select();
      }}
      onInput={(e) => {
        const t = (e.target as HTMLInputElement).value.replace(/[^\d.,:]/g, '');
        setText(t);
        const n = read(field, t, units, logType);
        const invalid = n !== undefined && Number.isNaN(n);
        setBad(invalid);
        if (!invalid) onChange(n);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
      onBlur={() => {
        setText(null);
        setBad(false);
      }}
    />
  );
}
