// Downloads free-exercise-db at a commit and pins it: `npm run dataset:update -- <commit sha>`.
// The app's build reads only data/free-exercise-db.json, so every build of a commit is the same.
import { readFileSync, writeFileSync } from 'node:fs';

const commit = process.argv[2];
if (!/^[0-9a-f]{40}$/.test(commit ?? '')) {
  console.error('Usage: npm run dataset:update -- <40-character commit sha of yuhonas/free-exercise-db>');
  process.exit(1);
}
const meta = JSON.parse(readFileSync('data/dataset.json', 'utf8'));
const url = `https://raw.githubusercontent.com/${meta.repo}/${commit}/dist/exercises.json`;
const res = await fetch(url);
if (!res.ok) throw new Error(`${url}: ${res.status}`);
const exercises = await res.json();
if (!Array.isArray(exercises) || exercises.length < 500) throw new Error('That does not look like the exercise list.');
writeFileSync('data/free-exercise-db.json', JSON.stringify(exercises, null, 2) + '\n');
writeFileSync('data/dataset.json', JSON.stringify({ ...meta, commit }, null, 2) + '\n');
console.log(`Pinned ${exercises.length} exercises at ${commit}. Run the build: it checks the curated names still exist.`);
