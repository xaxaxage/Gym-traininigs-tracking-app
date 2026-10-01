import { defineConfig, type Plugin } from 'vite';
import { version } from './vite.mcp.config.ts';
import { exerciseLibrary } from './plugins/exercise-library.ts';

/**
 * Builds the online Claude connector (mcp/cloud.ts) for Vercel, in its Build
 * Output format: one Node.js function, with everything bundled in, that
 * answers every path. vercel.json runs this as the Vercel project's build.
 */

const FUNCTION = 'functions/mcp.func';

function vercelOutput(): Plugin {
  const json = (value: unknown) => JSON.stringify(value, null, 2);
  return {
    name: 'gym-tracker-vercel-output',
    apply: 'build',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: `${FUNCTION}/.vc-config.json`,
        source: json({ runtime: 'nodejs22.x', handler: 'index.mjs', launcherType: 'Nodejs', shouldAddHelpers: false, maxDuration: 60 }),
      });
      // Every path goes to the function: /mcp/<address> is a person's connector, /link makes an
      // address for the app, / says whether it's set up. (The address and the action are also passed
      // as queries, in case the function sees the rewritten path.)
      this.emitFile({
        type: 'asset',
        fileName: 'config.json',
        source: json({
          version: 3,
          routes: [
            { src: '^/mcp/([^/]+)/?$', dest: '/mcp?token=$1' },
            { src: '^/link/?$', dest: '/mcp?action=link' },
            { handle: 'filesystem' },
            { src: '/(.*)', dest: '/mcp' },
          ],
        }),
      });
    },
  };
}

export default defineConfig({
  define: { __MCP_VERSION__: JSON.stringify(version()) },
  plugins: [exerciseLibrary(), vercelOutput()],
  publicDir: false,
  build: {
    ssr: 'mcp/cloud.ts',
    outDir: '.vercel/output',
    emptyOutDir: true,
    target: 'node22',
    minify: true,
    rollupOptions: { output: { format: 'es', entryFileNames: `${FUNCTION}/index.mjs`, codeSplitting: false } },
  },
  ssr: { noExternal: true, target: 'node' },
});
