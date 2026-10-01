import type { LogType, Workout, WorkoutSet } from './types';

/**
 * Numbers about training: estimated one-rep max, volume, personal records
 * and progress over time. Only completed sets of finished workouts count
 * (and the workout being looked at, for its own summary).
 */

/** Estimated one-rep max (Epley): weight × (1 + reps / 30); a single is just its weight. */
export function e1rm(weight: number, reps: number): number {
  if (!(weight > 0) || !(reps > 0)) return 0;
  return reps === 1 ? weight : weight * (1 + reps / 30);
}

/** Weight moved in a set: weight × reps (for bodyweight exercises, the added weight). */
export function setVolume(s: WorkoutSet, logType: LogType): number {
  if (logType !== 'weight_reps' && logType !== 'bodyweight') return 0;
  return (s.weight ?? 0) * (s.reps ?? 0);
}

export interface WorkoutTotals {
  sets: number;
  reps: number;
  volume: number;
  exercises: number;
  /** ms; up to now for a workout in progress. */
  duration: number;
}

export function workoutTotals(w: Workout, now = Date.now()): WorkoutTotals {
  let sets = 0;
  let reps = 0;
  let volume = 0;
  let exercises = 0;
  for (const e of w.exercises) {
    const done = e.sets.filter((s) => s.done);
    if (done.length) exercises++;
    for (const s of done) {
      sets++;
      reps += s.reps ?? 0;
      volume += setVolume(s, e.logType);
    }
  }
  return { sets, reps, volume, exercises, duration: Math.max(0, (w.endedAt ?? now) - w.startedAt) };
}

/** One workout's sets of one exercise. */
export interface Session {
  workoutId: string;
  date: string;
  startedAt: number;
  logType: LogType;
  sets: WorkoutSet[];
}

/** Every finished workout with completed sets of the exercise, oldest first. */
export function exerciseSessions(workouts: Workout[], exerciseId: string, include?: Workout): Session[] {
  const out: Session[] = [];
  for (const w of workouts) {
    if (!w.endedAt && w !== include) continue;
    const matching = w.exercises.filter((e) => e.exerciseId === exerciseId);
    const sets = matching.flatMap((e) => e.sets.filter((s) => s.done));
    if (sets.length) out.push({ workoutId: w.id, date: w.date, startedAt: w.startedAt, logType: matching[0].logType, sets });
  }
  return out.sort((a, b) => a.startedAt - b.startedAt);
}

/** A record and where it was set. */
export interface Mark {
  value: number;
  /** The set behind it, when there's one. */
  weight?: number;
  reps?: number;
  date: string;
  workoutId: string;
}

export interface Records {
  /** Heaviest weight lifted (any reps). */
  heaviest?: Mark;
  /** Best estimated one-rep max. */
  bestE1rm?: Mark;
  /** Most weight moved in one workout. */
  bestVolume?: Mark;
  /** Most reps in one set. */
  mostReps?: Mark;
  /** Longest set (time). */
  longest?: Mark;
  /** Longest distance in one set. */
  farthest?: Mark;
  /** For each weight: the most reps done with it, heaviest first. */
  repsAtWeight: Mark[];
}

const better = (a: Mark | undefined, value: number) => value > 0 && (!a || value > a.value);

/** A weight as a map key, to the gram (weights typed in pounds are stored with decimals). */
const weightKey = (kg: number) => Math.round(kg * 1000);

export function records(sessions: Session[]): Records {
  const r: Records = { repsAtWeight: [] };
  const atWeight = new Map<number, Mark>();
  for (const s of sessions) {
    const at = { date: s.date, workoutId: s.workoutId };
    let volume = 0;
    for (const set of s.sets) {
      const w = set.weight ?? 0;
      const reps = set.reps ?? 0;
      volume += setVolume(set, s.logType);
      if (s.logType === 'weight_reps' || s.logType === 'bodyweight' || s.logType === 'weight_distance') {
        if (better(r.heaviest, w)) r.heaviest = { value: w, weight: w, reps, ...at };
      }
      if (s.logType === 'weight_reps') {
        const est = e1rm(w, reps);
        if (better(r.bestE1rm, est)) r.bestE1rm = { value: est, weight: w, reps, ...at };
      }
      if (s.logType === 'weight_reps' || s.logType === 'bodyweight') {
        if (better(r.mostReps, reps)) r.mostReps = { value: reps, weight: w, reps, ...at };
        if (w > 0 && reps > 0) {
          const key = weightKey(w);
          const known = atWeight.get(key);
          if (!known || reps > known.value) atWeight.set(key, { value: reps, weight: w, reps, ...at });
        }
      }
      if (better(r.longest, set.seconds ?? 0)) r.longest = { value: set.seconds!, ...at };
      if (better(r.farthest, set.meters ?? 0)) r.farthest = { value: set.meters!, weight: set.weight, ...at };
    }
    if (better(r.bestVolume, volume)) r.bestVolume = { value: volume, ...at };
  }
  r.repsAtWeight = [...atWeight.values()].sort((a, b) => b.weight! - a.weight!);
  return r;
}

export type RecordKind = 'heaviest' | 'e1rm' | 'volume' | 'reps' | 'repsAtWeight' | 'longest' | 'farthest';

export interface NewRecord {
  exerciseId: string;
  name: string;
  logType: LogType;
  kind: RecordKind;
  value: number;
  previous: number;
  /** For a reps-at-a-weight record. */
  weight?: number;
}

/**
 * Records a workout set, compared with every finished workout before it. An
 * exercise done for the first time sets no records (there's nothing to beat).
 */
export function newRecords(workout: Workout, all: Workout[]): NewRecord[] {
  const before = all.filter((w) => w.id !== workout.id && w.endedAt && w.startedAt < workout.startedAt);
  const out: NewRecord[] = [];
  const seen = new Set<string>();
  for (const e of workout.exercises) {
    if (seen.has(e.exerciseId)) continue;
    seen.add(e.exerciseId);
    const past = exerciseSessions(before, e.exerciseId);
    if (past.length === 0) continue;
    const now = exerciseSessions([workout], e.exerciseId, workout);
    if (now.length === 0) continue;
    const old = records(past);
    const mine = records(now);
    const base = { exerciseId: e.exerciseId, name: e.name, logType: e.logType };
    const check = (kind: RecordKind, a: Mark | undefined, b: Mark | undefined) => {
      if (b && a && b.value > a.value + 1e-9) out.push({ ...base, kind, value: b.value, previous: a.value });
    };
    check('e1rm', old.bestE1rm, mine.bestE1rm);
    check('heaviest', old.heaviest, mine.heaviest);
    check('volume', old.bestVolume, mine.bestVolume);
    if (e.logType === 'bodyweight' && !(mine.heaviest && old.heaviest)) check('reps', old.mostReps, mine.mostReps);
    check('longest', old.longest, mine.longest);
    check('farthest', old.farthest, mine.farthest);
    // More reps than ever at a weight done before (a first time at a weight isn't a record yet).
    if (e.logType === 'weight_reps' || e.logType === 'bodyweight') {
      const oldAt = new Map(old.repsAtWeight.map((m) => [weightKey(m.weight!), m.value]));
      for (const m of mine.repsAtWeight) {
        const prev = oldAt.get(weightKey(m.weight!));
        if (prev !== undefined && m.value > prev) {
          out.push({ ...base, kind: 'repsAtWeight', value: m.value, previous: prev, weight: m.weight });
        }
      }
    }
  }
  return out;
}

export interface ProgressPoint {
  date: string;
  startedAt: number;
  workoutId: string;
  /** Best estimated one-rep max that day (weight × reps exercises). */
  e1rm?: number;
  /** Heaviest set that day. */
  top?: number;
  /** For other ways of logging: most reps, longest time or longest distance that day. */
  best?: number;
}

/** One point per workout, for the progress chart. */
export function progress(sessions: Session[]): ProgressPoint[] {
  return sessions.map((s) => {
    const point: ProgressPoint = { date: s.date, startedAt: s.startedAt, workoutId: s.workoutId };
    const max = (f: (x: WorkoutSet) => number) => Math.max(0, ...s.sets.map(f));
    if (s.logType === 'weight_reps') {
      point.e1rm = max((x) => e1rm(x.weight ?? 0, x.reps ?? 0));
      point.top = max((x) => x.weight ?? 0);
    } else if (s.logType === 'bodyweight') {
      point.best = max((x) => x.reps ?? 0);
      const top = max((x) => x.weight ?? 0);
      if (top > 0) point.top = top;
    } else if (s.logType === 'duration') point.best = max((x) => x.seconds ?? 0);
    else if (s.logType === 'distance') point.best = max((x) => x.meters ?? 0);
    else {
      point.top = max((x) => x.weight ?? 0);
      point.best = max((x) => x.meters ?? 0);
    }
    return point;
  });
}
