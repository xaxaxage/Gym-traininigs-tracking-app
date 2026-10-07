/**
 * Saved design versions (Settings → Design versions) open as previews that
 * keep their changes beside your data, under this prefix (see
 * scripts/preview-shim.js). Coming back to the current version throws that
 * copy away, so a preview never leaves anything behind.
 */
export const PREVIEW_PREFIX = 'gym-tracker:preview:';

export function clearPreviews(storage: Storage = localStorage) {
  try {
    for (let i = storage.length - 1; i >= 0; i--) {
      const key = storage.key(i);
      if (key?.startsWith(PREVIEW_PREFIX)) storage.removeItem(key);
    }
    sessionStorage.removeItem('gym-tracker:preview-of');
  } catch {
    // Storage blocked: there's nothing to clear.
  }
}
