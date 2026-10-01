import { useEffect, useRef, useState } from 'preact/hooks';
import { getData } from './store';

/**
 * Animations are on unless turned off in Settings or the phone asks for
 * reduced motion. CSS animations are switched off with a single attribute on
 * <html>; the JavaScript ones (numbers counting) check motionOn().
 */

const reduceQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : undefined;

export function systemReducesMotion(): boolean {
  return !!reduceQuery?.matches;
}

export function motionOn(): boolean {
  return getData().settings.animations && !systemReducesMotion();
}

export function applyMotion() {
  document.documentElement.dataset.motion = motionOn() ? 'on' : 'off';
}

/** Keep <html data-motion> in step with Settings and the system setting. */
export function watchMotion(subscribe: (listener: () => void) => void) {
  applyMotion();
  subscribe(applyMotion);
  reduceQuery?.addEventListener?.('change', applyMotion);
}

/** Last value shown per counter, so coming back to a screen counts on from there rather than from zero. */
const lastShown = new Map<string, number>();

const easeOut = (t: number) => 1 - (1 - t) ** 3;

/**
 * A number that glides to its new value — from 0 the first time it's shown,
 * afterwards from wherever it was, so a new total visibly rolls in.
 */
export function useCountUp(key: string, target: number, duration = 700): number {
  const [shown, setShown] = useState(() => (motionOn() ? lastShown.get(key) ?? 0 : target));
  const current = useRef(shown);

  useEffect(() => {
    const from = current.current;
    if (!motionOn() || Math.abs(target - from) < 0.5) {
      current.current = target;
      lastShown.set(key, target);
      setShown(target);
      return;
    }
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const value = from + (target - from) * easeOut(t);
      current.current = value;
      lastShown.set(key, value);
      setShown(value);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [key, target, duration]);

  return shown;
}
