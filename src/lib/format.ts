import type { LogType, Units, WorkoutSet } from './types';
import { distanceUnit, fmtDistance, fmtDuration, fmtWeight } from './units';
import type { SetNumbers } from './workout';

/** A set in a few characters: "80 × 8", "+10 × 6", "0:45", "5 km · 25:00", "40 × 20 m". */
export function fmtSet(s: SetNumbers | WorkoutSet, logType: LogType, units: Units): string {
  const w = fmtWeight(s.weight, units);
  switch (logType) {
    case 'weight_reps':
      return s.reps !== undefined ? `${w || '0'} × ${s.reps}` : w ? `${w} ${units}` : '';
    case 'bodyweight':
      if (s.reps === undefined) return '';
      return s.weight ? `+${w} × ${s.reps}` : `${s.reps} reps`;
    case 'duration':
      return fmtDuration(s.seconds);
    case 'distance': {
      const d = s.meters ? `${fmtDistance(s.meters, logType, units)} ${distanceUnit(logType, units)}` : '';
      const t = s.seconds ? fmtDuration(s.seconds) : '';
      return [d, t].filter(Boolean).join(' · ');
    }
    case 'weight_distance': {
      const d = s.meters ? `${fmtDistance(s.meters, logType, units)} ${distanceUnit(logType, units)}` : '';
      return w && d ? `${w} × ${d}` : d || (w ? `${w} ${units}` : '');
    }
  }
}

/** A list of sets, like "3 sets · 80 × 8" when they're all the same, or "80 × 8, 80 × 7". */
export function fmtSets(sets: (SetNumbers | WorkoutSet)[], logType: LogType, units: Units): string {
  const parts = sets.map((s) => fmtSet(s, logType, units)).filter(Boolean);
  if (parts.length > 1 && parts.every((p) => p === parts[0])) return `${parts.length} sets · ${parts[0]}`;
  return parts.join(', ');
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
