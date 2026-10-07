import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { clearPreviews, PREVIEW_PREFIX } from '../src/lib/previews';

/** A Storage backed by a Map. */
function memory(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => (m.has(k) ? m.get(k)! : null),
    setItem: (k, v) => void m.set(k, String(v)),
    removeItem: (k) => void m.delete(k),
    clear: () => m.clear(),
    key: (i) => [...m.keys()][i] ?? null,
    get length() {
      return m.size;
    },
  };
}

// The shim is plain script injected into old builds; load it the same way.
const scope: { gymPreview?: { previewStorage: (s: Storage) => Storage; PREFIX: string } } = {};
new Function('globalThis', readFileSync('scripts/preview-shim.js', 'utf8').replace('typeof globalThis !== \'undefined\' ? globalThis : this', 'globalThis'))(scope);
const { previewStorage, PREFIX } = scope.gymPreview!;

describe('preview storage', () => {
  let real: Storage;
  let preview: Storage;
  beforeEach(() => {
    real = memory();
    real.setItem('gym-tracker:v1', '{"workouts":["mine"]}');
    real.setItem('gym-tracker:theme', 'harbor');
    real.setItem('gym-tracker:sync', '{"phrase":"secret words"}');
    preview = previewStorage(real);
  });

  it('reads your data', () => {
    expect(preview.getItem('gym-tracker:v1')).toBe('{"workouts":["mine"]}');
  });

  it('writes beside it, never over it', () => {
    preview.setItem('gym-tracker:v1', '{"workouts":[]}');
    expect(preview.getItem('gym-tracker:v1')).toBe('{"workouts":[]}');
    expect(real.getItem('gym-tracker:v1')).toBe('{"workouts":["mine"]}');
    expect(real.getItem(PREFIX + 'gym-tracker:v1')).toBe('{"workouts":[]}');
  });

  it('removing and clearing only hide things from the preview', () => {
    preview.removeItem('gym-tracker:theme');
    expect(preview.getItem('gym-tracker:theme')).toBeNull();
    expect(real.getItem('gym-tracker:theme')).toBe('harbor');
    preview.setItem('gym-tracker:theme', 'night');
    expect(preview.getItem('gym-tracker:theme')).toBe('night');
    preview.clear();
    expect(preview.getItem('gym-tracker:v1')).toBeNull();
    expect(preview.length).toBe(0);
    expect(real.getItem('gym-tracker:v1')).toBe('{"workouts":["mine"]}');
  });

  it('never sees or sets the sync key', () => {
    expect(preview.getItem('gym-tracker:sync')).toBeNull();
    preview.setItem('gym-tracker:sync', '{"phrase":"other"}');
    expect(preview.getItem('gym-tracker:sync')).toBeNull();
    expect(real.getItem('gym-tracker:sync')).toBe('{"phrase":"secret words"}');
  });

  it('lists keys as the preview sees them', () => {
    preview.setItem('gym-tracker:rest', '1');
    preview.removeItem('gym-tracker:theme');
    const keys = Array.from({ length: preview.length }, (_, i) => preview.key(i));
    expect(keys.sort()).toEqual(['gym-tracker:rest', 'gym-tracker:v1']);
  });

  it('the current version throws a preview\'s copy away', () => {
    preview.setItem('gym-tracker:v1', '{}');
    preview.removeItem('gym-tracker:theme');
    expect(PREVIEW_PREFIX).toBe(PREFIX);
    clearPreviews(real);
    expect(Array.from({ length: real.length }, (_, i) => real.key(i)).sort()).toEqual(['gym-tracker:sync', 'gym-tracker:theme', 'gym-tracker:v1']);
  });
});
