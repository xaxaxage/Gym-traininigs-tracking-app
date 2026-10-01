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

/**
 * How well an exercise matches, as tier × 1000 + a score within the tier:
 * 3 = the exact name; 2 = an exact alias, or every word in the name or an
 * alias; 1 = only in its equipment or muscles, or inside a word; 0 = no match.
 * Within a tier, your favorites and recent exercises outrank wording.
 */
function textScore(ix: Indexed, q: string[], joined: string): number {
  if (ix.nameJoined === joined) return 3000;
  let best = 0;
  for (const a of ix.aliases) {
    if (a.joined === joined) best = Math.max(best, 2300);
    else if (allPrefix(q, a.words)) best = Math.max(best, 2150);
  }
  if (allPrefix(q, ix.name)) {
    // The name starts with the query ("bench" → "Bench Dip") beats a word deep inside it.
    best = Math.max(best, (ix.name[0].startsWith(q[0]) ? 2250 : 2200) - ix.name.length * 4);
  } else if (best === 0 && joined.length >= 4 && ix.nameJoined.includes(joined)) {
    best = 1150;
  } else if (best === 0 && allPrefix(q, [...ix.name, ...ix.tags, ...ix.aliases.flatMap((a) => a.words)])) {
    best = 1100 - ix.name.length * 2;
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

/** Within a match tier: favorites and recently done exercises first, then popular ones (at most 900, below a tier). */
function boost(e: Exercise, opts: SearchOptions): number {
  let b = 0;
  if (opts.favorites?.has(e.id)) b += 250;
  const used = opts.recent?.get(e.id);
  if (used) b += 100 + 200 * Math.exp(-Math.max(0, Date.now() - used) / (21 * 86_400_000));
  if (e.popular) b += Math.max(0, 60 - e.popular / 3);
  if (e.custom) b += 20;
  return b;
}

export interface Scored {
  exercise: Exercise;
  score: number;
  /** 3 = exact name, 2 = alias or every word in the name, 1 = only tags or part of a word. */
  tier: number;
}

/** Exercises matching the query with how well they match, best first. */
export function searchScored(all: Exercise[], query: string, opts: SearchOptions = {}): Scored[] {
  // Shorthand is tried both ways: "db row" is an alias as typed, "dumbbell row" as spelled out.
  const raw = words(query);
  const q = queryWords(query);
  const joined = q.join('');
  const rawJoined = raw.join('');
  const scored: Scored[] = [];
  if (q.length === 0 && raw.length > 0) return [];
  for (const e of all) {
    if (!matchesFilters(e, opts)) continue;
    if (q.length === 0) {
      scored.push({ exercise: e, score: boost(e, opts), tier: 0 });
      continue;
    }
    const ix = index(e);
    const text = Math.max(textScore(ix, q, joined), rawJoined === joined ? 0 : textScore(ix, raw, rawJoined));
    if (text > 0) scored.push({ exercise: e, score: text + boost(e, opts), tier: Math.floor(text / 1000) });
  }
  scored.sort((a, b) => b.score - a.score || a.exercise.name.localeCompare(b.exercise.name, 'en'));
  return opts.limit ? scored.slice(0, opts.limit) : scored;
}

/** Exercises matching the query, best first. An empty query lists everything that passes the filters. */
export function searchExercises(all: Exercise[], query: string, opts: SearchOptions = {}): Exercise[] {
  return searchScored(all, query, opts).map((s) => s.exercise);
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
