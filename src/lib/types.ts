/**
 * The app's data. Weights are always kilograms, distances meters and times
 * seconds; the chosen units only change how they are shown.
 *
 * Every item that syncs has an id and an updatedAt (ms), so two devices can
 * merge item by item: the newest edit wins, and a deletion (tombstone in
 * SyncMeta) wins over edits made before it.
 */

/** How an exercise is logged: which two numbers a set has. */
export type LogType =
  /** weight × reps */
  | 'weight_reps'
  /** reps, optionally with added weight (pull-ups, dips, push-ups) */
  | 'bodyweight'
  /** a time (planks, stretches, holds) */
  | 'duration'
  /** distance and time (running, rowing, cycling) */
  | 'distance'
  /** weight × distance (carries, sled pushes) */
  | 'weight_distance';

export const LOG_TYPES: LogType[] = ['weight_reps', 'bodyweight', 'duration', 'distance', 'weight_distance'];

/** Muscles as the exercise dataset names them. */
export type Muscle =
  | 'abs'
  | 'adductors'
  | 'abductors'
  | 'biceps'
  | 'calves'
  | 'chest'
  | 'forearms'
  | 'glutes'
  | 'hamstrings'
  | 'lats'
  | 'lower-back'
  | 'mid-back'
  | 'neck'
  | 'quads'
  | 'shoulders'
  | 'traps'
  | 'triceps';

/** The simple groups used for filters. */
export type MuscleGroup = 'chest' | 'back' | 'shoulders' | 'biceps' | 'triceps' | 'legs' | 'glutes' | 'core';

export type Equipment =
  | 'barbell'
  | 'dumbbell'
  | 'kettlebell'
  | 'cable'
  | 'machine'
  | 'bodyweight'
  | 'bands'
  | 'ez-bar'
  | 'medicine-ball'
  | 'exercise-ball'
  | 'foam-roll'
  | 'other'
  | 'none';

export type SetKind = 'warmup' | 'drop' | 'failure';

/** One set as done (or about to be done) in a workout. */
export interface WorkoutSet {
  id: string;
  /** kg. For bodyweight exercises: the added weight. */
  weight?: number;
  reps?: number;
  seconds?: number;
  meters?: number;
  done: boolean;
  /** Not shown yet: warm-up, drop and failure sets. */
  kind?: SetKind;
  /** Not shown yet: rate of perceived exertion, 1–10. */
  rpe?: number;
}

export interface WorkoutExercise {
  /** This exercise's place in the workout (the same exercise can appear twice). */
  id: string;
  /** Library id, or a custom exercise's id ("c-…"). */
  exerciseId: string;
  /** Snapshot, so the workout reads right even if the exercise is renamed or deleted. */
  name: string;
  logType: LogType;
  notes: string;
  /** Rest after each set, overriding the exercise's and the app's default. */
  restSeconds?: number;
  /** Not used yet: exercises with the same group id form a superset. */
  groupId?: string;
  sets: WorkoutSet[];
}

export interface Workout {
  id: string;
  name: string;
  routineId?: string;
  /** Local calendar day it started, YYYY-MM-DD (also its sync month). */
  date: string;
  startedAt: number;
  /** Missing while the workout is in progress. */
  endedAt?: number;
  notes: string;
  exercises: WorkoutExercise[];
  updatedAt: number;
}

/** A planned set in a routine; every number is optional. */
export interface PlannedSet {
  weight?: number;
  reps?: number;
  seconds?: number;
  meters?: number;
  kind?: SetKind;
}

export interface RoutineExercise {
  id: string;
  exerciseId: string;
  name: string;
  logType: LogType;
  notes: string;
  restSeconds?: number;
  groupId?: string;
  sets: PlannedSet[];
}

export interface Routine {
  id: string;
  name: string;
  notes: string;
  /** Sort position in the list (fractional, so moving one routine changes only that routine). */
  position: number;
  exercises: RoutineExercise[];
  /** Not used yet: routines of a program, with automatic progression. */
  programId?: string;
  updatedAt: number;
}

export interface CustomExercise {
  /** "c-" + random */
  id: string;
  name: string;
  primary: Muscle[];
  secondary: Muscle[];
  equipment: Equipment;
  logType: LogType;
  notes: string;
  updatedAt: number;
}

/** Library preferences for one exercise, keyed by the exercise's id. */
export interface ExercisePref {
  id: string;
  favorite: boolean;
  hidden: boolean;
  /** Default rest after this exercise's sets. */
  restSeconds?: number;
  updatedAt: number;
}

export type Units = 'kg' | 'lb';

/** Settings that sync, each with its own time so changes on two devices both survive. */
export interface SyncedSettings {
  units: Units;
  /** Default rest between sets, in seconds. */
  restSeconds: number;
  /** Start the rest timer when a set is completed. */
  autoRest: boolean;
  /** Keep the screen awake during a workout, where the browser allows. */
  keepAwake: boolean;
  /** Which exercises to pick from: the built-in list and your own, or only your own. */
  library: LibraryMode;
  /**
   * Google AI Studio key for Gemini, which turns a description into an exercise. Synced
   * (encrypted, like everything) so it's entered once; never in backups, never shown to Claude.
   */
  geminiKey: string;
  /** Any Gemini API model ID. */
  geminiModel: string;
  /** The models the key can use, as Google listed them. */
  geminiModels: GeminiModelInfo[];
  /** When a model is busy or out of free uses, try the next one. */
  geminiAutoSwitch: boolean;
}

export type LibraryMode = 'full' | 'mine';

export interface GeminiModelInfo {
  /** Model ID as used in API calls, e.g. "gemini-flash-lite-latest". */
  id: string;
  label: string;
}

export const SYNCED_SETTINGS: (keyof SyncedSettings)[] = [
  'units',
  'restSeconds',
  'autoRest',
  'keepAwake',
  'library',
  'geminiKey',
  'geminiModel',
  'geminiModels',
  'geminiAutoSwitch',
];

/** Settings for this device only (a phone can be dark while a computer stays light). */
export interface DeviceSettings {
  /** Palette id: a built-in one or "auto". */
  theme: string;
  /** Gentle motion (also off when the system asks for reduced motion). */
  animations: boolean;
  /** Whether "use only your own exercises?" was offered on this device (answered or dismissed). */
  libraryOffered: boolean;
}

export type Settings = SyncedSettings & DeviceSettings;

/** Bookkeeping that lets devices merge their changes. */
export interface SyncMeta {
  /** Deleted workouts: id → when, and the workout's day (to find its monthly part). */
  deletedWorkouts: Record<string, { at: number; date: string }>;
  deletedRoutines: Record<string, number>;
  deletedExercises: Record<string, number>;
  /** When each synced setting last changed (0 = never). */
  settingsAt: Record<keyof SyncedSettings, number>;
}

export interface AppData {
  version: 1;
  workouts: Workout[];
  routines: Routine[];
  customExercises: CustomExercise[];
  prefs: ExercisePref[];
  settings: Settings;
  meta: SyncMeta;
}
