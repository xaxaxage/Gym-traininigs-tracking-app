import { describe, expect, it } from 'vitest';
import type { Workout } from '../src/lib/types';
import { exerciseOverview, weeklyVolume } from '../src/lib/progress';

const day = (date: string, kg: number, reps = 8, extra: Partial<Workout> = {}): Workout => ({
  id: `w-${date}-${kg}`,
  name: 'Push',
  date,
  startedAt: Date.parse(`${date}T18:00:00`),
  endedAt: Date.parse(`${date}T19:00:00`),
  notes: '',
  updatedAt: 1,
  exercises: [
    { id: `e-${date}`, exerciseId: 'bench', name: 'Bench press', logType: 'weight_reps', notes: '', sets: [{ id: 's1', weight: kg, reps, done: true }, { id: 's2', weight: kg, reps, done: false }] },
  ],
  ...extra,
});

describe('weekly volume', () => {
  it('sums finished workouts into Monday-to-Sunday weeks, oldest first, ending with this week', () => {
    // 7 Oct 2026 is a Wednesday; its week starts Monday 5 Oct.
    const weeks = weeklyVolume([day('2026-10-05', 100), day('2026-10-07', 50), day('2026-09-28', 80), day('2026-08-01', 999)], '2026-10-07', 3);
    expect(weeks.map((w) => w.start)).toEqual(['2026-09-21', '2026-09-28', '2026-10-05']);
    expect(weeks.map((w) => w.volume)).toEqual([0, 640, 1200]);
    expect(weeks[2]).toMatchObject({ workouts: 2, sets: 2 });
  });

  it('leaves out workouts still in progress', () => {
    const open = day('2026-10-06', 100, 8, { endedAt: undefined });
    expect(weeklyVolume([open], '2026-10-07', 1)[0].volume).toBe(0);
  });
});

describe('exercise overview', () => {
  it('lists each exercise once with its trend, best and change, most recent first', () => {
    const list = exerciseOverview([day('2026-09-01', 60), day('2026-09-08', 66), day('2026-09-15', 63)]);
    expect(list).toHaveLength(1);
    const bench = list[0];
    expect(bench).toMatchObject({ exerciseId: 'bench', sessions: 3, lastDate: '2026-09-15' });
    // Estimated 1RM per workout (Epley): 60 × (1 + 8/30) = 76.
    expect(bench.trend.map((v) => Math.round(v))).toEqual([76, 84, 80]);
    expect(Math.round(bench.best)).toBe(84);
    expect(bench.change).toBeCloseTo(0.05, 5);
  });

  it('skips exercises with nothing checked off', () => {
    const w = day('2026-09-01', 60);
    w.exercises[0].sets.forEach((s) => (s.done = false));
    expect(exerciseOverview([w])).toEqual([]);
  });
});
