import { readFileSync } from 'node:fs';
import type { Plugin } from 'vite';
import { ALIASES, EXTRAS, LOG_TYPE_FIXES, POPULAR, RENAMES, type LogTypeName } from '../data/curation.ts';

/**
 * Turns the pinned free-exercise-db (data/free-exercise-db.json) and the
 * hand-made additions (data/curation.ts) into two small modules the app
 * loads only when it needs them:
 *
 * - virtual:exercise-library — every exercise without its instructions, for
 *   browsing and search (about a tenth of the dataset's size);
 * - virtual:exercise-instructions — the step-by-step instructions, for the
 *   exercise page.
 */

interface SourceExercise {
  id: string;
  name: string;
  force: string | null;
  level: string;
  mechanic: string | null;
  equipment: string | null;
  primaryMuscles: string[];
  secondaryMuscles: string[];
  instructions: string[];
  category: string;
  images: string[];
}

/** One exercise in the compact module (see src/lib/library/load.ts). */
export interface CompactExercise {
  i: string;
  n: string;
  p: string[];
  s: string[];
  e: string;
  l: string;
  m?: string;
  f?: string;
  c: string;
  t: LogTypeName;
  g: number;
  r?: number;
  a?: string[];
}

const MUSCLES: Record<string, string> = {
  abdominals: 'abs',
  adductors: 'adductors',
  abductors: 'abductors',
  biceps: 'biceps',
  calves: 'calves',
  chest: 'chest',
  forearms: 'forearms',
  glutes: 'glutes',
  hamstrings: 'hamstrings',
  lats: 'lats',
  'lower back': 'lower-back',
  'middle back': 'mid-back',
  neck: 'neck',
  quadriceps: 'quads',
  shoulders: 'shoulders',
  traps: 'traps',
  triceps: 'triceps',
};

const EQUIPMENT: Record<string, string> = {
  barbell: 'barbell',
  dumbbell: 'dumbbell',
  kettlebells: 'kettlebell',
  cable: 'cable',
  machine: 'machine',
  'body only': 'bodyweight',
  bands: 'bands',
  'e-z curl bar': 'ez-bar',
  'medicine ball': 'medicine-ball',
  'exercise ball': 'exercise-ball',
  'foam roll': 'foam-roll',
  other: 'other',
};

const muscle = (m: string) => {
  const out = MUSCLES[m];
  if (!out) throw new Error(`Unknown muscle "${m}" in the exercise dataset`);
  return out;
};
const equipment = (e: string | null) => (e === null ? 'none' : (EQUIPMENT[e] ?? 'other'));

/** How an exercise is logged, from its category and equipment; LOG_TYPE_FIXES has the exceptions. */
export function logTypeFor(e: Pick<SourceExercise, 'name' | 'category' | 'equipment'>): LogTypeName {
  const fix = LOG_TYPE_FIXES[e.name];
  if (fix) return fix;
  if (e.category === 'stretching' || e.equipment === 'foam roll') return 'duration';
  if (e.category === 'cardio') return 'distance';
  if (e.equipment === null || e.equipment === 'body only' || e.equipment === 'exercise ball' || e.equipment === 'bands') {
    return 'bodyweight';
  }
  return 'weight_reps';
}

export interface Library {
  exercises: CompactExercise[];
  instructions: Record<string, string[]>;
}

export function buildLibrary(sourcePath = 'data/free-exercise-db.json'): Library {
  const source = JSON.parse(readFileSync(sourcePath, 'utf8')) as SourceExercise[];
  const byName = new Map(source.map((e) => [e.name, e]));
  const need = (name: string, where: string) => {
    if (!byName.has(name)) throw new Error(`data/curation.ts ${where}: "${name}" is not in the exercise dataset`);
  };
  POPULAR.forEach((n) => need(n, 'POPULAR'));
  Object.keys(RENAMES).forEach((n) => need(n, 'RENAMES'));
  Object.keys(ALIASES).forEach((n) => need(n, 'ALIASES'));
  Object.keys(LOG_TYPE_FIXES).forEach((n) => need(n, 'LOG_TYPE_FIXES'));
  if (new Set(POPULAR).size !== POPULAR.length) throw new Error('data/curation.ts POPULAR lists an exercise twice');
  const ids = new Set(source.map((e) => e.id));
  const shown = new Set(source.map((e) => RENAMES[e.name] ?? e.name));
  for (const x of EXTRAS) {
    if (ids.has(x.id) || shown.has(x.name)) throw new Error(`data/curation.ts EXTRAS: "${x.name}" is now in the dataset; remove it`);
  }
  const rank = new Map(POPULAR.map((n, i) => [n, i + 1]));

  const exercises: CompactExercise[] = [];
  const instructions: Record<string, string[]> = {};
  for (const e of source) {
    const renamed = RENAMES[e.name];
    const aliases = [...(renamed ? [e.name] : []), ...(ALIASES[e.name] ?? [])];
    exercises.push({
      i: e.id,
      n: renamed ?? e.name,
      p: e.primaryMuscles.map(muscle),
      s: e.secondaryMuscles.map(muscle),
      e: equipment(e.equipment),
      l: e.level,
      ...(e.mechanic ? { m: e.mechanic } : {}),
      ...(e.force ? { f: e.force } : {}),
      c: e.category,
      t: logTypeFor(e),
      g: e.images.length,
      ...(rank.has(e.name) ? { r: rank.get(e.name) } : {}),
      ...(aliases.length ? { a: aliases } : {}),
    });
    instructions[e.id] = e.instructions;
  }
  for (const x of EXTRAS) {
    exercises.push({
      i: x.id,
      n: x.name,
      p: x.primary,
      s: x.secondary,
      e: equipment(x.equipment),
      l: x.level,
      m: x.mechanic,
      c: x.category,
      t: x.logType,
      g: 0,
      ...(x.aliases.length ? { a: x.aliases } : {}),
    });
    instructions[x.id] = x.instructions;
  }
  exercises.sort((a, b) => a.n.localeCompare(b.n, 'en'));
  return { exercises, instructions };
}

const LIBRARY = 'virtual:exercise-library';
const INSTRUCTIONS = 'virtual:exercise-instructions';

/** JSON.parse of a string literal parses much faster than the same data as a JS object literal. */
const asModule = (value: unknown) => `export default JSON.parse(${JSON.stringify(JSON.stringify(value))});`;

export function exerciseLibrary(): Plugin {
  let library: Library | null = null;
  const get = () => (library ??= buildLibrary());
  return {
    name: 'gym-tracker-exercise-library',
    resolveId(id) {
      if (id === LIBRARY || id === INSTRUCTIONS) return `\0${id}`;
      return null;
    },
    load(id) {
      if (id === `\0${LIBRARY}`) return asModule(get().exercises);
      if (id === `\0${INSTRUCTIONS}`) return asModule(get().instructions);
      return null;
    },
    configureServer(server) {
      server.watcher.add(['data/free-exercise-db.json', 'data/curation.ts']);
    },
  };
}
