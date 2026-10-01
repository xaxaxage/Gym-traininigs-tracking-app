import type { BrowserContext } from '@playwright/test';
import WebSocket from 'ws';

/**
 * The app's default relays, redirected: two to a local mock relay, one that
 * accepts the connection and never answers, and one that refuses. The app
 * runs unchanged, with its default relay list; nothing reaches the internet.
 */
export async function routeRelays(context: BrowserContext, relayUrl: string) {
  const forward = async (ws: import('@playwright/test').WebSocketRoute) => {
    const upstream = new WebSocket(relayUrl);
    const queue: string[] = [];
    upstream.on('open', () => queue.splice(0).forEach((m) => upstream.send(m)));
    upstream.on('message', (data) => ws.send(String(data)));
    upstream.on('close', () => ws.close());
    upstream.on('error', () => ws.close());
    ws.onMessage((m) => (upstream.readyState === WebSocket.OPEN ? upstream.send(String(m)) : queue.push(String(m))));
    ws.onClose(() => upstream.close());
  };
  await context.routeWebSocket(/relay\.damus\.io/, forward);
  await context.routeWebSocket(/relay\.primal\.net/, forward);
  // Accepts the connection, never says a word.
  await context.routeWebSocket(/nos\.lol/, () => {});
  // Refuses.
  await context.routeWebSocket(/nostr\.mom/, (ws) => ws.close({ code: 1011, reason: 'down' }));
}
