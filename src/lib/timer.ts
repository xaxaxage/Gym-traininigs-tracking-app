import { useEffect, useState } from 'preact/hooks';

/**
 * The rest timer. It stores when the rest ends, not how much is left, so it's
 * right after the app was in the background, reloaded or closed: the screen
 * just works out the time left from the clock. It shows on screen only (a
 * Home Screen web app can't alert or vibrate while the phone is locked).
 * Kept on this device; it doesn't sync.
 */

export const TIMER_KEY = 'gym-tracker:rest';

export interface RestTimer {
  startedAt: number;
  endsAt: number;
  /** What it's for, e.g. "Bench press · set 2". */
  label: string;
  workoutId: string;
}

/** After this long past the end, a finished timer goes away by itself. */
export const SHOW_DONE_FOR = 60_000;

let timer: RestTimer | null = read();
const listeners = new Set<() => void>();

function read(): RestTimer | null {
  try {
    const raw = JSON.parse(localStorage.getItem(TIMER_KEY) ?? 'null');
    if (raw && Number.isFinite(raw.endsAt) && Number.isFinite(raw.startedAt) && typeof raw.workoutId === 'string') {
      return { startedAt: raw.startedAt, endsAt: raw.endsAt, label: typeof raw.label === 'string' ? raw.label : '', workoutId: raw.workoutId };
    }
  } catch {
    // unreadable: no timer
  }
  return null;
}

function save(next: RestTimer | null) {
  timer = next;
  try {
    if (next) localStorage.setItem(TIMER_KEY, JSON.stringify(next));
    else localStorage.removeItem(TIMER_KEY);
  } catch {
    // The timer still runs while the app is open.
  }
  listeners.forEach((l) => l());
}

export function getRest(): RestTimer | null {
  return timer;
}

export function startRest(seconds: number, label: string, workoutId: string, now = Date.now()) {
  if (seconds <= 0) return save(null);
  save({ startedAt: now, endsAt: now + seconds * 1000, label, workoutId });
}

/** Add (or with a negative number, take off) time; never below zero left. */
export function adjustRest(seconds: number, now = Date.now()) {
  if (!timer) return;
  const endsAt = Math.max(now, Math.max(timer.endsAt, now) + seconds * 1000);
  // Adding time after it ran out starts a fresh rest from now.
  save({ ...timer, startedAt: timer.endsAt < now ? now : timer.startedAt, endsAt });
}

export function stopRest() {
  save(null);
}

/** Seconds left (0 when over), from the clock. */
export function restLeft(t: RestTimer, now = Date.now()): number {
  return Math.max(0, Math.ceil((t.endsAt - now) / 1000));
}

export interface RestView {
  timer: RestTimer;
  left: number;
  /** 0 → 1 as the rest goes by. */
  progress: number;
  done: boolean;
}

/** The current timer, redrawn a few times a second while it runs. */
export function useRest(): RestView | null {
  const [, redraw] = useState(0);
  useEffect(() => {
    const l = () => redraw((n) => n + 1);
    listeners.add(l);
    const tick = setInterval(l, 250);
    const wake = () => document.visibilityState === 'visible' && l();
    document.addEventListener('visibilitychange', wake);
    return () => {
      listeners.delete(l);
      clearInterval(tick);
      document.removeEventListener('visibilitychange', wake);
    };
  }, []);
  if (!timer) return null;
  const now = Date.now();
  if (now - timer.endsAt > SHOW_DONE_FOR) return null;
  const total = Math.max(1, timer.endsAt - timer.startedAt);
  return {
    timer,
    left: restLeft(timer, now),
    progress: Math.min(1, Math.max(0, (now - timer.startedAt) / total)),
    done: now >= timer.endsAt,
  };
}
