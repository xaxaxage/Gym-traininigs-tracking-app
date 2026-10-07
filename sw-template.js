/* Service worker: makes the app load offline. Generated at build time by vite.config.ts
   (ported from the calorie tracker, plus a cache for exercise photos). */
const VERSION = '__VERSION__';
const PRECACHE = __ASSETS__;
/** Exercise photos come from the dataset's pinned commit on GitHub. */
const PHOTOS = __PHOTOS__;
const PREFIX = 'gym-tracker-';
const CACHE = PREFIX + VERSION;
/** Kept across app versions: the photos you've looked at, for the gym without signal. */
const PHOTO_CACHE = 'gym-tracker-photos';
const MAX_PHOTOS = 400;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(['./', ...PRECACHE]))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      // Keep the previous version too, so a page that is still open can load its lazy chunks.
      const old = keys
        .filter((k) => k.startsWith(PREFIX) && k !== CACHE && k !== PHOTO_CACHE)
        .sort()
        .reverse();
      return Promise.all(old.slice(1).map((k) => caches.delete(k)));
    })
      // Take over the open page straight away, so even a first visit has the exercise list offline.
      .then(() => self.clients.claim()),
  );
});

async function photo(request) {
  const cache = await caches.open(PHOTO_CACHE);
  const hit = await cache.match(request.url);
  if (hit) return hit;
  const response = await fetch(request);
  // Only real images are kept (not error pages); oldest go first once there are many.
  if (response.ok && (response.headers.get('content-type') || '').startsWith('image/')) {
    await cache.put(request.url, response.clone());
    const keys = await cache.keys();
    await Promise.all(keys.slice(0, Math.max(0, keys.length - MAX_PHOTOS)).map((k) => cache.delete(k)));
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  if (request.url.startsWith(PHOTOS)) {
    event.respondWith(photo(request));
    return;
  }
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Downloads for other apps (the Claude Desktop extension) always come fresh from the server.
  if (url.pathname.includes('/mcp/')) return;
  // Saved design versions (Settings → Design versions) are separate pages with their
  // own files: never cached here, and never stored as this version's app page.
  if (url.pathname.includes('/versions/') || url.pathname.endsWith('/versions.json')) return;

  if (request.mode === 'navigate') {
    // Network first for the page itself so updates arrive; cached copy when offline.
    // Only an HTML answer is kept as the app's page, never a file download.
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok && (response.headers.get('content-type') || '').includes('text/html')) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put('./', copy));
          }
          return response;
        })
        .catch(() => caches.match('./', { ignoreVary: true }).then((hit) => hit || Response.error())),
    );
    return;
  }

  // Build assets have content hashes in their names, so cache first is safe — whatever the
  // request's headers (a server's "Vary: Origin" mustn't make a cached file unusable offline).
  event.respondWith(
    caches.match(request, { ignoreSearch: true, ignoreVary: true }).then(
      (hit) =>
        hit ||
        fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        }),
    ),
  );
});
