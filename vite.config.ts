import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vitest/config';
import preact from '@preact/preset-vite';
import { exerciseLibrary } from './plugins/exercise-library.ts';

/** Emit sw.js with a precache list of every file in the build (ported from the calorie tracker). */
function serviceWorker(): Plugin {
  return {
    name: 'gym-tracker-service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const built = Object.keys(bundle).filter((f) => !f.endsWith('.map'));
      const pub = ['manifest.webmanifest', ...readdirSync('public/icons').map((f) => `icons/${f}`)];
      const files = [...new Set([...built, ...pub])].sort();
      const hash = createHash('sha256').update(files.join('|')).digest('hex').slice(0, 10);
      const version = `${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}-${hash}`;
      const dataset = JSON.parse(readFileSync('data/dataset.json', 'utf8')) as { repo: string; commit: string };
      const source = readFileSync('sw-template.js', 'utf8')
        .replace('__VERSION__', version)
        .replace('__ASSETS__', JSON.stringify(files.map((f) => `./${f}`)))
        .replace('__PHOTOS__', JSON.stringify(`https://raw.githubusercontent.com/${dataset.repo}/${dataset.commit}/exercises/`));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

/** Shown in Settings, so it's easy to tell which version a device is running. */
function appVersion(): string {
  const when = new Date().toISOString().slice(0, 16).replace('T', ' ');
  let commit = process.env.GITHUB_SHA?.slice(0, 7) ?? '';
  if (!commit) {
    try {
      commit = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    } catch {
      commit = 'local';
    }
  }
  return `${when} · ${commit}`;
}

export default defineConfig({
  // Relative base so the build works from any sub-path (e.g. GitHub Pages).
  base: './',
  define: { __APP_VERSION__: JSON.stringify(appVersion()) },
  plugins: [preact(), exerciseLibrary(), serviceWorker()],
  build: {
    target: ['es2020', 'safari15'],
    assetsInlineLimit: 0,
    // The exercise instructions are one 600 kB chunk, loaded only on an exercise's page.
    chunkSizeWarningLimit: 700,
  },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.ts'],
  },
});
