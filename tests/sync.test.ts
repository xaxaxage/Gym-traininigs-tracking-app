import { beforeEach, describe, expect, it } from 'vitest';
import type { AppData, Workout } from '../src/lib/types';
import { buildParts, mergePart, parsePart, type Part } from '../src/lib/sync/parts';
import {
  connectorToken,
  decryptText,
  deriveKeys,
  encryptText,
  isValidPhrase,
  newPhrase,
  normalizePhrase,
  partLabel,
  SALT,
} from '../src/lib/sync/crypto';
import { deleteWorkout, emptyData, getData, putWorkout, reload, setPref, updateSettings } from '../src/lib/store';
import { emptyWorkout, finishWorkout } from '../src/lib/workout';

const set = (id: string, weight: number, reps: number) => ({ id, weight, reps, done: true });

function workout(id: string, date: string, updatedAt: number, extra: Partial<Workout> = {}): Workout {
  const startedAt = new Date(`${date}T17:00:00`).getTime();
  return {
    id, name: `Workout ${id}`, date, startedAt, endedAt: startedAt + 3600_000, notes: '', updatedAt,
    exercises: [{ id: `e-${id}`, exerciseId: 'Barbell_Squat', name: 'Barbell Squat', logType: 'weight_reps', notes: '', sets: [set(`s-${id}`, 100, 5)] }],
    ...extra,
  };
}

const withWorkouts = (workouts: Workout[], meta: Partial<AppData['meta']> = {}): AppData => {
  const d = emptyData();
  return { ...d, workouts, meta: { ...d.meta, ...meta } };
};

/** Send every part of `from` through JSON (as the relay would) and merge into `into`. */
function syncInto(into: AppData, from: AppData): AppData {
  let out = into;
  for (const part of buildParts(from).values()) out = mergePart(out, parsePart(JSON.parse(JSON.stringify(part))) as Part);
  return out;
}

const json = (d: AppData) => JSON.stringify([...buildParts(d).values()]);

describe('parts', () => {
  it('one part per month of workouts, plus library, routines and settings', () => {
    const data = withWorkouts([workout('b', '2026-09-23', 1), workout('a', '2026-09-21', 1), workout('c', '2026-10-01', 1)], {
      deletedWorkouts: { z: { at: 5, date: '2026-09-22' } },
    });
    const parts = buildParts(data);
    expect([...parts.keys()].sort()).toEqual(['2026-09', '2026-10', 'library', 'routines', 'settings']);
    const sep = parts.get('2026-09')!;
    expect(sep.kind === 'month' && sep.workouts.map((w) => w.id)).toEqual(['a', 'b']);
    expect(sep.kind === 'month' && sep.deleted).toEqual([{ id: 'z', at: 5, date: '2026-09-22' }]);
    const again = buildParts({ ...data, workouts: [...data.workouts].reverse() });
    expect(JSON.stringify(again.get('2026-09'))).toBe(JSON.stringify(sep));
  });

  it('a busy month stays well under the relays\' 64 KB limit', async () => {
    const workouts: Workout[] = [];
    for (let d = 1; d <= 31; d++) {
      for (const n of [0, 1]) {
        const w = workout(`w${d}-${n}xxxxxxxxx`, `2026-10-${String(d).padStart(2, '0')}`, 1);
        w.exercises = Array.from({ length: 8 }, (_, i) => ({
          id: `ex${i}${d}${n}abc`, exerciseId: `Exercise_Number_${i}_Long_Name`, name: `Exercise number ${i} with a long name`, logType: 'weight_reps' as const, notes: 'Seat 4',
          sets: Array.from({ length: 5 }, (_, j) => set(`s${i}${j}${d}${n}xyz`, 60 + i * 2.5 + j, 8 + (j % 3))),
        }));
        workouts.push(w);
      }
    }
    const part = buildParts(withWorkouts(workouts)).get('2026-10')!;
    const keys = await deriveKeys(newPhrase());
    const sealed = await encryptText(keys.encKey, JSON.stringify(part));
    // 62 workouts × 8 exercises × 5 sets: twice-a-day training, every day.
    expect(sealed.length).toBeLessThan(45_000);
  });
});

describe('merging two devices', () => {
  it('adds workouts from the other device, both ways, and is idempotent', () => {
    const phone = withWorkouts([workout('p1', '2026-09-23', 1)]);
    const laptop = withWorkouts([workout('t1', '2026-09-23', 1), workout('t2', '2026-08-01', 1)]);
    const merged = syncInto(phone, laptop);
    expect(merged.workouts.map((w) => w.id).sort()).toEqual(['p1', 't1', 't2']);
    expect(syncInto(merged, laptop)).toBe(merged);
    expect(syncInto(laptop, merged).workouts.map((w) => w.id).sort()).toEqual(['p1', 't1', 't2']);
  });

  it('keeps the newest edit of a workout', () => {
    const phone = withWorkouts([workout('x', '2026-09-23', 2000, { notes: 'old' })]);
    const laptop = withWorkouts([workout('x', '2026-09-23', 3000, { notes: 'new' })]);
    expect(syncInto(phone, laptop).workouts[0].notes).toBe('new');
    expect(syncInto(laptop, phone).workouts[0].notes).toBe('new');
  });

  it('a deletion wins over older edits, not newer ones, and travels on', () => {
    const phone = withWorkouts([workout('x', '2026-09-23', 2000), workout('y', '2026-09-23', 3000)]);
    const laptop = withWorkouts([], { deletedWorkouts: { x: { at: 2500, date: '2026-09-23' }, y: { at: 2500, date: '2026-09-23' } } });
    const merged = syncInto(phone, laptop);
    expect(merged.workouts.map((w) => w.id)).toEqual(['y']);
    const third = withWorkouts([workout('x', '2026-09-23', 2000)]);
    expect(syncInto(third, merged).workouts.map((w) => w.id)).toEqual(['y']);
  });

  it('a workout moved to another month moves on the other device', () => {
    const phone = withWorkouts([workout('x', '2026-09-30', 1000)]);
    const laptop = withWorkouts([workout('x', '2026-10-01', 2000)]);
    const merged = syncInto(phone, laptop);
    expect(merged.workouts.map((w) => w.date)).toEqual(['2026-10-01']);
    expect(buildParts(merged).get('2026-09')).toBeUndefined();
  });

  it('syncs the workout in progress, so it can be continued elsewhere', () => {
    const live = { ...workout('live', '2026-10-01', 5000), endedAt: undefined };
    const merged = syncInto(emptyData(), withWorkouts([live]));
    expect(merged.workouts[0].endedAt).toBeUndefined();
    const more = { ...live, updatedAt: 6000, exercises: [{ ...live.exercises[0], sets: [...live.exercises[0].sets, set('s2', 100, 4)] }] };
    expect(syncInto(merged, withWorkouts([more])).workouts[0].exercises[0].sets).toHaveLength(2);
  });

  it('converges to byte-identical parts, even with ties and different field order', () => {
    const a = withWorkouts([workout('x', '2026-09-23', 2000, { notes: 'a' })]);
    const reordered = Object.fromEntries(Object.entries(workout('x', '2026-09-23', 2000, { notes: 'b' })).reverse()) as unknown as Workout;
    const b = withWorkouts([reordered, workout('y', '2026-09-24', 1)]);
    const ab = syncInto(a, b);
    const ba = syncInto(b, a);
    expect(json(ab)).toBe(json(ba));
    expect(syncInto(ab, ba)).toBe(ab);
  });

  it('merges routines, custom exercises and preferences item by item', () => {
    const d = emptyData();
    const routine = { id: 'r1', name: 'Legs', notes: '', position: 1, exercises: [], updatedAt: 100 };
    const phone: AppData = {
      ...d,
      routines: [routine],
      customExercises: [{ id: 'c-aaaa1', name: 'Meadows row', primary: ['lats'], secondary: [], equipment: 'barbell', logType: 'weight_reps', notes: '', updatedAt: 100 }],
      prefs: [{ id: 'Barbell_Squat', favorite: true, hidden: false, updatedAt: 100 }],
    };
    const laptop: AppData = {
      ...d,
      routines: [{ ...routine, name: 'Leg day', updatedAt: 200 }],
      prefs: [{ id: 'Barbell_Squat', favorite: false, hidden: false, restSeconds: 180, updatedAt: 300 }, { id: 'Plank', favorite: true, hidden: false, updatedAt: 50 }],
      meta: { ...d.meta, deletedExercises: { 'c-aaaa1': 150 } },
    };
    for (const merged of [syncInto(phone, laptop), syncInto(laptop, phone)]) {
      expect(merged.routines.map((r) => r.name)).toEqual(['Leg day']);
      expect(merged.customExercises).toEqual([]);
      const squat = merged.prefs.find((p) => p.id === 'Barbell_Squat')!;
      expect(squat).toMatchObject({ favorite: false, restSeconds: 180 });
      expect(merged.prefs.find((p) => p.id === 'Plank')?.favorite).toBe(true);
    }
    expect(json(syncInto(phone, laptop))).toBe(json(syncInto(laptop, phone)));
  });

  it('merges each setting by its own time', () => {
    const d = emptyData();
    const phone: AppData = { ...d, settings: { ...d.settings, units: 'lb' }, meta: { ...d.meta, settingsAt: { ...d.meta.settingsAt, units: 300 } } };
    const laptop: AppData = { ...d, settings: { ...d.settings, restSeconds: 90, theme: 'night' }, meta: { ...d.meta, settingsAt: { ...d.meta.settingsAt, restSeconds: 200 } } };
    const merged = syncInto(phone, laptop);
    expect(merged.settings).toMatchObject({ units: 'lb', restSeconds: 90 });
    // The look is per device: it never syncs.
    expect(merged.settings.theme).toBe('instrument');
    expect(syncInto(laptop, phone).settings).toMatchObject({ units: 'lb', restSeconds: 90, theme: 'night' });
  });

  it('ignores malformed or unknown parts', () => {
    expect(parsePart({ kind: 'month', name: 'bad' })).toBeUndefined();
    expect(parsePart({ kind: 'body-weight', name: 'x' })).toBeUndefined();
    expect(parsePart('nope')).toBeUndefined();
    const part = parsePart({ kind: 'month', name: '2026-09', workouts: [{ id: 1 }, workout('x', '2026-10-01', 1)], deleted: [{ id: 'x' }] }) as Part;
    expect(part.kind === 'month' && part.workouts.length + part.deleted.length).toBe(0);
    const settings = parsePart({ kind: 'settings', values: { units: { value: 'stone', at: 5 }, restSeconds: { value: 90, at: 5 } } });
    expect(settings).toEqual({ kind: 'settings', name: 'settings', values: { restSeconds: { value: 90, at: 5 } } });
  });
});

describe('store bookkeeping for sync', () => {
  beforeEach(() => {
    localStorage.clear();
    reload();
  });

  it('records edits, deletions, preferences and setting changes', () => {
    const w = putWorkout(finishWorkout(emptyWorkout(Date.UTC(2026, 9, 1, 17)), Date.UTC(2026, 9, 1, 18)));
    deleteWorkout(w.id);
    expect(getData().meta.deletedWorkouts[w.id].date).toBe(w.date);
    setPref('Plank', { hidden: true });
    expect(getData().prefs[0].updatedAt).toBeGreaterThan(0);
    updateSettings({ restSeconds: 90 });
    expect(buildParts(getData()).get('settings')).toMatchObject({ values: { restSeconds: { value: 90 } } });
  });
});

describe('sync key and encryption', () => {
  it('makes 12-word keys and accepts pasted or dictated variants', () => {
    const phrase = newPhrase();
    expect(phrase.split(' ')).toHaveLength(12);
    expect(isValidPhrase(phrase)).toBe(true);
    expect(isValidPhrase(`  ${phrase.toUpperCase().replace(/ /g, ',\n ')}.`)).toBe(true);
    expect(isValidPhrase(phrase.split(' ').slice(0, 11).join(' '))).toBe(false);
    expect(isValidPhrase('abandon '.repeat(12))).toBe(false);
    expect(normalizePhrase(' Apple,  BANANA\ncherry ')).toBe('apple banana cherry');
  });

  it('derives the same keys from the same phrase on every device', async () => {
    const phrase = newPhrase();
    const a = await deriveKeys(phrase);
    const b = await deriveKeys(phrase.toUpperCase());
    expect(a.pubkey).toBe(b.pubkey);
    expect(await partLabel(a.nameKey, '2026-09')).toBe(await partLabel(b.nameKey, '2026-09'));
    expect(await partLabel(a.nameKey, '2026-09')).not.toContain('2026');
  });

  it("can never meet the calorie tracker's data under the same 12 words", async () => {
    expect(SALT).toBe('gym-tracker-sync');
    // The calorie tracker's keys for these words (same derivation, its own salt).
    const phrase = 'legal winner thank year wave sausage worth useful legal winner thank yellow';
    const { mnemonicToSeedWebcrypto } = await import('@scure/bip39');
    const { getPublicKey } = await import('nostr-tools/pure');
    const seed = await mnemonicToSeedWebcrypto(phrase);
    const base = await crypto.subtle.importKey('raw', seed as BufferSource, 'HKDF', false, ['deriveBits']);
    const bits = async (salt: string) =>
      new Uint8Array(
        await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: new TextEncoder().encode(salt), info: new TextEncoder().encode('nostr-signing-key/0') }, base, 256),
      );
    const calorie = getPublicKey(await bits('calorie-tracker-sync'));
    const gym = await deriveKeys(phrase);
    expect(gym.pubkey).toBe(getPublicKey(await bits('gym-tracker-sync')));
    expect(gym.pubkey).not.toBe(calorie);
    expect(await connectorToken(phrase)).toMatch(/^[0-9a-f]{32}$/);
  });

  it('encrypts so only the same phrase can read it', async () => {
    const phrase = newPhrase();
    const a = await deriveKeys(phrase);
    const text = JSON.stringify({ kind: 'month', name: '2026-09', workouts: Array(30).fill({ name: 'Barbell Squat' }) });
    const sealed = await encryptText(a.encKey, text);
    expect(sealed.startsWith('1z:')).toBe(true);
    expect(sealed).not.toContain('Squat');
    expect(sealed.length).toBeLessThan(text.length);
    expect(await decryptText((await deriveKeys(phrase)).encKey, sealed)).toBe(text);
    await expect(decryptText((await deriveKeys(newPhrase())).encKey, sealed)).rejects.toThrow();
  });
});
