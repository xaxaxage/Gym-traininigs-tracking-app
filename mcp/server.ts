import './setup';
import { createHash } from 'node:crypto';
import { hostname, userInfo } from 'node:os';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createConnector, relaysFrom } from './connector';

/**
 * Gym Tracker for Claude Desktop: a local MCP server that reads and writes
 * the same training log as the app, through the app's encrypted device sync.
 * Set SYNC_KEY to the 12 words from the app (Settings → Sync between devices).
 */

declare const __MCP_VERSION__: string;

const PLATFORM: Record<string, string> = { win32: 'Windows', darwin: 'Mac', linux: 'Linux' };
const deviceName = (process.env.DEVICE_NAME ?? '').trim().slice(0, 60) || `Claude Desktop · ${PLATFORM[process.platform] ?? process.platform}`;

/** The same id every time on this computer, so restarting doesn't add another device to the app's list. */
function deviceId(): string {
  let user = '';
  try {
    user = userInfo().username;
  } catch {
    // no user name available
  }
  return createHash('sha256').update(`gym-tracker-mcp|${hostname()}|${user}|${deviceName}`).digest('hex').slice(0, 32);
}

const connector = createConnector({
  syncKey: process.env.SYNC_KEY ?? '',
  relays: relaysFrom(process.env.RELAYS),
  device: { id: deviceId(), name: deviceName },
  host: 'desktop',
});

// A stray error in a library must not end the server: Claude Desktop would show it as
// disconnected until restarted. Log it (it lands in Claude Desktop's log) and carry on.
process.on('uncaughtException', (err) => console.error('Unexpected error, still running:', err));
process.on('unhandledRejection', (err) => console.error('Unexpected error, still running:', err));

async function main() {
  if (connector.setupProblem) console.error(connector.setupProblem);
  const transport = new StdioServerTransport();
  const stop = () => {
    connector.sync?.close();
    process.exit(0);
  };
  transport.onclose = stop;
  process.stdin.on('end', stop);
  await connector.newServer().connect(transport);
  console.error(`Gym Tracker MCP server ${__MCP_VERSION__} is running.`);
  connector.warmUp().catch((err) => console.error('First sync failed:', (err as Error).message));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
