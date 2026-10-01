import { MemoryStorage } from './setup';
import { createHash, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { pathToFileURL } from 'node:url';
import { mnemonicToSeedWebcrypto } from '@scure/bip39';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { reload } from '../src/lib/store';
import { connectorToken, isValidPhrase, normalizePhrase } from '../src/lib/sync/crypto';
import { createConnector, relaysFrom, type Connector } from './connector';
import { seal, sealKeys, unseal } from './seal';

/**
 * Gym Tracker online, for claude.ai and the Claude phone apps: the same
 * connector as the Claude Desktop extension, over MCP's Streamable HTTP, for
 * everyone who uses the app. Built for Vercel's free plan
 * (vite.cloud.config.ts); it also runs anywhere Node does:
 * `CONNECTOR_SECRET="…" PORT=8787 node index.mjs`.
 *
 * Each person's address is https://<host>/mcp/<sealed sync key>: the app gets
 * the sealed key from POST /link and shows the address (Settings → Use with
 * Claude). Only this server can open it, with CONNECTOR_SECRET (or, when
 * that isn't set, a secret derived from SYNC_KEY). Anything else gets a 404.
 *
 * `?tz=Europe/Kyiv` on the address sets the time zone for "today" and
 * workout times (servers run on UTC); `&r=wss://…` names relays other than the app's
 * default ones.
 *
 * An older form is still answered when SYNC_KEY is set: /mcp/<token derived
 * from SYNC_KEY>, for that one training log.
 */

declare const __MCP_VERSION__: string;

const deviceName = (process.env.DEVICE_NAME ?? '').trim().slice(0, 60) || 'Claude (online connector)';
// Instances come and go, so the id can't come from the machine: one per name (and per person's sync key).
const device = { id: createHash('sha256').update(`gym-tracker-mcp-cloud|${deviceName}`).digest('hex').slice(0, 32), name: deviceName };

const ownKey = normalizePhrase(process.env.SYNC_KEY ?? '');
const ownKeyValid = !!ownKey && isValidPhrase(ownKey);
const secret = (process.env.CONNECTOR_SECRET ?? '').trim();
const MIN_SECRET = 20;
const sealedWith: 'secret' | 'sync-key' | null = secret.length >= MIN_SECRET ? 'secret' : ownKeyValid ? 'sync-key' : null;
const keys =
  sealedWith === 'secret'
    ? sealKeys(secret)
    : sealedWith === 'sync-key'
      ? mnemonicToSeedWebcrypto(ownKey).then((seed) => sealKeys(seed))
      : null;
/** The older, single-person address. */
const ownToken = ownKeyValid ? connectorToken(ownKey) : null;

const NOT_SET_UP =
  "This connector isn't set up yet. Whoever runs it needs to set CONNECTOR_SECRET (32 or more random characters) in its Vercel project (Settings → Environment Variables) and redeploy.";

// ── People ─────────────────────────────────────────────────────────────────

/** Someone using this connector: their own training log (in memory) and relay sync. */
interface Account {
  connector: Connector;
  storage: MemoryStorage;
  zone?: string;
  usedAt: number;
}

const accounts = new Map<string, Account>();
/** Whose training log the app's store holds right now. */
let current: Account | null = null;
const MAX_ACCOUNTS = 40;
const FORGET_AFTER = 6 * 60 * 60_000;

function validZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

const defaultZone = process.env.TIME_ZONE && validZone(process.env.TIME_ZONE) ? process.env.TIME_ZONE : 'UTC';

/** Put this person's training log and time zone in place. Runs while their request has the store to itself. */
function use(account: Account) {
  process.env.TZ = account.zone ?? defaultZone;
  if (current === account) return;
  (globalThis as { localStorage: Storage }).localStorage = account.storage;
  reload();
  current = account;
}

function forgetIdle(now: number) {
  const idle = [...accounts].filter(([, a]) => a !== current && now - a.usedAt > FORGET_AFTER);
  const extra = [...accounts].filter(([, a]) => a !== current).sort((a, b) => a[1].usedAt - b[1].usedAt);
  for (const [id, a] of [...idle, ...extra.slice(0, Math.max(0, accounts.size - MAX_ACCOUNTS))]) {
    if (!accounts.has(id)) continue;
    a.connector.sync?.close();
    accounts.delete(id);
  }
}

function accountFor(phrase: string, relays: string[]): Account {
  const id = createHash('sha256').update(`${phrase}|${relays.join(' ')}`).digest('hex');
  let account = accounts.get(id);
  if (!account) {
    const created: Account = { storage: new MemoryStorage(), usedAt: 0, connector: null! };
    created.connector = createConnector({ syncKey: phrase, relays, device, host: 'cloud', enter: () => use(created) });
    accounts.set(id, created);
    account = created;
  }
  account.usedAt = Date.now();
  forgetIdle(account.usedAt);
  return account;
}

function sameToken(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** The person an address belongs to, or why there's none. */
async function accountAt(token: string, url: URL): Promise<Account | 'not-found' | 'not-set-up'> {
  if (/^[0-9a-f]{32}$/.test(token)) {
    return ownToken && sameToken(token, await ownToken) ? accountFor(ownKey, relaysFrom(process.env.RELAYS)) : 'not-found';
  }
  if (!keys) return 'not-set-up';
  const phrase = await unseal(await keys, token);
  if (!phrase) return 'not-found';
  const relays = relaysFrom(url.searchParams.get('r') ?? process.env.RELAYS).slice(0, 8);
  return accountFor(phrase, relays);
}

// ── HTTP ───────────────────────────────────────────────────────────────────

function send(res: ServerResponse, status: number, text: string, headers: Record<string, string> = {}) {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(text);
}

function sendJson(res: ServerResponse, status: number, value: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers });
  res.end(JSON.stringify(value));
}

function readBody(req: IncomingMessage, limit: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('Too large'));
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function status(): string {
  const addresses =
    sealedWith === 'secret'
      ? 'ready (sealed with CONNECTOR_SECRET).'
      : sealedWith === 'sync-key'
        ? "ready, sealed with a secret derived from SYNC_KEY. Set CONNECTOR_SECRET (32 or more random characters) so people's addresses don't change if that sync key does."
        : 'not set up: set CONNECTOR_SECRET (32 or more random characters) in the Vercel project and redeploy.';
  const short = secret && secret.length < MIN_SECRET ? `CONNECTOR_SECRET is too short to use (${secret.length} characters; use 32 or more random ones).` : '';
  return [
    `Gym Tracker connector for Claude, version ${__MCP_VERSION__}, is running.`,
    `Connector addresses: ${addresses}`,
    ...(short ? [short] : []),
    '',
    'Everyone gets their own address in the app: Settings → Use with Claude.',
  ].join('\n');
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
  'access-control-max-age': '86400',
};

/** POST /link {"syncKey": "12 words"} → {"token"}: the app asks for the person's address. */
async function link(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS);
    res.end();
    return;
  }
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Use POST.' }, { ...CORS, allow: 'POST, OPTIONS' });
  if (!keys) return sendJson(res, 503, { error: NOT_SET_UP }, CORS);
  let phrase = '';
  try {
    const body = JSON.parse(await readBody(req, 4096)) as { syncKey?: unknown };
    phrase = normalizePhrase(String(body.syncKey ?? ''));
  } catch {
    // answered below
  }
  if (!isValidPhrase(phrase)) return sendJson(res, 400, { error: 'That is not a valid 12-word sync key.' }, CORS);
  return sendJson(res, 200, { token: await seal(await keys, phrase) }, CORS);
}

/** Requests being answered, so relay connections close only once all are done. */
let active = 0;

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://connector');
  const path = url.pathname.replace(/\/+$/, '') || '/';
  try {
    // (Vercel may hand over the rewritten path, so the routes also pass these as queries.)
    if (path === '/link' || url.searchParams.get('action') === 'link') return await link(req, res);
    const token = url.searchParams.get('token') ?? /^\/mcp\/([^/]+)$/.exec(path)?.[1];
    if (token == null) {
      if (['/', '/health', '/mcp'].includes(path)) return send(res, 200, status());
      return send(res, 404, 'Not found');
    }
    const account = await accountAt(token, url);
    if (account === 'not-set-up') return send(res, 503, NOT_SET_UP);
    if (account === 'not-found') return send(res, 404, 'Not found');
    // No server-to-client stream (it would keep a serverless function running) and no sessions to end.
    if (req.method !== 'POST') return send(res, 405, 'Method not allowed', { allow: 'POST' });

    const zone = url.searchParams.get('tz');
    if (zone && validZone(zone)) account.zone = zone;

    active++;
    const server = account.connector.newServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => {
      transport.close().catch(() => {});
      server.close().catch(() => {});
      // A serverless instance sleeps between requests, so don't leave relay connections to go stale.
      if (--active === 0) accounts.forEach((a) => a.connector.sync?.disconnect());
    });
    await server.connect(transport);
    await transport.handleRequest(req, res);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) send(res, 500, 'Something went wrong.');
  }
}

// A stray error in a library must not take down requests in flight: log it and carry on.
process.on('uncaughtException', (err) => console.error('Unexpected error, still running:', err));
process.on('unhandledRejection', (err) => console.error('Unexpected error, still running:', err));

// Run directly (not imported by Vercel): serve on PORT.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT) || 8787;
  createServer((req, res) => void handler(req, res)).listen(port, () => {
    console.error(`Gym Tracker connector ${__MCP_VERSION__} is listening on port ${port}.`);
    if (!keys) console.error(NOT_SET_UP);
  });
}
