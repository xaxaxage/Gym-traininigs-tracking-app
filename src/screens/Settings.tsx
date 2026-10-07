import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { backupJson, clearAll, finishedWorkouts, parseBackup, restoreBackup, updateSettings, useData } from '../lib/store';
import { todayKey } from '../lib/dates';
import { saveFile } from '../lib/files';
import { showToast } from '../lib/toast';
import { fmtDuration } from '../lib/units';
import { plural } from '../lib/format';
import { DATASET } from '../lib/library/catalog';
import { AUTO_THEME, HARBOR, PALETTES } from '../lib/theme';
import { useSyncStatus } from '../lib/sync/state';
import { Segmented, Switch, TopBar } from '../components/Common';
import { Archive, Chat, ChevronRight, Download, HistoryIcon as History, Info, Minus, Palette, Plus, SyncIcon, Trash, Upload } from '../components/Icons';
import { AppearanceSettings } from './AppearanceSettings';
import { SyncSettings } from './SyncSettings';
import { ClaudeSettings } from './ClaudeSettings';

export type SettingsPage = 'appearance' | 'sync' | 'claude' | 'data' | 'versions' | 'about';

export const SETTINGS_PAGES: Record<SettingsPage, string> = {
  appearance: 'Appearance',
  sync: 'Sync between devices',
  claude: 'Use with Claude',
  data: 'Backup and data',
  versions: 'Design versions',
  about: 'About',
};

export function isSettingsPage(s: string | undefined): s is SettingsPage {
  return !!s && s in SETTINGS_PAGES;
}

/** Settings: training options right here, everything else one tap away. */
export function Settings({ page }: { page?: SettingsPage }) {
  if (page) {
    return (
      <main class="screen settings-page">
        <TopBar title={SETTINGS_PAGES[page]} back="/settings" />
        {page === 'appearance' && <AppearanceSettings />}
        {page === 'sync' && <SyncSettings />}
        {page === 'claude' && <ClaudeSettings />}
        {page === 'data' && <DataSettings />}
        {page === 'versions' && <DesignVersions />}
        {page === 'about' && <About />}
      </main>
    );
  }
  return <SettingsHome />;
}

function LinkRow({ href, icon, tone, label, value }: { href: string; icon: ComponentChildren; tone?: string; label: string; value?: string }) {
  return (
    <a href={href} class="setting">
      <span class={`setting-icon${tone ? ` ${tone}` : ''}`} aria-hidden="true">
        {icon}
      </span>
      <span class="setting-label">{label}</span>
      {value && <span class="setting-value">{value}</span>}
      <ChevronRight size={18} />
    </a>
  );
}

function SettingsHome() {
  const data = useData();
  const s = data.settings;
  const sync = useSyncStatus();
  const rest = (by: number) => updateSettings({ restSeconds: Math.min(600, Math.max(0, s.restSeconds + by)) });
  const palette =
    s.theme === AUTO_THEME ? 'Auto' : (PALETTES.find((p) => p.id === s.theme) ?? HARBOR).name;

  return (
    <main class="screen settings-page">
      <TopBar title="Settings" />

      <section class="group-section" aria-labelledby="training-title">
        <h2 id="training-title" class="list-label">
          Training
        </h2>
        <div class="group">
          <div class="setting">
            <span class="setting-label" id="units-label">
              Units
            </span>
            <Segmented
              label="Units"
              value={s.units}
              options={[
                { value: 'kg', label: 'kg' },
                { value: 'lb', label: 'lb' },
              ]}
              onChange={(units) => updateSettings({ units })}
            />
          </div>
          <div class="setting">
            <span class="setting-label" id="rest-label">
              Rest between sets
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
          </div>
          <Switch id="auto-rest" checked={s.autoRest} label="Start rest timer after a set" onChange={(autoRest) => updateSettings({ autoRest })} />
          <Switch id="keep-awake" checked={s.keepAwake} label="Keep the screen on" hint="While a workout is going" onChange={(keepAwake) => updateSettings({ keepAwake })} />
        </div>
        <p class="group-note">
          Switching units never changes your numbers. An exercise can have its own rest time — tap the timer on its card. The
          timer shows on screen only: a Home Screen web app can't ring while the phone is locked.
        </p>
      </section>

      <section class="group-section" aria-label="More settings">
        <div class="group">
          <LinkRow href="#/settings/appearance" icon={<Palette size={18} />} tone="accent" label="Appearance" value={palette} />
          <LinkRow href="#/settings/sync" icon={<SyncIcon size={18} />} tone="success" label="Sync between devices" value={sync.state === 'off' ? 'Off' : 'On'} />
          <LinkRow href="#/settings/claude" icon={<Chat size={18} />} label="Use with Claude" />
        </div>
      </section>

      <section class="group-section" aria-label="Data and about">
        <div class="group">
          <LinkRow href="#/settings/data" icon={<Archive size={18} />} tone="ink" label="Backup and data" value={plural(finishedWorkouts(data).length, 'workout')} />
          <LinkRow href="#/settings/versions" icon={<History size={18} />} tone="ink" label="Design versions" />
          <LinkRow href="#/settings/about" icon={<Info size={18} />} tone="ink" label="About and installing" />
        </div>
      </section>

      <p class="app-version">Version {__APP_VERSION__}</p>
    </main>
  );
}

async function exportBackup() {
  const name = `gym-tracker-backup-${todayKey()}.json`;
  await saveFile(new File([backupJson()], name, { type: 'application/json' }), 'Gym Tracker backup');
}

function DataSettings() {
  const data = useData();
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

  return (
    <>
      <p class="lead">
        Everything is saved on this device as you go — {plural(finishedWorkouts(data).length, 'workout')}, {plural(data.routines.length, 'routine')}
        {data.customExercises.length ? `, ${plural(data.customExercises.length, 'custom exercise')}` : ''}.
      </p>
      <section class="group-section" aria-labelledby="backup-title">
        <h2 id="backup-title" class="list-label">
          Backup
        </h2>
        <div class="group">
          <button type="button" class="setting setting-button" onClick={() => exportBackup()}>
            <span class="setting-icon" aria-hidden="true">
              <Download size={18} />
            </span>
            <span class="setting-label">Export backup</span>
          </button>
          <label class="setting setting-button file-btn">
            <span class="setting-icon" aria-hidden="true">
              <Upload size={18} />
            </span>
            <span class="setting-label">Import backup</span>
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
        <p class="group-note">
          Export one now and then and keep it in Files or iCloud Drive. A backup holds your workouts, routines, exercises and
          settings — never your sync key. Importing replaces what's on this device.
        </p>
      </section>
      <section class="group-section" aria-label="Delete">
        <div class="group">
          <button
            type="button"
            class="setting setting-button danger"
            onClick={() => {
              if (confirm('Delete every workout, routine and custom exercise — on this device and every synced one? This cannot be undone.')) {
                clearAll();
                showToast('Everything was deleted');
              }
            }}
          >
            <span class="setting-icon danger" aria-hidden="true">
              <Trash size={18} />
            </span>
            <span class="setting-label">Delete everything</span>
          </button>
        </div>
        <p class="group-note">Also on your other devices, if sync is on.</p>
      </section>
    </>
  );
}

export interface SavedVersion {
  tag: string;
  label: string;
  date: string;
  commit: string;
}

type VersionList = { state: 'loading' } | { state: 'ready'; versions: SavedVersion[] } | { state: 'error' };

/**
 * Earlier designs, built next to the app by scripts/build-versions.mjs. Each
 * opens as a preview that reads your data but keeps nothing it changes.
 */
function DesignVersions() {
  const [list, setList] = useState<VersionList>({ state: 'loading' });
  useEffect(() => {
    let live = true;
    fetch('./versions.json', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((json: { versions?: SavedVersion[] }) => live && setList({ state: 'ready', versions: Array.isArray(json.versions) ? json.versions : [] }))
      .catch(() => live && setList({ state: 'error' }));
    return () => {
      live = false;
    };
  }, []);
  const [when, commit] = __APP_VERSION__.split(' · ');

  return (
    <>
      <p class="lead">Open an earlier design to compare it with this one, using your own workouts and routines.</p>
      <section class="group-section" aria-labelledby="versions-title">
        <h2 id="versions-title" class="list-label">
          Versions
        </h2>
        <ul class="group">
          <li class="setting">
            <span class="setting-label">
              This version
              <span class="muted">
                {when}
                {commit ? ` · ${commit}` : ''}
              </span>
            </span>
            <span class="badge">In use</span>
          </li>
          {list.state === 'ready' &&
            list.versions.map((v) => (
              <li>
                <a class="setting" href={`./versions/${encodeURIComponent(v.tag)}/`} aria-label={`Open ${v.label} (${v.tag})`}>
                  <span class="setting-label">
                    {v.label}
                    <span class="muted">
                      {v.tag} · {v.date} · {v.commit}
                    </span>
                  </span>
                  <span class="setting-value">Open</span>
                  <ChevronRight size={18} />
                </a>
              </li>
            ))}
        </ul>
        {list.state === 'loading' && <p class="group-note">Looking for saved versions…</p>}
        {list.state === 'ready' && list.versions.length === 0 && <p class="group-note">No earlier versions are saved in this build.</p>}
        {list.state === 'error' && <p class="group-note">The list of versions couldn't be loaded. It needs a connection.</p>}
      </section>
      <div class="notice info plain">
        <strong>Your data is safe in a preview.</strong> It shows your workouts as they are now, but nothing you change there is
        kept, and sync is off. Back in this version, everything is as you left it.
      </div>
      <p class="group-note">
        To save the current design as a version, tag its commit <code>design-…</code> with a short description — see “Design
        versions” in the README.
      </p>
    </>
  );
}

function About() {
  return (
    <>
      <section class="page-section" aria-labelledby="install-title">
        <h2 id="install-title" class="section-title">
          Use it like an app
        </h2>
        <ol class="steps">
          <li>
            On iPhone, open this page in Safari, tap <strong>Share</strong>, then <strong>Add to Home Screen</strong>.
          </li>
          <li>On a Windows PC, use the install button in Edge's or Chrome's address bar.</li>
          <li>It then opens full screen from its own icon and works offline at the gym.</li>
        </ol>
        <div class="notice plain">
          <strong>The Home Screen app keeps its own data, separate from Safari.</strong> Always open it from the icon, or turn
          on sync. Removing the icon can delete its data, so export a backup first.
        </div>
      </section>

      <section class="page-section" aria-labelledby="credits-title">
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
    </>
  );
}
