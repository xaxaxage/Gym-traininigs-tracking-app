import type { CustomExercise, Equipment, LogType, Muscle, MuscleGroup } from '../types';
import dataset from '../../../data/dataset.json';

/**
 * What the app knows about exercises, without the exercise list itself (that
 * is loaded when needed, see load.ts): names for muscles, groups, equipment
 * and ways of logging.
 */

export type Level = 'beginner' | 'intermediate' | 'expert';

/** The compact form in virtual:exercise-library (see plugins/exercise-library.ts). */
export interface CompactExercise {
  i: string;
  n: string;
  p: Muscle[];
  s: Muscle[];
  e: Equipment;
  l: Level;
  m?: 'compound' | 'isolation';
  f?: 'push' | 'pull' | 'static';
  c: string;
  t: LogType;
  g: number;
  r?: number;
  a?: string[];
}

export interface Exercise {
  id: string;
  name: string;
  primary: Muscle[];
  secondary: Muscle[];
  equipment: Equipment;
  logType: LogType;
  level?: Level;
  mechanic?: 'compound' | 'isolation';
  force?: 'push' | 'pull' | 'static';
  category?: string;
  /** Number of photos (0–2). */
  images: number;
  /** 1 = most popular; missing for the rest. */
  popular?: number;
  aliases: string[];
  /** Made by the user (and synced). */
  custom: boolean;
}

export function expand(c: CompactExercise): Exercise {
  return {
    id: c.i,
    name: c.n,
    primary: c.p,
    secondary: c.s,
    equipment: c.e,
    logType: c.t,
    level: c.l,
    mechanic: c.m,
    force: c.f,
    category: c.c,
    images: c.g,
    popular: c.r,
    aliases: c.a ?? [],
    custom: false,
  };
}

export function fromCustom(c: CustomExercise): Exercise {
  return {
    id: c.id,
    name: c.name,
    primary: c.primary,
    secondary: c.secondary,
    equipment: c.equipment,
    logType: c.logType,
    images: 0,
    aliases: [],
    custom: true,
  };
}

export const MUSCLES: Muscle[] = [
  'chest', 'lats', 'mid-back', 'lower-back', 'traps', 'shoulders', 'neck', 'biceps', 'forearms', 'triceps',
  'abs', 'quads', 'hamstrings', 'glutes', 'calves', 'adductors', 'abductors',
];

export const MUSCLE_LABEL: Record<Muscle, string> = {
  abs: 'Abs',
  adductors: 'Adductors',
  abductors: 'Abductors',
  biceps: 'Biceps',
  calves: 'Calves',
  chest: 'Chest',
  forearms: 'Forearms',
  glutes: 'Glutes',
  hamstrings: 'Hamstrings',
  lats: 'Lats',
  'lower-back': 'Lower back',
  'mid-back': 'Upper back',
  neck: 'Neck',
  quads: 'Quads',
  shoulders: 'Shoulders',
  traps: 'Traps',
  triceps: 'Triceps',
};

export const GROUPS: MuscleGroup[] = ['chest', 'back', 'shoulders', 'biceps', 'triceps', 'legs', 'glutes', 'core'];

export const GROUP_LABEL: Record<MuscleGroup, string> = {
  chest: 'Chest',
  back: 'Back',
  shoulders: 'Shoulders',
  biceps: 'Biceps',
  triceps: 'Triceps',
  legs: 'Legs',
  glutes: 'Glutes',
  core: 'Core',
};

/** Which simple group each muscle counts towards in the filters. */
export const GROUP_OF: Record<Muscle, MuscleGroup> = {
  chest: 'chest',
  lats: 'back',
  'mid-back': 'back',
  'lower-back': 'back',
  traps: 'back',
  shoulders: 'shoulders',
  neck: 'shoulders',
  biceps: 'biceps',
  forearms: 'biceps',
  triceps: 'triceps',
  abs: 'core',
  quads: 'legs',
  hamstrings: 'legs',
  calves: 'legs',
  adductors: 'legs',
  glutes: 'glutes',
  abductors: 'glutes',
};

/** The groups an exercise is mainly for (by its primary muscles). */
export function groupsOf(e: Pick<Exercise, 'primary'>): MuscleGroup[] {
  return [...new Set(e.primary.map((m) => GROUP_OF[m]))];
}

export const EQUIPMENT: Equipment[] = [
  'barbell', 'dumbbell', 'kettlebell', 'cable', 'machine', 'bodyweight', 'bands', 'ez-bar',
  'medicine-ball', 'exercise-ball', 'foam-roll', 'other', 'none',
];

export const EQUIPMENT_LABEL: Record<Equipment, string> = {
  barbell: 'Barbell',
  dumbbell: 'Dumbbell',
  kettlebell: 'Kettlebell',
  cable: 'Cable',
  machine: 'Machine',
  bodyweight: 'Bodyweight',
  bands: 'Bands',
  'ez-bar': 'EZ bar',
  'medicine-ball': 'Medicine ball',
  'exercise-ball': 'Exercise ball',
  'foam-roll': 'Foam roller',
  other: 'Other',
  none: 'No equipment',
};

export const LOG_TYPE_LABEL: Record<LogType, string> = {
  weight_reps: 'Weight × reps',
  bodyweight: 'Bodyweight reps (+ weight)',
  duration: 'Time',
  distance: 'Distance and time',
  weight_distance: 'Weight × distance',
};

export const LEVEL_LABEL: Record<Level, string> = { beginner: 'Beginner', intermediate: 'Intermediate', expert: 'Expert' };

/** The exercise dataset this build uses, pinned to one commit. */
export const DATASET = dataset as { name: string; repo: string; commit: string; license: string };

/** A photo of an exercise from the pinned dataset (0 = start position, 1 = end). */
export function photoUrl(id: string, index: number): string {
  return `https://raw.githubusercontent.com/${DATASET.repo}/${DATASET.commit}/exercises/${encodeURIComponent(id)}/${index}.jpg`;
}
