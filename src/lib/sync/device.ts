import type { DeviceType } from './parts';

/**
 * This device's identity in the device list: a random id kept on the device
 * (not synced, not in backups) and a name — one the user gave it, or one
 * worked out from the browser, like "iPhone · Safari".
 */

export const DEVICE_KEY = 'gym-tracker:device';

export interface DeviceGuess {
  name: string;
  type: DeviceType;
}

/** A readable name for a browser: "iPhone · Home Screen app", "Windows · Edge", "Mac · Safari". */
export function guessDevice(ua: string, opts: { standalone?: boolean; touchPoints?: number } = {}): DeviceGuess {
  let platform = 'Browser';
  let type: DeviceType = 'computer';
  if (/iPhone|iPod/.test(ua)) [platform, type] = ['iPhone', 'phone'];
  // iPads ask for the desktop site and say "Macintosh"; touch gives them away.
  else if (/iPad/.test(ua) || (/Macintosh/.test(ua) && (opts.touchPoints ?? 0) > 1)) [platform, type] = ['iPad', 'tablet'];
  else if (/Android/.test(ua)) [platform, type] = /Mobile/.test(ua) ? ['Android phone', 'phone'] : ['Android tablet', 'tablet'];
  else if (/Windows/.test(ua)) platform = 'Windows';
  else if (/CrOS/.test(ua)) platform = 'Chromebook';
  else if (/Macintosh|Mac OS X/.test(ua)) platform = 'Mac';
  else if (/Linux/.test(ua)) platform = 'Linux';

  let app = '';
  if (opts.standalone) app = type === 'computer' ? 'installed app' : 'Home Screen app';
  else if (/Edg(A|iOS)?\//.test(ua)) app = 'Edge';
  else if (/OPR\/|Opera/.test(ua)) app = 'Opera';
  else if (/SamsungBrowser/.test(ua)) app = 'Samsung Internet';
  else if (/Firefox|FxiOS/.test(ua)) app = 'Firefox';
  else if (/Chrome|CriOS/.test(ua)) app = 'Chrome';
  else if (/Safari/.test(ua)) app = 'Safari';
  return { name: app ? `${platform} · ${app}` : platform, type };
}

interface Stored {
  id: string;
  name?: string;
}

function newDeviceId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

let fallback: Stored | null = null;

function read(): Stored {
  try {
    const raw = JSON.parse(localStorage.getItem(DEVICE_KEY) ?? 'null');
    if (raw && typeof raw.id === 'string' && raw.id) return { id: raw.id, name: typeof raw.name === 'string' ? raw.name : undefined };
  } catch {
    // unreadable: start over
  }
  const created = fallback ?? { id: newDeviceId() };
  write(created);
  return created;
}

function write(stored: Stored) {
  fallback = stored;
  try {
    localStorage.setItem(DEVICE_KEY, JSON.stringify(stored));
  } catch {
    // Storage unavailable: the id lasts until the page is closed.
  }
}

export interface ThisDevice extends DeviceGuess {
  id: string;
  /** The user named it (rather than it being worked out from the browser). */
  custom: boolean;
}

function standalone(): boolean {
  try {
    return window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
  } catch {
    return false;
  }
}

export function thisDevice(): ThisDevice {
  const stored = read();
  const guess = guessDevice(navigator.userAgent, { standalone: standalone(), touchPoints: navigator.maxTouchPoints });
  return { id: stored.id, name: stored.name || guess.name, type: guess.type, custom: !!stored.name };
}

/** Name this device; an empty name goes back to the one worked out from the browser. */
export function renameThisDevice(name: string) {
  const clean = name.trim().replace(/\s+/g, ' ').slice(0, 60);
  write({ id: read().id, ...(clean ? { name: clean } : {}) });
}
