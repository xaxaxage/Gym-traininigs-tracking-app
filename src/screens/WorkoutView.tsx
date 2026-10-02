import { useMemo, useState } from 'preact/hooks';
import type { Workout } from '../lib/types';
import { putRoutine, sortedRoutines, useData } from '../lib/store';
import { clockTime, durationWords, longDate } from '../lib/dates';
import { navigate } from '../lib/router';
import { showToast } from '../lib/toast';
import { discard } from '../lib/actions';
import { newRecords, workoutTotals } from '../lib/stats';
import { fmtVolume } from '../lib/units';
import { fmtSet, plural } from '../lib/format';
import { positionBetween, routineFromWorkout } from '../lib/workout';
import { ActionGroup, Sheet, SheetAction, TopBar } from '../components/Common';
import { Copy, More, Pencil, Trash, Trophy } from '../components/Icons';
import { recordText } from '../lib/records';

/** A finished workout, to look at; Edit opens it in the workout screen. */
export function WorkoutView({ workout }: { workout: Workout }) {
  const data = useData();
  const { units } = data.settings;
  const t = workoutTotals(workout);
  const records = useMemo(() => newRecords(workout, data.workouts), [workout, data.workouts]);
  const [menu, setMenu] = useState(false);
  return (
    <>
    <main class="screen workout-view">
      <TopBar
        back="/history"
        right={
          <div class="topbar-actions">
            <a href={`#/workout/${workout.id}/edit`} class="icon-btn" aria-label="Edit workout">
              <Pencil />
            </a>
            <button type="button" class="icon-btn" aria-label="More" onClick={() => setMenu(true)}>
              <More />
            </button>
          </div>
        }
      />
      <header class="stack-4">
        <span class="eyebrow">
          {longDate(workout.date)} · {clockTime(workout.startedAt)}
        </span>
        <h1 class="page-title medium">{workout.name}</h1>
      </header>
      <dl class="card stat-grid">
        <div>
          <dt>Duration</dt>
          <dd class="num">{durationWords(t.duration)}</dd>
        </div>
        <div>
          <dt>Sets</dt>
          <dd class="num">{t.sets}</dd>
        </div>
        <div>
          <dt>Volume</dt>
          <dd class="num">{fmtVolume(t.volume, units)}</dd>
        </div>
      </dl>

      {records.length > 0 && (
        <section class="stack-8" aria-labelledby="wr-title">
          <h2 id="wr-title" class="section-title">
            Records set
          </h2>
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
        </section>
      )}

      {workout.exercises.map((e) => (
        <section class="card stack-8" aria-labelledby={`v-${e.id}`}>
          <h2 class="exercise-name">
            <a id={`v-${e.id}`} href={`#/exercise/${encodeURIComponent(e.exerciseId)}`}>
              {e.name}
            </a>
          </h2>
          {e.notes && <p class="muted small-text">{e.notes}</p>}
          <ol class="set-list">
            {e.sets.map((s, i) => (
              <li>
                <span class="set-num static">{i + 1}</span>
                <span class="num">{fmtSet(s, e.logType, units)}</span>
              </li>
            ))}
          </ol>
        </section>
      ))}

      {workout.notes && (
        <section class="card stack-8">
          <h2 class="section-title small">Notes</h2>
          <p class="body-text pre">{workout.notes}</p>
        </section>
      )}

      <a href={`#/workout/${workout.id}/edit`} class="btn-tonal">
        <Pencil size={18} />
        Edit workout
      </a>
    </main>
    <Sheet open={menu} onClose={() => setMenu(false)} title={workout.name}>
      <ActionGroup>
        <SheetAction
          icon={<Copy size={20} />}
          label="Save as a routine"
          onClick={() => {
            setMenu(false);
            const last = sortedRoutines(data).at(-1);
            const r = putRoutine(routineFromWorkout(workout, positionBetween(last?.position, undefined)));
            showToast(`Saved as the routine “${r.name}”`, { label: 'Open', run: () => navigate(`/routine/${r.id}`) });
          }}
        />
      </ActionGroup>
      <ActionGroup>
        <SheetAction
          icon={<Trash />}
          label="Delete workout"
          danger
          onClick={() => {
            setMenu(false);
            if (confirm(`Delete “${workout.name}” (${plural(t.sets, 'set')}) from your history?`)) discard(workout.id);
          }}
        />
      </ActionGroup>
    </Sheet>
    </>
  );
}
