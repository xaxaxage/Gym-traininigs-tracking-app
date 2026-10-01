import type { AppData, CustomExercise, ExercisePref, Routine, SyncedSettings, Workout } from '../types';
import { SYNCED_SETTINGS } from '../types';
import { isDateKey, isMonthKey, monthOf } from '../dates';
import { isId } from '../ids';
import { cleanCustomExercise, cleanList, cleanPref, cleanRoutine, cleanWorkout } from '../schema';
import { cleanSetting } from '../store';

/**
 * Sync splits the data into small parts, each a relay message well under the
 * relays' 64 KB limit, so only the parts that changed are uploaded again:
 *
 * - "library": custom exercises and library preferences (favorites, hidden, rest times),
 * - "routines",
 * - "settings": units and the rest timer (each setting with its own time),
 * - "YYYY-MM": the workouts that started in that month, the one in progress too.
 *
 * Every part is encrypted before it leaves the device. Merging is per item
 * and order-independent: the newest edit of an item wins, and a deletion
 * wins over any edit made before it. Parts are built in one canonical form
 * (fixed field order, sorted by id), so equal data gives equal bytes on
 * every device.
 */

export interface Tombstone {
  id: string;
  at: number;
}

export interface MonthPart {
  kind: 'month';
  /** "2026-09" */
  name: string;
  workouts: Workout[];
  deleted: (Tombstone & { date: string })[];
}

export interface RoutinesPart {
  kind: 'routines';
  name: 'routines';
  routines: Routine[];
  deleted: Tombstone[];
}

export interface LibraryPart {
  kind: 'library';
  name: 'library';
  exercises: CustomExercise[];
  deleted: Tombstone[];
  prefs: ExercisePref[];
}

export type SettingValues = { [K in keyof SyncedSettings]?: { value: SyncedSettings[K]; at: number } };

export interface SettingsPart {
  kind: 'settings';
  name: 'settings';
  values: SettingValues;
}

/** The data parts, merged into the store. */
export type Part = MonthPart | RoutinesPart | LibraryPart | SettingsPart;

export type DeviceType = 'phone' | 'tablet' | 'computer' | 'claude';

/**
 * A device using the sync key, for the list in Settings. Each device writes
 * only its own, now and then while it's used; another device can mark it
 * removed, which hides it until it's used again.
 */
export interface DevicePart {
  kind: 'device';
  /** "device:<id>" */
  name: string;
  id: string;
  deviceName: string;
  type: DeviceType;
  /** App version, or the connector's. */
  version: string;
  /** Last time it was used, roughly. */
  seenAt: number;
  removedAt?: number;
}

/**
 * Written over every part of a sync key that was replaced by a new one, so
 * devices still using the old key stop syncing and ask for the new one.
 */
export interface RetiredPart {
  kind: 'retired';
  at: number;
}

/** Anything a device can find on the relays. */
export type SyncPart = Part | DevicePart | RetiredPart;

const DEVICE_TYPES: DeviceType[] = ['phone', 'tablet', 'computer', 'claude'];

export const devicePartName = (id: string) => `device:${id}`;

export function isDeviceId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9-]{8,64}$/i.test(value);
}

/** The sync part a workout belongs to. */
export const monthPartName = (date: string) => monthOf(date);

const byId = <T extends { id: string }>(a: T, b: T) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** All parts for the data, keyed by name, in canonical form. */
export function buildParts(data: AppData): Map<string, Part> {
  const parts = new Map<string, Part>();
  const month = (date: string): MonthPart => {
    const name = monthPartName(date);
    let part = parts.get(name) as MonthPart | undefined;
    if (!part) {
      part = { kind: 'month', name, workouts: [], deleted: [] };
      parts.set(name, part);
    }
    return part;
  };
  for (const w of data.workouts) {
    const clean = cleanWorkout(w);
    if (clean) month(w.date).workouts.push(clean);
  }
  for (const [id, t] of Object.entries(data.meta.deletedWorkouts)) month(t.date).deleted.push({ id, at: t.at, date: t.date });
  for (const p of parts.values()) {
    if (p.kind === 'month') {
      p.workouts.sort(byId);
      p.deleted.sort(byId);
    }
  }

  const tombstones = (record: Record<string, number>) => Object.entries(record).map(([id, at]) => ({ id, at })).sort(byId);
  parts.set('routines', {
    kind: 'routines',
    name: 'routines',
    routines: cleanList(data.routines, cleanRoutine, 10_000).sort(byId),
    deleted: tombstones(data.meta.deletedRoutines),
  });
  parts.set('library', {
    kind: 'library',
    name: 'library',
    exercises: cleanList(data.customExercises, cleanCustomExercise, 10_000).sort(byId),
    deleted: tombstones(data.meta.deletedExercises),
    prefs: cleanList(data.prefs, cleanPref, 100_000).sort(byId),
  });
  const values: SettingValues = {};
  for (const k of SYNCED_SETTINGS) {
    const at = data.meta.settingsAt[k];
    if (at > 0) (values as Record<string, unknown>)[k] = { value: data.settings[k], at };
  }
  parts.set('settings', { kind: 'settings', name: 'settings', values });
  return parts;
}

const time = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);

function cleanTombstones(raw: unknown): Tombstone[] {
  return (Array.isArray(raw) ? raw : []).filter((d: any) => d && isId(d.id) && time(d.at)).map((d: any) => ({ id: d.id, at: d.at }));
}

/** Validate a part received from another device. Unknown kinds (from a newer version) are left alone. */
export function parsePart(raw: any): SyncPart | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  if (raw.kind === 'device') {
    if (!isDeviceId(raw.id) || typeof raw.deviceName !== 'string' || !raw.deviceName.trim()) return undefined;
    return {
      kind: 'device',
      name: devicePartName(raw.id),
      id: raw.id,
      deviceName: raw.deviceName.trim().slice(0, 60),
      type: DEVICE_TYPES.includes(raw.type) ? raw.type : 'computer',
      version: typeof raw.version === 'string' ? raw.version.slice(0, 60) : '',
      seenAt: time(raw.seenAt),
      ...(time(raw.removedAt) ? { removedAt: time(raw.removedAt) } : {}),
    };
  }
  if (raw.kind === 'retired') return time(raw.at) ? { kind: 'retired', at: time(raw.at) } : undefined;
  if (raw.kind === 'month' && isMonthKey(raw.name)) {
    return {
      kind: 'month',
      name: raw.name,
      // A workout belongs in the month it started; anything else is ignored.
      workouts: cleanList(raw.workouts, cleanWorkout, 1000).filter((w) => monthPartName(w.date) === raw.name),
      deleted: (Array.isArray(raw.deleted) ? raw.deleted : [])
        .filter((d: any) => d && isId(d.id) && time(d.at) && isDateKey(d.date))
        .map((d: any) => ({ id: d.id, at: d.at, date: d.date })),
    };
  }
  if (raw.kind === 'routines') {
    return { kind: 'routines', name: 'routines', routines: cleanList(raw.routines, cleanRoutine, 10_000), deleted: cleanTombstones(raw.deleted) };
  }
  if (raw.kind === 'library') {
    return {
      kind: 'library',
      name: 'library',
      exercises: cleanList(raw.exercises, cleanCustomExercise, 10_000),
      deleted: cleanTombstones(raw.deleted),
      prefs: cleanList(raw.prefs, cleanPref, 100_000),
    };
  }
  if (raw.kind === 'settings') {
    const values: SettingValues = {};
    for (const k of SYNCED_SETTINGS) {
      const v = raw.values?.[k];
      const value = cleanSetting(k, v?.value);
      if (value !== undefined && time(v?.at)) (values as Record<string, unknown>)[k] = { value, at: v.at };
    }
    return { kind: 'settings', name: 'settings', values };
  }
  return undefined;
}

/** Whether a device belongs in the list: used since it was last removed. */
export function deviceShown(d: DevicePart): boolean {
  return !d.removedAt || d.seenAt > d.removedAt;
}

/** Merge a part from another device into local data. Returns the same object if nothing changed. */
export function mergePart(data: AppData, part: Part): AppData {
  switch (part.kind) {
    case 'month':
      return mergeMonth(data, part);
    case 'routines':
      return mergeRoutines(data, part);
    case 'library':
      return mergeLibrary(data, part);
    case 'settings':
      return mergeSettings(data, part);
  }
}

interface Item {
  id: string;
  updatedAt: number;
}

/**
 * Item-by-item merge: the newer edit wins; on a tie, a fixed rule (the
 * larger JSON) so both devices pick the same one. Then tombstones remove
 * items not edited since they were deleted.
 */
function mergeItems<T extends Item>(
  local: T[],
  remote: T[],
  canon: (x: T) => T | undefined,
  gone: (id: string) => number | undefined,
): { items: T[]; changed: boolean } {
  let changed = false;
  const items = new Map(local.map((x) => [x.id, x]));
  for (const r of remote) {
    const l = items.get(r.id);
    if (!l) {
      items.set(r.id, r);
      changed = true;
      continue;
    }
    if (r.updatedAt > l.updatedAt) {
      items.set(r.id, r);
      changed = true;
    } else if (r.updatedAt === l.updatedAt) {
      const a = JSON.stringify(canon(r));
      const b = JSON.stringify(canon(l));
      if (a > b) {
        items.set(r.id, r);
        changed = true;
      }
    }
  }
  for (const [id, item] of items) {
    const at = gone(id);
    if (at !== undefined && at >= item.updatedAt) {
      items.delete(id);
      changed = true;
    }
  }
  // Only report a change when the result really differs from what's here.
  const out = [...items.values()];
  if (changed && out.length === local.length && out.every((x, i) => x === local[i])) changed = false;
  return { items: out, changed };
}

function mergeMonth(data: AppData, part: MonthPart): AppData {
  let changed = false;
  const deletedWorkouts = { ...data.meta.deletedWorkouts };
  for (const d of part.deleted) {
    const known = deletedWorkouts[d.id];
    if (!known || d.at > known.at) {
      deletedWorkouts[d.id] = { at: d.at, date: d.date };
      changed = true;
    }
  }
  const merged = mergeItems(data.workouts, part.workouts, cleanWorkout, (id) => deletedWorkouts[id]?.at);
  if (!changed && !merged.changed) return data;
  return { ...data, workouts: merged.items, meta: { ...data.meta, deletedWorkouts } };
}

function mergeTimes(local: Record<string, number>, remote: Tombstone[]): { times: Record<string, number>; changed: boolean } {
  const times = { ...local };
  let changed = false;
  for (const d of remote) {
    if (!(times[d.id] >= d.at)) {
      times[d.id] = d.at;
      changed = true;
    }
  }
  return { times, changed };
}

function mergeRoutines(data: AppData, part: RoutinesPart): AppData {
  const tomb = mergeTimes(data.meta.deletedRoutines, part.deleted);
  const merged = mergeItems(data.routines, part.routines, cleanRoutine, (id) => tomb.times[id]);
  if (!tomb.changed && !merged.changed) return data;
  return { ...data, routines: merged.items, meta: { ...data.meta, deletedRoutines: tomb.times } };
}

function mergeLibrary(data: AppData, part: LibraryPart): AppData {
  const tomb = mergeTimes(data.meta.deletedExercises, part.deleted);
  const exercises = mergeItems(data.customExercises, part.exercises, cleanCustomExercise, (id) => tomb.times[id]);
  const prefs = mergeItems(data.prefs, part.prefs, cleanPref, () => undefined);
  if (!tomb.changed && !exercises.changed && !prefs.changed) return data;
  return {
    ...data,
    customExercises: exercises.items,
    prefs: prefs.items,
    meta: { ...data.meta, deletedExercises: tomb.times },
  };
}

/** Each setting on its own: the newest change wins (ties: the larger value, the same on every device). */
function mergeSettings(data: AppData, part: SettingsPart): AppData {
  let changed = false;
  const settings = { ...data.settings };
  const settingsAt = { ...data.meta.settingsAt };
  for (const k of SYNCED_SETTINGS) {
    const remote = part.values[k];
    if (!remote) continue;
    const mine = settingsAt[k];
    const newer = remote.at > mine || (remote.at === mine && JSON.stringify(remote.value) > JSON.stringify(settings[k]));
    if (newer && (remote.value !== settings[k] || remote.at !== mine)) {
      (settings as Record<string, unknown>)[k] = remote.value;
      settingsAt[k] = remote.at;
      changed = true;
    }
  }
  if (!changed) return data;
  return { ...data, settings, meta: { ...data.meta, settingsAt } };
}
