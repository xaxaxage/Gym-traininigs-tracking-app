import { useEffect, useState } from 'preact/hooks';

/**
 * Minimal hash router. Hash URLs keep the app working from any static host
 * (e.g. GitHub Pages) and from the home screen without server rewrites.
 * Each history entry carries its index so "close" buttons can return to where
 * a flow started instead of piling up history.
 */

export interface Route {
  /** The hash as parsed, to tell whether anything changed. */
  raw: string;
  path: string;
  segments: string[];
  query: URLSearchParams;
}

const FLOW_KEY = 'gym-tracker:flow-origin';
const listeners = new Set<() => void>();

export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#/, '') || '/';
  const [pathPart, queryPart = ''] = raw.split('?');
  const path = pathPart.startsWith('/') ? pathPart : `/${pathPart}`;
  return {
    raw,
    path,
    segments: path.split('/').filter(Boolean).map(decodeURIComponent),
    query: new URLSearchParams(queryPart),
  };
}

function currentIndex(): number {
  const idx = history.state?.idx;
  return typeof idx === 'number' ? idx : 0;
}

function emit() {
  listeners.forEach((l) => l());
}

export function initRouter() {
  if (typeof history.state?.idx !== 'number') {
    history.replaceState({ ...(history.state ?? {}), idx: 0 }, '');
  }
  window.addEventListener('popstate', () => {
    // Back/forward: the browser restores that screen's scroll position itself.
    scrollToTopPending = false;
    emit();
  });
  // Route in-app links through navigate() so every entry carries an index.
  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = (e.target as Element | null)?.closest?.('a');
    const target = a?.getAttribute('href');
    if (!a || !target?.startsWith('#/') || a.target) return;
    e.preventDefault();
    navigate(target.slice(1));
  });
  window.addEventListener('hashchange', () => {
    // A hash typed by hand arrives without our state; give it an index.
    if (typeof history.state?.idx !== 'number') history.replaceState({ idx: 0 }, '');
    emit();
  });
}

export function currentRoute(): Route {
  return parseHash(location.hash);
}

export function useRoute(): Route {
  const [route, setRoute] = useState(currentRoute);
  useEffect(() => {
    const update = () => {
      const next = currentRoute();
      setRoute((prev) => (prev.raw === next.raw ? prev : next));
    };
    listeners.add(update);
    // Effects run a moment after the first render; catch a URL change made in between.
    update();
    return () => {
      listeners.delete(update);
    };
  }, []);
  return route;
}

/** Build "/path?a=1" from a path and params, skipping empty values. */
export function href(path: string, params: Record<string, string | number | undefined | null> = {}): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
  }
  const qs = q.toString();
  return qs ? `${path}?${qs}` : path;
}

export interface NavigateOptions {
  replace?: boolean;
  /** Remember the current screen so finishFlow() can return to it. */
  startFlow?: boolean;
}

export function navigate(to: string, opts: NavigateOptions = {}) {
  const idx = currentIndex();
  if (opts.startFlow) {
    try {
      sessionStorage.setItem(FLOW_KEY, String(idx));
    } catch {
      // Without session storage finishFlow() falls back to the start screen.
    }
  }
  const url = `#${to}`;
  if (opts.replace) history.replaceState({ idx }, '', url);
  else history.pushState({ idx: idx + 1 }, '', url);
  // Scrolled to the top once the new screen is drawn (see takeScrollToTop), not
  // now: scrolling now would jolt the old screen to the top for a moment first.
  scrollToTopPending = true;
  emit();
}

let scrollToTopPending = false;

/** True once after navigate(): the screen that just rendered should start at the top. */
export function takeScrollToTop(): boolean {
  const pending = scrollToTopPending;
  scrollToTopPending = false;
  return pending;
}

/** Go back one screen, or to `fallback` when there is nothing to go back to. */
export function goBack(fallback = '/') {
  if (currentIndex() > 0) history.back();
  else navigate(fallback, { replace: true });
}

/** Leave a flow (like adding exercises) and return to the screen that started it. */
export function finishFlow(fallback = '/') {
  let origin: number | null = null;
  try {
    const saved = sessionStorage.getItem(FLOW_KEY);
    origin = saved === null ? null : Number(saved);
    sessionStorage.removeItem(FLOW_KEY);
  } catch {
    origin = null;
  }
  const idx = currentIndex();
  if (origin !== null && Number.isFinite(origin) && origin < idx) history.go(origin - idx);
  else navigate(fallback, { replace: true });
}
