import type { LogType, PlannedSet, Routine } from './types';
import { newRoutine, routineExercise } from './workout';

/** Ready-made routines for the empty start screen, built from library exercises (checked in tests/starters.test.ts). */

type Item = [id: string, name: string, logType: LogType, sets: PlannedSet[]];

const sets = (n: number, reps: number): PlannedSet[] => Array.from({ length: n }, () => ({ reps }));
const holds = (n: number, seconds: number): PlannedSet[] => Array.from({ length: n }, () => ({ seconds }));

const SQUAT: Item = ['Barbell_Squat', 'Barbell Squat', 'weight_reps', sets(3, 8)];
const BENCH: Item = ['Barbell_Bench_Press_-_Medium_Grip', 'Barbell Bench Press', 'weight_reps', sets(3, 8)];
const ROW: Item = ['Bent_Over_Barbell_Row', 'Barbell Row', 'weight_reps', sets(3, 8)];
const OHP: Item = ['Standing_Military_Press', 'Overhead Press', 'weight_reps', sets(3, 8)];
const DEADLIFT: Item = ['Barbell_Deadlift', 'Barbell Deadlift', 'weight_reps', sets(3, 5)];
const PULLDOWN: Item = ['Wide-Grip_Lat_Pulldown', 'Lat Pulldown', 'weight_reps', sets(3, 10)];

export interface StarterPack {
  id: string;
  name: string;
  description: string;
  routines: { name: string; items: Item[] }[];
}

export const STARTER_PACKS: StarterPack[] = [
  {
    id: 'full-body',
    name: 'Full body',
    description: 'Two workouts to alternate, 2–3 days a week. A good start.',
    routines: [
      {
        name: 'Full body A',
        items: [SQUAT, BENCH, ROW, ['Plank', 'Plank', 'duration', holds(3, 45)]],
      },
      {
        name: 'Full body B',
        items: [DEADLIFT, OHP, PULLDOWN, ['Dumbbell_Lunges', 'Dumbbell Lunge', 'weight_reps', sets(3, 10)], ['Hanging_Leg_Raise', 'Hanging Leg Raise', 'bodyweight', sets(3, 10)]],
      },
    ],
  },
  {
    id: 'ppl',
    name: 'Push · Pull · Legs',
    description: 'Three workouts, 3–6 days a week, each muscle group in its own session.',
    routines: [
      {
        name: 'Push',
        items: [
          [BENCH[0], BENCH[1], BENCH[2], sets(4, 8)],
          OHP,
          ['Incline_Dumbbell_Press', 'Incline Dumbbell Press', 'weight_reps', sets(3, 10)],
          ['Side_Lateral_Raise', 'Dumbbell Lateral Raise', 'weight_reps', sets(3, 12)],
          ['Triceps_Pushdown_-_Rope_Attachment', 'Rope Triceps Pushdown', 'weight_reps', sets(3, 12)],
        ],
      },
      {
        name: 'Pull',
        items: [
          ['Pullups', 'Pull-Up', 'bodyweight', sets(3, 8)],
          [ROW[0], ROW[1], ROW[2], sets(4, 8)],
          ['Seated_Cable_Rows', 'Seated Cable Row', 'weight_reps', sets(3, 10)],
          ['Face_Pull', 'Face Pull', 'weight_reps', sets(3, 15)],
          ['Barbell_Curl', 'Barbell Curl', 'weight_reps', sets(3, 10)],
          ['Hammer_Curls', 'Hammer Curl', 'weight_reps', sets(3, 12)],
        ],
      },
      {
        name: 'Legs',
        items: [
          [SQUAT[0], SQUAT[1], SQUAT[2], sets(4, 6)],
          ['Romanian_Deadlift', 'Romanian Deadlift', 'weight_reps', sets(3, 8)],
          ['Leg_Press', 'Leg Press', 'weight_reps', sets(3, 10)],
          ['Lying_Leg_Curls', 'Lying Leg Curl', 'weight_reps', sets(3, 12)],
          ['Standing_Calf_Raises', 'Standing Calf Raise', 'weight_reps', sets(4, 12)],
        ],
      },
    ],
  },
];

/** The pack's routines, placed after `lastPosition`. */
export function starterRoutines(pack: StarterPack, lastPosition: number): Routine[] {
  return pack.routines.map((r, i) => ({
    ...newRoutine(r.name, lastPosition + i + 1),
    exercises: r.items.map(([id, name, logType, planned]) => routineExercise({ id, name, logType }, planned.map((s) => ({ ...s })))),
  }));
}
