import { readFileSync } from 'node:fs';
import { strToU8, zipSync } from 'fflate';
import { defineConfig, type Plugin } from 'vite';
import { exerciseLibrary } from './plugins/exercise-library.ts';

/**
 * Builds the Claude Desktop connector (mcp/server.ts) into one file with
 * everything included (the exercise library too), and packs it as a Claude
 * Desktop extension (.mcpb): a zip with a manifest, the server and an icon.
 * Claude Desktop runs it with its own Node.js, so nothing else needs
 * installing. (Ported from the calorie tracker.)
 */

const pad = (n: number) => String(n).padStart(2, '0');

/** Semver that grows with every build, so Claude Desktop sees a new download as an update. */
export function version(): string {
  const d = new Date();
  return `1.${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}.${d.getUTCHours() * 100 + d.getUTCMinutes()}`;
}

const VERSION = version();
const ENTRY = 'gym-tracker-mcp.mjs';

export const TOOLS = [
  { name: 'get_workouts', description: 'Your workouts on a day or over a period, with sets, volume and best sets.' },
  { name: 'get_workout', description: 'One workout in full: every exercise and set, notes and records.' },
  { name: 'get_exercise_progress', description: 'Records and the trend for an exercise (estimated 1-rep max, top sets).' },
  { name: 'search_exercises', description: 'Search the 800+ exercise library and your own, by name, alias, muscle and equipment.' },
  { name: 'log_workout', description: 'Log a workout from a description, like "bench 3×8 at 80 kg, then rows 3×10 at 60".' },
  { name: 'update_workout', description: "Change a workout's name, notes, time or exercises." },
  { name: 'delete_workout', description: 'Remove a workout.' },
  { name: 'update_set', description: 'Change one set.' },
  { name: 'delete_set', description: 'Remove one set.' },
  { name: 'list_routines', description: 'Your routines with their exercises and planned sets.' },
  { name: 'create_routine', description: 'Make a routine, e.g. each day of a 4-day upper/lower program.' },
  { name: 'update_routine', description: 'Rename a routine or change its exercises.' },
  { name: 'delete_routine', description: 'Remove a routine.' },
  { name: 'create_exercise', description: 'Add a custom exercise when the library has nothing that fits.' },
];

export function manifest() {
  return {
    manifest_version: '0.3',
    name: 'gym-tracker',
    display_name: 'Gym Tracker',
    version: VERSION,
    description: 'Read and log your workouts in Gym Tracker, synced with the app on your phone.',
    long_description:
      "Ask Claude about your training — what you did this week, how your bench press is progressing — log workouts by describing them, and turn a plan into routines. Uses the app's end-to-end encrypted device sync: paste the 12-word sync key from the app (Settings → Sync between devices → Show sync key). Your training log stays encrypted on the relays; only your devices can read it.",
    author: { name: 'xaxaxage', url: 'https://github.com/xaxaxage' },
    homepage: 'https://xaxaxage.github.io/Gym-traininigs-tracking-app/',
    repository: { type: 'git', url: 'https://github.com/xaxaxage/Gym-traininigs-tracking-app' },
    icon: 'icon.png',
    server: {
      type: 'node',
      entry_point: 'server/index.mjs',
      mcp_config: {
        command: 'node',
        args: ['${__dirname}/server/index.mjs'],
        env: { SYNC_KEY: '${user_config.sync_key}' },
      },
    },
    tools: TOOLS,
    keywords: ['gym', 'workout', 'strength training', 'fitness', 'training log'],
    compatibility: { platforms: ['win32', 'darwin', 'linux'], runtimes: { node: '>=20.0.0' } },
    user_config: {
      sync_key: {
        type: 'string',
        title: 'Sync key (12 words)',
        description: 'In the app: Settings → Sync between devices → Show sync key. Turn sync on there first if it is off.',
        sensitive: true,
        required: true,
      },
    },
  };
}

function extension(): Plugin {
  return {
    name: 'gym-tracker-mcpb',
    apply: 'build',
    generateBundle(_options, bundle) {
      const server = bundle[ENTRY];
      if (!server || server.type !== 'chunk') throw new Error(`${ENTRY} was not built`);
      const zip = zipSync(
        {
          'manifest.json': strToU8(JSON.stringify(manifest(), null, 2)),
          'server/index.mjs': strToU8(server.code),
          'icon.png': readFileSync('public/icons/icon-512.png'),
        },
        { level: 9 },
      );
      this.emitFile({ type: 'asset', fileName: 'gym-tracker.mcpb', source: zip });
    },
  };
}

export default defineConfig({
  define: { __MCP_VERSION__: JSON.stringify(VERSION) },
  plugins: [exerciseLibrary(), extension()],
  // No browser code here: keep the web app's public/ folder out of this build.
  publicDir: false,
  build: {
    ssr: 'mcp/server.ts',
    outDir: 'dist/mcp',
    emptyOutDir: true,
    target: 'node20',
    minify: true,
    rollupOptions: { output: { format: 'es', entryFileNames: ENTRY, codeSplitting: false } },
  },
  ssr: { noExternal: true, target: 'node' },
});
