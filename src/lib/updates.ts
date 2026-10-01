import { showToast } from './toast';

/**
 * The service worker (sw-template.js, ported from the calorie tracker) makes
 * the app work offline. Home Screen apps can stay open for days, so it looks
 * for a new version whenever the app comes back into view and every hour,
 * and offers "Reload" when one is ready.
 */
export function registerServiceWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('./sw.js')
      .then((registration) => {
        const check = () => registration.update().catch(() => undefined);
        document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && check());
        setInterval(check, 60 * 60 * 1000);
      })
      .catch((err) => console.warn('Service worker failed', err));
  });

  // A new version has taken over: offer a reload, and do it the next time the app is hidden.
  // (Never on its own while it's in view: that could interrupt typing a set.)
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  const reload = () => {
    if (reloading) return;
    reloading = true;
    location.reload();
  };
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) return; // first install, nothing old to replace
    if (document.visibilityState === 'hidden') return reload();
    showToast('A new version of the app is ready', { label: 'Reload', run: reload }, { sticky: true });
    document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && reload());
  });
}
