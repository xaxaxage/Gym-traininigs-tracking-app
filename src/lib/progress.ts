import type { LogType, Workout } from './types';
import { addDays, weekStart } from './dates';
import { exerciseSessions, progress, workoutTotals } from './stats';

/**
 * The numbers behind the Progress screen: training volume week by week, and
 * every exercise you've done with its best mark and how it's moved.
 */

export interface WeekVolume {
  /** Monday of the week (YYYY-MM-DD). */
  start: string;
  workouts: number;
  sets: number;
  /** kg (weight × reps, bodyweight added weight included). */
  volume: number;
}

/** The last `weeks` weeks, oldest first, ending with the one `today` is in. */
export function weeklyVolume(workouts: Workout[], today: string, weeks = 7): WeekVolume[] {
  const first = addDays(weekStart(today), -7 * (weeks - 1));
  const out: WeekVolume[] = Array.from({ length: weeks }, (_, i) => ({ start: addDays(first, 7 * i), workouts: 0, sets: 0, volume: 0 }));
  for (const w of workouts) {
    if (!w.endedAt || w.date < first || w.date > addDays(out[weeks - 1].start, 6)) continue;
    const week = out[Math.floor((Date.parse(w.date) - Date.parse(first)) / (7 * 86_400_000))];
    if (!week) continue;
    const t = workoutTotals(w);
    week.workouts++;
    week.sets += t.sets;
    week.volume += t.volume;
  }
  return out;
}

export interface ExerciseProgress {
  exerciseId: string;
  name: string;
  logType: LogType;
  sessions: number;
  lastDate: string;
  /** The measure that best shows progress for how it's logged, one value per workout, oldest first. */
  trend: number[];
  /** The best value in `trend`. */
  best: number;
  /** Change from the first to the latest workout in the trend, as a fraction (0.1 = +10 %). */
  change?: number;
}

/** Per-workout value used for the trend: estimated 1RM for weights, best reps, time or distance otherwise. */
function trendValue(p: ReturnType<typeof progress>[number], logType: LogType): number {
  if (logType === 'weight_reps') return p.e1rm ?? 0;
  if (logType === 'weight_distance') return p.top ?? 0;
  return p.best ?? 0;
}

/** Every exercise with at least one finished workout, the most recently done first. */
export function exerciseOverview(workouts: Workout[], points = 12): ExerciseProgress[] {
  const seen = new Map<string, { name: string; logType: LogType }>();
  // Newest name wins: a renamed custom exercise shows its current name.
  for (const w of [...workouts].sort((a, b) => b.startedAt - a.startedAt)) {
    if (!w.endedAt) continue;
    for (const e of w.exercises) if (!seen.has(e.exerciseId) && e.sets.some((s) => s.done)) seen.set(e.exerciseId, { name: e.name, logType: e.logType });
  }
  const out: ExerciseProgress[] = [];
  for (const [id, { name, logType }] of seen) {
    const sessions = exerciseSessions(workouts, id);
    if (sessions.length === 0) continue;
    const trend = progress(sessions)
      .map((p) => trendValue(p, logType))
      .slice(-points);
    const nonZero = trend.filter((v) => v > 0);
    const first = nonZero[0];
    const last = nonZero.at(-1);
    out.push({
      exerciseId: id,
      name,
      logType,
      sessions: sessions.length,
      lastDate: sessions.at(-1)!.date,
      trend,
      best: Math.max(0, ...trend),
      ...(nonZero.length >= 2 && first && last ? { change: (last - first) / first } : {}),
    });
  }
  return out.sort((a, b) => (a.lastDate < b.lastDate ? 1 : a.lastDate > b.lastDate ? -1 : a.name.localeCompare(b.name)));
}
