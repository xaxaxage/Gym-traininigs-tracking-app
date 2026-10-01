/**
 * Keeps the screen on during a workout where the browser allows it (Screen
 * Wake Lock). Browsers release the lock when the app goes to the background,
 * so it's asked for again when the app comes back. Where it isn't supported,
 * or is refused, nothing happens.
 */

type Sentinel = { released: boolean; release(): Promise<void>; addEventListener(type: 'release', fn: () => void): void };

let wanted = false;
let sentinel: Sentinel | null = null;
let listening = false;

async function acquire() {
  const api = (navigator as { wakeLock?: { request(type: 'screen'): Promise<Sentinel> } }).wakeLock;
  if (!wanted || !api || document.visibilityState !== 'visible' || (sentinel && !sentinel.released)) return;
  try {
    sentinel = await api.request('screen');
    sentinel.addEventListener('release', () => {
      sentinel = null;
    });
    // Released while the request was pending.
    if (!wanted) await release();
  } catch {
    sentinel = null;
  }
}

async function release() {
  const s = sentinel;
  sentinel = null;
  try {
    await s?.release();
  } catch {
    // already released
  }
}

function onVisible() {
  if (document.visibilityState === 'visible') void acquire();
}

export function keepScreenOn(on: boolean) {
  wanted = on;
  if (on) {
    if (!listening) {
      document.addEventListener('visibilitychange', onVisible);
      listening = true;
    }
    void acquire();
  } else {
    if (listening) {
      document.removeEventListener('visibilitychange', onVisible);
      listening = false;
    }
    void release();
  }
}

export function screenKeptOn(): boolean {
  return !!sentinel && !sentinel.released;
}
