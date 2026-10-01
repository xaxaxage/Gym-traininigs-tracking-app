import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Equipment, MuscleGroup } from '../lib/types';
import { finishedWorkouts, getData, getRoutine, getWorkout, putRoutine, putWorkout, useData } from '../lib/store';
import { goBack, href, navigate } from '../lib/router';
import { showToast } from '../lib/toast';
import { allExercises, useLibrary } from '../lib/library/load';
import { EQUIPMENT, EQUIPMENT_LABEL, GROUP_LABEL, GROUPS, groupsOf, MUSCLE_LABEL, type Exercise } from '../lib/library/catalog';
import { hiddenMatches, searchExercises, type SearchOptions } from '../lib/library/search';
import { addExercises, lastSets, lastUsed, routineExercise, swapExercise } from '../lib/workout';
import { plural } from '../lib/format';
import { BottomNav, Loading, Sheet, Switch } from '../components/Common';
import { Check, ChevronRight, Close, Filter, Plus, Search, Star } from '../components/Icons';
import { requestScrollTo } from '../lib/scroll';

export type PickTarget =
  | { kind: 'workout'; workoutId: string; swap?: string }
  | { kind: 'routine'; routineId: string; swap?: string };

const PAGE = 60;

/** The exercise library, to browse, or to pick exercises for a workout or routine. */
export function Library({ pick, initialQuery = '' }: { pick?: PickTarget; initialQuery?: string }) {
  const lib = useLibrary();
  const data = useData();
  const [query, setQuery] = useState(initialQuery);
  const [group, setGroup] = useState<MuscleGroup | null>(null);
  const [equipment, setEquipment] = useState<Equipment | null>(null);
  const [onlyFavorites, setOnlyFavorites] = useState(false);
  const [includeHidden, setIncludeHidden] = useState(false);
  const [filters, setFilters] = useState(false);
  const [picked, setPicked] = useState<Exercise[]>([]);
  const swapping = !!pick?.swap;

  const recent = useMemo(() => lastUsed(data.workouts), [data.workouts]);
  const favorites = useMemo(() => new Set(data.prefs.filter((p) => p.favorite).map((p) => p.id)), [data.prefs]);
  const hidden = useMemo(() => new Set(data.prefs.filter((p) => p.hidden).map((p) => p.id)), [data.prefs]);
  const all = useMemo(
    () => (lib.state === 'ready' ? allExercises(data, lib.exercises) : []),
    [lib.state, data.customExercises],
  );
  const opts: SearchOptions = { group, equipment, recent, favorites, hidden, includeHidden, onlyFavorites };
  const filtered = !!(query.trim() || group || equipment || onlyFavorites);
  const results = useMemo(() => (filtered ? searchExercises(all, query, opts) : []), [all, query, group, equipment, onlyFavorites, includeHidden, recent, favorites, hidden]);
  const hiddenCount = filtered ? hiddenMatches(all, query, opts) : 0;

  const target = pick ? (pick.kind === 'workout' ? getWorkout(pick.workoutId) : getRoutine(pick.routineId)) : undefined;
  const already = new Set<string>(target ? target.exercises.map((e) => e.exerciseId) : []);

  const choose = (e: Exercise) => {
    if (!pick) return navigate(`/exercise/${encodeURIComponent(e.id)}`);
    if (swapping) return done([e]);
    setPicked((list) => (list.some((x) => x.id === e.id) ? list.filter((x) => x.id !== e.id) : [...list, e]));
  };

  const done = (list: Exercise[]) => {
    if (!pick || list.length === 0) return;
    const refs = list.map((e) => ({ id: e.id, name: e.name, logType: e.logType }));
    const history = finishedWorkouts(getData());
    if (pick.kind === 'workout') {
      const w = getWorkout(pick.workoutId);
      if (!w) return goBack('/');
      if (pick.swap) {
        putWorkout(swapExercise(w, pick.swap, refs[0], history));
        requestScrollTo(pick.swap);
      } else {
        const next = addExercises(w, refs, history);
        putWorkout(next);
        requestScrollTo(next.exercises[w.exercises.length]?.id);
      }
    } else {
      const r = getRoutine(pick.routineId);
      if (!r) return goBack('/');
      const planned = (id: string) => {
        const last = lastSets(history, id);
        return last.length ? last.map((s) => ({ reps: s.reps, seconds: s.seconds, meters: s.meters })) : [{}, {}, {}];
      };
      if (pick.swap) {
        putRoutine({
          ...r,
          exercises: r.exercises.map((x) => (x.id === pick.swap ? { ...x, exerciseId: refs[0].id, name: refs[0].name, logType: refs[0].logType } : x)),
        });
      } else {
        putRoutine({ ...r, exercises: [...r.exercises, ...refs.map((ref) => routineExercise(ref, planned(ref.id)))] });
      }
    }
    if (!pick.swap) showToast(list.length === 1 ? `Added ${list[0].name}` : `Added ${list.length} exercises`, undefined, { carry: true });
    goBack(pick.kind === 'workout' ? '/workout' : `/routine/${pick.routineId}`);
  };

  const sections =
    lib.state === 'ready' && !filtered ? browseSections(all, recent, favorites, hidden) : null;

  const title = pick ? (swapping ? 'Swap exercise' : 'Add exercises') : 'Exercises';
  const createHref = `#${href('/exercise/new', { name: query.trim(), to: pick && !swapping ? pickParam(pick) : undefined })}`;

  return (
    <>
      <main class={`screen library${pick ? ' with-footer' : ' with-nav'}`}>
        {pick ? (
          <header class="topbar">
            <button type="button" class="icon-btn ink" aria-label="Cancel" onClick={() => goBack('/')}>
              <Close />
            </button>
            <h1>{title}</h1>
            <span class="spacer-44" />
          </header>
        ) : (
          <header class="page-head">
            <h1 class="page-title">{title}</h1>
            <a href="#/exercise/new" class="icon-btn" aria-label="New custom exercise">
              <Plus />
            </a>
          </header>
        )}

        <div class="library-tools">
          <div class="search">
            <Search size={20} />
            <label for="exercise-search" class="sr-only">
              Search exercises
            </label>
            <input
              id="exercise-search"
              type="search"
              class="input search-input"
              placeholder="Search, e.g. bench, RDL, pull-up"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellcheck={false}
              enterKeyHint="search"
              value={query}
              onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              }}
            />
            {query && (
              <button type="button" class="search-clear" aria-label="Clear search" onClick={() => setQuery('')}>
                <Close size={18} />
              </button>
            )}
          </div>
          <div class="chip-row" role="group" aria-label="Muscle group">
            <button type="button" class={`pill${equipment || onlyFavorites || includeHidden ? ' has-filter' : ''}`} onClick={() => setFilters(true)}>
              <Filter size={16} />
              Filters{equipment || onlyFavorites || includeHidden ? ' •' : ''}
            </button>
            {GROUPS.map((g) => (
              <button type="button" class="pill" aria-pressed={group === g} onClick={() => setGroup(group === g ? null : g)}>
                {GROUP_LABEL[g]}
              </button>
            ))}
          </div>
        </div>

        {lib.state === 'loading' && <Loading label="Loading exercises…" />}
        {lib.state === 'error' && (
          <div class="notice plain" role="alert">
            <span>The exercise list couldn't be loaded. Check your connection.</span>
            <button type="button" class="btn-secondary btn-small" onClick={lib.retry}>
              Try again
            </button>
          </div>
        )}

        {sections &&
          sections.map((s) => (
            <section class="stack-8" aria-label={s.title}>
              <h2 class="list-label">{s.title}</h2>
              <ExerciseList items={s.items} picked={picked} already={already} favorites={favorites} pick={!!pick} onChoose={choose} />
            </section>
          ))}

        {filtered && lib.state === 'ready' && (
          <section class="stack-8" aria-label="Results">
            <p class="list-label" role="status">
              {results.length === 0 ? 'No matches' : plural(results.length, 'exercise')}
            </p>
            {results.length > 0 && (
              <ExerciseList items={results} picked={picked} already={already} favorites={favorites} pick={!!pick} onChoose={choose} />
            )}
            {hiddenCount > 0 && (
              <button type="button" class="link-btn left" onClick={() => setIncludeHidden(true)}>
                Show {plural(hiddenCount, 'hidden exercise')} that match
              </button>
            )}
          </section>
        )}

        {lib.state === 'ready' && (
          <a
            href={createHref}
            class="card create-row"
            onClick={(e) => {
              // From the picker, the new exercise's screen takes its place, so saving goes straight back.
              e.preventDefault();
              navigate(createHref.slice(1), { replace: !!pick });
            }}
          >
            <span class="row-main">
              <span class="row-title">{query.trim() ? `Create “${query.trim()}”` : 'Create your own exercise'}</span>
              <span class="row-sub">Not in the list? Add it with its muscles and how it's logged.</span>
            </span>
            <ChevronRight />
          </a>
        )}
      </main>

      {pick && !swapping && (
        <div class="footer">
          <div class="footer-inner">
            <button type="button" class="btn-primary" disabled={picked.length === 0} onClick={() => done(picked)}>
              {picked.length === 0 ? 'Pick exercises' : `Add ${plural(picked.length, 'exercise')}`}
            </button>
          </div>
        </div>
      )}
      {!pick && <BottomNav current="exercises" />}

      <Sheet open={filters} onClose={() => setFilters(false)} title="Filters">
        <div class="field">
          <label for="equipment" class="field-label">
            Equipment
          </label>
          <select
            id="equipment"
            class="input select"
            value={equipment ?? ''}
            onChange={(e) => setEquipment(((e.target as HTMLSelectElement).value || null) as Equipment | null)}
          >
            <option value="">Any equipment</option>
            {EQUIPMENT.map((eq) => (
              <option value={eq}>{EQUIPMENT_LABEL[eq]}</option>
            ))}
          </select>
        </div>
        <Switch id="only-favorites" checked={onlyFavorites} label="Favorites only" onChange={setOnlyFavorites} />
        <Switch id="show-hidden" checked={includeHidden} label="Show hidden exercises" hint="Exercises you hid are left out of the list and search." onChange={setIncludeHidden} />
        <div class="button-pair">
          <button
            type="button"
            class="btn-secondary"
            onClick={() => {
              setEquipment(null);
              setOnlyFavorites(false);
              setIncludeHidden(false);
              setGroup(null);
              setFilters(false);
            }}
          >
            Clear filters
          </button>
          <button type="button" class="btn-primary" onClick={() => setFilters(false)}>
            Show results
          </button>
        </div>
      </Sheet>
    </>
  );
}

function pickParam(p: PickTarget): string {
  return p.kind === 'workout' ? `workout:${p.workoutId}` : `routine:${p.routineId}`;
}

interface Section {
  title: string;
  items: Exercise[];
}

/** Without a search: recent, favorites, popular, then everything A–Z. */
function browseSections(all: Exercise[], recent: Map<string, number>, favorites: Set<string>, hidden: Set<string>): Section[] {
  const visible = all.filter((e) => !hidden.has(e.id));
  const byId = new Map(visible.map((e) => [e.id, e]));
  const recentItems = [...recent.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => byId.get(id))
    .filter((e): e is Exercise => !!e)
    .slice(0, 8);
  const fav = visible.filter((e) => favorites.has(e.id));
  const custom = visible.filter((e) => e.custom);
  const popular = visible.filter((e) => e.popular).sort((a, b) => a.popular! - b.popular!);
  const out: Section[] = [];
  if (recentItems.length) out.push({ title: 'Recent', items: recentItems });
  if (fav.length) out.push({ title: 'Favorites', items: fav });
  if (custom.length) out.push({ title: 'Your exercises', items: custom });
  out.push({ title: 'Popular', items: popular });
  out.push({ title: 'All exercises', items: visible.filter((e) => !e.custom) });
  return out;
}

function describe(e: Exercise): string {
  const muscles = groupsOf(e).length ? e.primary.map((m) => MUSCLE_LABEL[m]).join(', ') : '';
  return [muscles, EQUIPMENT_LABEL[e.equipment], e.custom ? 'Custom' : ''].filter(Boolean).join(' · ');
}

/** A long list that draws its rows a page at a time as it scrolls into view. */
function ExerciseList({
  items,
  picked,
  already,
  favorites,
  pick,
  onChoose,
}: {
  items: Exercise[];
  picked: Exercise[];
  already: Set<string>;
  favorites: Set<string>;
  pick: boolean;
  onChoose: (e: Exercise) => void;
}) {
  const [shown, setShown] = useState(PAGE);
  const more = useRef<HTMLLIElement>(null);
  useEffect(() => setShown(PAGE), [items]);
  useEffect(() => {
    const el = more.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((entries) => entries.some((x) => x.isIntersecting) && setShown((n) => n + PAGE), { rootMargin: '600px' });
    io.observe(el);
    return () => io.disconnect();
  }, [shown, items]);
  const pickedIds = new Set(picked.map((p) => p.id));
  return (
    <ul class="list exercise-list">
      {items.slice(0, shown).map((e) => {
        const on = pickedIds.has(e.id);
        return (
          <li key={e.id}>
            <button
              type="button"
              class={`row exercise-row${on ? ' picked' : ''}`}
              aria-pressed={pick ? on : undefined}
              onClick={() => onChoose(e)}
            >
              <span class="row-main">
                <span class="row-title">
                  {e.name}
                  {favorites.has(e.id) && (
                    <span class="fav-mark" aria-label="Favorite">
                      <Star size={14} filled />
                    </span>
                  )}
                </span>
                <span class="row-sub">
                  {describe(e)}
                  {pick && already.has(e.id) ? ' · in this one already' : ''}
                </span>
              </span>
              {pick ? (
                <span class={`pick-mark${on ? ' on' : ''}`} aria-hidden="true">
                  {on ? <Check size={18} /> : <Plus size={18} />}
                </span>
              ) : (
                <ChevronRight />
              )}
            </button>
          </li>
        );
      })}
      {shown < items.length && (
        <li ref={more} class="list-more">
          <button type="button" class="link-btn" onClick={() => setShown((n) => n + PAGE)}>
            Show more ({items.length - shown})
          </button>
        </li>
      )}
    </ul>
  );
}
