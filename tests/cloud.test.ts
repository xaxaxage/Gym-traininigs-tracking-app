// @vitest-environment node
import { MemoryStorage } from '../mcp/setup';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { getData, putWorkout, reload } from '../src/lib/store';
import { emptyWorkout, finishWorkout } from '../src/lib/workout';
import { connectorToken, newPhrase } from '../src/lib/sync/crypto';
import { buildParts } from '../src/lib/sync/parts';
import { RelaySync } from '../mcp/relays';
import { seal, sealKeys, unseal } from '../mcp/seal';
import { startRelay } from './fakeRelay';

vi.stubGlobal('__MCP_VERSION__', '1.0.0-test');

const SECRET = 'correct-horse-battery-staple-and-more-random-text';

/** "Today" in a time zone, as YYYY-MM-DD. */
const todayIn = (zone: string) => new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(new Date());

/** A fresh copy of the connector (it reads its settings when loaded), served on a local port. */
async function startConnector(env: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  vi.resetModules();
  const { default: handler } = await import('../mcp/cloud');
  const server = createServer((req, res) => void handler(req, res));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const clients: Client[] = [];
  return {
    base,
    async connect(path: string) {
      const client = new Client({ name: 'test', version: '1' });
      await client.connect(new StreamableHTTPClientTransport(new URL(`${base}${path}`)));
      clients.push(client);
      return client;
    },
    link: (syncKey: string, path = '/link') =>
      fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify({ syncKey }) }),
    async stop() {
      await Promise.all(clients.map((c) => c.close()));
      await new Promise((r) => server.close(r));
      for (const k of Object.keys(env)) delete process.env[k];
    },
  };
}

/** Someone's phone: their own storage and sync, like the app. */
function phone(phrase: string, relays: string[]) {
  const storage = new MemoryStorage();
  const sync = new RelaySync(phrase, relays);
  const on = async <T,>(work: () => Promise<T>): Promise<T> => {
    const before = globalThis.localStorage;
    globalThis.localStorage = storage as unknown as Storage;
    reload();
    try {
      return await work();
    } finally {
      globalThis.localStorage = before;
    }
  };
  return {
    log: (date: string, name: string) =>
      on(async () => {
        await sync.pull();
        const start = new Date(`${date}T07:00:00`).getTime();
        const w = emptyWorkout(start, name);
        w.exercises = [{ id: 'e1', exerciseId: 'Barbell_Squat', name: 'Barbell Squat', logType: 'weight_reps', notes: '', sets: [{ id: 's1', weight: 100, reps: 5, done: true }] }];
        putWorkout(finishWorkout({ ...w, date }, start + 3600_000));
        await sync.push(buildParts(getData()).keys());
      }),
    workouts: () =>
      on(async () => {
        await sync.pull();
        return getData().workouts;
      }),
    close: () => sync.close(),
  };
}

const call = async (client: Client, name: string, args: Record<string, unknown> = {}) => {
  const r = (await client.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
  const text = r.content.map((c) => c.text).join('\n');
  return { error: !!r.isError, text, json: r.isError ? null : JSON.parse(text) };
};

const names = (day: { workouts: { name: string }[] }) => day.workouts.map((w) => w.name);

describe('sealed addresses', () => {
  it('seal a sync key so only the same secret opens it, always to the same 60 characters', async () => {
    const keys = await sealKeys(SECRET);
    const phrase = newPhrase();
    const token = await seal(keys, phrase);
    expect(token).toMatch(/^[A-Za-z0-9_-]{60}$/);
    expect(await seal(keys, `  ${phrase.toUpperCase()} `)).toBe(token);
    expect(await unseal(keys, token)).toBe(phrase);
    expect(await seal(keys, newPhrase())).not.toBe(token);
    expect(await unseal(await sealKeys(`${SECRET}!`), token)).toBeNull();
    const altered = token.slice(0, 30) + (token[30] === 'A' ? 'B' : 'A') + token.slice(31);
    expect(await unseal(keys, altered)).toBeNull();
    expect(await unseal(keys, 'x'.repeat(60))).toBeNull();
    expect(await unseal(keys, token.slice(1))).toBeNull();
    await expect(seal(keys, 'not twelve words')).rejects.toThrow(/sync key/);
  });

  it('the older single-person address is 128 bits from the sync key', async () => {
    const phrase = newPhrase();
    const token = await connectorToken(phrase);
    expect(token).toMatch(/^[0-9a-f]{32}$/);
    expect(await connectorToken(`  ${phrase.toUpperCase()} `)).toBe(token);
    expect(await connectorToken(newPhrase())).not.toBe(token);
  });
});

describe('shared online connector', () => {
  const relay = startRelay();
  const other = startRelay();
  const ana = newPhrase();
  const ben = newPhrase();
  const cleo = newPhrase();
  const owner = newPhrase();
  const phones: ReturnType<typeof phone>[] = [];
  let app: Awaited<ReturnType<typeof startConnector>>;
  const address: Record<string, string> = {};

  beforeAll(async () => {
    await new Promise((r) => setTimeout(r, 50));
    const log = async (phrase: string, relays: string[], zone: string, name: string) => {
      const p = phone(phrase, relays);
      phones.push(p);
      await p.log(todayIn(zone), name);
    };
    await log(ana, [relay.url()], 'Pacific/Kiritimati', 'Ana legs');
    await log(ben, [relay.url()], 'Etc/GMT+12', 'Ben push');
    await log(cleo, [other.url()], 'UTC', 'Cleo pull');
    await log(owner, [relay.url()], 'UTC', 'Owner full body');
    app = await startConnector({ CONNECTOR_SECRET: SECRET, SYNC_KEY: owner, RELAYS: relay.url() });
    for (const [who, phrase] of Object.entries({ ana, ben, cleo })) {
      const res = await app.link(phrase);
      expect(res.status).toBe(200);
      expect(res.headers.get('access-control-allow-origin')).toBe('*');
      address[who] = `/mcp/${(await res.json()).token}`;
    }
  });

  afterAll(async () => {
    await app.stop();
    phones.forEach((p) => p.close());
    await relay.close();
    await other.close();
  });

  it('says it is running and how addresses are sealed, without giving anything away', async () => {
    const text = await (await fetch(`${app.base}/`)).text();
    expect(text).toMatch(/is running/);
    expect(text).toMatch(/ready \(sealed with CONNECTOR_SECRET\)/);
    expect(text).not.toContain(SECRET);
    expect(await (await fetch(`${app.base}/mcp`)).text()).toMatch(/is running/);
  });

  it('makes addresses for the app, and turns away anything that is not a sync key', async () => {
    expect((await app.link('twelve words that are not a sync key at all no no no no')).status).toBe(400);
    expect((await app.link(ana, '/mcp?action=link')).status).toBe(200);
    const again = await (await app.link(ana)).json();
    expect(`/mcp/${again.token}`).toBe(address.ana);
    const preflight = await fetch(`${app.base}/link`, { method: 'OPTIONS' });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-methods')).toMatch(/POST/);
    expect((await fetch(`${app.base}/link`)).status).toBe(405);
  });

  it('answers only at addresses it made', async () => {
    const token = address.ana.slice(5);
    const altered = token.slice(0, 20) + (token[20] === 'a' ? 'b' : 'a') + token.slice(21);
    for (const path of [`/mcp/${altered}`, `/mcp/${'0'.repeat(32)}`, `/mcp/${'A'.repeat(60)}`, '/sse', `/x/${token}`]) {
      const res = await fetch(`${app.base}${path}`, { method: 'POST', body: '{}' });
      expect(res.status, path).toBe(404);
    }
    expect((await fetch(`${app.base}${address.ana}`, { headers: { accept: 'text/event-stream' } })).status).toBe(405);
    expect((await fetch(`${app.base}${address.ana}`, { method: 'DELETE' })).status).toBe(405);
  });

  it('gives each person their own training log and time zone, even when they ask at the same moment', async () => {
    const a = await app.connect(`${address.ana}?tz=Pacific/Kiritimati`);
    const b = await app.connect(`${address.ben}?tz=Etc/GMT%2B12`);
    const { tools } = await a.listTools();
    expect(tools).toHaveLength(14);
    const [dayA, dayB] = await Promise.all([call(a, 'get_workouts', { date: todayIn('Pacific/Kiritimati') }), call(b, 'get_workouts', { date: todayIn('Etc/GMT+12') })]);
    expect(dayA.json.today).toBe(todayIn('Pacific/Kiritimati'));
    expect(names(dayA.json)).toEqual(['Ana legs']);
    expect(dayB.json.today).toBe(todayIn('Etc/GMT+12'));
    expect(names(dayB.json)).toEqual(['Ben push']);
  });

  it("logs a workout only into the person's own log, which their phone then gets", async () => {
    const b = await app.connect(`${address.ben}?tz=Etc/GMT%2B12`);
    const logged = await call(b, 'log_workout', { name: 'Ben arms', exercises: [{ exercise: 'curl', sets: [{ count: 3, reps: 10, weight: 30 }] }] });
    expect(logged.error, logged.text).toBe(false);
    const [anaPhone, benPhone] = phones;
    expect((await benPhone.workouts()).map((w) => w.name).sort()).toEqual(['Ben arms', 'Ben push']);
    expect((await anaPhone.workouts()).map((w) => w.name)).toEqual(['Ana legs']);
    const a = await app.connect(`${address.ana}?tz=Pacific/Kiritimati`);
    expect(names((await call(a, 'get_workouts')).json)).toEqual(['Ana legs']);
  });

  it('uses the relays named in the address', async () => {
    const without = await app.connect(address.cleo);
    expect((await call(without, 'get_workouts')).json.note).toMatch(/No synced training log/);
    const withRelay = await app.connect(`${address.cleo}?r=${encodeURIComponent(other.url())}`);
    expect(names((await call(withRelay, 'get_workouts')).json)).toEqual(['Cleo pull']);
  });

  it('still answers at the older address made from SYNC_KEY, and with the token as a query', async () => {
    const own = await app.connect(`/mcp/${await connectorToken(owner)}`);
    expect(names((await call(own, 'get_workouts')).json)).toEqual(['Owner full body']);
    const query = await app.connect(`/mcp?token=${address.ana.slice(5)}&tz=Pacific/Kiritimati`);
    expect(names((await call(query, 'get_workouts')).json)).toEqual(['Ana legs']);
  });
});

describe('shared online connector, other setups', () => {
  it('without CONNECTOR_SECRET, seals with a secret from SYNC_KEY', async () => {
    const app = await startConnector({ CONNECTOR_SECRET: undefined, SYNC_KEY: newPhrase() });
    try {
      expect(await (await fetch(`${app.base}/`)).text()).toMatch(/derived from SYNC_KEY/);
      expect((await app.link(newPhrase())).status).toBe(200);
    } finally {
      await app.stop();
    }
  });

  it('with neither, explains the setup instead of answering', async () => {
    const app = await startConnector({ CONNECTOR_SECRET: 'too short', SYNC_KEY: undefined });
    try {
      const text = await (await fetch(`${app.base}/`)).text();
      expect(text).toMatch(/not set up/);
      expect(text).toMatch(/too short/);
      const link = await app.link(newPhrase());
      expect(link.status).toBe(503);
      expect((await link.json()).error).toMatch(/CONNECTOR_SECRET/);
      expect((await fetch(`${app.base}/mcp/${'A'.repeat(60)}`, { method: 'POST' })).status).toBe(503);
    } finally {
      await app.stop();
    }
  });
});
