import { useEffect, useState } from 'preact/hooks';
import type {
  AppData,
  CustomExercise,
  ExercisePref,
  Routine,
  Settings,
  SyncedSettings,
  SyncMeta,
  Workout,
} from './types';
import { SYNCED_SETTINGS } from './types';
import { isDateKey } from './dates';
import { isId } from './ids';
import { cleanCustomExercise, cleanList, cleanPref, cleanRoutine, cleanWorkout } from './schema';
import { DEFAULT_THEME, isThemeId } from './theme';

/**
 * All data lives in one JSON record in localStorage, saved on every change
 * (ported from the calorie tracker's store). Screens read it with useData();
 * changes go through the functions here, which stamp each changed item with
 * the time, for merging with other devices.
 */

export const STORAGE_KEY = 'gym-tracker:v1';

export const DEFAULT_SETTINGS: Settings = {
  units: 'kg',
  restSeconds: 120,
  autoRest: true,
  keepAwake: true,
  theme: DEFAULT_THEME,
  animations: true,
};

export function emptyMeta(): SyncMeta {
  return {
    deletedWorkouts: {},
    deletedRoutines: {},
    deletedExercises: {},
    settingsAt: { units: 0, restSeconds: 0, autoRest: 0, keepAwake: 0 },
  };
}

export function emptyData(): AppData {
  return { version: 1, workouts: [], routines: [], customExercises: [], prefs: [], settings: { ...DEFAULT_SETTINGS }, meta: emptyMeta() };
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function cleanTimes(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (raw && typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw)) if (isId(k) && finite(v) && v > 0) out[k] = v;
  }
  return out;
}

export function cleanMeta(raw: any): SyncMeta {
  const deletedWorkouts: SyncMeta['deletedWorkouts'] = {};
  if (raw?.deletedWorkouts && typeof raw.deletedWorkouts === 'object') {
    for (const [id, v] of Object.entries<any>(raw.deletedWorkouts)) {
      if (isId(id) && v && finite(v.at) && isDateKey(v.date)) deletedWorkouts[id] = { at: v.at, date: v.date };
    }
  }
  const at = emptyMeta().settingsAt;
  for (const k of SYNCED_SETTINGS) if (finite(raw?.settingsAt?.[k])) at[k] = raw.settingsAt[k];
  return {
    deletedWorkouts,
    deletedRoutines: cleanTimes(raw?.deletedRoutines),
    deletedExercises: cleanTimes(raw?.deletedExercises),
    settingsAt: at,
  };
}

/** Check one synced setting's value; undefined if it isn't valid. */
export function cleanSetting<K extends keyof SyncedSettings>(key: K, v: unknown): SyncedSettings[K] | undefined {
  switch (key) {
    case 'units':
      return (v === 'kg' || v === 'lb' ? v : undefined) as SyncedSettings[K] | undefined;
    case 'restSeconds':
      return (finite(v) && v >= 0 && v <= 3600 ? Math.round(v) : undefined) as SyncedSettings[K] | undefined;
    default:
      return (typeof v === 'boolean' ? v : undefined) as SyncedSettings[K] | undefined;
  }
}

export function cleanSettings(raw: any): Settings {
  const s = { ...DEFAULT_SETTINGS };
  for (const k of SYNCED_SETTINGS) {
    const v = cleanSetting(k, raw?.[k]);
    if (v !== undefined) (s as Record<string, unknown>)[k] = v;
  }
  if (isThemeId(raw?.theme)) s.theme = raw.theme;
  if (typeof raw?.animations === 'boolean') s.animations = raw.animations;
  return s;
}

/** Validate data loaded from storage or an imported backup. Throws if it isn't app data. */
export function parseData(raw: unknown): AppData {
  if (!raw || typeof raw !== 'object' || (raw as any).version !== 1) throw new Error('This is not Gym Tracker data.');
  const r = raw as any;
  return {
    version: 1,
    workouts: cleanList(r.workouts, cleanWorkout, 100_000),
    routines: cleanList(r.routines, cleanRoutine, 1000),
    customExercises: cleanList(r.customExercises, cleanCustomExercise, 5000),
    prefs: cleanList(r.prefs, cleanPref, 10_000),
    settings: cleanSettings(r.settings),
    meta: cleanMeta(r.meta),
  };
}

/** Read a backup file's contents. Only this app's backups are accepted (not, say, another app's with the same format version). */
export function parseBackup(text: string): AppData {
  let raw: any;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('That file is not a valid backup.');
  }
  if (!raw || raw.app !== 'gym-tracker') throw new Error('This file is not a Gym Tracker backup.');
  return parseData(raw);
}

function load(): AppData {
  try {
    const text = localStorage.getItem(STORAGE_KEY);
    if (text) return parseData(JSON.parse(text));
  } catch (err) {
    console.error('Could not read saved data', err);
  }
  return emptyData();
}

let data: AppData = load();
/** Bumped on every change, so a component can tell it missed one. */
let version = 0;
let saveError: string | null = null;
const listeners = new Set<() => void>();

function commit(next: AppData) {
  data = next;
  version++;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    saveError = null;
  } catch (err) {
    console.error('Could not save data', err);
    saveError =
      'Could not save: your device storage is full. Your latest changes are kept while the app is open — free up space, or export a backup in Settings.';
  }
  listeners.forEach((l) => l());
}

export function getData(): AppData {
  return data;
}

export function getSaveError(): string | null {
  return saveError;
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Re-read storage, e.g. after another tab changed it. */
export function reload() {
  data = load();
  version++;
  listeners.forEach((l) => l());
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEY) reload();
  });
}

export function useData(): AppData {
  const [, setTick] = useState(0);
  const seen = version;
  useEffect(() => {
    const unsubscribe = subscribe(() => setTick((t) => t + 1));
    // Effects run a moment after render; catch a change made in between.
    if (version !== seen) setTick((t) => t + 1);
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return data;
}

let lastStamp = 0;

/** Strictly increasing timestamps, so "most recent" is unambiguous. */
export function stamp(): number {
  lastStamp = Math.max(Date.now(), lastStamp + 1);
  return lastStamp;
}

/** Replace the data with a merged copy from another device. */
export function applyMerged(next: AppData) {
  commit(next);
}

// ── Workouts ──────────────────────────────────────────────────────────────

export function getWorkout(id: string): Workout | undefined {
  return data.workouts.find((w) => w.id === id);
}

/** Save a new or changed workout. */
export function putWorkout(workout: Workout): Workout {
  const saved = { ...workout, updatedAt: stamp() };
  const exists = data.workouts.some((w) => w.id === workout.id);
  commit({
    ...data,
    workouts: exists ? data.workouts.map((w) => (w.id === workout.id ? saved : w)) : [...data.workouts, saved],
  });
  return saved;
}

/** Deleting leaves a note of when, so other devices delete it too. */
export function deleteWorkout(id: string) {
  const gone = getWorkout(id);
  if (!gone) return;
  commit({
    ...data,
    workouts: data.workouts.filter((w) => w.id !== id),
    meta: { ...data.meta, deletedWorkouts: { ...data.meta.deletedWorkouts, [id]: { at: stamp(), date: gone.date } } },
  });
}

/** The workout in progress: the most recently started one that isn't finished. */
export function activeWorkout(source: AppData = data): Workout | undefined {
  let best: Workout | undefined;
  for (const w of source.workouts) if (!w.endedAt && (!best || w.startedAt > best.startedAt)) best = w;
  return best;
}

/** Finished workouts, newest first. */
export function finishedWorkouts(source: AppData = data): Workout[] {
  return source.workouts.filter((w) => w.endedAt).sort((a, b) => b.startedAt - a.startedAt);
}

// ── Routines ──────────────────────────────────────────────────────────────

export function getRoutine(id: string): Routine | undefined {
  return data.routines.find((r) => r.id === id);
}

/** Routines in their order. */
export function sortedRoutines(source: AppData = data): Routine[] {
  return [...source.routines].sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
}

export function putRoutine(routine: Routine): Routine {
  const saved = { ...routine, updatedAt: stamp() };
  const exists = data.routines.some((r) => r.id === routine.id);
  commit({ ...data, routines: exists ? data.routines.map((r) => (r.id === routine.id ? saved : r)) : [...data.routines, saved] });
  return saved;
}

export function putRoutines(routines: Routine[]) {
  const t = stamp();
  const byId = new Map(routines.map((r) => [r.id, { ...r, updatedAt: t }]));
  const kept = data.routines.map((r) => byId.get(r.id) ?? r);
  const added = [...byId.values()].filter((r) => !data.routines.some((x) => x.id === r.id));
  commit({ ...data, routines: [...kept, ...added] });
}

export function deleteRoutine(id: string) {
  if (!getRoutine(id)) return;
  commit({
    ...data,
    routines: data.routines.filter((r) => r.id !== id),
    meta: { ...data.meta, deletedRoutines: { ...data.meta.deletedRoutines, [id]: stamp() } },
  });
}

// ── Custom exercises and library preferences ──────────────────────────────

export function putCustomExercise(exercise: CustomExercise): CustomExercise {
  const saved = { ...exercise, updatedAt: stamp() };
  const exists = data.customExercises.some((e) => e.id === exercise.id);
  commit({
    ...data,
    customExercises: exists ? data.customExercises.map((e) => (e.id === exercise.id ? saved : e)) : [...data.customExercises, saved],
  });
  return saved;
}

/** Workouts that used it keep their copy of its name. */
export function deleteCustomExercise(id: string) {
  commit({
    ...data,
    customExercises: data.customExercises.filter((e) => e.id !== id),
    meta: { ...data.meta, deletedExercises: { ...data.meta.deletedExercises, [id]: stamp() } },
  });
}

export function prefFor(id: string, source: AppData = data): ExercisePref {
  return source.prefs.find((p) => p.id === id) ?? { id, favorite: false, hidden: false, updatedAt: 0 };
}

export function setPref(id: string, patch: Partial<Omit<ExercisePref, 'id' | 'updatedAt'>>) {
  const next: ExercisePref = { ...prefFor(id), ...patch, updatedAt: stamp() };
  if (next.restSeconds === undefined) delete next.restSeconds;
  const exists = data.prefs.some((p) => p.id === id);
  commit({ ...data, prefs: exists ? data.prefs.map((p) => (p.id === id ? next : p)) : [...data.prefs, next] });
}

// ── Settings ──────────────────────────────────────────────────────────────

export function updateSettings(patch: Partial<Settings>) {
  const settingsAt = { ...data.meta.settingsAt };
  for (const k of SYNCED_SETTINGS) if (k in patch && patch[k] !== data.settings[k]) settingsAt[k] = stamp();
  commit({ ...data, settings: { ...data.settings, ...patch }, meta: { ...data.meta, settingsAt } });
}

// ── Backups and deleting everything ───────────────────────────────────────

/** Backup file contents. It never holds secrets: the sync key lives elsewhere (see sync/state.ts). */
export function backupJson(source: AppData = data): string {
  return JSON.stringify({ app: 'gym-tracker', ...source }, null, 1);
}

/**
 * Restore a backup in place of what's on this device (keeping this device's
 * look). With sync on, it is then combined with the synced data like any
 * other device's: the newest edit of each item wins.
 */
export function restoreBackup(next: AppData) {
  commit({ ...next, settings: { ...next.settings, theme: data.settings.theme, animations: data.settings.animations } });
}

/** Delete every workout, routine, custom exercise and preference (on every synced device, too). */
export function clearAll() {
  const t = stamp();
  const meta = { ...data.meta };
  const deletedWorkouts = { ...meta.deletedWorkouts };
  for (const w of data.workouts) deletedWorkouts[w.id] = { at: t, date: w.date };
  const deletedRoutines = { ...meta.deletedRoutines };
  for (const r of data.routines) deletedRoutines[r.id] = t;
  const deletedExercises = { ...meta.deletedExercises };
  for (const e of data.customExercises) deletedExercises[e.id] = t;
  commit({
    ...data,
    workouts: [],
    routines: [],
    customExercises: [],
    prefs: data.prefs.map((p) => ({ id: p.id, favorite: false, hidden: false, updatedAt: t })),
    meta: { ...meta, deletedWorkouts, deletedRoutines, deletedExercises },
  });
}
