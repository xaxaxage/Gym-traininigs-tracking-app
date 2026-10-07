import { useMemo, useState } from 'preact/hooks';
import type { LogType, Units } from '../lib/types';
import { activeWorkout, finishedWorkouts, useData } from '../lib/store';
import { shortDate, todayKey } from '../lib/dates';
import { exerciseOverview, weeklyVolume, type ExerciseProgress } from '../lib/progress';
import { fmtDistance, fmtDuration, fmtVolume, weightLabel, distanceUnit } from '../lib/units';
import { plural } from '../lib/format';
import { normalize } from '../lib/library/search';
import { BottomNav } from '../components/Common';
import { ChevronRight, Search } from '../components/Icons';

/** How training is going: volume week by week, and every exercise with its trend. */
export function Progress() {
  const data = useData();
  const { units } = data.settings;
  const active = activeWorkout(data);
  const done = useMemo(() => finishedWorkouts(data), [data.workouts]);
  const today = todayKey();
  const weeks = useMemo(() => weeklyVolume(done, today, 7), [done, today]);
  const exercises = useMemo(() => exerciseOverview(done), [done]);
  const [picked, setPicked] = useState(weeks.length - 1);
  const [query, setQuery] = useState('');
  const shown = query.trim() ? exercises.filter((e) => normalize(e.name).includes(normalize(query))) : exercises;
  const week = weeks[picked] ?? weeks[weeks.length - 1];
  const max = Math.max(1, ...weeks.map((w) => w.volume));
  const month = done.filter((w) => w.date.slice(0, 7) === today.slice(0, 7)).length;

  return (
    <>
      <main class={`screen with-nav${active ? ' with-mini' : ''}`}>
        <header class="page-head">
          <div>
            <span class="eyebrow">
              {plural(done.length, 'workout')} · {month} this month
            </span>
            <h1 class="page-title">Progress</h1>
          </div>
        </header>

        <section class="stack-12" aria-labelledby="volume-title">
          <div class="week-head">
            <h2 id="volume-title" class="list-label">
              Volume per week
            </h2>
            <span class="muted num" aria-live="polite">
              {picked === weeks.length - 1 ? 'This week' : `Week of ${shortDate(week.start)}`} · {fmtVolume(week.volume, units)}
            </span>
          </div>
          <ol class="week-bars" style={`--weeks:${weeks.length}`} aria-label="Volume per week, oldest first">
            {weeks.map((w, i) => (
              <li class={i === weeks.length - 1 ? 'this-week' : ''}>
                <button
                  type="button"
                  class={`week-pick${i === picked ? ' picked' : ''}`}
                  aria-pressed={i === picked}
                  aria-label={`Week of ${shortDate(w.start)}: ${fmtVolume(w.volume, units)}, ${plural(w.workouts, 'workout')}, ${plural(w.sets, 'set')}`}
                  onClick={() => setPicked(i)}
                >
                  <span class="week-bar" style={{ height: `${Math.max(2, (w.volume / max) * 100)}%` }} />
                </button>
                <span class="week-bar-label" aria-hidden="true">
                  {shortDate(w.start).replace(/^\w+ /, '')}
                </span>
              </li>
            ))}
          </ol>
          <p class="stat-line">
            <span>
              <strong>{week.workouts}</strong> {week.workouts === 1 ? 'workout' : 'workouts'}
            </span>
            <span>
              <strong>{week.sets}</strong> sets
            </span>
          </p>
        </section>

        <section class="stack-12" aria-labelledby="ex-title">
          <div class="section-head">
            <h2 id="ex-title" class="list-label">
              Exercises
            </h2>
            <a href="#/exercises" class="link-btn muted">
              All exercises
            </a>
          </div>
          {exercises.length > 8 && (
            <div class="search">
              <Search size={18} />
              <label for="progress-search" class="sr-only">
                Find an exercise
              </label>
              <input
                id="progress-search"
                type="search"
                class="input search-input"
                placeholder="Find an exercise"
                autoComplete="off"
                value={query}
                onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
              />
            </div>
          )}
          {exercises.length === 0 ? (
            <p class="notice info plain">Finish a workout and every exercise in it shows up here, with its best and how it's moving.</p>
          ) : shown.length === 0 ? (
            <p class="list-empty">No exercise matches “{query.trim()}”.</p>
          ) : (
            <ul class="list">
              {shown.map((e) => (
                <ProgressRow e={e} units={units} />
              ))}
            </ul>
          )}
        </section>
      </main>
      <BottomNav current="progress" />
    </>
  );
}

function bestText(value: number, logType: LogType, units: Units): string {
  if (logType === 'weight_reps' || logType === 'weight_distance') return weightLabel(value, units);
  if (logType === 'bodyweight') return plural(value, 'rep');
  if (logType === 'duration') return fmtDuration(value);
  return `${fmtDistance(value, logType, units)} ${distanceUnit(logType, units)}`;
}

const MEASURE: Record<LogType, string> = {
  weight_reps: 'est. 1RM',
  bodyweight: 'most reps',
  duration: 'longest',
  distance: 'farthest',
  weight_distance: 'heaviest',
};

function ProgressRow({ e, units }: { e: ExerciseProgress; units: Units }) {
  const change = e.change === undefined ? '' : `${e.change >= 0 ? '+' : '−'}${Math.abs(Math.round(e.change * 100))}%`;
  return (
    <li>
      <a href={`#/exercise/${encodeURIComponent(e.exerciseId)}`} class="row progress-row">
        <span class="row-main">
          <span class="row-title">{e.name}</span>
          <span class="row-sub num">
            {plural(e.sessions, 'workout')} · {shortDate(e.lastDate)}
          </span>
        </span>
        <Spark values={e.trend} />
        <span class="row-side">
          <span>{bestText(e.best, e.logType, units)}</span>
          <small>
            {MEASURE[e.logType]}
            {change ? ` · ${change}` : ''}
          </small>
        </span>
        <ChevronRight size={18} />
      </a>
    </li>
  );
}

/** A small line of the trend, the latest point marked. Decorative: the numbers beside it say the same. */
function Spark({ values }: { values: number[] }) {
  const w = 56;
  const h = 22;
  const pts = values.filter((v) => v > 0);
  if (pts.length < 2) return <svg class="spark" width={w} height={h} aria-hidden="true" />;
  const lo = Math.min(...pts);
  const hi = Math.max(...pts);
  const y = (v: number) => (hi === lo ? h / 2 : h - 2 - ((v - lo) / (hi - lo)) * (h - 4));
  const x = (i: number) => (i / (pts.length - 1)) * (w - 4) + 2;
  const line = pts.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  return (
    <svg class="spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <polyline points={line} />
      <circle cx={x(pts.length - 1)} cy={y(pts[pts.length - 1])} r={2.5} />
    </svg>
  );
}
