import type {
  CustomExercise,
  Equipment,
  ExercisePref,
  LogType,
  Muscle,
  PlannedSet,
  Routine,
  RoutineExercise,
  SetKind,
  Workout,
  WorkoutExercise,
  WorkoutSet,
} from './types';
import { LOG_TYPES } from './types';
import { isDateKey } from './dates';
import { isId } from './ids';

/**
 * Checking data that comes from storage, a backup file or another device,
 * and putting it in one canonical form: a fixed field order and no
 * undefined fields, so two devices holding the same data produce
 * byte-identical sync parts.
 */

const MUSCLES = new Set<Muscle>([
  'abs', 'adductors', 'abductors', 'biceps', 'calves', 'chest', 'forearms', 'glutes', 'hamstrings',
  'lats', 'lower-back', 'mid-back', 'neck', 'quads', 'shoulders', 'traps', 'triceps',
]);
const EQUIPMENT = new Set<Equipment>([
  'barbell', 'dumbbell', 'kettlebell', 'cable', 'machine', 'bodyweight', 'bands', 'ez-bar',
  'medicine-ball', 'exercise-ball', 'foam-roll', 'other', 'none',
]);
const KINDS = new Set<SetKind>(['warmup', 'drop', 'failure']);

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const round = (n: number, places: number) => Math.round(n * 10 ** places) / 10 ** places;

/** A number within limits, rounded, or undefined. */
function amount(v: unknown, max: number, places: number): number | undefined {
  if (!finite(v) || v < 0) return undefined;
  return round(Math.min(v, max), places);
}

export const time = (v: unknown): number => (finite(v) && v > 0 ? Math.round(v) : 0);

export function text(v: unknown, max: number): string {
  return typeof v === 'string' ? v.slice(0, max) : '';
}

/** A name: trimmed, single spaces, not empty. */
export function name(v: unknown, fallback: string, max = 80): string {
  const t = typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '';
  return t || fallback;
}

export function isLogType(v: unknown): v is LogType {
  return LOG_TYPES.includes(v as LogType);
}

export const MAX_WEIGHT = 1500;
export const MAX_REPS = 9999;
export const MAX_SECONDS = 24 * 3600;
export const MAX_METERS = 1_000_000;

/** The numbers of a set, in a fixed order. */
function numbers(raw: any): Pick<WorkoutSet, 'weight' | 'reps' | 'seconds' | 'meters'> {
  const weight = amount(raw?.weight, MAX_WEIGHT, 3);
  const reps = amount(raw?.reps, MAX_REPS, 0);
  const seconds = amount(raw?.seconds, MAX_SECONDS, 0);
  const meters = amount(raw?.meters, MAX_METERS, 1);
  return {
    ...(weight !== undefined ? { weight } : {}),
    ...(reps !== undefined ? { reps } : {}),
    ...(seconds !== undefined ? { seconds } : {}),
    ...(meters !== undefined ? { meters } : {}),
  };
}

function extras(raw: any): Pick<WorkoutSet, 'kind' | 'rpe'> {
  const rpe = finite(raw?.rpe) && raw.rpe >= 1 && raw.rpe <= 10 ? round(raw.rpe, 1) : undefined;
  return {
    ...(KINDS.has(raw?.kind) ? { kind: raw.kind as SetKind } : {}),
    ...(rpe !== undefined ? { rpe } : {}),
  };
}

export function cleanSet(raw: any): WorkoutSet | undefined {
  if (!raw || typeof raw !== 'object' || !isId(raw.id)) return undefined;
  return { id: raw.id, ...numbers(raw), done: raw.done === true, ...extras(raw) };
}

export function cleanPlannedSet(raw: any): PlannedSet | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  return { ...numbers(raw), ...(KINDS.has(raw.kind) ? { kind: raw.kind as SetKind } : {}) };
}

const list = <T>(raw: unknown, clean: (x: any) => T | undefined, max: number): T[] =>
  (Array.isArray(raw) ? raw : []).slice(0, max).map(clean).filter((x): x is T => x !== undefined);

function exerciseFields(raw: any) {
  const rest = amount(raw.restSeconds, 3600, 0);
  return {
    id: raw.id as string,
    exerciseId: raw.exerciseId as string,
    name: name(raw.name, 'Exercise'),
    logType: (isLogType(raw.logType) ? raw.logType : 'weight_reps') as LogType,
    notes: text(raw.notes, 2000),
    ...(rest !== undefined ? { restSeconds: rest } : {}),
    ...(isId(raw.groupId) ? { groupId: raw.groupId as string } : {}),
  };
}

export function cleanWorkoutExercise(raw: any): WorkoutExercise | undefined {
  if (!raw || typeof raw !== 'object' || !isId(raw.id) || !isId(raw.exerciseId)) return undefined;
  return { ...exerciseFields(raw), sets: list(raw.sets, cleanSet, 100) };
}

export function cleanRoutineExercise(raw: any): RoutineExercise | undefined {
  if (!raw || typeof raw !== 'object' || !isId(raw.id) || !isId(raw.exerciseId)) return undefined;
  return { ...exerciseFields(raw), sets: list(raw.sets, cleanPlannedSet, 100) };
}

export function cleanWorkout(raw: any): Workout | undefined {
  if (!raw || typeof raw !== 'object' || !isId(raw.id) || !isDateKey(raw.date)) return undefined;
  const startedAt = time(raw.startedAt);
  if (!startedAt) return undefined;
  const endedAt = time(raw.endedAt);
  return {
    id: raw.id,
    name: name(raw.name, 'Workout'),
    ...(isId(raw.routineId) ? { routineId: raw.routineId as string } : {}),
    date: raw.date,
    startedAt,
    ...(endedAt ? { endedAt: Math.max(endedAt, startedAt) } : {}),
    notes: text(raw.notes, 4000),
    exercises: list(raw.exercises, cleanWorkoutExercise, 60),
    updatedAt: time(raw.updatedAt) || startedAt,
  };
}

export function cleanRoutine(raw: any): Routine | undefined {
  if (!raw || typeof raw !== 'object' || !isId(raw.id)) return undefined;
  return {
    id: raw.id,
    name: name(raw.name, 'Routine'),
    notes: text(raw.notes, 4000),
    position: finite(raw.position) ? raw.position : 0,
    exercises: list(raw.exercises, cleanRoutineExercise, 60),
    ...(isId(raw.programId) ? { programId: raw.programId as string } : {}),
    updatedAt: time(raw.updatedAt),
  };
}

const muscles = (raw: unknown) => [...new Set(Array.isArray(raw) ? raw.filter((m) => MUSCLES.has(m)) : [])] as Muscle[];

export function cleanCustomExercise(raw: any): CustomExercise | undefined {
  if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || !/^c-[a-z0-9]{4,40}$/.test(raw.id)) return undefined;
  return {
    id: raw.id,
    name: name(raw.name, 'My exercise'),
    primary: muscles(raw.primary),
    secondary: muscles(raw.secondary),
    equipment: EQUIPMENT.has(raw.equipment) ? raw.equipment : 'other',
    logType: isLogType(raw.logType) ? raw.logType : 'weight_reps',
    notes: text(raw.notes, 2000),
    updatedAt: time(raw.updatedAt),
  };
}

export function cleanPref(raw: any): ExercisePref | undefined {
  if (!raw || typeof raw !== 'object' || !isId(raw.id)) return undefined;
  const rest = amount(raw.restSeconds, 3600, 0);
  return {
    id: raw.id,
    favorite: raw.favorite === true,
    hidden: raw.hidden === true,
    ...(rest !== undefined ? { restSeconds: rest } : {}),
    updatedAt: time(raw.updatedAt),
  };
}

export { list as cleanList };
