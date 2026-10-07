import { render } from 'preact';
import './styles.css';
import './screens.css';
import './motion.css';
import { App } from './app';
import { initRouter } from './lib/router';
import { activeWorkout, getData, subscribe } from './lib/store';
import { applyTheme } from './lib/theme';
import { watchMotion } from './lib/motion';
import { keepScreenOn } from './lib/wakelock';
import { registerServiceWorker } from './lib/updates';
import { loadSyncConfig } from './lib/sync/state';
import { clearPreviews } from './lib/previews';

// Back from a preview of an earlier design: drop what was changed in it.
clearPreviews();

// Keep the color palette in step with Settings.
let shownTheme = '';
function syncTheme() {
  const { theme } = getData().settings;
  if (theme === shownTheme) return;
  shownTheme = theme;
  applyTheme(theme);
}
syncTheme();
subscribe(syncTheme);
watchMotion(subscribe);

// The screen stays on while a workout is in progress (where the browser allows it).
const awake = () => keepScreenOn(!!activeWorkout() && getData().settings.keepAwake);
awake();
subscribe(awake);

initRouter();
render(<App />, document.getElementById('app')!);

// Resume device sync if this device has a sync key (the sync code loads only then).
if (loadSyncConfig()) {
  import('./lib/sync/engine').then((m) => m.startSync()).catch((err) => console.warn('Sync could not start', err));
}

// Ask the browser not to evict saved workouts when storage runs low.
navigator.storage?.persist?.().catch(() => undefined);

registerServiceWorker();
