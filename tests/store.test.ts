import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  activeWorkout,
  backupJson,
  clearAll,
  deleteRoutine,
  deleteWorkout,
  emptyData,
  getData,
  getSaveError,
  parseBackup,
  parseData,
  putRoutine,
  putWorkout,
  reload,
  restoreBackup,
  setPref,
  STORAGE_KEY,
  updateSettings,
} from '../src/lib/store';
import { emptyWorkout, finishWorkout, newRoutine } from '../src/lib/workout';

beforeEach(() => {
  localStorage.clear();
  reload();
});

describe('store', () => {
  it('saves every change straight away', () => {
    const w = putWorkout(emptyWorkout(Date.UTC(2026, 9, 1, 17)));
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).workouts[0].id).toBe(w.id);
    putWorkout({ ...w, notes: 'Heavy day' });
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).workouts[0].notes).toBe('Heavy day');
    reload();
    expect(getData().workouts[0].notes).toBe('Heavy day');
  });

  it('stamps every change with a time that only goes up', () => {
    const w = putWorkout(emptyWorkout());
    const again = putWorkout(w);
    expect(again.updatedAt).toBeGreaterThan(w.updatedAt);
  });

  it('knows the workout in progress: the newest unfinished one', () => {
    const older = putWorkout(emptyWorkout(1_000_000));
    const newer = putWorkout(emptyWorkout(2_000_000));
    expect(activeWorkout()?.id).toBe(newer.id);
    putWorkout(finishWorkout(newer, 2_100_000));
    expect(activeWorkout()?.id).toBe(older.id);
  });

  it('leaves tombstones for deletions, for other devices', () => {
    const w = putWorkout(emptyWorkout(Date.UTC(2026, 9, 1, 17)));
    deleteWorkout(w.id);
    expect(getData().workouts).toEqual([]);
    expect(getData().meta.deletedWorkouts[w.id]).toMatchObject({ date: w.date });
    const r = putRoutine(newRoutine('Legs', 1));
    deleteRoutine(r.id);
    expect(getData().meta.deletedRoutines[r.id]).toBeGreaterThan(0);
  });

  it('stamps synced settings only when they change', () => {
    updateSettings({ units: 'kg' });
    expect(getData().meta.settingsAt.units).toBe(0);
    updateSettings({ units: 'lb', theme: 'night' });
    expect(getData().meta.settingsAt.units).toBeGreaterThan(0);
    expect(getData().settings.theme).toBe('night');
  });

  it('shows an error when storage is full, and keeps the change in memory', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError');
    });
    try {
      putWorkout(emptyWorkout());
      expect(getSaveError()).toMatch(/storage is full/);
      expect(getData().workouts).toHaveLength(1);
    } finally {
      spy.mockRestore();
    }
    putWorkout(getData().workouts[0]);
    expect(getSaveError()).toBeNull();
  });
});

describe('backups', () => {
  it('round-trip everything, and never contain the sync key', () => {
    localStorage.setItem('gym-tracker:sync', JSON.stringify({ phrase: 'secret words here' }));
    const w = putWorkout(finishWorkout(emptyWorkout(Date.UTC(2026, 9, 1, 17)), Date.UTC(2026, 9, 1, 18)));
    putRoutine(newRoutine('Legs', 1));
    setPref('Barbell_Squat', { favorite: true, restSeconds: 180 });
    updateSettings({ units: 'lb' });
    const json = backupJson();
    expect(json).not.toContain('secret words');
    expect(json).not.toContain('phrase');
    const back = parseBackup(json);
    expect(back.workouts[0].id).toBe(w.id);
    expect(back.routines[0].name).toBe('Legs');
    expect(back.prefs[0]).toMatchObject({ id: 'Barbell_Squat', favorite: true, restSeconds: 180 });
    expect(back.settings.units).toBe('lb');

    localStorage.clear();
    reload();
    updateSettings({ theme: 'night' });
    restoreBackup(back);
    expect(getData().workouts).toHaveLength(1);
    expect(getData().settings.units).toBe('lb');
    // The look stays this device's own.
    expect(getData().settings.theme).toBe('night');
  });

  it('refuse files that are not this app\'s backups', () => {
    expect(() => parseBackup('not json')).toThrow(/not a valid backup/);
    expect(() => parseBackup(JSON.stringify({ version: 1, entries: [] }))).toThrow(/not a Gym Tracker backup/);
    expect(() => parseData({ version: 2 })).toThrow();
  });

  it('drop broken items instead of failing', () => {
    const data = parseData({
      version: 1,
      workouts: [{ id: 'ok', date: '2026-10-01', startedAt: 5, exercises: [{ id: 'e', exerciseId: 'x', sets: [{ id: 's', weight: -5, reps: 'eight', done: 'yes' }] }] }, { id: 'bad' }],
      routines: [{ id: 'r', name: '', exercises: 'nope' }],
      settings: { units: 'stone', restSeconds: 99999, theme: 'x;}body{display:none' },
    });
    expect(data.workouts).toHaveLength(1);
    expect(data.workouts[0].exercises[0].sets[0]).toEqual({ id: 's', done: false });
    expect(data.routines[0]).toMatchObject({ name: 'Routine', exercises: [] });
    expect(data.settings).toMatchObject({ units: 'kg', restSeconds: 120, theme: 'instrument' });
    expect(parseData(JSON.parse(JSON.stringify(emptyData())))).toEqual(emptyData());
  });
});

describe('delete everything', () => {
  it('deletes on every synced device too', () => {
    const w = putWorkout(emptyWorkout());
    const r = putRoutine(newRoutine('Legs', 1));
    setPref('Barbell_Squat', { favorite: true });
    clearAll();
    const d = getData();
    expect(d.workouts).toEqual([]);
    expect(d.routines).toEqual([]);
    expect(d.prefs[0].favorite).toBe(false);
    expect(d.meta.deletedWorkouts[w.id]).toBeDefined();
    expect(d.meta.deletedRoutines[r.id]).toBeDefined();
  });
});
