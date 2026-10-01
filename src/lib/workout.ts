import type { LogType, PlannedSet, Routine, RoutineExercise, Workout, WorkoutExercise, WorkoutSet } from './types';
import { newId, shortId } from './ids';
import { todayKey, toKey } from './dates';

/**
 * Workout logic as plain functions on plain objects: the screens save what
 * these return, and the Claude connector uses the same ones.
 */

export interface ExerciseRef {
  id: string;
  name: string;
  logType: LogType;
}

/** The numbers a set can have. */
export type SetNumbers = Pick<WorkoutSet, 'weight' | 'reps' | 'seconds' | 'meters'>;

const numbersOf = (s: SetNumbers | PlannedSet): SetNumbers => ({
  ...(s.weight !== undefined ? { weight: s.weight } : {}),
  ...(s.reps !== undefined ? { reps: s.reps } : {}),
  ...(s.seconds !== undefined ? { seconds: s.seconds } : {}),
  ...(s.meters !== undefined ? { meters: s.meters } : {}),
});

export function newSet(numbers: SetNumbers = {}): WorkoutSet {
  return { id: shortId(), ...numbersOf(numbers), done: false };
}

/** Which numbers matter for a way of logging, in the order they're shown. */
export function fieldsFor(logType: LogType): ('weight' | 'reps' | 'seconds' | 'meters')[] {
  switch (logType) {
    case 'weight_reps':
    case 'bodyweight':
      return ['weight', 'reps'];
    case 'duration':
      return ['seconds'];
    case 'distance':
      return ['meters', 'seconds'];
    case 'weight_distance':
      return ['weight', 'meters'];
  }
}

/** A completed set must have something in it. */
export function setHasNumbers(s: SetNumbers, logType: LogType): boolean {
  switch (logType) {
    case 'weight_reps':
    case 'bodyweight':
      return (s.reps ?? 0) > 0;
    case 'duration':
      return (s.seconds ?? 0) > 0;
    case 'distance':
      return (s.meters ?? 0) > 0 || (s.seconds ?? 0) > 0;
    case 'weight_distance':
      return (s.meters ?? 0) > 0;
  }
}

// ── History lookups ───────────────────────────────────────────────────────

/** The completed sets of an exercise from the last finished workout before `before` that has some. */
export function lastSets(workouts: Workout[], exerciseId: string, before = Infinity): WorkoutSet[] {
  let best: { at: number; sets: WorkoutSet[] } | null = null;
  for (const w of workouts) {
    if (!w.endedAt || w.startedAt >= before || (best && w.startedAt <= best.at)) continue;
    const sets = w.exercises.filter((e) => e.exerciseId === exerciseId).flatMap((e) => e.sets.filter((s) => s.done));
    if (sets.length) best = { at: w.startedAt, sets };
  }
  return best?.sets ?? [];
}

/** When each exercise was last done (finished workouts), for "recent" in the library. */
export function lastUsed(workouts: Workout[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const w of workouts) {
    for (const e of w.exercises) {
      if (!e.sets.some((s) => s.done)) continue;
      if ((out.get(e.exerciseId) ?? 0) < w.startedAt) out.set(e.exerciseId, w.startedAt);
    }
  }
  return out;
}

/**
 * Sets for an exercise about to be done: last time's numbers when there are
 * any (so one tap completes a set), otherwise the routine's targets, or
 * three empty sets.
 */
export function prefillSets(previous: WorkoutSet[], planned?: PlannedSet[]): WorkoutSet[] {
  const count = planned?.length || previous.length || 3;
  const out: WorkoutSet[] = [];
  for (let i = 0; i < count; i++) {
    const last = previous[i] ?? previous[previous.length - 1];
    const plan = planned?.[i];
    out.push(newSet(last ? numbersOf(last) : plan ? numbersOf(plan) : {}));
  }
  return out;
}

export function workoutExercise(ref: ExerciseRef, sets: WorkoutSet[], extra: Partial<WorkoutExercise> = {}): WorkoutExercise {
  return { id: shortId(), exerciseId: ref.id, name: ref.name, logType: ref.logType, notes: '', ...extra, sets };
}

// ── Starting ──────────────────────────────────────────────────────────────

export function emptyWorkout(now = Date.now(), name = defaultName(now)): Workout {
  return { id: newId(), name, date: toKey(new Date(now)), startedAt: now, notes: '', exercises: [], updatedAt: now };
}

/** "Morning workout", "Evening workout"… */
export function defaultName(now = Date.now()): string {
  const h = new Date(now).getHours();
  if (h < 5) return 'Night workout';
  if (h < 12) return 'Morning workout';
  if (h < 17) return 'Afternoon workout';
  if (h < 22) return 'Evening workout';
  return 'Night workout';
}

export function fromRoutine(routine: Routine, history: Workout[], now = Date.now()): Workout {
  return {
    ...emptyWorkout(now, routine.name),
    routineId: routine.id,
    notes: '',
    exercises: routine.exercises.map((re) =>
      workoutExercise({ id: re.exerciseId, name: re.name, logType: re.logType }, prefillSets(lastSets(history, re.exerciseId, now), re.sets), {
        notes: re.notes,
        ...(re.restSeconds !== undefined ? { restSeconds: re.restSeconds } : {}),
        ...(re.groupId ? { groupId: re.groupId } : {}),
      }),
    ),
  };
}

// ── Changing ──────────────────────────────────────────────────────────────

export function addExercises(w: Workout, refs: ExerciseRef[], history: Workout[]): Workout {
  const added = refs.map((r) => workoutExercise(r, prefillSets(lastSets(history, r.id, w.startedAt))));
  return { ...w, exercises: [...w.exercises, ...added] };
}

export function mapExercise(w: Workout, instanceId: string, fn: (e: WorkoutExercise) => WorkoutExercise): Workout {
  return { ...w, exercises: w.exercises.map((e) => (e.id === instanceId ? fn(e) : e)) };
}

export function removeExercise(w: Workout, instanceId: string): Workout {
  return { ...w, exercises: w.exercises.filter((e) => e.id !== instanceId) };
}

/** Move an exercise up (-1) or down (+1). */
export function moveItem<T>(items: T[], index: number, by: number): T[] {
  const to = index + by;
  if (index < 0 || index >= items.length || to < 0 || to >= items.length) return items;
  const next = [...items];
  const [item] = next.splice(index, 1);
  next.splice(to, 0, item);
  return next;
}

/**
 * Swap an exercise for another: the sets stay, done ones as they were;
 * sets not done yet take the new exercise's numbers from last time.
 */
export function swapExercise(w: Workout, instanceId: string, ref: ExerciseRef, history: Workout[]): Workout {
  const previous = lastSets(history, ref.id, w.startedAt);
  return mapExercise(w, instanceId, (e) => {
    const sameType = e.logType === ref.logType;
    const sets = e.sets.map((s, i) => {
      if (s.done && sameType) return s;
      const last = previous[i] ?? previous[previous.length - 1];
      return { ...newSet(last ? numbersOf(last) : sameType ? numbersOf(s) : {}), id: s.id, done: s.done && sameType };
    });
    return { ...e, exerciseId: ref.id, name: ref.name, logType: ref.logType, sets };
  });
}

/** Another set like the last one. */
export function addSet(e: WorkoutExercise): WorkoutExercise {
  const last = e.sets[e.sets.length - 1];
  return { ...e, sets: [...e.sets, newSet(last ? numbersOf(last) : {})] };
}

export function updateSet(e: WorkoutExercise, setId: string, patch: Partial<WorkoutSet>): WorkoutExercise {
  return {
    ...e,
    sets: e.sets.map((s) => {
      if (s.id !== setId) return s;
      const next = { ...s, ...patch };
      for (const k of ['weight', 'reps', 'seconds', 'meters'] as const) if (next[k] === undefined) delete next[k];
      return next;
    }),
  };
}

export function removeSet(e: WorkoutExercise, setId: string): WorkoutExercise {
  return { ...e, sets: e.sets.filter((s) => s.id !== setId) };
}

/**
 * Change one number of a set. Later sets that aren't done yet and had the
 * same number follow along, so changing 80 kg to 82.5 kg once does all of them.
 */
export function editSetNumber(
  e: WorkoutExercise,
  setId: string,
  field: 'weight' | 'reps' | 'seconds' | 'meters',
  value: number | undefined,
): WorkoutExercise {
  const index = e.sets.findIndex((s) => s.id === setId);
  if (index < 0) return e;
  const old = e.sets[index][field];
  let following = true;
  const sets = e.sets.map((s, i) => {
    if (i < index) return s;
    if (i > index) {
      following = following && !s.done && s[field] === old;
      if (!following) return s;
    }
    const next = { ...s, [field]: value };
    if (value === undefined) delete next[field];
    return next;
  });
  return { ...e, sets };
}

/** Check a set off, or undo it. */
export function toggleSet(e: WorkoutExercise, setId: string): WorkoutExercise {
  const index = e.sets.findIndex((s) => s.id === setId);
  if (index < 0) return e;
  const set = e.sets[index];
  return { ...e, sets: e.sets.map((s, i) => (i === index ? { ...s, done: !set.done } : s)) };
}

// ── Finishing ─────────────────────────────────────────────────────────────

export interface Unfinished {
  sets: number;
  exercises: number;
}

/** What's still open: sets not checked off, and exercises with nothing done. */
export function unfinished(w: Workout): Unfinished {
  return {
    sets: w.exercises.reduce((n, e) => n + e.sets.filter((s) => !s.done).length, 0),
    exercises: w.exercises.filter((e) => !e.sets.some((s) => s.done)).length,
  };
}

export function doneSetCount(w: Workout): number {
  return w.exercises.reduce((n, e) => n + e.sets.filter((s) => s.done).length, 0);
}

/** End the workout, leaving out sets that weren't done (and exercises left with none). */
export function finishWorkout(w: Workout, now = Date.now()): Workout {
  const exercises = w.exercises
    .map((e) => ({ ...e, sets: e.sets.filter((s) => s.done) }))
    .filter((e) => e.sets.length > 0);
  return { ...w, exercises, endedAt: Math.max(now, w.startedAt) };
}

/**
 * A workout left running for a long time (the app was closed mid-workout and
 * forgotten): ends at its last change rather than now.
 */
export const STALE_AFTER = 6 * 3600_000;

export function isStale(w: Workout, now = Date.now()): boolean {
  return !w.endedAt && now - w.updatedAt > STALE_AFTER;
}

// ── Routines ──────────────────────────────────────────────────────────────

export function routineExercise(ref: ExerciseRef, sets: PlannedSet[] = [{}, {}, {}]): RoutineExercise {
  return { id: shortId(), exerciseId: ref.id, name: ref.name, logType: ref.logType, notes: '', sets };
}

export function newRoutine(name: string, position: number): Routine {
  return { id: newId(), name, notes: '', position, exercises: [], updatedAt: 0 };
}

/** A routine made from a workout: its exercises and set counts, with the numbers done as targets. */
export function routineFromWorkout(w: Workout, position: number): Routine {
  return {
    ...newRoutine(w.name, position),
    exercises: w.exercises.map((e) =>
      routineExercise(
        { id: e.exerciseId, name: e.name, logType: e.logType },
        e.sets.filter((s) => s.done).map((s) => numbersOf(s)),
      ),
    ),
  };
}

/** Copy of a routine, placed right after it. */
export function duplicateRoutine(r: Routine, position: number): Routine {
  return {
    ...r,
    id: newId(),
    name: `${r.name} (copy)`.slice(0, 80),
    position,
    exercises: r.exercises.map((e) => ({ ...e, id: shortId(), sets: e.sets.map((s) => ({ ...s })) })),
    updatedAt: 0,
  };
}

/** Position for a routine placed between two others (or at an end). */
export function positionBetween(before: number | undefined, after: number | undefined): number {
  if (before === undefined && after === undefined) return 1;
  if (before === undefined) return after! - 1;
  if (after === undefined) return before + 1;
  return (before + after) / 2;
}

export { todayKey };
