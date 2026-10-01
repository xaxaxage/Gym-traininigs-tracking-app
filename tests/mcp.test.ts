// @vitest-environment node
import '../mcp/setup';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type AddressInfo, type Socket } from 'node:net';
import { finalizeEvent } from 'nostr-tools/pure';
import { getData, reload, updateSettings } from '../src/lib/store';
import { addDays, todayKey } from '../src/lib/dates';
import { decryptText, deriveKeys, encryptText, newPhrase, partLabel } from '../src/lib/sync/crypto';
import {
  createExercise,
  createRoutine,
  editRoutine,
  editSet,
  editWorkout,
  findExercises,
  logWorkout,
  progressReport,
  removeRoutine,
  removeSet,
  removeWorkout,
  resolveExercise,
  routinesReport,
  ToolError,
  workoutReport,
  workoutsReport,
} from '../mcp/tools';
import { OfflineError, RelaySync } from '../mcp/relays';
import { startRelay } from './fakeRelay';

const benchAndRows = {
  name: 'Push and pull',
  exercises: [
    { exercise: 'bench', sets: [{ count: 3, reps: 8, weight: 80 }] },
    { exercise: 'rows', sets: [{ count: 3, reps: 10, weight: 60 }] },
  ],
};

beforeEach(() => {
  localStorage.clear();
  reload();
});

describe('log_workout', () => {
  it('logs "bench 3×8 at 80 kg, then rows 3×10 at 60" with library exercises', async () => {
    const { result, touched } = await logWorkout({ ...benchAndRows, date: '2026-09-21', start_time: '18:30', duration_minutes: 50 });
    expect(touched).toEqual(['2026-09']);
    expect(result.exercises_used.map((e) => e.logged_as)).toEqual(['Barbell Bench Press', 'Barbell Row']);
    const w = getData().workouts[0];
    expect(w).toMatchObject({ name: 'Push and pull', date: '2026-09-21' });
    expect(new Date(w.startedAt).getHours()).toBe(18);
    expect(w.endedAt! - w.startedAt).toBe(50 * 60_000);
    expect(w.exercises[0].sets.map((s) => [s.weight, s.reps, s.done])).toEqual([[80, 8, true], [80, 8, true], [80, 8, true]]);
    expect(result.logged.volume).toBe(3 * 8 * 80 + 3 * 10 * 60);
  });

  it("takes and gives weights in the user's unit", async () => {
    updateSettings({ units: 'lb' });
    await logWorkout({ exercises: [{ exercise: 'Barbell Deadlift', sets: [{ reps: 5, weight: 315 }] }] });
    expect(getData().workouts[0].exercises[0].sets[0].weight).toBeCloseTo(142.882, 2);
    const day = workoutsReport({});
    expect(day.units).toBe('lb');
    expect(day.workouts[0].exercises[0]).toBe('Barbell Deadlift: 1 set, best 315 lb × 5');
    await logWorkout({ unit: 'kg', exercises: [{ exercise: 'Barbell Deadlift', sets: [{ reps: 5, weight: 150 }] }] });
    expect(getData().workouts[1].exercises[0].sets[0].weight).toBe(150);
  });

  it('reports new records', async () => {
    await logWorkout({ date: addDays(todayKey(), -3), exercises: [{ exercise: 'bench', sets: [{ reps: 8, weight: 80 }] }] });
    const { result } = await logWorkout({ exercises: [{ exercise: 'bench', sets: [{ reps: 5, weight: 90 }] }] });
    expect(result.new_records?.join('\n')).toMatch(/Heaviest weight: 90 kg \(was 80 kg\)/);
  });

  it('logs each way an exercise is logged, and says what a set needs', async () => {
    await logWorkout({
      exercises: [
        { exercise: 'pull-up', sets: [{ reps: 10 }, { reps: 6, weight: 10 }] },
        { exercise: 'plank', sets: [{ seconds: 60 }] },
        { exercise: 'treadmill run', sets: [{ distance_m: 5000, seconds: 1500 }] },
        { exercise: "farmer's walk", sets: [{ weight: 40, distance_m: 30, count: 2 }] },
      ],
    });
    const w = workoutReport(getData().workouts[0].id).workout;
    expect(w.exercises.map((e) => e.logging)).toEqual(['bodyweight', 'duration', 'distance', 'weight_distance']);
    expect(w.exercises[0].sets[1]).toEqual({ set: 2, added_weight: 10, reps: 6 });
    await expect(logWorkout({ exercises: [{ exercise: 'plank', sets: [{ reps: 3 }] }] })).rejects.toThrow(/needs seconds/);
    await expect(logWorkout({ exercises: [{ exercise: 'bench', sets: [{ weight: 80 }] }] })).rejects.toThrow(/reps/);
    await expect(logWorkout({ exercises: [] })).rejects.toThrow(ToolError);
    await expect(logWorkout({ date: '2999-01-01', ...benchAndRows })).rejects.toThrow(/future/);
  });

  it('refuses to guess an exercise it cannot find clearly', async () => {
    await expect(resolveExercise('the thing with the rope')).rejects.toThrow(/search_exercises/);
    expect((await resolveExercise('RDL')).name).toBe('Romanian Deadlift');
    expect((await resolveExercise('Pullups')).name).toBe('Pull-Up');
    expect((await resolveExercise('Barbell_Squat')).name).toBe('Barbell Squat');
  });
});

describe('reading', () => {
  it('lists workouts for a day or a period, and one in full with numbered sets', async () => {
    await logWorkout({ ...benchAndRows, date: addDays(todayKey(), -20) });
    await logWorkout({ ...benchAndRows, date: addDays(todayKey(), -2) });
    expect(workoutsReport({}).workouts).toHaveLength(1);
    expect(workoutsReport({ from: addDays(todayKey(), -30) }).totals.workouts).toBe(2);
    expect(workoutsReport({ date: addDays(todayKey(), -20) }).workouts).toHaveLength(1);
    expect(() => workoutsReport({ from: '2020-01-01' })).toThrow(/a year/);
    const id = workoutsReport({}).workouts[0].id;
    const full = workoutReport(id).workout;
    expect(full.exercises[1]).toMatchObject({ exercise: 2, name: 'Barbell Row', sets: [{ set: 1, weight: 60, reps: 10 }, { set: 2 }, { set: 3 }] });
    expect(() => workoutReport('nope')).toThrow(/get_workouts/);
  });

  it('reports records and the trend for an exercise', async () => {
    for (const [days, w] of [[-21, 70], [-14, 75], [-7, 80]] as const) {
      await logWorkout({ date: addDays(todayKey(), days), exercises: [{ exercise: 'bench', sets: [{ count: 3, reps: 8, weight: w }] }] });
    }
    // The reply's shape depends on whether there's any history, so read it loosely.
    const p = (await progressReport({ exercise: 'Barbell Bench Press' })) as Record<string, any>;
    expect(p.workouts_with_it).toBe(3);
    expect(p.records?.heaviest).toMatchObject({ weight: 80, reps: 8 });
    expect(p.records?.best_estimated_1rm?.value).toBeCloseTo(101.3, 1);
    expect(p.trend?.map((t: { top_weight: number }) => t.top_weight)).toEqual([70, 75, 80]);
    expect(p.change?.top_weight).toBe(10);
    expect(((await progressReport({ exercise: 'squat' })) as Record<string, any>).note).toMatch(/No completed sets/);
  });

  it('searches the whole library with aliases and filters', async () => {
    expect((await findExercises({ query: 'RDL' })).results[0].name).toBe('Romanian Deadlift');
    const chest = await findExercises({ muscle_group: 'chest', equipment: 'dumbbell', limit: 50 });
    expect(chest.results.every((e) => e.muscle_groups.includes('chest') && e.equipment === 'dumbbell')).toBe(true);
    expect(chest.total).toBeGreaterThan(10);
    expect((await findExercises({})).results[0].name).toBe('Barbell Bench Press');
    await expect(findExercises({ muscle_group: 'wings' })).rejects.toThrow(/muscle_group is one of/);
  });
});

describe('changing workouts and sets', () => {
  it('changes and deletes sets; an exercise without sets goes', async () => {
    await logWorkout(benchAndRows);
    const id = getData().workouts[0].id;
    const changed = editSet({ workout_id: id, exercise: 1, set: 2, weight: 82.5, reps: 7 });
    expect(changed.result.set).toEqual({ set: 2, weight: 82.5, reps: 7 });
    expect(() => editSet({ workout_id: id, exercise: 1, set: 9, reps: 1 })).toThrow(/no set 9/);
    expect(() => editSet({ workout_id: id, exercise: 1, set: 1 })).toThrow(/Nothing to change/);
    for (let i = 0; i < 3; i++) removeSet({ workout_id: id, exercise: 2, set: 1 });
    expect(getData().workouts[0].exercises.map((e) => e.name)).toEqual(['Barbell Bench Press']);
  });

  it('renames, moves, adds and removes exercises, and deletes with a tombstone', async () => {
    await logWorkout({ ...benchAndRows, date: '2026-09-30', start_time: '19:00' });
    const id = getData().workouts[0].id;
    const moved = await editWorkout({ id, name: 'Upper A', date: '2026-10-01', add_exercises: [{ exercise: 'face pull', sets: [{ count: 2, reps: 15, weight: 20 }] }] });
    expect(moved.touched).toEqual(['2026-09', '2026-10']);
    expect(getData().workouts[0]).toMatchObject({ name: 'Upper A', date: '2026-10-01' });
    expect(new Date(getData().workouts[0].startedAt).getHours()).toBe(19);
    expect(getData().workouts[0].exercises.map((e) => e.name)).toEqual(['Barbell Bench Press', 'Barbell Row', 'Face Pull']);
    await editWorkout({ id, remove_exercise: 2 });
    expect(getData().workouts[0].exercises).toHaveLength(2);
    await expect(editWorkout({ id })).rejects.toThrow(/Nothing to change/);
    removeWorkout(id);
    expect(getData().workouts).toEqual([]);
    expect(getData().meta.deletedWorkouts[id]).toMatchObject({ date: '2026-10-01' });
  });
});

describe('routines', () => {
  it('turns "a 4-day upper/lower program" into routines, and changes and deletes them', async () => {
    const days = [
      { name: 'Upper A', exercises: [{ exercise: 'bench', sets: 4, reps: [8, 8, 6, 6] }, { exercise: 'rows', reps: 10, weight: 60 }, { exercise: 'ohp' }] },
      { name: 'Lower A', exercises: [{ exercise: 'squat', sets: 4, reps: 6, rest_seconds: 180 }, { exercise: 'RDL', reps: 8 }] },
      { name: 'Upper B', exercises: [{ exercise: 'incline dumbbell press', reps: 10 }, { exercise: 'lat pulldown', reps: 12 }] },
      { name: 'Lower B', exercises: [{ exercise: 'deadlift', sets: 3, reps: 5 }, { exercise: 'leg press', reps: 12 }] },
    ];
    for (const d of days) await createRoutine(d);
    const list = routinesReport().routines;
    expect(list.map((r) => r.name)).toEqual(['Upper A', 'Lower A', 'Upper B', 'Lower B']);
    expect(list[0].exercises[0].sets.map((s) => s.reps)).toEqual([8, 8, 6, 6]);
    expect(list[0].exercises[1].sets[0]).toEqual({ set: 1, weight: 60, reps: 10 });
    expect(list[0].exercises[2]).toMatchObject({ name: 'Overhead Press', sets: [{ set: 1 }, { set: 2 }, { set: 3 }] });
    expect(list[1].exercises[0]).toMatchObject({ rest_seconds: 180 });

    const upper = list[0].id;
    await editRoutine({ id: upper, name: 'Upper A (heavy)', exercises: [{ exercise: 'bench', sets: 5, reps: 5 }] });
    expect(routinesReport().routines[0]).toMatchObject({ name: 'Upper A (heavy)', exercises: [{ name: 'Barbell Bench Press' }] });
    removeRoutine(upper);
    expect(routinesReport().routines).toHaveLength(3);
    expect(getData().meta.deletedRoutines[upper]).toBeGreaterThan(0);
  });
});

describe('custom exercises', () => {
  it('makes one when the library has nothing, and it is used from then on', async () => {
    const { result, touched } = createExercise({ name: 'Meadows row', primary_muscles: ['lats'], secondary_muscles: ['biceps', 'lats'], equipment: 'barbell' });
    expect(touched).toEqual(['library']);
    expect(result.created).toMatchObject({ name: 'Meadows row', logging: 'weight_reps' });
    expect(getData().customExercises[0].secondary).toEqual(['biceps']);
    expect((await resolveExercise('meadows row')).custom).toBe(true);
    expect(() => createExercise({ name: 'Meadows row', primary_muscles: ['lats'] })).toThrow(/already/);
    expect(() => createExercise({ name: 'X', primary_muscles: ['wings'] })).toThrow(/Unknown muscles/);
  });
});

describe('relay sync for the connector', () => {
  const relay = startRelay();
  const phrase = newPhrase();
  const clients: RelaySync[] = [];
  const client = (relays = [relay.url()], device?: { id: string; name: string; version: string }) => {
    const c = new RelaySync(phrase, relays, device);
    clients.push(c);
    return c;
  };
  beforeAll(() => new Promise((r) => setTimeout(r, 50)));
  afterAll(async () => {
    clients.forEach((c) => c.close());
    await relay.close();
  });

  it('uploads encrypted parts and another client reads them back', async () => {
    const a = client();
    await a.pull();
    expect(a.partCount).toBe(0);
    const { touched } = await logWorkout({ ...benchAndRows, date: '2026-09-21' });
    expect(await a.push(touched)).toEqual({ sent: 1, failed: [] });
    expect(await a.push(touched)).toEqual({ sent: 0, failed: [] });
    const stored = JSON.stringify([...relay.events.values()]);
    expect(stored).not.toContain('Bench');
    expect(stored).not.toContain('2026-09');

    localStorage.clear();
    reload();
    const b = client();
    await b.pull();
    expect(b.partCount).toBe(1);
    expect(getData().workouts[0].name).toBe('Push and pull');
  });

  it('shows up in the device list, never under an unused key, and stops when the key was replaced', async () => {
    const device = { id: 'claude-test-device-01', name: 'Claude Desktop · Windows', version: '1.20261001.1200' };
    const unused = new RelaySync(newPhrase(), [relay.url()], { ...device, id: 'claude-unused-key-01' });
    clients.push(unused);
    const before = relay.events.size;
    await unused.pull();
    await unused.announce();
    expect(relay.events.size).toBe(before);

    const c = client([relay.url()], device);
    await c.pull();
    await c.announce();
    const keys = await deriveKeys(phrase);
    const label = await partLabel(keys.nameKey, `device:${device.id}`);
    const stored = [...relay.events.values()].find((e) => e.tags.some((t) => t[0] === 'd' && t[1] === label))!;
    expect(JSON.parse(await decryptText(keys.encKey, stored.content))).toMatchObject({ kind: 'device', type: 'claude', deviceName: device.name });

    const retired = await encryptText(keys.encKey, JSON.stringify({ kind: 'retired', at: Date.now() }));
    for (const e of [...relay.events.values()].filter((e) => e.pubkey === stored.pubkey)) {
      const d = e.tags.find((t) => t[0] === 'd')![1];
      const next = finalizeEvent({ kind: 30078, created_at: e.created_at + 1, tags: [['d', d]], content: retired }, keys.secretKey);
      relay.events.set(`${next.pubkey}:30078:${d}`, next);
    }
    const fresh = client([relay.url()], device);
    await fresh.pull();
    expect(fresh.retiredAt).toBeGreaterThan(0);
  });

  it('reports a relay that refuses uploads', async () => {
    const other = new RelaySync(newPhrase(), [relay.url()]);
    clients.push(other);
    await other.pull();
    const { touched } = await logWorkout(benchAndRows);
    relay.refuse(true);
    expect(await other.push(touched)).toEqual({ sent: 0, failed: touched });
    relay.refuse(false);
  });

  it('says when no relay can be reached, without crashing', async () => {
    await expect(client(['ws://127.0.0.1:1', 'ws://127.0.0.1:2']).pull()).rejects.toBeInstanceOf(OfflineError);
  });

  it('survives a relay that never answers, and doesn\'t wait for it', async () => {
    const sockets: Socket[] = [];
    const silent = createServer((s) => sockets.push(s));
    await new Promise<void>((r) => silent.listen(0, '127.0.0.1', r));
    const silentUrl = `ws://127.0.0.1:${(silent.address() as AddressInfo).port}`;
    try {
      const c = new RelaySync(newPhrase(), [relay.url(), silentUrl]);
      clients.push(c);
      await c.pull();
      const { touched } = await logWorkout(benchAndRows);
      const started = Date.now();
      expect(await c.push(touched)).toEqual({ sent: 1, failed: [] });
      await c.pull();
      expect(Date.now() - started).toBeLessThan(6000);
      await expect(client([silentUrl]).pull()).rejects.toBeInstanceOf(OfflineError);
      await new Promise((r) => setTimeout(r, 300));
    } finally {
      sockets.forEach((s) => s.destroy());
      silent.close();
    }
  }, 30_000);
});
