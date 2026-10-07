import type { ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useState } from 'preact/hooks';
import { backupJson, clearAll, finishedWorkouts, parseBackup, restoreBackup, updateSettings, useData } from '../lib/store';
import { todayKey } from '../lib/dates';
import { saveFile } from '../lib/files';
import { showToast } from '../lib/toast';
import { fmtDuration } from '../lib/units';
import { plural } from '../lib/format';
import { DATASET } from '../lib/library/catalog';
import { Segmented, Switch, TopBar } from '../components/Common';
import { ChevronRight, Minus, Plus } from '../components/Icons';
import { AppearanceSettings } from './AppearanceSettings';
import { SyncSettings } from './SyncSettings';
import { ClaudeSettings } from './ClaudeSettings';
import { ExerciseSettings } from './ExerciseSettings';

/** The sections of the one Settings page; #/settings/<section> scrolls to one. */
export const SETTINGS_SECTIONS = {
  training: 'Training',
  exercises: 'Exercises and AI',
  appearance: 'Appearance',
  sync: 'Sync between devices',
  claude: 'Use with Claude',
  data: 'Backup and data',
  versions: 'Design versions',
  about: 'About',
} as const;

export type SettingsSection = keyof typeof SETTINGS_SECTIONS;

export function isSettingsSection(s: string | undefined): s is SettingsSection {
  return !!s && s in SETTINGS_SECTIONS;
}

function Section({ id, children }: { id: SettingsSection; children: ComponentChildren }) {
  return (
    <section id={`settings-${id}`} class="settings-section" aria-labelledby={`settings-${id}-title`}>
      <h2 id={`settings-${id}-title`}>{SETTINGS_SECTIONS[id]}</h2>
      {children}
    </section>
  );
}

/** Everything on one page, in the order it's most often needed. */
export function Settings({ section }: { section?: SettingsSection }) {
  useLayoutEffect(() => {
    if (section && section !== 'training') document.getElementById(`settings-${section}`)?.scrollIntoView({ block: 'start' });
  }, [section]);

  return (
    <main class="screen settings-page">
      <TopBar title="Settings" />
      <Section id="training">
        <TrainingSettings />
      </Section>
      <Section id="exercises">
        <ExerciseSettings />
      </Section>
      <Section id="appearance">
        <AppearanceSettings />
      </Section>
      <Section id="sync">
        <SyncSettings />
      </Section>
      <Section id="claude">
        <ClaudeSettings />
      </Section>
      <Section id="data">
        <DataSettings />
      </Section>
      <Section id="versions">
        <DesignVersions />
      </Section>
      <Section id="about">
        <About />
      </Section>
    </main>
  );
}

function TrainingSettings() {
  const s = useData().settings;
  const rest = (by: number) => updateSettings({ restSeconds: Math.min(600, Math.max(0, s.restSeconds + by)) });
  return (
    <>
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
        Switching units never changes your numbers. An exercise can have its own rest time. The timer shows on screen only: a
        Home Screen web app can't ring while the phone is locked.
      </p>
    </>
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
      <div class="group">
        <button type="button" class="setting setting-button" onClick={() => exportBackup()}>
          <span class="setting-label">
            Export backup
            <span class="muted">
              {plural(finishedWorkouts(data).length, 'workout')}, {plural(data.routines.length, 'routine')}
              {data.customExercises.length ? `, ${plural(data.customExercises.length, 'own exercise')}` : ''}
            </span>
          </span>
          <ChevronRight size={18} />
        </button>
        <label class="setting setting-button file-btn">
          <span class="setting-label">
            Import backup
            <span class="muted">Replaces what's on this device</span>
          </span>
          <ChevronRight size={18} />
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
          <span class="setting-label">
            Delete everything
            <span class="muted">Also on your other devices, if sync is on</span>
          </span>
        </button>
      </div>
      {importError && (
        <p class="field-hint error-text" role="alert">
          {importError}
        </p>
      )}
      <p class="group-note">
        Everything is saved on this device as you go. Export a backup now and then and keep it in Files or iCloud Drive. A backup
        never holds your sync key or AI key.
      </p>
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
      <ul class="group">
        <li class="setting">
          <span class="setting-label">
            This version
            <span class="muted num">
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
                  <span class="muted num">
                    {v.tag} · {v.date}
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
      <p class="group-note">
        Open an earlier design to compare it, with your own workouts. Nothing you change in a preview is kept, and sync is off
        there. To save a design as a version, add its commit to <code>design-versions.json</code> (see the README).
      </p>
    </>
  );
}

function About() {
  return (
    <>
      <details class="fold">
        <summary>Use it like an app</summary>
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
      </details>
      <details class="fold">
        <summary>Credits</summary>
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
        <p class="body-text">Fonts: IBM Plex Sans and IBM Plex Mono (SIL Open Font License).</p>
      </details>
      <p class="app-version">Version {__APP_VERSION__}</p>
    </>
  );
}
