import { useState } from 'preact/hooks';
import type { Routine, Workout } from '../lib/types';
import {
  activeWorkout,
  deleteRoutine,
  finishedWorkouts,
  putRoutine,
  putRoutines,
  sortedRoutines,
  useData,
} from '../lib/store';
import { addDays, durationWords, longDate, relativeDayTitle, shortDate, shortWeekday, stopwatch, todayKey, weekStart } from '../lib/dates';
import { navigate } from '../lib/router';
import { showToast } from '../lib/toast';
import { discardActive, finishActive, startWorkout } from '../lib/actions';
import { doneSetCount, duplicateRoutine, isStale, moveItem, newRoutine, positionBetween } from '../lib/workout';
import { workoutTotals } from '../lib/stats';
import { fmtVolume } from '../lib/units';
import { STARTER_PACKS, starterRoutines } from '../lib/starters';
import { BottomNav, Empty, Sheet, SheetAction, useElapsed } from '../components/Common';
import { ArrowDown, ArrowUp, Copy, Dumbbell, Gear, More, Pencil, Play, Plus, Trash } from '../components/Icons';

/** Where to begin: the workout in progress, or a routine, or an empty workout. */
export function Train() {
  const data = useData();
  const active = activeWorkout(data);
  const routines = sortedRoutines(data);
  const finished = finishedWorkouts(data);
  const today = todayKey();
  const [starters, setStarters] = useState(false);
  const [menu, setMenu] = useState<Routine | null>(null);
  const [busy, setBusy] = useState<Routine | 'empty' | null>(null);

  const begin = (routine?: Routine) => {
    if (active) setBusy(routine ?? 'empty');
    else startWorkout(routine);
  };

  const newOne = () => {
    const last = routines[routines.length - 1];
    const r = putRoutine(newRoutine('New routine', positionBetween(last?.position, undefined)));
    navigate(`/routine/${r.id}?new=1`);
  };

  return (
    <>
      <main class={`screen with-nav${active ? ' with-mini' : ''}`}>
        <header class="page-head">
          <div>
            <span class="eyebrow">{longDate(today)}</span>
            <h1 class="page-title">Train</h1>
          </div>
          <a href="#/settings" class="icon-btn" aria-label="Settings">
            <Gear />
          </a>
        </header>

        {active ? <ActiveCard workout={active} /> : (
          <button type="button" class="btn-accent start-empty" onClick={() => begin()}>
            <Play size={18} />
            Start an empty workout
          </button>
        )}

        <WeekStrip workouts={finished} today={today} />

        <section class="stack-12" aria-labelledby="routines-title">
          <div class="section-head">
            <h2 id="routines-title" class="section-title">
              Routines
            </h2>
            {routines.length > 0 && (
              <button type="button" class="link-btn" onClick={newOne}>
                <Plus size={18} />
                New routine
              </button>
            )}
          </div>

          {routines.length === 0 ? (
            <div class="card">
              <Empty title="Plan your workouts" icon={<Dumbbell size={28} />}>
                <p class="body-text center">
                  A routine is a list of exercises with their sets. Start one with a tap, and last time's weights are filled
                  in for you.
                </p>
                <div class="button-pair">
                  <button type="button" class="btn-secondary" onClick={() => setStarters(true)}>
                    Use a starter plan
                  </button>
                  <button type="button" class="btn-primary" onClick={newOne}>
                    Create a routine
                  </button>
                </div>
              </Empty>
            </div>
          ) : (
            <ul class="routine-list">
              {routines.map((r) => (
                <RoutineCard key={r.id} routine={r} workouts={finished} onStart={() => begin(r)} onMenu={() => setMenu(r)} />
              ))}
            </ul>
          )}
          {routines.length > 0 && (
            <button type="button" class="link-btn left" onClick={() => setStarters(true)}>
              Add a starter plan
            </button>
          )}
        </section>

        {data.workouts.length === 0 && (
          <div class="notice info plain">
            <span>
              Everything you log stays on this device. To use it on your other devices too, turn on{' '}
              <a href="#/settings">sync in Settings</a> — no account needed.
            </span>
          </div>
        )}
      </main>
      <BottomNav current="train" />

      <Sheet open={starters} onClose={() => setStarters(false)} title="Starter plans">
        <p class="body-text">Ready-made routines with common exercises. Change them however you like afterwards.</p>
        {STARTER_PACKS.map((pack) => (
          <SheetAction
            label={pack.name}
            hint={`${pack.routines.map((r) => r.name).join(', ')} — ${pack.description}`}
            onClick={() => {
              const last = routines[routines.length - 1]?.position ?? 0;
              putRoutines(starterRoutines(pack, last));
              setStarters(false);
              showToast(`Added ${pack.routines.length} routines`);
            }}
          />
        ))}
      </Sheet>

      <RoutineMenu routine={menu} routines={routines} onClose={() => setMenu(null)} />

      <Sheet open={!!busy} onClose={() => setBusy(null)} title="A workout is in progress">
        {active && (
          <>
            <p class="body-text">
              <strong>{active.name}</strong> is still going ({doneSetCount(active)} sets done). What should happen to it?
            </p>
            <SheetAction label="Go back to it" onClick={() => (setBusy(null), navigate('/workout'))} />
            <SheetAction
              label="Finish it, then start"
              hint="It's saved to your history."
              onClick={() => {
                const next = busy;
                setBusy(null);
                finishActive();
                startWorkout(next === 'empty' || !next ? undefined : next);
              }}
            />
            <SheetAction
              label="Discard it, then start"
              danger
              onClick={() => {
                const next = busy;
                setBusy(null);
                discardActive({ undo: false });
                startWorkout(next === 'empty' || !next ? undefined : next);
              }}
            />
          </>
        )}
      </Sheet>
    </>
  );
}

function ActiveCard({ workout }: { workout: Workout }) {
  const elapsed = useElapsed(workout.startedAt);
  const stale = isStale(workout);
  const sets = doneSetCount(workout);
  return (
    <section class="card active-card" aria-labelledby="active-title">
      <span class="eyebrow accent">{stale ? `Still open from ${shortDate(workout.date)}` : 'In progress'}</span>
      <h2 id="active-title" class="active-name">
        {workout.name}
      </h2>
      <p class="muted num">
        {stale ? `Last change ${durationWords(Date.now() - workout.updatedAt)} ago` : stopwatch(elapsed)} · {sets}{' '}
        {sets === 1 ? 'set' : 'sets'} done
      </p>
      <div class="button-pair">
        {stale && (
          <button type="button" class="btn-secondary" onClick={() => finishActive()}>
            Finish it
          </button>
        )}
        <a href="#/workout" class="btn-primary">
          <Play size={18} />
          Resume
        </a>
      </div>
    </section>
  );
}

/** This week at a glance: a dot for each day trained. */
function WeekStrip({ workouts, today }: { workouts: Workout[]; today: string }) {
  const start = weekStart(today);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const thisWeek = workouts.filter((w) => w.date >= start && w.date <= today);
  const trained = new Set(thisWeek.map((w) => w.date));
  const volume = thisWeek.reduce((v, w) => v + workoutTotals(w).volume, 0);
  const { units } = useData().settings;
  return (
    <a href="#/history" class="card week-strip" aria-label={`This week: ${thisWeek.length} workouts. Open history`}>
      <div class="week-head">
        <span class="section-title small">This week</span>
        <span class="muted small-text num">
          {thisWeek.length} {thisWeek.length === 1 ? 'workout' : 'workouts'}
          {volume > 0 ? ` · ${fmtVolume(volume, units)}` : ''}
        </span>
      </div>
      <ol class="week-days" aria-hidden="true">
        {days.map((d) => (
          <li class={`${trained.has(d) ? 'on' : ''}${d === today ? ' today' : ''}${d > today ? ' later' : ''}`}>
            <span class="week-dot" />
            <span class="week-letter">{shortWeekday(d).slice(0, 1)}</span>
          </li>
        ))}
      </ol>
    </a>
  );
}

function ago(date: string, today: string): string {
  if (date === today) return 'today';
  const t = relativeDayTitle(date, today);
  return t === 'Yesterday' ? 'yesterday' : `on ${shortDate(date)}`;
}

function RoutineCard({
  routine,
  workouts,
  onStart,
  onMenu,
}: {
  routine: Routine;
  workouts: Workout[];
  onStart: () => void;
  onMenu: () => void;
}) {
  const last = workouts.find((w) => w.routineId === routine.id);
  const names = routine.exercises.map((e) => e.name).join(', ');
  const sets = routine.exercises.reduce((n, e) => n + e.sets.length, 0);
  return (
    <li class="card routine-card">
      <div class="routine-top">
        <a href={`#/routine/${routine.id}`} class="routine-main">
          <h3 class="routine-name">{routine.name}</h3>
          <p class="routine-exercises">{names || 'No exercises yet'}</p>
        </a>
        <button type="button" class="icon-btn plain ink" aria-label={`More for ${routine.name}`} onClick={onMenu}>
          <More />
        </button>
      </div>
      <div class="routine-actions">
        <p class="muted small-text">
          {routine.exercises.length} {routine.exercises.length === 1 ? 'exercise' : 'exercises'} · {sets} sets
          {last ? ` · last done ${ago(last.date, todayKey())}` : ''}
        </p>
        <button type="button" class="btn-primary btn-small" onClick={onStart} aria-label={`Start ${routine.name}`} disabled={routine.exercises.length === 0}>
          <Play size={16} />
          Start
        </button>
      </div>
    </li>
  );
}

function RoutineMenu({ routine, routines, onClose }: { routine: Routine | null; routines: Routine[]; onClose: () => void }) {
  const index = routine ? routines.findIndex((r) => r.id === routine.id) : -1;
  const move = (by: number) => {
    if (!routine) return;
    const order = moveItem(routines, index, by);
    const at = order.findIndex((r) => r.id === routine.id);
    putRoutine({ ...routine, position: positionBetween(order[at - 1]?.position, order[at + 1]?.position) });
    onClose();
  };
  return (
    <Sheet open={!!routine} onClose={onClose} title={routine?.name ?? ''}>
      {routine && (
        <>
          <SheetAction icon={<Pencil />} label="Edit" onClick={() => (onClose(), navigate(`/routine/${routine.id}`))} />
          <SheetAction
            icon={<Copy size={20} />}
            label="Duplicate"
            onClick={() => {
              const copy = putRoutine(duplicateRoutine(routine, positionBetween(routine.position, routines[index + 1]?.position)));
              onClose();
              showToast(`Made “${copy.name}”`);
            }}
          />
          {index > 0 && <SheetAction icon={<ArrowUp />} label="Move up" onClick={() => move(-1)} />}
          {index < routines.length - 1 && <SheetAction icon={<ArrowDown />} label="Move down" onClick={() => move(1)} />}
          <SheetAction
            icon={<Trash />}
            label="Delete"
            danger
            onClick={() => {
              deleteRoutine(routine.id);
              onClose();
              showToast(`Deleted “${routine.name}”`, { label: 'Undo', run: () => putRoutine(routine) });
            }}
          />
        </>
      )}
    </Sheet>
  );
}
