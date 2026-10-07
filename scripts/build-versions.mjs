#!/usr/bin/env node
/*
 * Builds every saved design version into dist/versions/<tag>/, so the app
 * can open them from Settings → Design versions and you can compare them
 * with the current one, using your own data (see scripts/preview-shim.js).
 *
 * A saved version is an entry in design-versions.json (a name, a commit and a
 * description), or a git tag named design-* with its description as the
 * tag's message:
 *
 *     git tag -a design-v3 -m "Bigger buttons, darker cards"
 *     git push origin design-v3
 *
 * Run after `npm run build` (it adds to dist/): node scripts/build-versions.mjs
 * Each version is built from its own checkout in .versions/ with its own
 * dependencies, exactly as it was.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const repo = resolve(import.meta.dirname, '..');
const dist = join(repo, 'dist');
const work = join(repo, '.versions');
const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();

if (!existsSync(join(dist, 'index.html'))) {
  console.error('Build the app first (npm run build): dist/ is missing.');
  process.exit(1);
}

// Saved versions: the ones listed in design-versions.json, then any git tag named design-*.
const NAME = /^design-[\w.-]+$/;
const listed = JSON.parse(readFileSync(join(repo, 'design-versions.json'), 'utf8')).versions ?? [];
const fromFile = listed.map((v) => {
  if (!NAME.test(v.name)) throw new Error(`design-versions.json: "${v.name}" must be named design-something`);
  const commit = git('rev-parse', '--verify', `${v.commit}^{commit}`);
  return { tag: v.name, label: v.label || v.name, date: git('show', '-s', '--format=%cs', commit), commit };
});
const SEP = '\u001f';
const fromTags = git('tag', '--list', 'design-*', '--sort=-creatordate', `--format=%(refname:short)${SEP}%(contents:subject)${SEP}%(creatordate:short)`)
  .split('\n')
  .filter(Boolean)
  .map((line) => {
    const [tag, subject, date] = line.split(SEP);
    return { tag, label: subject || tag, date, commit: git('rev-list', '-n', '1', tag) };
  })
  .filter((t) => NAME.test(t.tag) && !fromFile.some((f) => f.tag === t.tag));
const tags = [...fromFile, ...fromTags];

const shim = readFileSync(join(repo, 'scripts', 'preview-shim.js'), 'utf8');
const out = join(dist, 'versions');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const built = [];
for (const t of tags) {
  const dir = join(work, t.tag);
  console.log(`\n▸ ${t.tag} (${t.commit.slice(0, 7)}): ${t.label}`);
  if (!existsSync(join(dir, '.git'))) {
    rmSync(dir, { recursive: true, force: true });
    git('worktree', 'add', '--force', '--detach', dir, t.commit);
  } else {
    execFileSync('git', ['checkout', '--force', '--detach', t.commit], { cwd: dir, stdio: 'inherit' });
  }
  execFileSync('npm', ['ci', '--no-audit', '--no-fund', '--loglevel=error'], { cwd: dir, stdio: 'inherit' });
  const target = join(out, t.tag);
  execFileSync('npx', ['vite', 'build', '--outDir', target, '--emptyOutDir'], {
    cwd: dir,
    stdio: 'inherit',
    // Its version line shows its own commit, not the current one.
    env: { ...process.env, GITHUB_SHA: t.commit },
  });

  // An old service worker would clear the current version's offline files.
  rmSync(join(target, 'sw.js'), { force: true });
  // The Claude Desktop extension belongs to the current version only.
  rmSync(join(target, 'mcp'), { recursive: true, force: true });

  const config = { tag: t.tag, label: t.label, home: '../../' };
  const page = join(target, 'index.html');
  const html = readFileSync(page, 'utf8');
  const head = html.indexOf('<head>');
  if (head < 0) throw new Error(`${t.tag}: no <head> in index.html`);
  const inject = `<head>\n    <script>window.__GYM_PREVIEW__ = ${JSON.stringify(config)};</script>\n    <script>${shim}</script>`;
  writeFileSync(page, html.slice(0, head) + inject + html.slice(head + '<head>'.length));
  // Not an app of its own: no "Add to Home Screen" for a preview.
  writeFileSync(page, readFileSync(page, 'utf8').replace(/<link rel="manifest"[^>]*>\s*/, ''));

  built.push({ tag: t.tag, label: t.label, date: t.date, commit: t.commit.slice(0, 7) });
}

writeFileSync(join(dist, 'versions.json'), JSON.stringify({ versions: built }, null, 2) + '\n');
console.log(`\nSaved design versions: ${built.length ? built.map((b) => b.tag).join(', ') : 'none'}`);
