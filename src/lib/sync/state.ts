import { useEffect, useState } from 'preact/hooks';
import type { DevicePart } from './parts';

/**
 * Sync settings and status. Kept separate from the sync engine so screens can
 * show the status without downloading the engine's crypto and relay code.
 */

export const SYNC_STORAGE_KEY = 'gym-tracker:sync';

/** Free public Nostr relays. Several, so one being down or losing data doesn't matter. */
export const DEFAULT_RELAYS = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net', 'wss://nostr.mom'];

export interface SyncConfig {
  phrase: string;
  relays: string[];
  /** Relay label → the newest version seen: event id, content hash, time. */
  seen: Record<string, { id: string; hash: string; createdAt: number }>;
  lastSyncAt: number;
  /** Devices using this key, as they last described themselves: id → part. */
  devices: Record<string, DevicePart>;
  /** Set when another device replaced this sync key with a new one. */
  retiredAt?: number;
}

export function loadSyncConfig(): SyncConfig | null {
  try {
    const raw = JSON.parse(localStorage.getItem(SYNC_STORAGE_KEY) ?? 'null');
    if (!raw || typeof raw.phrase !== 'string' || !raw.phrase) return null;
    const relays = Array.isArray(raw.relays) ? raw.relays.filter(isRelayUrl) : [];
    return {
      phrase: raw.phrase,
      relays: relays.length > 0 ? relays : [...DEFAULT_RELAYS],
      seen: raw.seen && typeof raw.seen === 'object' ? raw.seen : {},
      lastSyncAt: typeof raw.lastSyncAt === 'number' ? raw.lastSyncAt : 0,
      devices: raw.devices && typeof raw.devices === 'object' && !Array.isArray(raw.devices) ? raw.devices : {},
      ...(typeof raw.retiredAt === 'number' ? { retiredAt: raw.retiredAt } : {}),
    };
  } catch {
    return null;
  }
}

export function saveSyncConfig(config: SyncConfig) {
  try {
    localStorage.setItem(SYNC_STORAGE_KEY, JSON.stringify(config));
  } catch (err) {
    console.error('Could not save sync settings', err);
  }
}

export function clearSyncConfig() {
  try {
    localStorage.removeItem(SYNC_STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function isRelayUrl(value: unknown): value is string {
  return typeof value === 'string' && /^wss?:\/\/[^\s/$.?#].[^\s]*$/i.test(value.trim());
}

export type SyncState = 'off' | 'syncing' | 'synced' | 'offline' | 'error';

export interface SyncStatus {
  state: SyncState;
  message?: string;
  lastSyncAt?: number;
  relaysOk?: number;
  relaysTotal?: number;
}

let status: SyncStatus = { state: loadSyncConfig() ? 'syncing' : 'off', lastSyncAt: loadSyncConfig()?.lastSyncAt };
const listeners = new Set<() => void>();

export function getSyncStatus(): SyncStatus {
  return status;
}

export function setSyncStatus(next: SyncStatus) {
  status = next;
  listeners.forEach((l) => l());
}

export function useSyncStatus(): SyncStatus {
  const [, setTick] = useState(0);
  const shown = status;
  useEffect(() => {
    const l = () => setTick((t) => t + 1);
    listeners.add(l);
    if (status !== shown) l();
    return () => {
      listeners.delete(l);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return status;
}
