import { describe, expect, it } from 'vitest';
import type { Workout, WorkoutSet } from '../src/lib/types';
import { e1rm, exerciseSessions, newRecords, progress, records, workoutTotals } from '../src/lib/stats';

const set = (weight: number | undefined, reps: number, done = true): WorkoutSet => ({ id: `${weight}x${reps}${Math.random()}`, weight, reps, done });

function workout(day: number, sets: WorkoutSet[], exerciseId = 'bench', logType: 'weight_reps' | 'bodyweight' = 'weight_reps'): Workout {
  const startedAt = Date.UTC(2026, 8, day, 17);
  return {
    id: `w${day}${exerciseId}`, name: 'W', date: `2026-09-${String(day).padStart(2, '0')}`, startedAt, endedAt: startedAt + 3000_000,
    notes: '', updatedAt: startedAt,
    exercises: [{ id: `e${day}`, exerciseId, name: exerciseId, logType, notes: '', sets }],
  };
}

describe('estimated one-rep max (Epley)', () => {
  it('is weight × (1 + reps/30), and a single is its weight', () => {
    expect(e1rm(100, 1)).toBe(100);
    expect(e1rm(100, 10)).toBeCloseTo(133.33, 2);
    expect(e1rm(80, 8)).toBeCloseTo(101.33, 2);
    expect(e1rm(0, 5)).toBe(0);
    expect(e1rm(100, 0)).toBe(0);
  });
});

describe('totals and records', () => {
  const history = [
    workout(1, [set(80, 8), set(80, 8), set(80, 6)]),
    workout(4, [set(85, 5), set(85, 5), set(70, 12, false)]),
    workout(8, [set(90, 3), set(80, 10)]),
  ];

  it('adds up a workout, counting only completed sets', () => {
    const t = workoutTotals(history[1]);
    expect(t).toMatchObject({ sets: 2, reps: 10, volume: 850, exercises: 1, duration: 3000_000 });
  });

  it('finds heaviest, best e1RM, best volume and reps at each weight', () => {
    const r = records(exerciseSessions(history, 'bench'));
    expect(r.heaviest).toMatchObject({ value: 90, reps: 3, date: '2026-09-08' });
    expect(r.bestE1rm!.value).toBeCloseTo(106.67, 2); // 80 × 10
    expect(r.bestE1rm).toMatchObject({ weight: 80, reps: 10 });
    expect(r.bestVolume).toMatchObject({ value: 80 * 22, date: '2026-09-01' });
    expect(r.repsAtWeight.map((m) => [m.weight, m.value])).toEqual([[90, 3], [85, 5], [80, 10]]);
  });

  it('reports new records against earlier workouts only', () => {
    const today = workout(10, [set(92.5, 2), set(85, 6), set(80, 10)]);
    const found = newRecords(today, [...history, today]);
    const kinds = found.map((f) => [f.kind, f.value, f.previous, f.weight]);
    expect(kinds).toContainEqual(['heaviest', 92.5, 90, undefined]);
    expect(kinds).toContainEqual(['repsAtWeight', 6, 5, 85]);
    expect(found.some((f) => f.kind === 'e1rm')).toBe(false); // 85 × 6 = 102 < 106.7
    // 80 × 10 again is not a record; neither is the first time at 92.5 kg as reps-at-weight.
    expect(found.filter((f) => f.kind === 'repsAtWeight')).toHaveLength(1);
  });

  it('sets no records the first time an exercise is done', () => {
    const first = workout(10, [set(50, 10)], 'squat');
    expect(newRecords(first, [first, ...history])).toEqual([]);
  });

  it('records reps for bodyweight exercises', () => {
    const before = workout(2, [set(undefined, 8), set(undefined, 7)], 'pullup', 'bodyweight');
    const now = workout(9, [set(undefined, 10)], 'pullup', 'bodyweight');
    expect(newRecords(now, [before, now]).map((f) => [f.kind, f.value])).toEqual([['reps', 10]]);
  });

  it('gives one progress point per workout', () => {
    const points = progress(exerciseSessions(history, 'bench'));
    expect(points.map((p) => p.date)).toEqual(['2026-09-01', '2026-09-04', '2026-09-08']);
    expect(points[2].top).toBe(90);
    expect(points[2].e1rm).toBeCloseTo(106.67, 2);
  });
});
