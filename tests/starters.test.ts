import { describe, expect, it } from 'vitest';
import { loadLibrary } from '../src/lib/library/load';
import { STARTER_PACKS, starterRoutines } from '../src/lib/starters';

describe('starter plans', () => {
  it('use exercises from the library, with their names and way of logging', async () => {
    const lib = new Map((await loadLibrary()).map((e) => [e.id, e]));
    for (const pack of STARTER_PACKS) {
      for (const r of starterRoutines(pack, 0)) {
        for (const e of r.exercises) {
          const found = lib.get(e.exerciseId);
          expect(found, e.exerciseId).toBeDefined();
          expect(e.name).toBe(found!.name);
          expect(e.logType).toBe(found!.logType);
        }
      }
    }
  });
});
