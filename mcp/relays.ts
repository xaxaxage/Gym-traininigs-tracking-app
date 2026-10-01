import { SimplePool, useWebSocketImplementation } from 'nostr-tools/pool';
import { finalizeEvent, type Event } from 'nostr-tools/pure';
import { normalizeURL } from 'nostr-tools/utils';
import WebSocketFromWs from 'ws';
import { applyMerged, getData } from '../src/lib/store';
import { buildParts, devicePartName, mergePart, parsePart, type DevicePart } from '../src/lib/sync/parts';
import { decryptText, deriveKeys, encryptText, partLabel, sha256, type SyncKeys } from '../src/lib/sync/crypto';
import { firstAccepted } from '../src/lib/sync/wait';

/**
 * The app's device sync, without a device: pulls the encrypted parts from the
 * relays into the in-memory store, and uploads the parts a tool changed. The
 * phone treats this like any other synced device.
 */

const KIND = 30078;
/** Same limit as the app: strfry relays reject events over 64 KB. */
const MAX_CONTENT = 60_000;
/** Download everything this often; in between, only what changed. */
const FULL_PULL_EVERY = 5 * 60_000;
/** Device clocks differ, so look back this far (seconds) when asking only for recent changes. */
const LOOKBACK = 15 * 60;

/** A relay that couldn't be reached is left out for this long, so it doesn't slow down every request. */
const SKIP_DOWN_RELAY = 2 * 60_000;
/** How often to tell the app's device list that the connector is still in use. */
const ANNOUNCE_EVERY = 15 * 60_000;

/** How this server shows up in the app's device list. */
export interface DeviceInfo {
  id: string;
  name: string;
  version: string;
}

/** The relays couldn't be reached. */
export class OfflineError extends Error {}

/**
 * The ws package's WebSocket, never left without an error listener. When a relay is slow to
 * answer, nostr-tools gives up: it closes the socket and removes its handlers. ws then reports
 * "closed before the connection was established" as an error event a moment later, and an
 * error event nobody listens to ends a Node process.
 *
 * (Not Node's built-in WebSocket: when a relay is down it reports the error again from inside
 * close(), and nostr-tools closes on error, so it recurses until the stack overflows.)
 */
class RelaySocket extends WebSocketFromWs {
  constructor(address: string | URL, protocols?: string | string[]) {
    super(address, protocols);
    this.on('error', () => {});
  }
}

export class RelaySync {
  private pool: SimplePool;
  private keys?: Promise<SyncKeys>;
  /** Relay label → the newest version this server has seen or sent. */
  private seen = new Map<string, { id: string; hash: string; createdAt: number }>();
  private labels = new Map<string, string>();
  private lastFullPull = 0;
  private lastPullStarted = 0;
  /** Relay → when to try it again after it couldn't be reached. */
  private downUntil = new Map<string, number>();
  /** When the data was last brought up to date, for showing stale data offline. */
  lastPullAt = 0;
  /** Set when the sync key was replaced in the app: it opens nothing anymore. */
  retiredAt = 0;
  private lastAnnounced = 0;
  /** When the app last removed this server from its device list. */
  private removedAt = 0;

  constructor(
    private phrase: string,
    readonly relays: string[],
    private device?: DeviceInfo,
  ) {
    useWebSocketImplementation(RelaySocket);
    this.pool = new SimplePool();
  }

  /** Labels of the log's parts (months, routines, library, settings) found on the relays. */
  private dataLabels = new Set<string>();

  /** How many parts of the training log the relays hold for this key (device notes don't count). */
  get partCount(): number {
    return this.dataLabels.size;
  }

  private getKeys(): Promise<SyncKeys> {
    return (this.keys ??= deriveKeys(this.phrase));
  }

  private async label(name: string): Promise<string> {
    let label = this.labels.get(name);
    if (!label) {
      label = await partLabel((await this.getKeys()).nameKey, name);
      this.labels.set(name, label);
    }
    return label;
  }

  /** The relays worth trying now: all but those that just failed (or all, if every one did). */
  private usable(): string[] {
    const now = Date.now();
    const up = this.relays.filter((r) => (this.downUntil.get(r) ?? 0) <= now);
    return up.length > 0 ? up : this.relays;
  }

  /** Note which of the relays just tried are reachable; returns how many are. */
  private noteReachable(tried: string[]): number {
    const status = this.pool.listConnectionStatus();
    let reachable = 0;
    for (const r of tried) {
      if (status.get(normalizeURL(r))) {
        reachable++;
        this.downUntil.delete(r);
      } else this.downUntil.set(r, Date.now() + SKIP_DOWN_RELAY);
    }
    return reachable;
  }

  /**
   * Ask each relay at once; once a connected relay has answered, the others
   * get a short grace period, so one that accepts connections but never
   * answers doesn't hold up every request.
   */
  private query(relays: string[], filter: Parameters<SimplePool['querySync']>[1], maxWait: number): Promise<Event[]> {
    const events: Event[] = [];
    return new Promise((resolve) => {
      let left = relays.length;
      let grace: ReturnType<typeof setTimeout> | undefined;
      if (left === 0) resolve(events);
      for (const url of relays) {
        this.pool
          .querySync([url], filter, { maxWait })
          .catch(() => [] as Event[])
          .then((found) => {
            events.push(...found);
            if (--left === 0) {
              clearTimeout(grace);
              resolve(events);
            } else if (!grace && this.pool.listConnectionStatus().get(normalizeURL(url))) {
              grace = setTimeout(() => resolve(events), 2500);
            }
          });
      }
    });
  }

  /** Bring the store up to date with the relays. */
  async pull(): Promise<void> {
    const keys = await this.getKeys();
    const full = Date.now() - this.lastFullPull > FULL_PULL_EVERY;
    const started = Math.floor(Date.now() / 1000);
    const relays = this.usable();
    const events = await this.query(
      relays,
      { kinds: [KIND], authors: [keys.pubkey], limit: 5000, ...(full ? {} : { since: this.lastPullStarted - LOOKBACK }) },
      8000,
    );
    if (this.noteReachable(relays) === 0 && events.length === 0) {
      throw new OfflineError("Couldn't reach any of the sync relays. Check the internet connection and try again.");
    }

    // Newest version of each part (relays may hold different versions).
    const newest = new Map<string, Event>();
    for (const e of events) {
      const label = e.tags.find((t) => t[0] === 'd')?.[1];
      if (!label || e.pubkey !== keys.pubkey || e.kind !== KIND) continue;
      const cur = newest.get(label);
      if (!cur || e.created_at > cur.created_at || (e.created_at === cur.created_at && e.id < cur.id)) newest.set(label, e);
    }
    for (const [label, e] of [...newest].sort((a, b) => a[1].created_at - b[1].created_at)) {
      await this.take(label, e, keys);
    }
    if (full) this.lastFullPull = Date.now();
    this.lastPullStarted = started;
    this.lastPullAt = Date.now();
  }

  private async take(label: string, event: Event, keys: SyncKeys): Promise<void> {
    const known = this.seen.get(label);
    if (known && (known.id === event.id || event.created_at < known.createdAt)) return;
    let text: string;
    let raw: unknown;
    try {
      text = await decryptText(keys.encKey, event.content);
      raw = JSON.parse(text);
    } catch (err) {
      console.error('Skipped a sync part that could not be read:', (err as Error).message);
      return;
    }
    const part = parsePart(raw);
    if (!part) return;
    this.seen.set(label, { id: event.id, hash: await sha256(text), createdAt: event.created_at });
    if (part.kind === 'retired') {
      this.retiredAt = part.at;
      return;
    }
    if (part.kind === 'device') {
      // Removed from the list in the app: say it's still here the next time it's used.
      if (part.id === this.device?.id && part.removedAt && part.removedAt >= part.seenAt) {
        this.removedAt = part.removedAt;
        this.lastAnnounced = 0;
      }
      return;
    }
    this.dataLabels.add(label);
    const before = getData();
    const after = mergePart(before, part);
    if (after !== before) applyMerged(after);
  }

  /**
   * Upload the named parts where they differ from the relays' copy.
   * Returns how many went up, and the names no relay accepted.
   */
  async push(names: Iterable<string>): Promise<{ sent: number; failed: string[] }> {
    const parts = buildParts(getData());
    const failed: string[] = [];
    let sent = 0;
    for (const name of new Set(names)) {
      const part = parts.get(name);
      if (!part) continue;
      const json = JSON.stringify(part);
      const hash = await sha256(json);
      if (this.seen.get(await this.label(name))?.hash === hash) continue;
      if (await this.send(name, json, hash)) sent++;
      else failed.push(name);
    }
    return { sent, failed };
  }

  /** Encrypt and publish one part; true if a relay took it. */
  private async send(name: string, json: string, hash: string): Promise<boolean> {
    const keys = await this.getKeys();
    const label = await this.label(name);
    const content = await encryptText(keys.encKey, json);
    if (content.length > MAX_CONTENT) {
      throw new Error(`The part ${name} is too large to sync (${Math.round(content.length / 1000)} KB).`);
    }
    // Relays keep the newest version by timestamp, so never go backwards.
    const createdAt = Math.max(Math.floor(Date.now() / 1000), (this.seen.get(label)?.createdAt ?? 0) + 1);
    const event = finalizeEvent({ kind: KIND, created_at: createdAt, tags: [['d', label]], content }, keys.secretKey);
    // Done as soon as one relay keeps it: a relay that never answers doesn't hold up the reply to Claude.
    if (!(await firstAccepted(this.pool.publish(this.usable(), event, { maxWait: 8000 })))) return false;
    this.seen.set(label, { id: event.id, hash, createdAt });
    return true;
  }

  /** Show up in the app's device list; refreshed at most every so often while in use. */
  async announce(): Promise<void> {
    // Not with a key that has no log (a typo'd or unused key): nobody would see it, and it would look like data.
    if (!this.device || this.retiredAt || this.partCount === 0 || Date.now() - this.lastAnnounced < ANNOUNCE_EVERY) return;
    const { id, name, version } = this.device;
    const part: DevicePart = {
      kind: 'device',
      name: devicePartName(id),
      id,
      deviceName: name,
      type: 'claude',
      version,
      seenAt: Math.max(Date.now(), this.removedAt + 1),
    };
    const json = JSON.stringify(part);
    if (await this.send(part.name, json, await sha256(json))) this.lastAnnounced = Date.now();
  }

  /** Close the relay connections; the next pull or push opens them again. */
  disconnect() {
    this.pool.close(this.relays);
  }

  close() {
    this.pool.destroy();
  }
}
