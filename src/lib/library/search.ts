import type { Equipment, MuscleGroup } from '../types';
import { EQUIPMENT_LABEL, GROUP_LABEL, groupsOf, MUSCLE_LABEL, type Exercise } from './catalog';
import { SYNONYMS } from './synonyms';

/**
 * Exercise search that is instant over the whole library: every exercise is
 * turned into a few normalized strings once, and a query is matched against
 * them word by word. "pull-up", "pullup" and "pull up" are the same, plurals
 * match ("curls"), shorthand works ("db", "bb", "kb") and aliases
 * ("bench", "RDL") rank their exercise first.
 */

/** Lower case, apostrophes and hyphens dropped ("pull-up" → "pullup"), other punctuation as spaces. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['’`-]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Plural and singular match: "curls" → "curl", "presses" → "press". */
function stem(word: string): string {
  if (word.length > 4 && word.endsWith('ses')) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

const words = (text: string) => normalize(text).split(' ').filter(Boolean).map(stem);

interface Indexed {
  exercise: Exercise;
  name: string[];
  nameJoined: string;
  aliases: { words: string[]; joined: string }[];
  /** Equipment, muscles and groups. */
  tags: string[];
}

const cache = new WeakMap<Exercise, Indexed>();

function index(e: Exercise): Indexed {
  let ix = cache.get(e);
  if (!ix) {
    const name = words(e.name);
    ix = {
      exercise: e,
      name,
      nameJoined: name.join(''),
      aliases: e.aliases.map((a) => {
        const w = words(a);
        return { words: w, joined: w.join('') };
      }),
      tags: words(
        [
          EQUIPMENT_LABEL[e.equipment],
          ...e.primary.map((m) => MUSCLE_LABEL[m]),
          ...groupsOf(e).map((g) => GROUP_LABEL[g]),
          e.custom ? 'custom' : '',
        ].join(' '),
      ),
    };
    cache.set(e, ix);
  }
  return ix;
}

/** Every query word starts some word of the target. */
const allPrefix = (query: string[], target: string[]) => query.every((q) => target.some((t) => t.startsWith(q)));

function textScore(ix: Indexed, q: string[], joined: string): number {
  if (ix.nameJoined === joined) return 1000;
  let best = 0;
  for (const a of ix.aliases) {
    if (a.joined === joined) best = Math.max(best, 900);
    else if (allPrefix(q, a.words)) best = Math.max(best, a.joined.startsWith(joined) ? 520 : 380);
  }
  if (allPrefix(q, ix.name)) {
    // The name starts with the query ("bench" → "Bench Press …") beats a word deep inside it.
    const starts = ix.name[0].startsWith(q[0]);
    best = Math.max(best, (starts ? 640 : 460) - ix.name.length * 4);
  } else if (joined.length >= 4 && ix.nameJoined.includes(joined)) {
    best = Math.max(best, 300);
  } else if (allPrefix(q, [...ix.name, ...ix.tags, ...ix.aliases.flatMap((a) => a.words)])) {
    best = Math.max(best, 200 - ix.name.length * 2);
  }
  return best;
}

export interface SearchOptions {
  group?: MuscleGroup | null;
  equipment?: Equipment | null;
  /** Exercise id → when it was last done. */
  recent?: Map<string, number>;
  favorites?: Set<string>;
  hidden?: Set<string>;
  /** Show hidden exercises too. */
  includeHidden?: boolean;
  onlyFavorites?: boolean;
  limit?: number;
}

/** Query words with shorthand spelled out ("db row" → "dumbbell row"). */
function queryWords(query: string): string[] {
  return words(
    normalize(query)
      .split(' ')
      .map((w) => SYNONYMS[w] ?? w)
      .join(' '),
  );
}

export function matchesFilters(e: Exercise, opts: SearchOptions): boolean {
  if (opts.group && !groupsOf(e).includes(opts.group)) return false;
  if (opts.equipment && e.equipment !== opts.equipment) return false;
  if (opts.onlyFavorites && !opts.favorites?.has(e.id)) return false;
  if (!opts.includeHidden && opts.hidden?.has(e.id)) return false;
  return true;
}

/** Small nudges so, among equally good matches, the ones you use come first. */
function boost(e: Exercise, opts: SearchOptions): number {
  let b = 0;
  if (opts.favorites?.has(e.id)) b += 60;
  const used = opts.recent?.get(e.id);
  if (used) b += 50 + Math.max(0, 40 - (Date.now() - used) / (7 * 86_400_000));
  if (e.popular) b += Math.max(0, 60 - e.popular / 3);
  if (e.custom) b += 20;
  return b;
}

/** Exercises matching the query, best first. An empty query lists everything that passes the filters. */
export function searchExercises(all: Exercise[], query: string, opts: SearchOptions = {}): Exercise[] {
  const q = queryWords(query);
  const joined = q.join('');
  const scored: { e: Exercise; score: number }[] = [];
  for (const e of all) {
    if (!matchesFilters(e, opts)) continue;
    if (q.length === 0) {
      scored.push({ e, score: boost(e, opts) });
      continue;
    }
    const text = textScore(index(e), q, joined);
    if (text > 0) scored.push({ e, score: text + boost(e, opts) });
  }
  scored.sort((a, b) => b.score - a.score || a.e.name.localeCompare(b.e.name, 'en'));
  const out = scored.map((s) => s.e);
  return opts.limit ? out.slice(0, opts.limit) : out;
}

/** Hidden exercises that match, for a "show hidden" hint under the results. */
export function hiddenMatches(all: Exercise[], query: string, opts: SearchOptions): number {
  if (!opts.hidden?.size || opts.includeHidden) return 0;
  return searchExercises(
    all.filter((e) => opts.hidden!.has(e.id)),
    query,
    { ...opts, includeHidden: true },
  ).length;
}
