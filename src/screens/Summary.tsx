import { useMemo } from 'preact/hooks';
import type { Workout } from '../lib/types';
import { putRoutine, sortedRoutines, useData } from '../lib/store';
import { clockTime, durationWords, shortDate } from '../lib/dates';
import { navigate } from '../lib/router';
import { showToast } from '../lib/toast';
import { newRecords, workoutTotals } from '../lib/stats';
import { recordText } from '../lib/records';
import { fmtVolume } from '../lib/units';
import { fmtSets, plural } from '../lib/format';
import { positionBetween, routineFromWorkout } from '../lib/workout';
import { useCountUp } from '../lib/motion';
import { Trophy } from '../components/Icons';

/** Shown right after finishing: how it went, and any new records. */
export function Summary({ workout }: { workout: Workout }) {
  const data = useData();
  const { units } = data.settings;
  const totals = workoutTotals(workout);
  const records = useMemo(() => newRecords(workout, data.workouts), [workout, data.workouts]);
  const sets = useCountUp(`summary-sets-${workout.id}`, totals.sets);
  const volume = useCountUp(`summary-volume-${workout.id}`, totals.volume, 900);
  const fromRoutine = !!workout.routineId && data.routines.some((r) => r.id === workout.routineId);

  return (
    <main class="screen summary-screen with-footer">
      <header class="summary-head">
        <span class="summary-badge" aria-hidden="true">
          <Trophy size={30} />
        </span>
        <span class="eyebrow">
          {shortDate(workout.date)} · {clockTime(workout.startedAt)}
        </span>
        <h1 class="page-title">Workout done</h1>
        <p class="summary-name">{workout.name}</p>
      </header>

      <dl class="card stat-grid">
        <div>
          <dt>Duration</dt>
          <dd class="num">{durationWords(totals.duration)}</dd>
        </div>
        <div>
          <dt>Sets</dt>
          <dd class="num">{Math.round(sets)}</dd>
        </div>
        <div>
          <dt>Volume</dt>
          <dd class="num">{fmtVolume(volume, units)}</dd>
        </div>
      </dl>

      <section class="stack-8" aria-labelledby="records-title">
        <h2 id="records-title" class="section-title">
          {records.length ? `New records (${records.length})` : 'Records'}
        </h2>
        {records.length ? (
          <ul class="list records-list">
            {records.map((r) => (
              <li class="row record-row">
                <span class="record-icon" aria-hidden="true">
                  <Trophy size={20} />
                </span>
                <span class="row-main">
                  <span class="row-title">{r.name}</span>
                  <span class="row-sub">{recordText(r, units)}</span>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p class="body-text">No new records this time — consistency is what builds them.</p>
        )}
      </section>

      <section class="stack-8" aria-labelledby="done-title">
        <h2 id="done-title" class="section-title">
          {plural(totals.exercises, 'exercise')}
        </h2>
        <ul class="list">
          {workout.exercises.map((e) => (
            <li>
              <a class="row" href={`#/exercise/${encodeURIComponent(e.exerciseId)}`}>
                <span class="row-main">
                  <span class="row-title">{e.name}</span>
                  <span class="row-sub">{fmtSets(e.sets, e.logType, units)}</span>
                </span>
              </a>
            </li>
          ))}
        </ul>
      </section>

      {!fromRoutine && (
        <button
          type="button"
          class="link-btn left"
          onClick={() => {
            const last = sortedRoutines(data).at(-1);
            const r = putRoutine(routineFromWorkout(workout, positionBetween(last?.position, undefined)));
            showToast(`Saved as the routine “${r.name}”`);
          }}
        >
          Save as a routine
        </button>
      )}

      <div class="footer">
        <div class="footer-inner">
          <a href={`#/workout/${workout.id}`} class="btn-tonal" onClick={(e) => (e.preventDefault(), navigate(`/workout/${workout.id}`, { replace: true }))}>
            View
          </a>
          <button type="button" class="btn-primary" onClick={() => navigate('/', { replace: true })}>
            Done
          </button>
        </div>
      </div>
    </main>
  );
}
