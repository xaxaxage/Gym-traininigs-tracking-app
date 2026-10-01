import { SimplePool } from 'nostr-tools/pool';
import { finalizeEvent, type Event } from 'nostr-tools/pure';
import { normalizeURL } from 'nostr-tools/utils';
import { applyMerged, getData, subscribe } from '../store';
import { buildParts, devicePartName, mergePart, parsePart, type DevicePart } from './parts';
import { decryptText, deriveKeys, encryptText, normalizePhrase, partLabel, sha256, type SyncKeys } from './crypto';
import { thisDevice } from './device';
import { firstAccepted } from './wait';
import {
  clearSyncConfig,
  DEFAULT_RELAYS,
  getSyncStatus,
  loadSyncConfig,
  saveSyncConfig,
  setSyncStatus,
  type SyncConfig,
} from './state';

/**
 * Device sync over Nostr relays (NIP-78 app data). Each part of the data is a
 * replaceable event (kind 30078) labelled with an opaque tag; its content is
 * encrypted with a key only phrase holders have. Every device keeps its full
 * copy, merges what it receives and uploads parts that differ, so the relays
 * are a meeting point rather than the source of truth.
 */

const KIND = 30078;
/** strfry relays reject events over 64 KB; stay well below. */
const MAX_CONTENT = 60_000;
const PUSH_DELAY = 2500;
const FULL_SYNC_MIN_GAP = 20_000;
/** How often a device in use tells the others it's still around (for the device list). */
const ANNOUNCE_EVERY = 15 * 60_000;

export const RETIRED_MESSAGE =
  'This sync key was replaced on another device, so this device stopped syncing. Enter the new key to continue.';

let pool: SimplePool | null = null;
let keys: SyncKeys | null = null;
let config: SyncConfig | null = null;
let unsubscribeStore: (() => void) | null = null;
let pushTimer: ReturnType<typeof setTimeout> | undefined;
let lastFullSync = 0;
const labels = new Map<string, string>();
/** Bumped on every connect/disconnect; a sync step that started earlier stops instead of using the new connection. */
let generation = 0;

class Stale extends Error {}
function check(gen: number) {
  if (gen !== generation) throw new Stale();
}

// Run sync steps one at a time so a push never races a pull.
let chain: Promise<unknown> = Promise.resolve();
function queue<T>(task: () => Promise<T>): Promise<T | undefined> {
  const safe = () => task().catch((err) => {
    if (err instanceof Stale) return undefined; // superseded by a newer connection
    throw err;
  });
  const run = chain.then(safe, safe);
  chain = run.catch(() => undefined);
  return run;
}

async function labelFor(name: string): Promise<string> {
  let label = labels.get(name);
  if (!label) {
    label = await partLabel(keys!.nameKey, name);
    labels.set(name, label);
  }
  return label;
}

function relaysOk(): number {
  if (!pool || !config) return 0;
  const status = pool.listConnectionStatus();
  return config.relays.filter((r) => status.get(normalizeURL(r))).length;
}

function save() {
  if (config) saveSyncConfig(config);
}

function report(state: 'synced' | 'error' | 'offline' | 'syncing', message?: string) {
  setSyncStatus({
    state,
    message,
    lastSyncAt: config?.lastSyncAt,
    relaysOk: relaysOk(),
    relaysTotal: config?.relays.length ?? 0,
  });
}

/** After the first relay that really answered, wait this much longer for the others. */
const QUERY_GRACE = 2500;

/**
 * Ask every relay at once. A relay that accepts the connection but never
 * answers would otherwise hold up every sync for the whole wait, so once a
 * connected relay has answered, the rest get a short grace period.
 */
async function queryRelays(relays: string[], filter: Parameters<SimplePool['querySync']>[1], maxWait: number): Promise<Event[]> {
  if (!pool) return [];
  const p = pool;
  const events: Event[] = [];
  await new Promise<void>((resolve) => {
    let left = relays.length;
    let grace: ReturnType<typeof setTimeout> | undefined;
    if (left === 0) resolve();
    for (const url of relays) {
      p.querySync([url], filter, { maxWait })
        .catch(() => [] as Event[])
        .then((found) => {
          events.push(...found);
          if (--left === 0) {
            clearTimeout(grace);
            resolve();
          } else if (!grace && p.listConnectionStatus().get(normalizeURL(url))) {
            grace = setTimeout(resolve, QUERY_GRACE);
          }
        });
    }
  });
  return events;
}

/** Decrypt and merge one event; returns true if local data changed. */
async function takeEvent(event: Event): Promise<boolean> {
  if (!config || !keys || event.pubkey !== keys.pubkey || event.kind !== KIND) return false;
  const label = event.tags.find((t) => t[0] === 'd')?.[1];
  if (!label) return false;
  const known = config.seen[label];
  if (known && (known.id === event.id || event.created_at < known.createdAt)) return false;
  const gen = generation;

  let text: string;
  try {
    text = await decryptText(keys.encKey, event.content);
  } catch (err) {
    console.warn('Could not decrypt a sync part', err);
    return false;
  }
  check(gen);
  const part = parsePart(JSON.parse(text));
  if (!part) return false;
  const hash = await sha256(text);
  check(gen);
  config.seen[label] = { id: event.id, hash, createdAt: event.created_at };
  if (part.kind === 'retired') {
    retire(part.at);
    return false;
  }
  if (part.kind === 'device') {
    config.devices[part.id] = part;
    save();
    notify();
    return false;
  }

  const before = getData();
  const after = mergePart(before, part);
  if (after !== before) applyMerged(after);
  // If this device has something the relay's copy lacks, upload the merged version.
  const mine = buildParts(after).get(part.name);
  if (!mine || (await sha256(JSON.stringify(mine))) !== hash) schedulePush();
  return after !== before;
}

/** Encrypt and publish one part under the given keys. Resolves to the event, or null if no relay took it. */
async function publishWith(
  with_: SyncKeys,
  label: string,
  name: string,
  json: string,
  previous: number,
): Promise<{ id: string; createdAt: number } | null> {
  if (!pool || !config) return null;
  const content = await encryptText(with_.encKey, json);
  if (content.length > MAX_CONTENT) {
    throw new Error(`The part ${name} is too large to sync (${Math.round(content.length / 1000)} KB).`);
  }
  // Relays keep the newest version by timestamp, so never go backwards even if clocks differ.
  const createdAt = Math.max(Math.floor(Date.now() / 1000), previous + 1);
  const event = finalizeEvent({ kind: KIND, created_at: createdAt, tags: [['d', label]], content }, with_.secretKey);
  const gen = generation;
  const accepted = await firstAccepted(pool.publish(config.relays, event, { maxWait: 8000 }));
  check(gen);
  return accepted ? { id: event.id, createdAt } : null;
}

async function publishPart(name: string, json: string, hash: string): Promise<boolean> {
  if (!pool || !config || !keys) return false;
  const label = await labelFor(name);
  const sent = await publishWith(keys, label, name, json, config.seen[label]?.createdAt ?? 0);
  if (!sent) return false;
  config.seen[label] = { ...sent, hash };
  return true;
}

/** Tell the Settings screen something changed (the device list). */
function notify() {
  setSyncStatus({ ...getSyncStatus() });
}

/** This device's part, as it describes itself now. */
function myDevicePart(): DevicePart {
  const me = thisDevice();
  const known = config?.devices[me.id];
  return {
    kind: 'device',
    name: devicePartName(me.id),
    id: me.id,
    deviceName: me.name,
    type: me.type,
    version: __APP_VERSION__,
    // Being used again brings back a device that was removed from the list.
    seenAt: Math.max(Date.now(), (known?.removedAt ?? 0) + 1),
  };
}

/** Put this device in the list, or refresh when it was last active; at most every so often unless something changed. */
async function announce(force = false): Promise<void> {
  if (!config || !keys || config.retiredAt) return;
  const next = myDevicePart();
  const known = config.devices[next.id];
  const current =
    known &&
    !known.removedAt &&
    Date.now() - known.seenAt < ANNOUNCE_EVERY &&
    known.deviceName === next.deviceName &&
    known.type === next.type &&
    known.version === next.version;
  if (current && !force) return;
  const json = JSON.stringify(next);
  if (await publishPart(next.name, json, await sha256(json))) {
    config.devices[next.id] = next;
    save();
    notify();
  }
}

async function announceQuietly() {
  try {
    await announce();
  } catch (err) {
    if (err instanceof Stale) throw err;
    console.warn('Could not update the device list', err);
  }
}

/** Another device replaced this sync key: stop syncing, keep the data, and ask for the new key. */
function retire(at: number) {
  if (!config) return;
  config.retiredAt = at;
  save();
  disconnect();
  setSyncStatus({ state: 'error', message: RETIRED_MESSAGE });
}

/** Run tasks with at most `limit` at a time; resolves to how many returned false. */
async function runLimited(tasks: (() => Promise<boolean>)[], limit = 6): Promise<number> {
  let failed = 0;
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const task = tasks[next++];
      if (!(await task())) failed++;
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return failed;
}

/** Upload parts whose latest known copy on the relays differs from this device's. */
async function pushChanged(): Promise<void> {
  if (!config || !keys) return;
  const gen = generation;
  const uploads: (() => Promise<boolean>)[] = [];
  for (const part of buildParts(getData()).values()) {
    const json = JSON.stringify(part);
    const hash = await sha256(json);
    const label = await labelFor(part.name);
    check(gen);
    if (config.seen[label]?.hash === hash) continue;
    uploads.push(() => publishPart(part.name, json, hash));
  }
  const failed = await runLimited(uploads);
  check(gen);
  await announceQuietly();
  save();
  if (failed > 0) report('offline', "Couldn't reach any relay. Changes will upload when you're back online.");
  else {
    config.lastSyncAt = Date.now();
    save();
    report('synced');
  }
}

/** Download everything, merge, and upload whatever the relays are missing. */
async function fullSync(): Promise<{ added: number }> {
  if (!pool || !config || !keys) return { added: 0 };
  const gen = generation;
  report('syncing');
  lastFullSync = Date.now();
  const before = getData().workouts.length;

  const events = await queryRelays(config.relays, { kinds: [KIND], authors: [keys.pubkey], limit: 5000 }, 10_000);
  check(gen);
  if (relaysOk() === 0 && events.length === 0) {
    report('offline', "Couldn't reach any relay. Your data is safe on this device and will sync when you're online.");
    return { added: 0 };
  }

  // Newest version of each part (relays may hold different versions).
  const newest = new Map<string, Event>();
  for (const e of events) {
    const label = e.tags.find((t) => t[0] === 'd')?.[1];
    if (!label) continue;
    const cur = newest.get(label);
    if (!cur || e.created_at > cur.created_at || (e.created_at === cur.created_at && e.id < cur.id)) newest.set(label, e);
  }
  for (const e of [...newest.values()].sort((a, b) => a.created_at - b.created_at)) {
    await takeEvent(e);
    check(gen);
  }

  // Upload parts the relays don't have in this exact form (including ones a relay lost).
  const uploads: (() => Promise<boolean>)[] = [];
  for (const part of buildParts(getData()).values()) {
    const json = JSON.stringify(part);
    const hash = await sha256(json);
    const label = await labelFor(part.name);
    check(gen);
    const onRelays = newest.get(label);
    if (onRelays && config.seen[label]?.id === onRelays.id && config.seen[label].hash === hash) continue;
    uploads.push(() => publishPart(part.name, json, hash));
  }
  const failed = await runLimited(uploads);
  check(gen);
  await announceQuietly();

  config.lastSyncAt = Date.now();
  save();
  if (failed > 0) report('offline', "Some changes couldn't be uploaded yet. They'll go up on the next sync.");
  else report('synced');
  return { added: Math.max(0, getData().workouts.length - before) };
}

function schedulePush() {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    queue(pushChanged).catch((err) => report('error', (err as Error).message));
  }, PUSH_DELAY);
}

function onVisible() {
  if (document.visibilityState !== 'visible' || Date.now() - lastFullSync < FULL_SYNC_MIN_GAP) return;
  queue(fullSync).catch((err) => report('error', (err as Error).message));
}

function onOnline() {
  queue(fullSync).catch((err) => report('error', (err as Error).message));
}

async function connect(cfg: SyncConfig) {
  generation++;
  config = cfg;
  keys = await deriveKeys(cfg.phrase);
  labels.clear();
  pool = new SimplePool({ enableReconnect: true });
  pool.subscribeMany(
    cfg.relays,
    { kinds: [KIND], authors: [keys.pubkey], since: Math.floor(Date.now() / 1000) - 60 },
    {
      onevent: (event) => {
        queue(() => takeEvent(event).then(() => save())).catch((err) => console.warn('Sync update failed', err));
      },
    },
  );
  unsubscribeStore = subscribe(schedulePush);
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('online', onOnline);
}

function disconnect() {
  generation++;
  clearTimeout(pushTimer);
  // pool.destroy() below also ends the live subscription.
  unsubscribeStore?.();
  unsubscribeStore = null;
  document.removeEventListener('visibilitychange', onVisible);
  window.removeEventListener('online', onOnline);
  pool?.destroy();
  pool = null;
  keys = null;
  config = null;
}

/** Resume sync on app start when this device has a sync key. */
export async function startSync(): Promise<void> {
  const cfg = loadSyncConfig();
  if (!cfg || pool) return;
  if (cfg.retiredAt) {
    setSyncStatus({ state: 'error', message: RETIRED_MESSAGE });
    return;
  }
  await connect(cfg);
  await queue(fullSync).catch((err) => report('error', (err as Error).message));
}

/** Turn sync on with a new or existing phrase. Merges this device's data with what's already synced. */
export async function enableSync(phrase: string): Promise<{ added: number }> {
  const result = await enableSyncInner(phrase);
  return result ?? { added: 0 };
}

async function enableSyncInner(phrase: string): Promise<{ added: number } | undefined> {
  disconnect();
  const cfg: SyncConfig = {
    phrase: normalizePhrase(phrase),
    relays: loadSyncConfig()?.relays ?? [...DEFAULT_RELAYS],
    seen: {},
    lastSyncAt: 0,
    devices: {},
  };
  saveSyncConfig(cfg);
  await connect(cfg);
  return queue(fullSync);
}

export function syncNow(): Promise<{ added: number }> {
  if (!pool) return startSync().then(() => ({ added: 0 }));
  return queue(fullSync)
    .then((r) => r ?? { added: 0 })
    .catch((err) => {
      report('error', (err as Error).message);
      return { added: 0 };
    });
}

export async function setRelays(relays: string[]): Promise<void> {
  const cfg = loadSyncConfig();
  if (!cfg) return;
  disconnect();
  // A new relay has none of the data yet, so re-check everything.
  saveSyncConfig({ ...cfg, relays, seen: {} });
  await startSync();
}

/** Rename this device in the list (the name is saved by the caller); tells the other devices now. */
export function announceNow(): Promise<void> {
  if (!pool) return Promise.resolve();
  return queue(() => announce(true)).then(() => undefined);
}

/** Hide a device from the list, on every device. It comes back if it's used again. */
export function removeDevice(id: string): Promise<void> {
  return queue(async () => {
    const known = config?.devices[id];
    if (!config || !known) return;
    const part: DevicePart = { ...known, removedAt: Math.max(Date.now(), known.seenAt + 1) };
    const json = JSON.stringify(part);
    if (!(await publishPart(part.name, json, await sha256(json)))) {
      throw new Error("Couldn't reach any relay. Try again when you're online.");
    }
    config.devices[id] = part;
    save();
    notify();
  }).then(() => undefined);
}

/**
 * Move to a new sync key. Everything goes up under the new key first (if
 * that fails, nothing changes); then every part of the old key is replaced
 * with a "retired" note, so the old words open nothing anymore and devices
 * still using them stop syncing and ask for the new key.
 */
export async function changeSyncKey(newPhrase: string): Promise<void> {
  const phrase = normalizePhrase(newPhrase);
  if (!pool) await startSync();
  if (!pool) throw new Error('Turn on sync first.');
  await syncNow(); // the latest from the other devices comes along
  const done = await queue(async () => {
    if (!pool || !config || !keys) throw new Error('Sync is not on.');
    const gen = generation;
    report('syncing');
    const next = await deriveKeys(phrase);
    check(gen);
    const me = myDevicePart();
    const parts: [string, string][] = [...buildParts(getData()).values()].map((p) => [p.name, JSON.stringify(p)]);
    parts.push([me.name, JSON.stringify(me)]);

    const upload = async ([name, json]: [string, string]) => !!(await publishWith(next, await partLabel(next.nameKey, name), name, json, 0));
    const failed = await runLimited(parts.map((p) => () => upload(p)));
    check(gen);
    if (failed > 0) {
      report('offline', "Couldn't upload your data under the new key, so nothing changed. Try again when you're online.");
      throw new Error("Couldn't upload your data under the new key, so nothing changed. Try again when you're online.");
    }

    // Best effort: a part that isn't replaced can still only be read with the old words.
    const retired = JSON.stringify({ kind: 'retired', at: Date.now() });
    const labels = new Set(Object.keys(config.seen));
    for (const [name] of parts) labels.add(await labelFor(name));
    await runLimited(
      [...labels].map((label) => async () => {
        const sent = await publishWith(keys!, label, 'retired', retired, config!.seen[label]?.createdAt ?? 0);
        // Remember it, so this device's own "retired" notes coming back aren't taken for another device's.
        if (sent) config!.seen[label] = { ...sent, hash: '' };
        return !!sent;
      }),
    );
    check(gen);
    disconnect();
    return true;
  });
  if (!done) throw new Error('Sync was interrupted. Try again.');
  await enableSync(phrase);
}

/** Stop syncing on this device. Its data stays; the other devices keep theirs. */
export function disableSync() {
  disconnect();
  clearSyncConfig();
  setSyncStatus({ state: 'off' });
}
