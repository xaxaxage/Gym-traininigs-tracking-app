import { DEFAULT_RELAYS } from './sync/state';

/**
 * The online Claude connector (mcp/cloud.ts): one server that everyone using
 * the app can connect Claude to. Each person's address carries their sync key,
 * sealed by that server (POST /link), plus their time zone, so "today"
 * matches the phone.
 */

/** The connector this app uses unless someone picks their own; a fork sets VITE_CONNECTOR_HOST at build time. */
export const SHARED_CONNECTOR_HOST = (import.meta.env.VITE_CONNECTOR_HOST ?? '').trim() || 'gym.xaxaxage.vercel.app';

const HOST_KEY = 'gym-tracker:connector-host';

/** "gym-tracker-abc.vercel.app" from whatever was pasted: an address with or without https://, or a whole URL. */
export function connectorHost(text: string): string {
  const t = text.trim();
  if (!t) return '';
  try {
    const url = new URL(/^https?:\/\//i.test(t) ? t : `https://${t}`);
    return url.hostname.includes('.') ? url.host.toLowerCase() : '';
  } catch {
    return '';
  }
}

/** A connector server of one's own, set on this device; empty for the shared one. */
export function ownConnectorHost(): string {
  try {
    return localStorage.getItem(HOST_KEY) ?? '';
  } catch {
    return '';
  }
}

export function saveOwnConnectorHost(host: string) {
  try {
    if (host) localStorage.setItem(HOST_KEY, host);
    else localStorage.removeItem(HOST_KEY);
  } catch {
    // Private browsing: it just isn't remembered.
  }
}

export function timeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

const sameRelays = (relays: string[]) =>
  relays.length === DEFAULT_RELAYS.length && relays.every((r) => DEFAULT_RELAYS.includes(r));

export function connectorUrl(host: string, token: string, zone?: string, relays: string[] = DEFAULT_RELAYS): string {
  const query = new URLSearchParams();
  if (zone) query.set('tz', zone);
  if (!sameRelays(relays)) query.set('r', relays.join(','));
  // Slashes and commas read better unescaped ("Europe/Kyiv"); a "+" must stay escaped.
  const q = query.toString().replace(/%2F/gi, '/').replace(/%2C/gi, ',').replace(/%3A/gi, ':');
  return `https://${host}/mcp/${token}${q ? `?${q}` : ''}`;
}

/** Ask the connector server for this sync key's address (the sealed part). */
export async function fetchConnectorToken(host: string, syncKey: string, signal?: AbortSignal): Promise<string> {
  let res: Response;
  try {
    // Plain text, so the browser sends it straight away (no CORS preflight).
    res = await fetch(`https://${host}/link`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify({ syncKey }), signal });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new Error(`Couldn't reach the connector at ${host}. Check your connection and try again.`);
  }
  const body = (await res.json().catch(() => ({}))) as { token?: string; error?: string };
  if (res.ok && typeof body.token === 'string') return body.token;
  throw new Error(body.error ?? `The connector at ${host} didn't answer as expected (${res.status}).`);
}
