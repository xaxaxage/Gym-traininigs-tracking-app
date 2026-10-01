import '../../mcp/setup';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { getData, putWorkout, reload } from '../../src/lib/store';
import { newPhrase } from '../../src/lib/sync/crypto';
import { buildParts } from '../../src/lib/sync/parts';
import { emptyWorkout, finishWorkout } from '../../src/lib/workout';
import { RelaySync } from '../../mcp/relays';
import { MemoryStorage } from '../../mcp/setup';
import { startRelay } from '../fakeRelay';

/**
 * The connectors as they ship: the Vercel function (.vercel/output/…/index.mjs)
 * over MCP Streamable HTTP, and the Claude Desktop extension's server
 * (dist/mcp/gym-tracker-mcp.mjs) over stdio — each driven by the MCP SDK's
 * own client, against a local mock relay.
 */

const CLOUD = '.vercel/output/functions/mcp.func/index.mjs';
const DESKTOP = 'dist/mcp/gym-tracker-mcp.mjs';
const SECRET = 'a-long-random-connector-secret-for-the-tests-0123456789';

/** Someone's phone: its own storage and sync, like the app. */
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
    log: (name: string) =>
      on(async () => {
        await sync.pull();
        const start = Date.now() - 2 * 3600_000;
        const w = emptyWorkout(start, name);
        w.exercises = [{ id: 'e1', exerciseId: 'Barbell_Squat', name: 'Barbell Squat', logType: 'weight_reps', notes: '', sets: [{ id: 's1', weight: 100, reps: 5, done: true }] }];
        putWorkout(finishWorkout(w, start + 3600_000));
        await sync.push(buildParts(getData()).keys());
      }),
    names: () =>
      on(async () => {
        await sync.pull();
        return getData().workouts.map((w) => w.name).sort();
      }),
    close: () => sync.close(),
  };
}

const freePort = () =>
  new Promise<number>((resolve) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => resolve(port));
    });
  });

type Result = { content: { text: string }[]; isError?: boolean };
const call = async (client: Client, name: string, args: Record<string, unknown> = {}) => {
  const r = (await client.callTool({ name, arguments: args })) as Result;
  const text = r.content.map((c) => c.text).join('\n');
  return { error: !!r.isError, text, json: r.isError ? null : JSON.parse(text) };
};

describe.skipIf(!existsSync(CLOUD))('the built online connector (Vercel function) over HTTP', () => {
  const relay = startRelay();
  let server: ChildProcess;
  let base = '';
  const ana = newPhrase();
  const ben = newPhrase();
  const phones: ReturnType<typeof phone>[] = [];
  const clients: Client[] = [];
  let stderr = '';

  beforeAll(async () => {
    await new Promise((r) => setTimeout(r, 50));
    const port = await freePort();
    base = `http://127.0.0.1:${port}`;
    server = spawn(process.execPath, [CLOUD], { env: { ...process.env, CONNECTOR_SECRET: SECRET, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
    server.stderr!.on('data', (d) => (stderr += String(d)));
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`The connector didn't start: ${stderr}`)), 15_000);
      server.stderr!.on('data', () => stderr.includes('is listening') && (clearTimeout(t), resolve()));
    });
    for (const [phrase, name] of [[ana, 'Ana legs'], [ben, 'Ben push']]) {
      const p = phone(phrase, [relay.url()]);
      phones.push(p);
      await p.log(name);
    }
  });

  afterAll(async () => {
    await Promise.all(clients.map((c) => c.close()));
    phones.forEach((p) => p.close());
    server?.kill();
    await relay.close();
  });

  const address = async (phrase: string) => {
    const res = await fetch(`${base}/link`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify({ syncKey: phrase }) });
    expect(res.status).toBe(200);
    const { token } = (await res.json()) as { token: string };
    expect(token).toMatch(/^[A-Za-z0-9_-]{60}$/);
    return `/mcp/${token}?tz=Europe/Kyiv&r=${encodeURIComponent(relay.url())}`;
  };
  const connect = async (path: string) => {
    const client = new Client({ name: 'test', version: '1' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}${path}`)));
    clients.push(client);
    return client;
  };

  it('seals each sync key into its own address, and answers only POST there', async () => {
    expect(await (await fetch(`${base}/`)).text()).toMatch(/Gym Tracker connector .* is running[\s\S]*ready \(sealed with CONNECTOR_SECRET\)/);
    const a = await address(ana);
    expect(a).not.toContain(ana.split(' ')[0]);
    expect((await fetch(`${base}${a}`)).status).toBe(405);
    expect((await fetch(`${base}${a}`, { method: 'DELETE' })).status).toBe(405);
    expect((await fetch(`${base}/mcp/${'A'.repeat(60)}`, { method: 'POST', body: '{}' })).status).toBe(404);
  });

  it('two people at once each see and change only their own training log', async () => {
    const [a, b] = await Promise.all([address(ana).then(connect), address(ben).then(connect)]);
    expect((await a.listTools()).tools.map((t) => t.name).sort()).toEqual([
      'create_exercise', 'create_routine', 'delete_routine', 'delete_set', 'delete_workout', 'get_exercise_progress', 'get_workout',
      'get_workouts', 'list_routines', 'log_workout', 'search_exercises', 'update_routine', 'update_set', 'update_workout',
    ]);
    const [wa, wb] = await Promise.all([call(a, 'get_workouts'), call(b, 'get_workouts')]);
    expect(wa.json.workouts.map((w: { name: string }) => w.name)).toEqual(['Ana legs']);
    expect(wb.json.workouts.map((w: { name: string }) => w.name)).toEqual(['Ben push']);

    const [la, lb] = await Promise.all([
      call(a, 'log_workout', { name: 'Ana pull', exercises: [{ exercise: 'pull-up', sets: [{ count: 3, reps: 8 }] }] }),
      call(b, 'log_workout', { name: 'Ben bench', exercises: [{ exercise: 'bench', sets: [{ count: 3, reps: 8, weight: 80 }] }] }),
    ]);
    expect(la.error, la.text).toBe(false);
    expect(lb.error, lb.text).toBe(false);
    expect(await phones[0].names()).toEqual(['Ana legs', 'Ana pull']);
    expect(await phones[1].names()).toEqual(['Ben bench', 'Ben push']);
    // Nothing secret reaches Claude.
    expect(JSON.stringify([wa, wb, la, lb])).not.toMatch(new RegExp(`${ana.split(' ')[0]} ${ana.split(' ')[1]}|${SECRET}`));
  });

  it('keeps running after a bad request', async () => {
    expect((await fetch(`${base}/link`, { method: 'POST', body: 'not json' })).status).toBe(400);
    expect((await fetch(`${base}/`)).status).toBe(200);
  });
});

describe.skipIf(!existsSync(DESKTOP))('the built Claude Desktop extension over stdio', () => {
  const relay = startRelay();
  const phrase = newPhrase();
  let client: Client;
  let p: ReturnType<typeof phone>;
  const protocolErrors: string[] = [];
  let stderr = '';

  beforeAll(async () => {
    await new Promise((r) => setTimeout(r, 50));
    p = phone(phrase, [relay.url()]);
    await p.log('Phone workout');
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [DESKTOP],
      env: { ...(process.env as Record<string, string>), SYNC_KEY: phrase, RELAYS: relay.url(), DEVICE_NAME: 'Claude Desktop · Test' },
      stderr: 'pipe',
    });
    transport.stderr?.on('data', (d) => (stderr += String(d)));
    // Anything on stdout that isn't an MCP message shows up here.
    transport.onerror = (err) => protocolErrors.push(err.message);
    client = new Client({ name: 'test', version: '1' });
    await client.connect(transport);
  });

  afterAll(async () => {
    await client?.close();
    p?.close();
    await relay.close();
  });

  it('answers with the same tools, logs to stderr only, and syncs with the phone', async () => {
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(14);
    const before = await call(client, 'get_workouts');
    expect(before.json.workouts.map((w: { name: string }) => w.name)).toEqual(['Phone workout']);
    const logged = await call(client, 'log_workout', { name: 'From Claude', exercises: [{ exercise: 'RDL', sets: [{ count: 3, reps: 8, weight: 100 }] }] });
    expect(logged.error, logged.text).toBe(false);
    expect(logged.json.exercises_used[0].logged_as).toBe('Romanian Deadlift');
    expect(await p.names()).toEqual(['From Claude', 'Phone workout']);
    const search = await call(client, 'search_exercises', { query: 'chin-up' });
    expect(search.json.results[0].name).toBe('Chin-Up');
    expect(stderr).toMatch(/Gym Tracker MCP server .* is running/);
    expect(protocolErrors).toEqual([]);
  });

  it('explains a missing sync key instead of failing', async () => {
    const bare = new Client({ name: 'test', version: '1' });
    await bare.connect(new StdioClientTransport({ command: process.execPath, args: [DESKTOP], env: { ...(process.env as Record<string, string>), SYNC_KEY: '' }, stderr: 'pipe' }));
    const r = await call(bare, 'get_workouts');
    expect(r.error).toBe(true);
    expect(r.text).toMatch(/sync key is not set/);
    await bare.close();
  });
});
