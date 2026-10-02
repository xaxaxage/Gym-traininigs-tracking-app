import { useEffect, useRef, useState } from 'preact/hooks';
import { DEFAULT_RELAYS, isRelayUrl, loadSyncConfig, useSyncStatus, type SyncStatus } from '../lib/sync/state';
import { deviceShown, type DevicePart, type DeviceType } from '../lib/sync/parts';
import { renameThisDevice, thisDevice } from '../lib/sync/device';
import { showToast } from '../lib/toast';
import { Chat, ComputerIcon, Pencil, PhoneIcon, TabletIcon, Trash } from '../components/Icons';

type Mode = 'idle' | 'create' | 'join' | 'show' | 'change';

const crypto = () => import('../lib/sync/crypto');
const engine = () => import('../lib/sync/engine');

function ago(ms: number | undefined): string {
  if (!ms) return 'not yet';
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86_400) return `${Math.round(s / 3600)} h ago`;
  return new Date(ms).toLocaleDateString();
}

function statusText(s: SyncStatus): string {
  const relays = s.relaysTotal ? ` · ${s.relaysOk ?? 0} of ${s.relaysTotal} relays` : '';
  switch (s.state) {
    case 'syncing':
      return 'Syncing…';
    case 'synced':
      return `Synced ${ago(s.lastSyncAt)}${relays}`;
    case 'offline':
      return s.message ?? 'Offline — will sync when connected';
    case 'error':
      return s.message ?? 'Sync failed';
    default:
      return 'Off';
  }
}

export async function copy(text: string, what = 'Sync key') {
  try {
    await navigator.clipboard.writeText(text);
    showToast(`${what} copied`);
  } catch {
    showToast('Copy failed — select the text and copy it instead');
  }
}

function Words({ phrase }: { phrase: string }) {
  return (
    <ol class="words" aria-label="Sync key">
      {phrase.split(' ').map((w) => (
        <li>{w}</li>
      ))}
    </ol>
  );
}

const DEVICE_ICON: Record<DeviceType, typeof Chat> = { phone: PhoneIcon, tablet: TabletIcon, computer: ComputerIcon, claude: Chat };

/** Every device using the sync key, this one first, then by when they were last used. */
function DeviceList({ devices }: { devices: Record<string, DevicePart> }) {
  const me = thisDevice();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState('');
  const nameInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (renaming) nameInput.current?.select();
  }, [renaming]);
  const mine: DevicePart = {
    kind: 'device',
    name: `device:${me.id}`,
    id: me.id,
    deviceName: me.name,
    type: me.type,
    version: __APP_VERSION__,
    seenAt: Date.now(),
  };
  const others = Object.values(devices)
    .filter((d) => d.id !== me.id && deviceShown(d))
    .sort((a, b) => b.seenAt - a.seenAt);
  const list = [mine, ...others];

  const saveName = async (e: Event) => {
    e.preventDefault();
    renameThisDevice(name);
    setRenaming(false);
    const { announceNow } = await engine();
    await announceNow().catch(() => undefined);
  };

  const remove = async (d: DevicePart) => {
    const ok = confirm(
      `Remove "${d.deviceName}" from the list?\n\nThis only hides it: if it's still used with this sync key, it shows up again. To stop a device from syncing, change the sync key.`,
    );
    if (!ok) return;
    try {
      const { removeDevice } = await engine();
      await removeDevice(d.id);
      showToast(`Removed ${d.deviceName}`);
    } catch (err) {
      showToast((err as Error).message || 'Could not remove it. Try again.');
    }
  };

  return (
    <div class="stack-8">
      <h3 id="devices-title" class="field-label">
        Devices ({list.length})
      </h3>
      <ul class="device-list" aria-labelledby="devices-title">
        {list.map((d) => {
          const Icon = DEVICE_ICON[d.type] ?? ComputerIcon;
          const isMe = d.id === me.id;
          return (
            <li key={d.id} class="device-row">
              <span class="device-icon">
                <Icon size={20} />
              </span>
              {isMe && renaming ? (
                <form class="device-rename" onSubmit={saveName}>
                  <input
                    id="device-name"
                    class="input"
                    aria-label="Name for this device"
                    maxLength={60}
                    placeholder={me.name}
                    value={name}
                    onInput={(e) => setName((e.target as HTMLInputElement).value)}
                    ref={nameInput}
                  />
                  <button type="submit" class="link-btn">
                    Save
                  </button>
                  <button type="button" class="link-btn" onClick={() => setRenaming(false)}>
                    Cancel
                  </button>
                </form>
              ) : (
                <div class="row-main device-text">
                  <span class="device-name">{d.deviceName}</span>
                  <span class="muted small-text">
                    {isMe ? 'This device' : `Active ${ago(d.seenAt)}`}
                    {d.version ? ` · ${d.version}` : ''}
                  </span>
                </div>
              )}
              {isMe
                ? !renaming && (
                    <button
                      type="button"
                      class="part-remove"
                      aria-label="Rename this device"
                      onClick={() => {
                        setName(me.name);
                        setRenaming(true);
                      }}
                    >
                      <Pencil size={18} />
                    </button>
                  )
                : (
                    <button type="button" class="part-remove" aria-label={`Remove ${d.deviceName}`} onClick={() => remove(d)}>
                      <Trash size={18} />
                    </button>
                  )}
            </li>
          );
        })}
      </ul>
      <p class="field-hint">
        Each device appears once it has synced with this version of the app. Removing one only hides it; to stop a device
        from syncing, change the sync key.
      </p>
    </div>
  );
}

export function SyncSettings() {
  const status = useSyncStatus();
  const retiredAt = loadSyncConfig()?.retiredAt;
  const enabled = status.state !== 'off' && !retiredAt;
  const [mode, setMode] = useState<Mode>('idle');
  const [phrase, setPhrase] = useState('');
  const [saved, setSaved] = useState(false);
  const [input, setInput] = useState('');
  const [valid, setValid] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [relayText, setRelayText] = useState('');

  // Fill the relay list once sync is on (not when the section opens, which could overwrite typing).
  useEffect(() => {
    if (enabled) setRelayText((loadSyncConfig()?.relays ?? DEFAULT_RELAYS).join('\n'));
  }, [enabled]);

  useEffect(() => {
    if (mode !== 'join') return;
    let live = true;
    crypto().then(({ isValidPhrase }) => live && setValid(isValidPhrase(input)));
    return () => {
      live = false;
    };
  }, [mode, input]);

  const start = async (words: string, joining: boolean) => {
    setBusy(true);
    setError('');
    try {
      const { enableSync } = await engine();
      const { added } = await enableSync(words);
      setMode('idle');
      setPhrase('');
      setInput('');
      showToast(
        joining
          ? added > 0
            ? `Sync is on — ${added} ${added === 1 ? 'workout' : 'workouts'} added from your other devices`
            : 'Sync is on'
          : 'Sync is on',
      );
    } catch (err) {
      setError((err as Error).message || 'Could not start sync.');
    } finally {
      setBusy(false);
    }
  };

  const openCreate = async () => {
    const { newPhrase } = await crypto();
    setPhrase(newPhrase());
    setSaved(false);
    setMode('create');
  };

  const openChange = async () => {
    const { newPhrase } = await crypto();
    setPhrase(newPhrase());
    setSaved(false);
    setError('');
    setMode('change');
  };

  const changeKey = async () => {
    setBusy(true);
    setError('');
    try {
      const { changeSyncKey } = await engine();
      await changeSyncKey(phrase);
      setPhrase('');
      setMode('show');
      showToast('Sync key changed. Enter the new key on your other devices.');
    } catch (err) {
      setError((err as Error).message || 'Could not change the sync key.');
    } finally {
      setBusy(false);
    }
  };

  if (!enabled) {
    return (
      <section class="page-section" aria-label="Sync between devices">

        {mode === 'idle' && retiredAt && (
          <>
            <div class="notice plain" role="status">
              The sync key was changed on another device on {new Date(retiredAt).toLocaleDateString()}, so this device
              stopped syncing. Enter the new key to continue — what's on this device is kept and combined with the synced
              data.
            </div>
            <button type="button" class="btn-primary" onClick={() => setMode('join')}>
              Enter the new key
            </button>
            <button
              type="button"
              class="link-btn left danger"
              onClick={async () => {
                const { disableSync } = await engine();
                disableSync();
                showToast('Sync turned off on this device');
              }}
            >
              Turn off sync on this device
            </button>
          </>
        )}

        {mode === 'idle' && !retiredAt && (
          <>
            <p class="lead">
              Use the same training log on your iPhone and your computer. A <strong>12-word sync key</strong> links them;
              everything is encrypted on this device before it's sent. No account needed.
            </p>
            <div class="button-pair">
              <button type="button" class="btn-tonal" onClick={() => setMode('join')}>
                I have a key
              </button>
              <button type="button" class="btn-primary" onClick={openCreate}>
                Create sync key
              </button>
            </div>
          </>
        )}

        {mode === 'create' && (
          <>
            <p class="body-text">
              This is your sync key. <strong>Save it somewhere safe</strong> (a password manager or Notes) — you'll type it
              on your other devices. Anyone with these words can read and change your training log.
            </p>
            <Words phrase={phrase} />
            <button type="button" class="btn-tonal" onClick={() => copy(phrase)}>
              Copy the 12 words
            </button>
            <label class="toggle-row">
              <input type="checkbox" checked={saved} onChange={(e) => setSaved((e.target as HTMLInputElement).checked)} />
              <span>I've saved my sync key</span>
            </label>
            {error && <div class="notice plain">{error}</div>}
            <div class="button-pair">
              <button type="button" class="btn-tonal" disabled={busy} onClick={() => setMode('idle')}>
                Cancel
              </button>
              <button type="button" class="btn-primary" disabled={!saved || busy} onClick={() => start(phrase, false)}>
                {busy ? 'Starting…' : 'Start syncing'}
              </button>
            </div>
          </>
        )}

        {mode === 'join' && (
          <form
            class="stack-12"
            onSubmit={(e) => {
              e.preventDefault();
              if (valid && !busy) start(input, true);
            }}
          >
            <label for="sync-phrase" class="field-label">
              Sync key from your other device
            </label>
            <textarea
              id="sync-phrase"
              class="input textarea mono"
              rows={3}
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellcheck={false}
              placeholder="12 words, separated by spaces"
              value={input}
              onInput={(e) => setInput((e.target as HTMLTextAreaElement).value)}
            />
            {input.trim() && !valid && (
              <span class="field-hint">That's not a complete sync key yet — check all 12 words.</span>
            )}
            <p class="field-hint">
              What's on this device is combined with what's already synced — nothing gets overwritten.
            </p>
            {error && <div class="notice plain">{error}</div>}
            <div class="button-pair">
              <button type="button" class="btn-tonal" disabled={busy} onClick={() => setMode('idle')}>
                Cancel
              </button>
              <button type="submit" class="btn-primary" disabled={!valid || busy}>
                {busy ? 'Connecting…' : 'Connect'}
              </button>
            </div>
          </form>
        )}
      </section>
    );
  }

  const config = loadSyncConfig();
  return (
    <section class="page-section" aria-label="Sync between devices">
      <div class={`sync-status ${status.state}`} role="status">
        <span class="sync-dot" aria-hidden="true" />
        <span>{statusText(status)}</span>
      </div>
      <div class="button-pair">
        <button type="button" class="btn-tonal" onClick={() => setMode(mode === 'show' ? 'idle' : 'show')}>
          {mode === 'show' ? 'Hide sync key' : 'Show sync key'}
        </button>
        <button
          type="button"
          class="btn-primary"
          disabled={status.state === 'syncing'}
          onClick={async () => {
            const { syncNow } = await engine();
            const { added } = await syncNow();
            if (added > 0) showToast(`${added} ${added === 1 ? 'workout' : 'workouts'} synced from other devices`);
          }}
        >
          Sync now
        </button>
      </div>

      {mode === 'show' && config && (
        <>
          <p class="body-text">
            To add a device: open the app there, go to <strong>Settings → Sync between devices → I have a key</strong>, and
            enter these words.
          </p>
          <Words phrase={config.phrase} />
          <button type="button" class="btn-tonal" onClick={() => copy(config.phrase)}>
            Copy the 12 words
          </button>
        </>
      )}

      <DeviceList devices={config?.devices ?? {}} />

      <details class="fold relays">
        <summary>Relays ({config?.relays.length ?? 0})</summary>
        <p class="field-hint">
          Free public Nostr relays that pass the encrypted data between your devices. One per line; every device should
          use at least one relay in common.
        </p>
        <textarea
          class="input textarea mono"
          rows={4}
          autoCapitalize="off"
          autoCorrect="off"
          spellcheck={false}
          value={relayText}
          onInput={(e) => setRelayText((e.target as HTMLTextAreaElement).value)}
        />
        <div class="button-pair">
          <button type="button" class="btn-tonal" onClick={() => setRelayText(DEFAULT_RELAYS.join('\n'))}>
            Defaults
          </button>
          <button
            type="button"
            class="btn-primary"
            onClick={async () => {
              const relays = relayText.split(/\s+/).filter(isRelayUrl);
              if (relays.length === 0) return showToast('Add at least one wss:// relay');
              const { setRelays } = await engine();
              await setRelays(relays);
              showToast('Relays saved');
            }}
          >
            Save relays
          </button>
        </div>
      </details>

      {mode === 'change' ? (
        <div class="stack-12 change-key">
          <h3 class="field-label">Change sync key</h3>
          <p class="body-text">
            This is your <strong>new sync key</strong>. Everything moves to it, and the old key stops working: devices still
            using it stop syncing until you enter the new key there. Use this if a device is lost or someone else has seen
            your words. <strong>Save the new words</strong> — you'll enter them on each device you keep, and copy your new
            Claude connector address (or paste them in Claude Desktop, if you use it).
          </p>
          <Words phrase={phrase} />
          <button type="button" class="btn-tonal" onClick={() => copy(phrase)}>
            Copy the 12 words
          </button>
          <label class="toggle-row">
            <input type="checkbox" checked={saved} onChange={(e) => setSaved((e.target as HTMLInputElement).checked)} />
            <span>I've saved the new key</span>
          </label>
          {error && <div class="notice plain">{error}</div>}
          <div class="button-pair">
            <button type="button" class="btn-tonal" disabled={busy} onClick={() => setMode('idle')}>
              Cancel
            </button>
            <button type="button" class="btn-primary" disabled={!saved || busy} onClick={changeKey}>
              {busy ? 'Switching…' : 'Switch to the new key'}
            </button>
          </div>
        </div>
      ) : (
        <button type="button" class="link-btn left" onClick={openChange}>
          Change sync key
        </button>
      )}

      <button
        type="button"
        class="link-btn left danger"
        onClick={async () => {
          if (!confirm('Stop syncing on this device? Your workouts stay here, and your other devices keep theirs.')) return;
          const { disableSync } = await engine();
          disableSync();
          setMode('idle');
          showToast('Sync turned off on this device');
        }}
      >
        Turn off sync on this device
      </button>
    </section>
  );
}
