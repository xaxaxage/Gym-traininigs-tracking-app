import { useEffect, useState } from 'preact/hooks';
import type { AppData } from '../types';
import { expand, fromCustom, type Exercise } from './catalog';

/**
 * The exercise list is its own chunk, downloaded (and cached for offline use)
 * the first time something needs it, so the start screen and the workout
 * stay light. Custom exercises come from the store and are added on top.
 */

let builtin: Exercise[] | null = null;
let loading: Promise<Exercise[]> | null = null;
let byId: Map<string, Exercise> | null = null;
const listeners = new Set<() => void>();

export function loadLibrary(): Promise<Exercise[]> {
  if (builtin) return Promise.resolve(builtin);
  loading ??= import('virtual:exercise-library')
    .then((m) => {
      builtin = m.default.map(expand);
      byId = new Map(builtin.map((e) => [e.id, e]));
      listeners.forEach((l) => l());
      return builtin;
    })
    .catch((err) => {
      loading = null;
      throw err;
    });
  return loading;
}

/** The built-in exercises if they're loaded already. */
export function libraryLoaded(): Exercise[] | null {
  return builtin;
}

/** A built-in exercise, if the library is loaded. */
export function builtinExercise(id: string): Exercise | undefined {
  return byId?.get(id);
}

/**
 * What you pick from. Everything, or with Settings → "Pick from: Mine" your
 * own exercises plus the built-in ones you've already used — so a past
 * exercise keeps its history instead of coming back as a copy.
 */
export function pickable(data: Pick<AppData, 'customExercises' | 'settings' | 'workouts' | 'routines'>, list: Exercise[]): Exercise[] {
  const all = allExercises(data, list);
  if (data.settings.library !== 'mine') return all;
  const used = new Set<string>();
  for (const w of data.workouts) for (const e of w.exercises) used.add(e.exerciseId);
  for (const r of data.routines) for (const e of r.exercises) used.add(e.exerciseId);
  return all.filter((e) => e.custom || used.has(e.id));
}

/** Built-in and custom exercises, custom ones first. */
export function allExercises(data: Pick<AppData, 'customExercises'>, list: Exercise[] = builtin ?? []): Exercise[] {
  return [...data.customExercises.map(fromCustom), ...list];
}

/** Any exercise by id: custom ones always, built-in ones once the library is loaded. */
export function exerciseById(data: Pick<AppData, 'customExercises'>, id: string): Exercise | undefined {
  const custom = data.customExercises.find((c) => c.id === id);
  return custom ? fromCustom(custom) : byId?.get(id);
}

export type LibraryState = { state: 'loading' } | { state: 'ready'; exercises: Exercise[] } | { state: 'error'; retry: () => void };

/** Loads the library when a screen that needs it opens. */
export function useLibrary(): LibraryState {
  const [, redraw] = useState(0);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const l = () => redraw((n) => n + 1);
    listeners.add(l);
    if (!builtin) loadLibrary().catch(() => setFailed(true));
    return () => {
      listeners.delete(l);
    };
  }, []);
  if (builtin) return { state: 'ready', exercises: builtin };
  if (failed)
    return {
      state: 'error',
      retry: () => {
        setFailed(false);
        loadLibrary().catch(() => setFailed(true));
      },
    };
  return { state: 'loading' };
}
