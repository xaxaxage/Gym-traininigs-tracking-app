import { beforeAll, describe, expect, it } from 'vitest';
import { loadLibrary } from '../src/lib/library/load';
import { fromCustom, groupsOf, type Exercise } from '../src/lib/library/catalog';
import { hiddenMatches, normalize, searchExercises } from '../src/lib/library/search';

let all: Exercise[] = [];
beforeAll(async () => {
  all = await loadLibrary();
});

const top = (q: string, n = 1, opts = {}) => searchExercises(all, q, opts).slice(0, n).map((e) => e.name);

describe('exercise search', () => {
  it('loads the whole library from its own chunk', () => {
    expect(all.length).toBeGreaterThan(880);
    expect(all.find((e) => e.id === 'Barbell_Squat')?.popular).toBe(2);
  });

  it('finds common exercises by the words people use', () => {
    expect(top('bench')).toEqual(['Barbell Bench Press']);
    expect(top('RDL')).toEqual(['Romanian Deadlift']);
    expect(top('rdl')).toEqual(['Romanian Deadlift']);
    expect(top('pull-up')).toEqual(['Pull-Up']);
    expect(top('pullup')).toEqual(['Pull-Up']);
    expect(top('pull up')).toEqual(['Pull-Up']);
    expect(top('pullups')).toEqual(['Pull-Up']);
    expect(top('chin-up')).toEqual(['Chin-Up']);
    expect(top('chinup')).toEqual(['Chin-Up']);
    expect(top('ohp')).toEqual(['Overhead Press']);
    expect(top('squat')).toEqual(['Barbell Squat']);
    expect(top('deadlift')).toEqual(['Barbell Deadlift']);
    expect(top('lat pulldown')).toEqual(['Lat Pulldown']);
    expect(top('pec deck')).toEqual(['Pec Deck']);
    expect(top('skull crusher')).toEqual(['EZ-Bar Skull Crusher']);
    expect(top('bulgarian')).toEqual(['Bulgarian Split Squat']);
    expect(top('hip thrust')).toEqual(['Barbell Hip Thrust']);
    expect(top('leg curl', 2)).toEqual(expect.arrayContaining(['Lying Leg Curl']));
  });

  it('understands shorthand and plurals', () => {
    expect(top('db row')).toEqual(['One-Arm Dumbbell Row']);
    expect(top('db bench')).toEqual(['Dumbbell Bench Press']);
    expect(top('hammer curls')).toEqual(['Hammer Curl']);
    expect(top('kb swing')).toEqual(['Kettlebell Swing']);
  });

  it("still finds the dataset's own names", () => {
    expect(top('Barbell Bench Press - Medium Grip')).toEqual(['Barbell Bench Press']);
    expect(top('Pullups')).toEqual(['Pull-Up']);
  });

  it('filters by muscle group and equipment', () => {
    const chest = searchExercises(all, '', { group: 'chest' });
    expect(chest.length).toBeGreaterThan(40);
    expect(chest.every((e) => groupsOf(e).includes('chest'))).toBe(true);
    const curls = searchExercises(all, 'curl', { group: 'biceps', equipment: 'cable' });
    expect(curls.length).toBeGreaterThan(3);
    expect(curls.every((e) => e.equipment === 'cable')).toBe(true);
    expect(searchExercises(all, 'core', {}).length).toBeGreaterThan(0);
  });

  it('puts favorites and recently done exercises first among equal matches', () => {
    const plain = top('row', 3);
    const favorites = new Set(['Pendlay_Row']);
    expect(top('row', 1, { favorites })).toEqual(['Pendlay Row']);
    const recent = new Map([['T-Bar_Row_with_Handle', Date.now()]]);
    expect(top('row', 1, { recent })).toEqual(['T-Bar Row']);
    expect(plain).not.toContain('T-Bar Row');
  });

  it('leaves out hidden exercises, and counts the ones that match', () => {
    const hidden = new Set(['Barbell_Bench_Press_-_Medium_Grip']);
    expect(top('bench', 1, { hidden })).not.toEqual(['Barbell Bench Press']);
    expect(hiddenMatches(all, 'bench', { hidden })).toBe(1);
    expect(top('bench', 1, { hidden, includeHidden: true })).toEqual(['Barbell Bench Press']);
  });

  it('searches custom exercises too', () => {
    const custom = fromCustom({
      id: 'c-abc123', name: 'Landmine Row (Meadows)', primary: ['lats'], secondary: [], equipment: 'barbell', logType: 'weight_reps', notes: '', updatedAt: 1,
    });
    expect(searchExercises([custom, ...all], 'meadows')[0].id).toBe('c-abc123');
  });

  it('stays instant over the whole library', () => {
    searchExercises(all, 'warm up the index');
    const started = performance.now();
    for (const q of ['b', 'be', 'ben', 'benc', 'bench', 'bench p', 'bench pr', 'incline db', 'squat', 'curl']) searchExercises(all, q);
    const per = (performance.now() - started) / 10;
    expect(per).toBeLessThan(15);
  });

  it('normalizes text', () => {
    expect(normalize("Farmer's Walk")).toBe('farmers walk');
    expect(normalize('Pull-Up')).toBe('pullup');
    expect(normalize('  Bench   Press!! ')).toBe('bench press');
  });
});
