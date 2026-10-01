import type { Equipment, LogType, Muscle, PlannedSet, Routine, RoutineExercise, Units, Workout, WorkoutExercise, WorkoutSet } from '../src/lib/types';
import { LOG_TYPES } from '../src/lib/types';
import {
  deleteRoutine,
  deleteWorkout,
  finishedWorkouts,
  getData,
  getRoutine,
  getWorkout,
  putCustomExercise,
  putRoutine,
  putWorkout,
  sortedRoutines,
} from '../src/lib/store';
import { addDays, daysBetween, isDateKey, todayKey, toKey } from '../src/lib/dates';
import { newId, shortId } from '../src/lib/ids';
import { allExercises, loadLibrary } from '../src/lib/library/load';
import { EQUIPMENT, groupsOf, GROUPS, MUSCLES, type Exercise } from '../src/lib/library/catalog';
import { searchScored } from '../src/lib/library/search';
import { exerciseSessions, newRecords, progress, records, workoutTotals } from '../src/lib/stats';
import { recordText } from '../src/lib/records';
import { fieldsFor, positionBetween, setHasNumbers } from '../src/lib/workout';
import { fromKg, toKg } from '../src/lib/units';
import { MAX_METERS, MAX_REPS, MAX_SECONDS, MAX_WEIGHT } from '../src/lib/schema';
import { monthPartName } from '../src/lib/sync/parts';

/**
 * What each tool does to the training log, apart from talking to the relays.
 * Writes return the sync parts they touched, so only those get uploaded.
 * Weights go in and out in the user's unit (kg or lb, from the app's settings).
 */

/** A mistake in the request, explained so Claude can fix it and call again. */
export class ToolError extends Error {}

export interface WriteResult<T> {
  result: T;
  touched: string[];
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const units = (): Units => getData().settings.units;
const weightOut = (kg: number | undefined) => (kg === undefined ? undefined : fromKg(kg, units()));
const pad = (n: number) => String(n).padStart(2, '0');
const clock = (ms: number) => {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export function checkDate(date: string | undefined): string {
  if (date === undefined || date === '' || date === 'today') return todayKey();
  if (date === 'yesterday') return addDays(todayKey(), -1);
  if (!isDateKey(date)) throw new ToolError(`"${date}" is not a date. Use YYYY-MM-DD.`);
  if (date > todayKey()) throw new ToolError(`${date} is in the future.`);
  return date;
}

function checkTime(time: string | undefined): [number, number] | undefined {
  if (time === undefined || time === '') return undefined;
  const m = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!m || +m[1] > 23 || +m[2] > 59) throw new ToolError(`"${time}" is not a time. Use HH:MM (24-hour).`);
  return [+m[1], +m[2]];
}

// ── Exercises ─────────────────────────────────────────────────────────────

async function library(): Promise<Exercise[]> {
  return allExercises(getData(), await loadLibrary());
}

function exerciseOut(e: Exercise) {
  return {
    id: e.id,
    name: e.name,
    primary_muscles: e.primary,
    ...(e.secondary.length ? { secondary_muscles: e.secondary } : {}),
    muscle_groups: groupsOf(e),
    equipment: e.equipment,
    logging: e.logType,
    ...(e.popular ? { popular: true } : {}),
    ...(e.custom ? { custom: true } : {}),
  };
}

/**
 * An exercise named by Claude: its id, its name, an alias ("RDL") or a clear
 * search match ("bench" → Barbell Bench Press). Anything less clear is an
 * error that says how to find it.
 */
export async function resolveExercise(name: string): Promise<Exercise> {
  const all = await library();
  const wanted = name.trim();
  if (!wanted) throw new ToolError('Name the exercise (or give its id from search_exercises).');
  const byId = all.find((e) => e.id === wanted);
  if (byId) return byId;
  const lower = wanted.toLowerCase();
  const byName = all.find((e) => e.name.toLowerCase() === lower);
  if (byName) return byName;
  const best = searchScored(all, wanted, { limit: 3 });
  if (best[0] && best[0].tier >= 2) return best[0].exercise;
  const ideas = best.map((b) => b.exercise.name);
  throw new ToolError(
    `No exercise clearly matches "${wanted}".${ideas.length ? ` Close ones: ${ideas.join(', ')}.` : ''} Use search_exercises to find it, or create_exercise if it's not in the library.`,
  );
}

export async function findExercises(input: { query?: string; muscle_group?: string; equipment?: string; limit?: number }) {
  const all = await library();
  const prefs = getData().prefs;
  const hidden = new Set(prefs.filter((p) => p.hidden).map((p) => p.id));
  const favorites = new Set(prefs.filter((p) => p.favorite).map((p) => p.id));
  const group = input.muscle_group ? (GROUPS.find((g) => g === input.muscle_group) ?? null) : null;
  if (input.muscle_group && !group) throw new ToolError(`muscle_group is one of: ${GROUPS.join(', ')}.`);
  const equipment = input.equipment ? ((EQUIPMENT as string[]).includes(input.equipment) ? (input.equipment as Equipment) : null) : null;
  if (input.equipment && !equipment) throw new ToolError(`equipment is one of: ${EQUIPMENT.join(', ')}.`);
  const limit = Math.min(50, Math.max(1, input.limit ?? 15));
  const found = searchScored(all, input.query ?? '', { group, equipment, favorites, hidden, includeHidden: true });
  return {
    total: found.length,
    results: found.slice(0, limit).map((s) => ({
      ...exerciseOut(s.exercise),
      ...(favorites.has(s.exercise.id) ? { favorite: true } : {}),
      ...(hidden.has(s.exercise.id) ? { hidden_in_app: true } : {}),
    })),
  };
}

export function createExercise(input: { name: string; primary_muscles: string[]; secondary_muscles?: string[]; equipment?: string; logging?: string }) {
  const name = input.name.trim().replace(/\s+/g, ' ').slice(0, 80);
  if (!name) throw new ToolError('Give the exercise a name.');
  const muscles = (list: string[] = []) => {
    const bad = list.filter((m) => !(MUSCLES as string[]).includes(m));
    if (bad.length) throw new ToolError(`Unknown muscles: ${bad.join(', ')}. Use: ${MUSCLES.join(', ')}.`);
    return [...new Set(list)] as Muscle[];
  };
  const primary = muscles(input.primary_muscles);
  if (primary.length === 0) throw new ToolError('Give at least one primary muscle.');
  const equipment = (input.equipment ?? 'other') as Equipment;
  if (!EQUIPMENT.includes(equipment)) throw new ToolError(`equipment is one of: ${EQUIPMENT.join(', ')}.`);
  const logType = (input.logging ?? 'weight_reps') as LogType;
  if (!LOG_TYPES.includes(logType)) throw new ToolError(`logging is one of: ${LOG_TYPES.join(', ')}.`);
  const lower = name.toLowerCase();
  if (getData().customExercises.some((c) => c.name.toLowerCase() === lower)) throw new ToolError(`There already is a custom exercise called "${name}".`);
  const saved = putCustomExercise({
    id: `c-${newId(12)}`,
    name,
    primary,
    secondary: muscles(input.secondary_muscles).filter((m) => !primary.includes(m)),
    equipment,
    logType,
    notes: '',
    updatedAt: 0,
  });
  return {
    result: { created: { id: saved.id, name: saved.name, logging: saved.logType, equipment: saved.equipment, primary_muscles: saved.primary } },
    touched: ['library'],
  } satisfies WriteResult<unknown>;
}

// ── Reading workouts ──────────────────────────────────────────────────────

function setOut(s: WorkoutSet, i: number, logType: LogType) {
  const weight = weightOut(s.weight);
  return {
    set: i + 1,
    ...(weight !== undefined ? { [logType === 'bodyweight' ? 'added_weight' : 'weight']: weight } : {}),
    ...(s.reps !== undefined ? { reps: s.reps } : {}),
    ...(s.seconds !== undefined ? { seconds: s.seconds } : {}),
    ...(s.meters !== undefined ? { distance_m: s.meters } : {}),
    ...(s.done ? {} : { done: false }),
  };
}

function bestSet(e: WorkoutExercise): string {
  const done = e.sets.filter((s) => s.done);
  if (!done.length) return 'no sets done';
  const u = units();
  const n = `${done.length} ${done.length === 1 ? 'set' : 'sets'}`;
  if (e.logType === 'weight_reps' || e.logType === 'bodyweight') {
    const top = [...done].sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0) || (b.reps ?? 0) - (a.reps ?? 0))[0];
    const w = weightOut(top.weight);
    return `${n}, best ${w ? `${e.logType === 'bodyweight' ? '+' : ''}${w} ${u} × ` : ''}${top.reps ?? 0}`;
  }
  if (e.logType === 'duration') return `${n}, longest ${Math.max(...done.map((s) => s.seconds ?? 0))} s`;
  return `${n}, farthest ${Math.max(...done.map((s) => s.meters ?? 0))} m`;
}

function workoutSummary(w: Workout) {
  const t = workoutTotals(w);
  return {
    id: w.id,
    name: w.name,
    date: w.date,
    start: clock(w.startedAt),
    ...(w.endedAt ? { duration_min: Math.round(t.duration / 60_000) } : { in_progress: true }),
    sets: t.sets,
    volume: Math.round(fromKg(t.volume, units())),
    exercises: w.exercises.map((e) => `${e.name}: ${bestSet(e)}`),
  };
}

export function workoutsReport(input: { date?: string; from?: string; to?: string }) {
  let from: string;
  let to: string;
  if (input.date) from = to = checkDate(input.date);
  else {
    to = input.to ? checkDate(input.to) : todayKey();
    from = input.from ? checkDate(input.from) : addDays(to, -13);
  }
  const span = daysBetween(from, to);
  if (span < 0) throw new ToolError('"from" must not be after "to".');
  if (span > 365) throw new ToolError('Ask for at most a year at a time.');
  const list = getData()
    .workouts.filter((w) => w.date >= from && w.date <= to)
    .sort((a, b) => a.startedAt - b.startedAt);
  const totals = list.reduce(
    (acc, w) => {
      const t = workoutTotals(w);
      return { sets: acc.sets + t.sets, volume: acc.volume + t.volume };
    },
    { sets: 0, volume: 0 },
  );
  return {
    units: units(),
    today: todayKey(),
    from,
    to,
    workouts: list.map(workoutSummary),
    totals: { workouts: list.length, sets: totals.sets, volume: Math.round(fromKg(totals.volume, units())) },
  };
}

function needWorkout(id: string): Workout {
  const w = getWorkout(id);
  if (!w) throw new ToolError(`There is no workout "${id}". Use get_workouts to see the workouts and their ids.`);
  return w;
}

export function workoutReport(id: string) {
  const w = needWorkout(id);
  const found = w.endedAt ? newRecords(w, getData().workouts) : [];
  return {
    units: units(),
    workout: {
      ...workoutSummary(w),
      ...(w.endedAt ? { end: clock(w.endedAt) } : {}),
      ...(w.notes ? { notes: w.notes } : {}),
      ...(w.routineId ? { routine: getRoutine(w.routineId)?.name } : {}),
      exercises: w.exercises.map((e, i) => ({
        exercise: i + 1,
        exercise_id: e.exerciseId,
        name: e.name,
        logging: e.logType,
        ...(e.notes ? { notes: e.notes } : {}),
        sets: e.sets.map((s, j) => setOut(s, j, e.logType)),
      })),
      ...(found.length ? { records: found.map((r) => `${r.name} — ${recordText(r, units())}`) } : {}),
    },
  };
}

export async function progressReport(input: { exercise: string; from?: string; to?: string }) {
  const ex = await resolveExercise(input.exercise);
  const from = input.from ? checkDate(input.from) : '0000-01-01';
  const to = input.to ? checkDate(input.to) : todayKey();
  const sessions = exerciseSessions(getData().workouts, ex.id).filter((s) => s.date >= from && s.date <= to);
  const u = units();
  const w = (kg?: number) => (kg === undefined ? undefined : fromKg(kg, u));
  const r = records(sessions);
  const points = progress(sessions);
  const first = points[0];
  const last = points[points.length - 1];
  return {
    units: u,
    exercise: { id: ex.id, name: ex.name, logging: ex.logType },
    workouts_with_it: sessions.length,
    ...(sessions.length === 0
      ? { note: `No completed sets of ${ex.name}${input.from || input.to ? ' in that period' : ' yet'}.` }
      : {
          records: {
            ...(r.bestE1rm ? { best_estimated_1rm: { value: r1(w(r.bestE1rm.value)!), from: `${w(r.bestE1rm.weight)} × ${r.bestE1rm.reps}`, date: r.bestE1rm.date } } : {}),
            ...(r.heaviest ? { heaviest: { weight: w(r.heaviest.value), reps: r.heaviest.reps, date: r.heaviest.date } } : {}),
            ...(r.bestVolume?.value ? { most_volume_in_a_workout: { value: Math.round(w(r.bestVolume.value)!), date: r.bestVolume.date } } : {}),
            ...(r.mostReps ? { most_reps_in_a_set: { reps: r.mostReps.value, ...(r.mostReps.weight ? { weight: w(r.mostReps.weight) } : {}), date: r.mostReps.date } } : {}),
            ...(r.longest ? { longest_seconds: { value: r.longest.value, date: r.longest.date } } : {}),
            ...(r.farthest ? { farthest_m: { value: r.farthest.value, date: r.farthest.date } } : {}),
            ...(r.repsAtWeight.length ? { most_reps_at_each_weight: r.repsAtWeight.slice(0, 10).map((m) => ({ weight: w(m.weight), reps: m.value, date: m.date })) } : {}),
          },
          trend: points.slice(-20).map((p) => ({
            date: p.date,
            ...(p.e1rm !== undefined ? { estimated_1rm: r1(w(p.e1rm)!) } : {}),
            ...(p.top !== undefined ? { top_weight: w(p.top) } : {}),
            ...(p.best !== undefined ? { best: p.best } : {}),
          })),
          ...(points.length >= 2 && first.e1rm !== undefined && last.e1rm !== undefined
            ? { change: { from: first.date, to: last.date, estimated_1rm: r1(w(last.e1rm)! - w(first.e1rm)!), top_weight: r1(w(last.top)! - w(first.top)!) } }
            : {}),
        }),
    estimated_1rm_formula: 'Epley: weight × (1 + reps / 30); a single rep counts as its weight',
  };
}

// ── Logging and changing workouts ─────────────────────────────────────────

export interface SetInput {
  weight?: number;
  reps?: number;
  seconds?: number;
  distance_m?: number;
  /** The same set this many times. */
  count?: number;
}

export interface ExerciseInput {
  exercise: string;
  sets: SetInput[];
  notes?: string;
}

const inRange = (v: number | undefined, max: number, what: string) => {
  if (v === undefined) return undefined;
  if (!Number.isFinite(v) || v < 0 || v > max) throw new ToolError(`${what} must be between 0 and ${max}.`);
  return v;
};

function setsFrom(input: SetInput[], logType: LogType, unit: Units, name: string, done: boolean): WorkoutSet[] {
  const out: WorkoutSet[] = [];
  for (const s of input) {
    const count = Math.min(30, Math.max(1, Math.round(s.count ?? 1)));
    const weight = inRange(s.weight, MAX_WEIGHT * 2.5, 'weight');
    const numbers = {
      ...(weight !== undefined ? { weight: Math.min(MAX_WEIGHT, toKg(weight, unit)) } : {}),
      ...(s.reps !== undefined ? { reps: Math.round(inRange(s.reps, MAX_REPS, 'reps')!) } : {}),
      ...(s.seconds !== undefined ? { seconds: Math.round(inRange(s.seconds, MAX_SECONDS, 'seconds')!) } : {}),
      ...(s.distance_m !== undefined ? { meters: inRange(s.distance_m, MAX_METERS, 'distance_m')! } : {}),
    };
    if (!setHasNumbers(numbers, logType)) {
      const need = fieldsFor(logType).map((f) => (f === 'meters' ? 'distance_m' : f)).join(' and ');
      throw new ToolError(`${name} is logged as ${logType}: each set needs ${need === 'weight and reps' ? 'reps (and weight)' : need}.`);
    }
    for (let i = 0; i < count; i++) out.push({ id: shortId(), ...numbers, done });
  }
  if (out.length === 0) throw new ToolError(`Give at least one set for ${name}.`);
  if (out.length > 100) throw new ToolError(`At most 100 sets for ${name}.`);
  return out;
}

async function exercisesFrom(input: ExerciseInput[], unit: Units, done = true): Promise<WorkoutExercise[]> {
  const out: WorkoutExercise[] = [];
  for (const item of input) {
    const ex = await resolveExercise(item.exercise);
    out.push({
      id: shortId(),
      exerciseId: ex.id,
      name: ex.name,
      logType: ex.logType,
      notes: (item.notes ?? '').slice(0, 2000),
      sets: setsFrom(item.sets ?? [], ex.logType, unit, ex.name, done),
    });
  }
  return out;
}

function whenFor(date: string, start: string | undefined, minutes: number): { startedAt: number; endedAt: number } {
  const time = checkTime(start);
  const length = minutes * 60_000;
  if (time) {
    const d = new Date(`${date}T00:00:00`);
    d.setHours(time[0], time[1], 0, 0);
    return { startedAt: d.getTime(), endedAt: d.getTime() + length };
  }
  if (date === todayKey()) {
    const end = Date.now();
    // Started today, even when it was a long one logged just after midnight.
    const startedAt = Math.max(end - length, new Date(`${date}T00:00:00`).getTime());
    return { startedAt, endedAt: startedAt + length };
  }
  const d = new Date(`${date}T18:00:00`);
  return { startedAt: d.getTime(), endedAt: d.getTime() + length };
}

const checkMinutes = (m: number | undefined) => {
  if (m === undefined) return 60;
  if (!Number.isFinite(m) || m < 1 || m > 600) throw new ToolError('duration_minutes must be between 1 and 600.');
  return Math.round(m);
};

const unitOf = (u: string | undefined): Units => (u === 'kg' || u === 'lb' ? u : units());

export async function logWorkout(input: {
  date?: string;
  start_time?: string;
  duration_minutes?: number;
  name?: string;
  notes?: string;
  unit?: 'kg' | 'lb';
  exercises: ExerciseInput[];
}) {
  const date = checkDate(input.date);
  if (!input.exercises?.length) throw new ToolError('Give at least one exercise with its sets.');
  if (input.exercises.length > 40) throw new ToolError('At most 40 exercises in a workout.');
  const exercises = await exercisesFrom(input.exercises, unitOf(input.unit));
  const { startedAt, endedAt } = whenFor(date, input.start_time, checkMinutes(input.duration_minutes));
  const workout: Workout = {
    id: newId(),
    name: (input.name ?? '').trim().slice(0, 80) || 'Workout',
    date: toKey(new Date(startedAt)),
    startedAt,
    endedAt,
    notes: (input.notes ?? '').slice(0, 4000),
    exercises,
    updatedAt: 0,
  };
  const saved = putWorkout(workout);
  const found = newRecords(saved, getData().workouts);
  return {
    result: {
      units: units(),
      logged: workoutSummary(saved),
      ...(found.length ? { new_records: found.map((r) => `${r.name} — ${recordText(r, units())}`) } : {}),
      exercises_used: exercises.map((e) => ({ asked: input.exercises[exercises.indexOf(e)].exercise, logged_as: e.name, exercise_id: e.exerciseId })),
    },
    touched: [monthPartName(saved.date)],
  } satisfies WriteResult<unknown>;
}

export async function editWorkout(input: {
  id: string;
  name?: string;
  notes?: string;
  date?: string;
  start_time?: string;
  duration_minutes?: number;
  unit?: 'kg' | 'lb';
  add_exercises?: ExerciseInput[];
  remove_exercise?: number;
}) {
  const w = needWorkout(input.id);
  const next: Workout = { ...w };
  if (input.name !== undefined) {
    const name = input.name.trim().slice(0, 80);
    if (!name) throw new ToolError('The name cannot be empty.');
    next.name = name;
  }
  if (input.notes !== undefined) next.notes = input.notes.slice(0, 4000);
  if (input.date !== undefined || input.start_time !== undefined || input.duration_minutes !== undefined) {
    const date = input.date !== undefined ? checkDate(input.date) : w.date;
    const minutes = input.duration_minutes !== undefined ? checkMinutes(input.duration_minutes) : Math.max(1, Math.round(((w.endedAt ?? Date.now()) - w.startedAt) / 60_000));
    const time = input.start_time ?? clock(w.startedAt);
    const when = whenFor(date, time, minutes);
    next.startedAt = when.startedAt;
    next.date = toKey(new Date(when.startedAt));
    if (w.endedAt) next.endedAt = when.endedAt;
  }
  if (input.remove_exercise !== undefined) {
    const i = input.remove_exercise - 1;
    if (!next.exercises[i]) throw new ToolError(`This workout has no exercise ${input.remove_exercise} (it has ${next.exercises.length}).`);
    next.exercises = next.exercises.filter((_, j) => j !== i);
  }
  if (input.add_exercises?.length) next.exercises = [...next.exercises, ...(await exercisesFrom(input.add_exercises, unitOf(input.unit)))];
  if (JSON.stringify(next) === JSON.stringify(w)) throw new ToolError('Nothing to change: give name, notes, date, start_time, duration_minutes, add_exercises or remove_exercise.');
  const saved = putWorkout(next);
  return {
    result: { units: units(), updated: workoutSummary(saved) },
    touched: [...new Set([monthPartName(w.date), monthPartName(saved.date)])],
  } satisfies WriteResult<unknown>;
}

export function removeWorkout(id: string) {
  const w = needWorkout(id);
  deleteWorkout(id);
  return { result: { deleted: workoutSummary(w) }, touched: [monthPartName(w.date)] } satisfies WriteResult<unknown>;
}

function locateSet(input: { workout_id: string; exercise: number; set: number }) {
  const w = needWorkout(input.workout_id);
  const ei = input.exercise - 1;
  const e = w.exercises[ei];
  if (!e) throw new ToolError(`This workout has no exercise ${input.exercise} (it has ${w.exercises.length}). Use get_workout to see them.`);
  const si = input.set - 1;
  if (!e.sets[si]) throw new ToolError(`${e.name} has no set ${input.set} (it has ${e.sets.length}).`);
  return { w, e, ei, si };
}

export function editSet(input: { workout_id: string; exercise: number; set: number; weight?: number; reps?: number; seconds?: number; distance_m?: number; done?: boolean; unit?: 'kg' | 'lb' }) {
  const { w, e, ei, si } = locateSet(input);
  const unit = unitOf(input.unit);
  const old = e.sets[si];
  const weight = inRange(input.weight, MAX_WEIGHT * 2.5, 'weight');
  const set: WorkoutSet = {
    ...old,
    ...(weight !== undefined ? { weight: Math.min(MAX_WEIGHT, toKg(weight, unit)) } : {}),
    ...(input.reps !== undefined ? { reps: Math.round(inRange(input.reps, MAX_REPS, 'reps')!) } : {}),
    ...(input.seconds !== undefined ? { seconds: Math.round(inRange(input.seconds, MAX_SECONDS, 'seconds')!) } : {}),
    ...(input.distance_m !== undefined ? { meters: inRange(input.distance_m, MAX_METERS, 'distance_m')! } : {}),
    ...(input.done !== undefined ? { done: input.done } : {}),
  };
  if (JSON.stringify(set) === JSON.stringify(old)) throw new ToolError('Nothing to change: give weight, reps, seconds, distance_m or done.');
  const exercises = w.exercises.map((x, i) => (i === ei ? { ...x, sets: x.sets.map((s, j) => (j === si ? set : s)) } : x));
  const saved = putWorkout({ ...w, exercises });
  return {
    result: { units: units(), workout_id: saved.id, exercise: e.name, set: setOut(set, si, e.logType) },
    touched: [monthPartName(saved.date)],
  } satisfies WriteResult<unknown>;
}

export function removeSet(input: { workout_id: string; exercise: number; set: number }) {
  const { w, e, ei, si } = locateSet(input);
  const sets = e.sets.filter((_, j) => j !== si);
  // An exercise left without sets goes too.
  const exercises = sets.length ? w.exercises.map((x, i) => (i === ei ? { ...x, sets } : x)) : w.exercises.filter((_, i) => i !== ei);
  const saved = putWorkout({ ...w, exercises });
  return {
    result: { deleted: `${e.name}, set ${input.set}`, ...(sets.length ? {} : { note: `${e.name} had no sets left, so it was removed from the workout.` }), workout: workoutSummary(saved) },
    touched: [monthPartName(saved.date)],
  } satisfies WriteResult<unknown>;
}

// ── Routines ──────────────────────────────────────────────────────────────

export interface RoutineExerciseInput {
  exercise: string;
  /** How many sets (default 3). */
  sets?: number;
  /** Target reps: one number for every set, or one per set. */
  reps?: number | number[];
  weight?: number;
  seconds?: number;
  distance_m?: number;
  rest_seconds?: number;
  notes?: string;
}

function plannedOut(s: PlannedSet, i: number, logType: LogType) {
  const weight = weightOut(s.weight);
  return {
    set: i + 1,
    ...(weight !== undefined ? { [logType === 'bodyweight' ? 'added_weight' : 'weight']: weight } : {}),
    ...(s.reps !== undefined ? { reps: s.reps } : {}),
    ...(s.seconds !== undefined ? { seconds: s.seconds } : {}),
    ...(s.meters !== undefined ? { distance_m: s.meters } : {}),
  };
}

function routineOut(r: Routine) {
  const last = finishedWorkouts(getData()).find((w) => w.routineId === r.id);
  return {
    id: r.id,
    name: r.name,
    ...(r.notes ? { notes: r.notes } : {}),
    exercises: r.exercises.map((e, i) => ({
      exercise: i + 1,
      exercise_id: e.exerciseId,
      name: e.name,
      logging: e.logType,
      ...(e.restSeconds !== undefined ? { rest_seconds: e.restSeconds } : {}),
      ...(e.notes ? { notes: e.notes } : {}),
      sets: e.sets.map((s, j) => plannedOut(s, j, e.logType)),
    })),
    ...(last ? { last_done: last.date } : {}),
  };
}

export function routinesReport() {
  return { units: units(), routines: sortedRoutines(getData()).map(routineOut) };
}

async function routineExercisesFrom(input: RoutineExerciseInput[], unit: Units): Promise<RoutineExercise[]> {
  const out: RoutineExercise[] = [];
  for (const item of input) {
    const ex = await resolveExercise(item.exercise);
    const count = Math.min(30, Math.max(1, Math.round(item.sets ?? (Array.isArray(item.reps) ? item.reps.length : 3))));
    const reps = (i: number) => (Array.isArray(item.reps) ? item.reps[Math.min(i, item.reps.length - 1)] : item.reps);
    const weight = inRange(item.weight, MAX_WEIGHT * 2.5, 'weight');
    const rest = inRange(item.rest_seconds, 3600, 'rest_seconds');
    out.push({
      id: shortId(),
      exerciseId: ex.id,
      name: ex.name,
      logType: ex.logType,
      notes: (item.notes ?? '').slice(0, 2000),
      ...(rest !== undefined ? { restSeconds: Math.round(rest) } : {}),
      sets: Array.from({ length: count }, (_, i) => {
        const r = reps(i);
        return {
          ...(weight !== undefined ? { weight: Math.min(MAX_WEIGHT, toKg(weight, unit)) } : {}),
          ...(r !== undefined ? { reps: Math.round(inRange(r, MAX_REPS, 'reps')!) } : {}),
          ...(item.seconds !== undefined ? { seconds: Math.round(inRange(item.seconds, MAX_SECONDS, 'seconds')!) } : {}),
          ...(item.distance_m !== undefined ? { meters: inRange(item.distance_m, MAX_METERS, 'distance_m')! } : {}),
        };
      }),
    });
  }
  return out;
}

export async function createRoutine(input: { name: string; notes?: string; unit?: 'kg' | 'lb'; exercises: RoutineExerciseInput[] }) {
  const name = input.name.trim().slice(0, 80);
  if (!name) throw new ToolError('Give the routine a name.');
  if (input.exercises.length > 40) throw new ToolError('At most 40 exercises in a routine.');
  const exercises = await routineExercisesFrom(input.exercises, unitOf(input.unit));
  const last = sortedRoutines(getData()).at(-1);
  const saved = putRoutine({ id: newId(), name, notes: (input.notes ?? '').slice(0, 4000), position: positionBetween(last?.position, undefined), exercises, updatedAt: 0 });
  return { result: { units: units(), created: routineOut(saved) }, touched: ['routines'] } satisfies WriteResult<unknown>;
}

function needRoutine(id: string): Routine {
  const r = getRoutine(id);
  if (!r) throw new ToolError(`There is no routine "${id}". Use list_routines to see them and their ids.`);
  return r;
}

export async function editRoutine(input: { id: string; name?: string; notes?: string; unit?: 'kg' | 'lb'; exercises?: RoutineExerciseInput[] }) {
  const r = needRoutine(input.id);
  const next: Routine = { ...r };
  if (input.name !== undefined) {
    const name = input.name.trim().slice(0, 80);
    if (!name) throw new ToolError('The name cannot be empty.');
    next.name = name;
  }
  if (input.notes !== undefined) next.notes = input.notes.slice(0, 4000);
  if (input.exercises !== undefined) next.exercises = await routineExercisesFrom(input.exercises, unitOf(input.unit));
  if (JSON.stringify(next) === JSON.stringify(r)) throw new ToolError('Nothing to change: give name, notes or exercises (the whole new list).');
  const saved = putRoutine(next);
  return { result: { units: units(), updated: routineOut(saved) }, touched: ['routines'] } satisfies WriteResult<unknown>;
}

export function removeRoutine(id: string) {
  const r = needRoutine(id);
  deleteRoutine(id);
  return { result: { deleted: { id: r.id, name: r.name } }, touched: ['routines'] } satisfies WriteResult<unknown>;
}
