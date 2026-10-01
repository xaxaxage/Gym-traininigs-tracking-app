import type { Units } from './types';
import type { NewRecord } from './stats';
import { distanceUnit, fmtDistance, fmtDuration, fmtVolume, weightLabel } from './units';

/** A new record in words, e.g. "Heaviest weight: 100 kg (was 97.5 kg)". */
export function recordText(r: NewRecord, units: Units): string {
  const was = (v: string) => ` (was ${v})`;
  switch (r.kind) {
    case 'e1rm':
      return `Best estimated 1-rep max: ${weightLabel(r.value, units)}${was(weightLabel(r.previous, units))}`;
    case 'heaviest':
      return `Heaviest weight: ${weightLabel(r.value, units)}${was(weightLabel(r.previous, units))}`;
    case 'volume':
      return `Most volume in a workout: ${fmtVolume(r.value, units)}${was(fmtVolume(r.previous, units))}`;
    case 'reps':
      return `Most reps in a set: ${r.value}${was(String(r.previous))}`;
    case 'repsAtWeight':
      return `Most reps at ${weightLabel(r.weight, units)}: ${r.value}${was(String(r.previous))}`;
    case 'longest':
      return `Longest: ${fmtDuration(r.value)}${was(fmtDuration(r.previous))}`;
    case 'farthest': {
      const u = distanceUnit(r.logType, units);
      return `Farthest: ${fmtDistance(r.value, r.logType, units)} ${u}${was(`${fmtDistance(r.previous, r.logType, units)} ${u}`)}`;
    }
  }
}
