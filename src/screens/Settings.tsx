import { useState } from 'preact/hooks';
import { backupJson, clearAll, parseBackup, restoreBackup, updateSettings, useData } from '../lib/store';
import { todayKey } from '../lib/dates';
import { saveFile } from '../lib/files';
import { showToast } from '../lib/toast';
import { fmtDuration } from '../lib/units';
import { plural } from '../lib/format';
import { DATASET } from '../lib/library/catalog';
import { Segmented, Switch, TopBar } from '../components/Common';
import { Minus, Plus } from '../components/Icons';
import { SettingsExtras } from './SettingsExtras';

async function exportBackup() {
  const name = `gym-tracker-backup-${todayKey()}.json`;
  await saveFile(new File([backupJson()], name, { type: 'application/json' }), 'Gym Tracker backup');
}

export function Settings() {
  const data = useData();
  const s = data.settings;
  const [importError, setImportError] = useState('');

  const importBackup = async (file: File) => {
    setImportError('');
    try {
      const next = parseBackup(await file.text());
      const count = next.workouts.length;
      if (!confirm(`Replace what's on this device with the backup (${plural(count, 'workout')}, ${plural(next.routines.length, 'routine')})?`)) return;
      restoreBackup(next);
      showToast(`Restored ${plural(count, 'workout')}`);
    } catch (err) {
      setImportError((err as Error).message);
    }
  };

  const rest = (by: number) => updateSettings({ restSeconds: Math.min(600, Math.max(0, s.restSeconds + by)) });

  return (
    <main class="screen settings">
      <TopBar title="Settings" />

      <section class="card stack-12" aria-labelledby="training-title">
        <h2 id="training-title" class="section-title">
          Training
        </h2>
        <div class="field">
          <span class="field-label" id="units-label">
            Units
          </span>
          <Segmented
            label="Units"
            value={s.units}
            options={[
              { value: 'kg', label: 'Kilograms (kg)' },
              { value: 'lb', label: 'Pounds (lb)' },
            ]}
            onChange={(units) => updateSettings({ units })}
          />
          <span class="field-hint">
            Weights are kept in kg and shown in the unit you pick, so switching never changes your numbers. Distances follow: km and
            m, or miles and yards.
          </span>
        </div>
        <div class="field">
          <span class="field-label" id="rest-label">
            Rest timer
          </span>
          <div class="stepper" role="group" aria-labelledby="rest-label">
            <button type="button" class="icon-btn" aria-label="15 seconds less" disabled={s.restSeconds <= 0} onClick={() => rest(-15)}>
              <Minus />
            </button>
            <output class="stepper-value num" aria-live="polite">
              {s.restSeconds > 0 ? fmtDuration(s.restSeconds) : 'Off'}
            </output>
            <button type="button" class="icon-btn" aria-label="15 seconds more" disabled={s.restSeconds >= 600} onClick={() => rest(15)}>
              <Plus />
            </button>
          </div>
          <span class="field-hint">The rest after each set, unless an exercise has its own (set it from the exercise's timer button).</span>
        </div>
        <Switch
          id="auto-rest"
          checked={s.autoRest}
          label="Start the rest timer after each set"
          hint="The timer shows on screen. iPhone web apps can't sound an alarm or vibrate while the phone is locked."
          onChange={(autoRest) => updateSettings({ autoRest })}
        />
        <Switch
          id="keep-awake"
          checked={s.keepAwake}
          label="Keep the screen on during a workout"
          hint="Where the browser allows it. Uses a little more battery."
          onChange={(keepAwake) => updateSettings({ keepAwake })}
        />
      </section>

      <SettingsExtras />

      <section class="card stack-12" aria-labelledby="data-title">
        <h2 id="data-title" class="section-title">
          Your data
        </h2>
        <p class="body-text">
          Everything is saved on this device as you go ({plural(data.workouts.length, 'workout')}, {plural(data.routines.length, 'routine')}), and on your
          other devices if sync is on. Export a backup now and then and keep it in Files or iCloud Drive. Backups never contain your sync
          key.
        </p>
        <div class="button-pair">
          <button type="button" class="btn-secondary" onClick={() => exportBackup()}>
            Export backup
          </button>
          <label class="btn-secondary file-btn">
            Import backup
            <input
              type="file"
              accept="application/json,.json"
              class="sr-only"
              onChange={(e) => {
                const input = e.target as HTMLInputElement;
                const file = input.files?.[0];
                input.value = '';
                if (file) importBackup(file);
              }}
            />
          </label>
        </div>
        {importError && (
          <p class="field-hint error-text" role="alert">
            {importError}
          </p>
        )}
        <button
          type="button"
          class="link-btn left danger"
          onClick={() => {
            if (confirm('Delete every workout, routine and custom exercise — on this device and every synced one? This cannot be undone.')) {
              clearAll();
              showToast('Everything was deleted');
            }
          }}
        >
          Delete everything
        </button>
      </section>

      <section class="card stack-12" aria-labelledby="install-title">
        <h2 id="install-title" class="section-title">
          Use it like an app
        </h2>
        <p class="body-text">
          On iPhone, open this page in Safari, tap <strong>Share</strong>, then <strong>Add to Home Screen</strong>. It then opens full screen from its
          own icon and works offline at the gym. On a Windows PC, use the install button in Edge's or Chrome's address bar.
        </p>
        <p class="body-text">
          <strong>On iPhone the Home Screen app keeps its own data, separate from Safari.</strong> Workouts logged in a Safari tab don't show up
          in the Home Screen app (and the other way round) — so always open it from the icon, or turn on sync. Removing the icon can delete its
          data, so export a backup first.
        </p>
      </section>

      <section class="card stack-8" aria-labelledby="credits-title">
        <h2 id="credits-title" class="section-title">
          Credits
        </h2>
        <p class="body-text">
          Exercises, instructions and photos come from{' '}
          <a href={`https://github.com/${DATASET.repo}`} target="_blank" rel="noopener noreferrer">
            free-exercise-db
          </a>{' '}
          by yuhonas, released into the public domain (the Unlicense). This version uses commit{' '}
          <a href={`https://github.com/${DATASET.repo}/tree/${DATASET.commit}`} target="_blank" rel="noopener noreferrer" class="mono-link">
            {DATASET.commit.slice(0, 7)}
          </a>
          , with clearer names, search words and a few extra exercises added.
        </p>
        <p class="body-text">Fonts: Bricolage Grotesque and Figtree (SIL Open Font License).</p>
      </section>

      <p class="app-version">Version {__APP_VERSION__}</p>
    </main>
  );
}
