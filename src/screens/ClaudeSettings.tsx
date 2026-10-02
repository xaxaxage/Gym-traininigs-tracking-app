import { useEffect, useRef, useState } from 'preact/hooks';
import { loadSyncConfig, useSyncStatus } from '../lib/sync/state';
import {
  connectorHost,
  connectorUrl,
  fetchConnectorToken,
  ownConnectorHost,
  saveOwnConnectorHost,
  SHARED_CONNECTOR_HOST,
  timeZone,
} from '../lib/connector';
import { copy } from './SyncSettings';

type Address = { state: 'idle' } | { state: 'loading' } | { state: 'done'; url: string } | { state: 'error'; message: string };

/** The person's own connector address, fetched when asked for (the server seals their sync key into it). */
function ConnectorAddress({ phrase, relays, host }: { phrase: string; relays: string[]; host: string }) {
  const [address, setAddress] = useState<Address>({ state: 'idle' });
  const abort = useRef<AbortController | null>(null);

  // A different server or sync key means a different address.
  useEffect(() => {
    abort.current?.abort();
    setAddress({ state: 'idle' });
  }, [host, phrase]);
  useEffect(() => () => abort.current?.abort(), []);

  const load = async () => {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setAddress({ state: 'loading' });
    try {
      const token = await fetchConnectorToken(host, phrase, controller.signal);
      if (!controller.signal.aborted) setAddress({ state: 'done', url: connectorUrl(host, token, timeZone(), relays) });
    } catch (err) {
      if (!controller.signal.aborted) setAddress({ state: 'error', message: (err as Error).message });
    }
  };

  return (
    <>
      <ol class="steps body-text">
        <li>
          Get your connector address:
          {address.state === 'done' ? (
            <>
              <code class="connector-url">{address.url}</code>
              <button type="button" class="btn-primary" onClick={() => copy(address.url, 'Connector address')}>
                Copy the address
              </button>
            </>
          ) : (
            <>
              {address.state === 'error' && <span class="field-hint error-text">{address.message}</span>}
              <button type="button" class="btn-primary" disabled={address.state === 'loading'} onClick={load}>
                {address.state === 'loading' ? 'Getting your address…' : address.state === 'error' ? 'Try again' : 'Show my connector address'}
              </button>
            </>
          )}
        </li>
        <li>
          In Claude on a computer (claude.ai or Claude Desktop): <strong>Customize → Connectors → + → Add custom
          connector</strong>. Name it Gym Tracker, paste the address and click <strong>Add</strong>.
        </li>
        <li>That's it — it works in the Claude app on your phone too. Try “how is my bench press going?”</li>
      </ol>
      <p class="field-hint">
        The address is yours alone: it lets Claude read and change your training log, so don't share it — friends get their
        own here, in their app. It runs on <strong>{host}</strong>, which opens your log to answer Claude, so whoever runs
        that server could see it.
      </p>
    </>
  );
}

/** Connecting Claude to the training log: online for claude.ai and the phone apps, or the Claude Desktop extension. */
export function ClaudeSettings() {
  const status = useSyncStatus();
  const config = loadSyncConfig();
  const syncing = status.state !== 'off' && !!config && !config.retiredAt;
  const [ownHost, setOwnHost] = useState(ownConnectorHost);
  const [hostText, setHostText] = useState(ownHost);
  const host = ownHost || SHARED_CONNECTOR_HOST;
  const typedHost = connectorHost(hostText);

  return (
    <section class="page-section claude-settings" aria-label="Use with Claude">
      <p class="lead">
        Ask Claude how your training is going, log a workout by describing it (“bench 3×8 at 80 kg, then rows 3×10 at 60”),
        or have it plan a program as routines — on claude.ai and in the Claude app on your phone.
      </p>

      {syncing && config ? (
        <ConnectorAddress phrase={config.phrase} relays={config.relays} host={host} />
      ) : (
        <div class="notice plain">
          Turn on <a href="#/settings/sync">Sync between devices</a> first: Claude reaches your training log through it.
        </div>
      )}

      <details class="fold claude-desktop">
        <summary>Claude Desktop extension (runs on your computer)</summary>
        <p class="field-hint">
          Instead of the online connector, Claude Desktop can run the connector on your computer, so your training log is
          opened only there. It works only in Claude Desktop, not on your phone.
        </p>
        <ol class="steps body-text">
          <li>
            <a href="./mcp/gym-tracker.mcpb" download="gym-tracker.mcpb">
              Download the Claude Desktop extension
            </a>
          </li>
          <li>Open the file with Claude Desktop (double-click it, or drag it into Settings → Extensions) and install.</li>
          <li>When it asks for the sync key, paste your 12 words.</li>
        </ol>
        {syncing && config && (
          <button type="button" class="btn-tonal" onClick={() => copy(config.phrase)}>
            Copy the 12 words
          </button>
        )}
      </details>

      <details class="fold claude-server" open={!!ownHost}>
        <summary>Use your own connector server</summary>
        <p class="field-hint">
          For a connector only you use, run your own copy (free on Vercel — see “Host the connector” in the app's README) and
          enter its address. Leave it empty to use {SHARED_CONNECTOR_HOST}.
        </p>
        <form
          class="key-row"
          onSubmit={(e) => {
            e.preventDefault();
            saveOwnConnectorHost(typedHost);
            setOwnHost(typedHost);
          }}
        >
          <input
            id="connector-host"
            class="input mono"
            type="text"
            inputMode="url"
            autoCapitalize="off"
            autoCorrect="off"
            spellcheck={false}
            aria-label="Your connector server"
            placeholder={SHARED_CONNECTOR_HOST}
            value={hostText}
            onInput={(e) => setHostText((e.target as HTMLInputElement).value)}
          />
          <button type="submit" class="btn-secondary small-btn" disabled={(!!hostText.trim() && !typedHost) || typedHost === ownHost}>
            Use
          </button>
        </form>
        {hostText.trim() && !typedHost && <span class="field-hint error-text">That doesn't look like an address.</span>}
      </details>
    </section>
  );
}
