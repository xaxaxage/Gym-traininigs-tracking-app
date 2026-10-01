import { useEffect, useState } from 'preact/hooks';

/** One short message at a time at the bottom of the screen (ported from the calorie tracker). */

export interface Toast {
  id: number;
  message: string;
  /** Survives the next screen change (for toasts shown right before navigating). */
  carry: boolean;
  /** Stays until dismissed or acted on, on every screen (e.g. "new version ready"). */
  sticky: boolean;
  action?: { label: string; run: () => void };
}

let current: Toast | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let nextId = 1;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

export function showToast(message: string, action?: Toast['action'], opts: { carry?: boolean; sticky?: boolean } = {}) {
  current = { id: nextId++, message, action, carry: !!opts.carry, sticky: !!opts.sticky };
  clearTimeout(timer);
  if (!opts.sticky) timer = setTimeout(dismissToast, action ? 6000 : 2800);
  emit();
}

/** Called on every screen change: drop toasts that belong to the screen being left. */
export function toastNavigated() {
  if (!current || current.sticky) return;
  if (current.carry) current = { ...current, carry: false };
  else dismissToast();
}

export function dismissToast() {
  current = null;
  clearTimeout(timer);
  emit();
}

export function useToast(): Toast | null {
  const [, setTick] = useState(0);
  const shown = current;
  useEffect(() => {
    const l = () => setTick((t) => t + 1);
    listeners.add(l);
    // Catch a toast shown between render and subscribing.
    if (current !== shown) l();
    return () => {
      listeners.delete(l);
    };
  }, []);
  return current;
}
