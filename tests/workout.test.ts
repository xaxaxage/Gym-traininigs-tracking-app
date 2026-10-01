import { describe, expect, it } from 'vitest';
import type { Routine, Workout, WorkoutSet } from '../src/lib/types';
import {
  addExercises,
  addSet,
  duplicateRoutine,
  editSetNumber,
  emptyWorkout,
  finishWorkout,
  fromRoutine,
  isStale,
  lastSets,
  lastUsed,
  moveItem,
  positionBetween,
  prefillSets,
  routineExercise,
  swapExercise,
  toggleSet,
  unfinished,
} from '../src/lib/workout';

const bench = { id: 'Barbell_Bench_Press_-_Medium_Grip', name: 'Barbell Bench Press', logType: 'weight_reps' as const };
const row = { id: 'Bent_Over_Barbell_Row', name: 'Barbell Row', logType: 'weight_reps' as const };
const pullup = { id: 'Pullups', name: 'Pull-Up', logType: 'bodyweight' as const };

const set = (weight: number, reps: number, done = true): WorkoutSet => ({ id: Math.random().toString(36).slice(2, 10), weight, reps, done });

function past(day: number, sets: WorkoutSet[], ref = bench): Workout {
  const startedAt = Date.UTC(2026, 8, day, 17);
  return {
    ...emptyWorkout(startedAt, 'Push'),
    endedAt: startedAt + 3600_000,
    exercises: [{ id: 'x' + day, exerciseId: ref.id, name: ref.name, logType: ref.logType, notes: '', sets }],
  };
}

describe('last time and prefilling', () => {
  const history = [past(1, [set(70, 8), set(70, 8)]), past(8, [set(80, 8), set(80, 7), set(75, 9, false)]), past(5, [set(75, 8)])];

  it('finds the last finished workout with completed sets', () => {
    expect(lastSets(history, bench.id).map((s) => [s.weight, s.reps])).toEqual([[80, 8], [80, 7]]);
    expect(lastSets(history, bench.id, Date.UTC(2026, 8, 6)).map((s) => s.weight)).toEqual([75]);
    expect(lastSets(history, row.id)).toEqual([]);
    const active = { ...past(9, [set(100, 1)]), endedAt: undefined };
    expect(lastSets([...history, active], bench.id).map((s) => s.weight)).toEqual([80, 80]);
  });

  it('prefills from last time, then the routine, then three empty sets', () => {
    const prev = lastSets(history, bench.id);
    expect(prefillSets(prev).map((s) => [s.weight, s.reps, s.done])).toEqual([[80, 8, false], [80, 7, false]]);
    expect(prefillSets(prev, [{ reps: 5 }, { reps: 5 }, { reps: 5 }]).map((s) => [s.weight, s.reps])).toEqual([
      [80, 8],
      [80, 7],
      [80, 7],
    ]);
    expect(prefillSets([], [{ reps: 10, weight: 40 }, {}]).map((s) => [s.weight, s.reps])).toEqual([[40, 10], [undefined, undefined]]);
    expect(prefillSets([])).toHaveLength(3);
  });

  it('starts a workout from a routine with last time\'s numbers', () => {
    const routine: Routine = {
      id: 'r1', name: 'Push', notes: '', position: 1, updatedAt: 1,
      exercises: [routineExercise(bench, [{ reps: 8 }, { reps: 8 }, { reps: 8 }]), { ...routineExercise(row), restSeconds: 90 }],
    };
    const w = fromRoutine(routine, history, Date.UTC(2026, 8, 10, 17));
    expect(w.name).toBe('Push');
    expect(w.routineId).toBe('r1');
    expect(w.endedAt).toBeUndefined();
    expect(w.exercises.map((e) => e.sets.length)).toEqual([3, 3]);
    expect(w.exercises[0].sets.map((s) => s.weight)).toEqual([80, 80, 80]);
    expect(w.exercises[1].restSeconds).toBe(90);
  });

  it('lists when exercises were last used', () => {
    const used = lastUsed(history);
    expect(used.get(bench.id)).toBe(Date.UTC(2026, 8, 8, 17));
  });
});

describe('changing a workout', () => {
  const start = () => addExercises(emptyWorkout(Date.UTC(2026, 8, 10, 17)), [bench, pullup], []);

  it('adds sets like the last one and checks them off', () => {
    let w = start();
    let e = w.exercises[0];
    e = editSetNumber(e, e.sets[0].id, 'weight', 60);
    expect(e.sets.map((s) => s.weight)).toEqual([60, 60, 60]);
    e = editSetNumber(e, e.sets[0].id, 'reps', 10);
    e = toggleSet(e, e.sets[0].id);
    e = editSetNumber(e, e.sets[1].id, 'weight', 62.5);
    // The done first set keeps its weight; later open sets follow the change.
    expect(e.sets.map((s) => s.weight)).toEqual([60, 62.5, 62.5]);
    e = addSet(e);
    expect(e.sets[3]).toMatchObject({ weight: 62.5, reps: 10, done: false });
    w = { ...w, exercises: [e, w.exercises[1]] };
    expect(unfinished(w)).toEqual({ sets: 6, exercises: 1 });
  });

  it('finishing drops what was not done', () => {
    let w = start();
    const e = toggleSet(editSetNumber(w.exercises[0], w.exercises[0].sets[0].id, 'reps', 5), w.exercises[0].sets[0].id);
    w = { ...w, exercises: [e, w.exercises[1]] };
    const done = finishWorkout(w, w.startedAt + 3000_000);
    expect(done.endedAt).toBe(w.startedAt + 3000_000);
    expect(done.exercises).toHaveLength(1);
    expect(done.exercises[0].sets).toHaveLength(1);
  });

  it('swaps an exercise, keeping done sets of the same kind', () => {
    let w = start();
    const first = w.exercises[0];
    w = { ...w, exercises: [toggleSet(editSetNumber(first, first.sets[0].id, 'reps', 8), first.sets[0].id), w.exercises[1]] };
    const history = [past(3, [set(50, 10), set(50, 10)], row)];
    const swapped = swapExercise(w, first.id, row, history);
    expect(swapped.exercises[0]).toMatchObject({ exerciseId: row.id, name: 'Barbell Row' });
    expect(swapped.exercises[0].sets.map((s) => [s.weight, s.reps, s.done])).toEqual([
      [undefined, 8, true],
      [50, 10, false],
      [50, 10, false],
    ]);
  });

  it('moves items within bounds', () => {
    expect(moveItem([1, 2, 3], 0, 1)).toEqual([2, 1, 3]);
    expect(moveItem([1, 2, 3], 2, 1)).toEqual([1, 2, 3]);
    expect(moveItem([1, 2, 3], 1, -1)).toEqual([2, 1, 3]);
  });

  it('notices a workout left running', () => {
    const w = start();
    expect(isStale(w, w.updatedAt + 3600_000)).toBe(false);
    expect(isStale(w, w.updatedAt + 7 * 3600_000)).toBe(true);
  });
});

describe('routines', () => {
  it('duplicates with new ids and places between neighbors', () => {
    const r: Routine = { id: 'r1', name: 'Legs', notes: '', position: 1, updatedAt: 5, exercises: [routineExercise(bench)] };
    const copy = duplicateRoutine(r, 1.5);
    expect(copy.id).not.toBe(r.id);
    expect(copy.name).toBe('Legs (copy)');
    expect(copy.exercises[0].id).not.toBe(r.exercises[0].id);
    expect(positionBetween(1, 2)).toBe(1.5);
    expect(positionBetween(undefined, 1)).toBe(0);
    expect(positionBetween(3, undefined)).toBe(4);
  });
});
