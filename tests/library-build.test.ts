import { describe, expect, it } from 'vitest';
import { buildLibrary, logTypeFor } from '../plugins/exercise-library';
import { POPULAR } from '../data/curation';

describe('exercise library build', () => {
  const lib = buildLibrary();
  const find = (name: string) => lib.exercises.find((e) => e.n === name)!;

  it('keeps every dataset exercise and adds the extras', () => {
    expect(lib.exercises.length).toBeGreaterThanOrEqual(876);
    expect(new Set(lib.exercises.map((e) => e.i)).size).toBe(lib.exercises.length);
    expect(Object.keys(lib.instructions)).toHaveLength(lib.exercises.length);
  });

  it('marks about 150 popular exercises', () => {
    const popular = lib.exercises.filter((e) => e.r);
    expect(popular.length).toBe(POPULAR.length);
    expect(popular.length).toBeGreaterThanOrEqual(140);
    expect(popular.length).toBeLessThanOrEqual(170);
    expect(find('Barbell Bench Press').r).toBe(1);
  });

  it('renames for clarity but still finds the dataset name', () => {
    const bench = find('Barbell Bench Press');
    expect(bench.i).toBe('Barbell_Bench_Press_-_Medium_Grip');
    expect(bench.a).toContain('Barbell Bench Press - Medium Grip');
    expect(bench.a).toContain('bench');
  });

  it('picks how each exercise is logged', () => {
    expect(find('Barbell Bench Press').t).toBe('weight_reps');
    expect(find('Pull-Up').t).toBe('bodyweight');
    expect(find('Plank').t).toBe('duration');
    expect(find('Treadmill Run').t).toBe('distance');
    expect(find("Farmer's Walk").t).toBe('weight_distance');
    expect(find('Jump Rope').t).toBe('duration');
    expect(find('Back Extension').t).toBe('bodyweight');
    expect(logTypeFor({ name: 'x', category: 'stretching', equipment: null })).toBe('duration');
    expect(logTypeFor({ name: 'x', category: 'strength', equipment: 'cable' })).toBe('weight_reps');
  });

  it('maps muscles and equipment to the app names', () => {
    const row = find('Barbell Row');
    expect(row.p).toEqual(['mid-back']);
    expect(row.e).toBe('barbell');
    expect(find('Crunch').p).toEqual(['abs']);
    expect(find('Burpee').g).toBe(0);
  });
});
