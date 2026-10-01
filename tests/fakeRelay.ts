import { WebSocketServer, type WebSocket } from 'ws';
import type { AddressInfo } from 'node:net';
import { verifyEvent, type Event } from 'nostr-tools/pure';

interface Filter {
  kinds?: number[];
  authors?: string[];
  since?: number;
  limit?: number;
}

const matches = (f: Filter, e: Event) =>
  (!f.kinds || f.kinds.includes(e.kind)) && (!f.authors || f.authors.includes(e.pubkey)) && (!f.since || e.created_at >= f.since);

/**
 * Enough of a Nostr relay for the sync client, on a local port: replaceable
 * events (kind 30078 by "d" tag), REQ with kinds/authors/since/limit, live
 * subscriptions that get new events, and CLOSE. Never a public relay in tests.
 */
export function startRelay() {
  const events = new Map<string, Event>();
  const subs = new Map<WebSocket, Map<string, Filter[]>>();
  let refuse = false;
  const server = new WebSocketServer({ port: 0 });
  server.on('connection', (ws: WebSocket) => {
    subs.set(ws, new Map());
    ws.on('close', () => subs.delete(ws));
    ws.on('message', (raw) => {
      const msg = JSON.parse(String(raw));
      if (msg[0] === 'EVENT') {
        const e: Event = msg[1];
        if (refuse || !verifyEvent(e)) return ws.send(JSON.stringify(['OK', e.id, false, 'blocked']));
        const key = `${e.pubkey}:${e.kind}:${e.tags.find((t) => t[0] === 'd')?.[1]}`;
        const old = events.get(key);
        if (!old || e.created_at > old.created_at || (e.created_at === old.created_at && e.id < old.id)) {
          events.set(key, e);
          for (const [client, list] of subs) {
            for (const [id, filters] of list) if (filters.some((f) => matches(f, e))) client.send(JSON.stringify(['EVENT', id, e]));
          }
        }
        ws.send(JSON.stringify(['OK', e.id, true, '']));
      } else if (msg[0] === 'REQ') {
        const [, id, ...filters] = msg as [string, string, ...Filter[]];
        subs.get(ws)?.set(id, filters);
        for (const e of events.values()) if (filters.some((f) => matches(f, e))) ws.send(JSON.stringify(['EVENT', id, e]));
        ws.send(JSON.stringify(['EOSE', id]));
      } else if (msg[0] === 'CLOSE') {
        subs.get(ws)?.delete(msg[1]);
      }
    });
  });
  return {
    url: () => `ws://127.0.0.1:${(server.address() as AddressInfo).port}`,
    port: () => (server.address() as AddressInfo).port,
    events,
    refuse: (on: boolean) => (refuse = on),
    close: () => new Promise((r) => server.close(r)),
  };
}
