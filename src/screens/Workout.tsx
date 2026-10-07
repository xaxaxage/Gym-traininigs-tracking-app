import type { ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { motionOn } from '../lib/motion';
import type { LogType, Units, Workout, WorkoutExercise, WorkoutSet } from '../lib/types';
import { finishedWorkouts, getData, prefFor, putWorkout, setPref, useData } from '../lib/store';
import { clockTime, durationWords, fromKey, shortDate, stopwatch, toKey } from '../lib/dates';
import { href, navigate } from '../lib/router';
import { showToast } from '../lib/toast';
import { discard, finish } from '../lib/actions';
import {
  addSet,
  doneSetCount,
  editSetNumber,
  fieldsFor,
  lastSets,
  mapExercise,
  moveItem,
  removeExercise,
  removeSet,
  setHasNumbers,
  toggleSet,
  unfinished,
  updateSet,
} from '../lib/workout';
import { adjustRest, startRest, stopRest, useRest } from '../lib/timer';
import { workoutTotals } from '../lib/stats';
import { fmtDuration, fmtVolume, restLabel } from '../lib/units';
import { fmtSet, plural } from '../lib/format';
import { scrollToPending } from '../lib/scroll';
import { DescribeBox } from '../components/Describe';
import { NumberInput, unitFor, type Field } from '../components/NumberInput';
import { ActionGroup, Sheet, SheetAction, useElapsed } from '../components/Common';
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ListIcon,
  Info,
  More,
  Note,
  Pencil,
  Plus,
  Swap,
  Timer,
  Trash,
} from '../components/Icons';

/**
 * The workout screen: the one in progress, or a finished one being edited
 * (same cards, no clock or rest timer). Every change is saved at once, so
 * closing the app, a crash or a reload never loses a set.
 */
export function WorkoutScreen({ workout }: { workout: Workout }) {
  const data = useData();
  const { units } = data.settings;
  const live = !workout.endedAt;
  const history = useMemo(() => finishedWorkouts(data), [data.workouts]);
  const [menu, setMenu] = useState<WorkoutExercise | null>(null);
  const [setMenuFor, setSetMenuFor] = useState<{ e: WorkoutExercise; s: WorkoutSet; index: number } | null>(null);
  const [restFor, setRestFor] = useState<WorkoutExercise | null>(null);
  const [reorder, setReorder] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [workoutMenu, setWorkoutMenu] = useState(false);
  const [overview, setOverview] = useState(false);
  /** Moves the paged workout to an exercise (live workouts only). */
  const pager = useRef<((index: number) => void) | null>(null);
  const [notesOpen, setNotesOpen] = useState<Set<string>>(new Set());

  useEffect(() => scrollToPending((id) => `ex-${id}`), []);

  const save = (next: Workout) => putWorkout(next);
  const change = (e: WorkoutExercise) => save(mapExercise(getLatest(workout), e.id, () => e));
  const pickHref = (swap?: string) => `#${href('/exercises/pick', { to: `workout:${workout.id}`, swap })}`;

  const restFor_ = (e: WorkoutExercise) => e.restSeconds ?? prefFor(e.exerciseId, data).restSeconds ?? data.settings.restSeconds;

  const complete = (e: WorkoutExercise, s: WorkoutSet, index: number) => {
    let next = e;
    if (!s.done && !setHasNumbers(s, e.logType)) {
      // Nothing typed yet: take last time's numbers for this set, if there are any.
      const last = lastSets(history, e.exerciseId, workout.startedAt);
      const prev = last[index] ?? last[last.length - 1];
      if (!prev || !setHasNumbers(prev, e.logType)) {
        showToast(e.logType === 'duration' ? 'Enter the time first' : e.logType === 'distance' ? 'Enter the distance or time first' : 'Enter the reps first');
        document.getElementById(`set-${s.id}-${fieldsFor(e.logType).at(-1)}`)?.focus();
        return;
      }
      next = updateSet(next, s.id, { weight: prev.weight, reps: prev.reps, seconds: prev.seconds, meters: prev.meters });
    }
    next = toggleSet(next, s.id);
    change(next);
    const nowDone = next.sets.find((x) => x.id === s.id)?.done;
    if (live && nowDone && data.settings.autoRest) {
      startRest(restFor_(e), `${e.name} · set ${index + 1}`, workout.id);
    }
    // The exercise is done: move on to the next one (or to Finish), after a moment to see the tick.
    if (live && nowDone && next.sets.every((x) => x.done)) {
      const at = getLatest(workout).exercises.findIndex((x) => x.id === e.id);
      setTimeout(() => pager.current?.(at + 1), 700);
    }
  };

  const unfinishedNow = unfinished(workout);
  const done = doneSetCount(workout);

  return (
    <>
      <main class={`screen workout-screen${live ? ' live' : ''}`}>
        <header class="workout-head">
          <button
            type="button"
            class="icon-btn ink"
            aria-label={live ? 'Hide the workout (it keeps going)' : 'Back'}
            onClick={() => (live ? navigate('/') : navigate(`/workout/${workout.id}`, { replace: true }))}
          >
            {live ? <ChevronDown /> : <ChevronLeft />}
          </button>
          <button type="button" class="workout-title" onClick={() => setRenaming(true)} aria-label={`Workout name: ${workout.name}. Rename`}>
            <span class="workout-name">{workout.name}</span>
            {live ? <LiveClock startedAt={workout.startedAt} done={done} /> : <span class="workout-when">{shortDate(workout.date)} · {clockTime(workout.startedAt)}</span>}
          </button>
          <button type="button" class="icon-btn" aria-label="Workout options" onClick={() => setWorkoutMenu(true)}>
            <More />
          </button>
          {live ? (
            <button type="button" class="btn-primary btn-small finish-btn" onClick={() => setFinishing(true)}>
              Finish
            </button>
          ) : (
            <button type="button" class="btn-primary btn-small finish-btn" onClick={() => navigate(`/workout/${workout.id}`, { replace: true })}>
              Done
            </button>
          )}
        </header>

        {!live && <WhenFields workout={workout} />}

        {(() => {
          const cards = workout.exercises.map((e, index) => (
            <ExerciseCard
              key={e.id}
              e={e}
              index={index}
              units={units}
              previous={lastSets(history, e.exerciseId, workout.startedAt)}
              rest={live ? restFor_(e) : undefined}
              notesOpen={notesOpen.has(e.id) || !!e.notes}
              onChange={change}
              onComplete={(s, i) => complete(e, s, i)}
              onMenu={() => setMenu(e)}
              onSetMenu={(s, i) => setSetMenuFor({ e, s, index: i })}
              onRest={() => setRestFor(e)}
              onNote={() => {
                setNotesOpen(new Set([...notesOpen, e.id]));
                requestAnimationFrame(() => document.getElementById(`note-${e.id}`)?.focus());
              }}
              page={live ? { number: index + 1, of: workout.exercises.length, next: workout.exercises[index + 1]?.name, onNext: () => pager.current?.(index + 1) } : undefined}
            />
          ));
          const end = (
            <section class={live ? 'workout-end' : 'stack-16'} aria-label={live ? 'Add exercises or finish' : undefined}>
              {workout.exercises.length === 0 && (
                <div class="empty-workout">
                  <p class="body-text">
                    {live ? "Add the exercises you're doing. Last time's numbers are filled in for you." : 'This workout has no exercises.'}
                  </p>
                </div>
              )}
              {live && workout.exercises.length > 0 && (
                <div class="workout-end-head">
                  <span class="eyebrow">After the last exercise</span>
                  <h2 class="page-title medium">{done > 0 ? `${plural(done, 'set')} done` : 'Nothing checked off yet'}</h2>
                </div>
              )}
              {/* The new exercise takes this page's place, so it's what you see next. */}
              {live && <DescribeBox target={{ kind: 'workout', workoutId: workout.id }} onAdded={() => window.scrollY > 0 && window.scrollTo({ top: 0 })} />}
              <a href={pickHref()} class="btn-tonal add-exercises">
                <Plus />
                Add exercises
              </a>
              <section class="field workout-notes">
                <label for="workout-notes" class="field-label">
                  Workout notes
                </label>
                <textarea
                  id="workout-notes"
                  class="input textarea"
                  rows={2}
                  placeholder="How did it go?"
                  value={workout.notes}
                  onInput={(ev) => save({ ...getLatest(workout), notes: (ev.target as HTMLTextAreaElement).value.slice(0, 4000) })}
                />
              </section>
              {live && workout.exercises.length > 0 && (
                <button type="button" class="btn-primary" onClick={() => setFinishing(true)}>
                  <Check />
                  Finish workout
                </button>
              )}
            </section>
          );
          if (!live) return [...cards, end];
          return (
            <Pager
              workoutId={workout.id}
              exercises={workout.exercises}
              api={pager}
              onOverview={() => setOverview(true)}
            >
              {[...cards, end]}
            </Pager>
          );
        })()}

      </main>

      {live && <RestBar workoutId={workout.id} />}

      <Sheet open={workoutMenu} onClose={() => setWorkoutMenu(false)} title={workout.name}>
        <ActionGroup>
          <SheetAction icon={<Pencil />} label="Rename" onClick={() => (setWorkoutMenu(false), setRenaming(true))} />
          {workout.exercises.length > 1 && (
            <SheetAction icon={<ArrowDown />} label="Reorder exercises" onClick={() => (setWorkoutMenu(false), setReorder(true))} />
          )}
          <SheetAction
            icon={<Note />}
            label="Workout notes"
            onClick={() => {
              setWorkoutMenu(false);
              const notes = document.getElementById('workout-notes');
              notes?.scrollIntoView({ block: 'center' });
              notes?.focus();
            }}
          />
        </ActionGroup>
        <ActionGroup>
          <SheetAction
            icon={<Trash />}
            label={live ? 'Discard workout' : 'Delete workout'}
            danger
            onClick={() => {
              setWorkoutMenu(false);
              if (live && done === 0 && workout.exercises.length === 0) return discard(workout.id, { undo: false });
              if (confirm(live ? 'Discard this workout? What you logged in it is deleted.' : 'Delete this workout from your history?')) discard(workout.id);
            }}
          />
        </ActionGroup>
      </Sheet>

      <Sheet open={overview} onClose={() => setOverview(false)} title="Exercises in this workout">
        <ol class="menu overview-list">
          {workout.exercises.map((e, i) => {
            const n = e.sets.filter((x) => x.done).length;
            return (
              <li>
                <button
                  type="button"
                  class="sheet-action"
                  onClick={() => {
                    setOverview(false);
                    pager.current?.(i);
                  }}
                >
                  <span class="overview-index num">{String(i + 1).padStart(2, '0')}</span>
                  <span class="row-main">
                    <span class="row-title">{e.name}</span>
                  </span>
                  <span class={`overview-done num${n === e.sets.length && n > 0 ? ' all' : ''}`}>
                    {n}/{e.sets.length}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
        <div class="button-pair">
          {workout.exercises.length > 1 && (
            <button type="button" class="btn-tonal" onClick={() => (setOverview(false), setReorder(true))}>
              Reorder
            </button>
          )}
          <a href={pickHref()} class="btn-tonal">
            <Plus />
            Add
          </a>
        </div>
      </Sheet>

      <ExerciseMenu
        e={menu}
        onClose={() => setMenu(null)}
        onSwap={(e) => navigate(pickHref(e.id).slice(1))}
        onReorder={() => setReorder(true)}
        onRemove={(e) => {
          const before = getLatest(workout);
          save(removeExercise(before, e.id));
          showToast(`Removed ${e.name}`, { label: 'Undo', run: () => save({ ...getLatest(workout), exercises: before.exercises }) });
        }}
      />

      <Sheet open={!!setMenuFor} onClose={() => setSetMenuFor(null)} title={setMenuFor ? `${setMenuFor.e.name} · set ${setMenuFor.index + 1}` : ''}>
        {setMenuFor && (
          <>
            <ActionGroup>
              <SheetAction
                icon={<Plus />}
                label="Add a set below"
                onClick={() => {
                  const { e, index } = setMenuFor;
                  const copy = addSet({ ...e, sets: e.sets.slice(0, index + 1) });
                  change({ ...e, sets: [...copy.sets, ...e.sets.slice(index + 1)] });
                  setSetMenuFor(null);
                }}
              />
            </ActionGroup>
            <ActionGroup>
              <SheetAction
                icon={<Trash />}
                label="Delete set"
                danger
                onClick={() => {
                  change(removeSet(setMenuFor.e, setMenuFor.s.id));
                  setSetMenuFor(null);
                }}
              />
            </ActionGroup>
          </>
        )}
      </Sheet>

      <RestPicker
        e={restFor}
        value={restFor ? restFor_(restFor) : 0}
        onClose={() => setRestFor(null)}
        onPick={(e, seconds, always) => {
          change({ ...e, restSeconds: seconds });
          if (always) setPref(e.exerciseId, { restSeconds: seconds });
          setRestFor(null);
        }}
      />

      <Sheet open={reorder} onClose={() => setReorder(false)} title="Reorder exercises">
        <ol class="group reorder-list">
          {workout.exercises.map((e, i) => (
            <li key={e.id} class="reorder-row">
              <span class="reorder-name">{e.name}</span>
              <button type="button" class="icon-btn filled" aria-label={`Move ${e.name} up`} disabled={i === 0} onClick={() => save({ ...getLatest(workout), exercises: moveItem(getLatest(workout).exercises, i, -1) })}>
                <ArrowUp />
              </button>
              <button
                type="button"
                class="icon-btn filled"
                aria-label={`Move ${e.name} down`}
                disabled={i === workout.exercises.length - 1}
                onClick={() => save({ ...getLatest(workout), exercises: moveItem(getLatest(workout).exercises, i, 1) })}
              >
                <ArrowDown />
              </button>
            </li>
          ))}
        </ol>
        <button type="button" class="btn-primary" onClick={() => setReorder(false)}>
          Done
        </button>
      </Sheet>

      <Sheet open={finishing} onClose={() => setFinishing(false)} title={done === 0 ? 'Nothing checked off yet' : 'Finish the workout?'}>
        {done === 0 ? (
          <>
            <p class="body-text">Check off the sets you did with the ✓ button. With nothing checked off, the workout isn't saved.</p>
            <button type="button" class="btn-primary" onClick={() => setFinishing(false)}>
              Keep going
            </button>
            <button type="button" class="btn-tonal danger" onClick={() => (setFinishing(false), discard(workout.id, { undo: false }))}>
              Discard workout
            </button>
          </>
        ) : (
          <>
            <FinishSummary workout={workout} units={units} />
            {unfinishedNow.sets > 0 && (
              <p class="body-text">
                {plural(unfinishedNow.sets, 'set')} not checked off {unfinishedNow.sets === 1 ? 'is' : 'are'} left out
                {unfinishedNow.exercises > 0 ? `, and so ${unfinishedNow.exercises === 1 ? 'is 1 exercise' : `are ${unfinishedNow.exercises} exercises`} with none done` : ''}.
              </p>
            )}
            <button type="button" class="btn-primary" onClick={() => (setFinishing(false), finish(workout.id))}>
              <Check />
              Finish workout
            </button>
            <button type="button" class="btn-tonal" onClick={() => setFinishing(false)}>
              Keep going
            </button>
          </>
        )}
      </Sheet>

      <RenameSheet open={renaming} name={workout.name} onClose={() => setRenaming(false)} onSave={(name) => save({ ...getLatest(workout), name })} />
    </>
  );
}

/** The newest saved copy (a sheet or field may hold an older one). */
function getLatest(w: Workout): Workout {
  return getData().workouts.find((x) => x.id === w.id) ?? w;
}

function LiveClock({ startedAt, done }: { startedAt: number; done: number }) {
  const elapsed = useElapsed(startedAt);
  return (
    <span class="workout-when num">
      <span class="sr-only">Time so far </span>
      {stopwatch(elapsed)} · {plural(done, 'set')}
    </span>
  );
}

function FinishSummary({ workout, units }: { workout: Workout; units: Units }) {
  const t = workoutTotals(workout);
  return (
    <dl class="mini-stats">
      <div>
        <dt>Time</dt>
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
  );
}

/** For a finished workout: when it was and how long it took. */
function WhenFields({ workout }: { workout: Workout }) {
  const start = new Date(workout.startedAt);
  const pad = (n: number) => String(n).padStart(2, '0');
  const local = `${toKey(start)}T${pad(start.getHours())}:${pad(start.getMinutes())}`;
  const minutes = Math.round(((workout.endedAt ?? workout.startedAt) - workout.startedAt) / 60_000);
  return (
    <div class="card when-card">
      <div class="field">
        <label for="w-start" class="field-label">
          Started
        </label>
        <input
          id="w-start"
          class="input"
          type="datetime-local"
          value={local}
          onChange={(e) => {
            const v = (e.target as HTMLInputElement).value;
            const [d, t] = v.split('T');
            if (!d || !t) return;
            const at = fromKey(d);
            const [h, m] = t.split(':').map(Number);
            at.setHours(h, m);
            const w = getLatest(workout);
            const length = (w.endedAt ?? w.startedAt) - w.startedAt;
            putWorkout({ ...w, startedAt: at.getTime(), endedAt: at.getTime() + length, date: toKey(at) });
          }}
        />
      </div>
      <div class="field">
        <label for="w-length" class="field-label">
          Duration
        </label>
        <div class="input-wrap">
          <input
            id="w-length"
            class="input"
            type="text"
            inputMode="numeric"
            value={String(minutes)}
            onChange={(e) => {
              const n = Number((e.target as HTMLInputElement).value.replace(/\D/g, ''));
              if (!Number.isFinite(n) || n <= 0 || n > 24 * 60) return;
              const w = getLatest(workout);
              putWorkout({ ...w, endedAt: w.startedAt + n * 60_000 });
            }}
          />
          <span class="input-suffix">min</span>
        </div>
      </div>
    </div>
  );
}

function ExerciseCard({
  e,
  index,
  units,
  previous,
  rest,
  notesOpen,
  onChange,
  onComplete,
  onMenu,
  onSetMenu,
  onRest,
  onNote,
  page,
}: {
  e: WorkoutExercise;
  index: number;
  units: Units;
  previous: WorkoutSet[];
  rest?: number;
  notesOpen: boolean;
  onChange: (e: WorkoutExercise) => void;
  onComplete: (s: WorkoutSet, index: number) => void;
  onMenu: () => void;
  onSetMenu: (s: WorkoutSet, index: number) => void;
  onRest: () => void;
  onNote: () => void;
  /** On its own page in a live workout: where it is, and what comes next. */
  page?: { number: number; of: number; next?: string; onNext: () => void };
}) {
  const fields = fieldsFor(e.logType);
  const allDone = e.sets.length > 0 && e.sets.every((s) => s.done);
  const doneCount = e.sets.filter((s) => s.done).length;
  // The "previous" column only takes room once there's something to show in it.
  const hasPrev = previous.length > 0;
  const headingId = `ex-${e.id}`;
  return (
    <section class={`card exercise-card${allDone ? ' all-done' : ''}${page ? ' paged' : ''}`} aria-labelledby={headingId}>
      {page && (
        <span class="eyebrow num" aria-hidden="true">
          Exercise {page.number} of {page.of}
        </span>
      )}
      <div class="exercise-head">
        <h2 class="exercise-name" id={headingId}>
          <a href={`#/exercise/${encodeURIComponent(e.exerciseId)}`}>
            <span class="sr-only">{index + 1}. </span>
            {e.name}
          </a>
        </h2>
        <span class={`exercise-progress num${allDone ? ' done' : ''}`} aria-label={`${doneCount} of ${plural(e.sets.length, 'set')} done`}>
          {allDone ? <Check size={14} strokeWidth={3} /> : null}
          {doneCount}/{e.sets.length}
        </span>
        <button type="button" class="icon-btn" aria-label={`More for ${e.name}`} onClick={onMenu}>
          <More />
        </button>
      </div>
      <div class="exercise-tools">
        {rest !== undefined && (
          <button type="button" class="tool-btn" onClick={onRest} aria-label={`Rest ${restLabel(rest)} after each set. Change`}>
            <Timer size={16} />
            {rest > 0 ? fmtDuration(rest) : 'No rest'}
          </button>
        )}
        {!notesOpen && (
          <button type="button" class="tool-btn" onClick={onNote} aria-label={`Add a note for ${e.name}`}>
            <Note size={16} />
            Note
          </button>
        )}
      </div>
      {notesOpen && (
        <textarea
          id={`note-${e.id}`}
          class="input textarea exercise-note"
          rows={1}
          aria-label={`Notes for ${e.name}`}
          placeholder="Seat height, grip, how it felt…"
          value={e.notes}
          onInput={(ev) => onChange({ ...e, notes: (ev.target as HTMLTextAreaElement).value.slice(0, 2000) })}
        />
      )}
      <div class={`sets fields-${fields.length}${hasPrev ? '' : ' no-prev'}`} role="table" aria-label={`Sets of ${e.name}`}>
        <div class="set-row set-header" role="row">
          <span role="columnheader">Set</span>
          {hasPrev && (
            <span role="columnheader" class="set-prev">
              Last
            </span>
          )}
          {fields.map((f) => (
            <span role="columnheader">{fieldLabel(f, units, e.logType)}</span>
          ))}
          <span role="columnheader">
            <span class="sr-only">Done</span>
          </span>
        </div>
        {e.sets.map((s, i) => (
          <SetRow
            key={s.id}
            e={e}
            s={s}
            index={i}
            units={units}
            previous={previous[i]}
            showPrev={hasPrev}
            fields={fields}
            onChange={onChange}
            onComplete={() => onComplete(s, i)}
            onMenu={() => onSetMenu(s, i)}
          />
        ))}
      </div>
      <button type="button" class="add-set" onClick={() => onChange(addSet(e))}>
        <Plus size={18} />
        Add set
      </button>
      {page && (
        <button type="button" class={`page-next${allDone ? ' ready' : ''}`} onClick={page.onNext}>
          <span class="page-next-label">{page.next ? 'Next' : 'Then'}</span>
          <span class="page-next-name">{page.next ?? 'Finish or add more'}</span>
          <ChevronRight size={20} />
        </button>
      )}
    </section>
  );
}

function fieldLabel(f: Field, units: Units, logType: LogType): string {
  return unitFor(f, units, logType);
}

function SetRow({
  e,
  s,
  index,
  units,
  previous,
  showPrev,
  fields,
  onChange,
  onComplete,
  onMenu,
}: {
  e: WorkoutExercise;
  s: WorkoutSet;
  index: number;
  units: Units;
  previous?: WorkoutSet;
  showPrev: boolean;
  fields: Field[];
  onChange: (e: WorkoutExercise) => void;
  onComplete: () => void;
  onMenu: () => void;
}) {
  const prev = previous ? fmtSet(previous, e.logType, units) : '';
  const label = `Set ${index + 1}`;
  return (
    <div class={`set-row${s.done ? ' done' : ''}`} role="row">
      <button type="button" class="set-num" aria-label={`${label}: options`} onClick={onMenu} role="cell">
        {index + 1}
      </button>
      {showPrev && (
      <span class="set-prev" role="cell">
        {prev ? (
          <button
            type="button"
            class="prev-btn"
            aria-label={`Last time: ${prev}. Use it for ${label.toLowerCase()}`}
            disabled={s.done}
            onClick={() => onChange(updateSet(e, s.id, { weight: previous!.weight, reps: previous!.reps, seconds: previous!.seconds, meters: previous!.meters }))}
          >
            {prev}
          </button>
        ) : (
          <span class="muted" aria-label="No previous set">
            –
          </span>
        )}
      </span>
      )}
      {fields.map((f) => (
        <span role="cell" class="set-cell">
          <NumberInput
            id={`set-${s.id}-${f}`}
            field={f}
            value={s[f]}
            units={units}
            logType={e.logType}
            label={`${label} ${f === 'weight' ? (e.logType === 'bodyweight' ? `added weight in ${units}` : `weight in ${units}`) : f === 'seconds' ? 'time' : f === 'meters' ? `distance in ${unitFor(f, units, e.logType)}` : 'reps'}`}
            placeholder={f === 'weight' && e.logType === 'bodyweight' ? '0' : undefined}
            onChange={(v) => onChange(editSetNumber(e, s.id, f, v))}
          />
        </span>
      ))}
      <span role="cell" class="set-cell">
        <button
          type="button"
          class={`check-btn${s.done ? ' on' : ''}`}
          aria-pressed={s.done}
          aria-label={s.done ? `${label} done. Undo` : `Complete ${label.toLowerCase()}`}
          onClick={onComplete}
        >
          <Check size={22} />
        </button>
      </span>
    </div>
  );
}

function ExerciseMenu({
  e,
  onClose,
  onSwap,
  onReorder,
  onRemove,
}: {
  e: WorkoutExercise | null;
  onClose: () => void;
  onSwap: (e: WorkoutExercise) => void;
  onReorder: () => void;
  onRemove: (e: WorkoutExercise) => void;
}) {
  const run = (fn: (e: WorkoutExercise) => void) => () => {
    if (!e) return;
    onClose();
    fn(e);
  };
  return (
    <Sheet open={!!e} onClose={onClose} title={e?.name ?? ''}>
      {e && (
        <>
          <ActionGroup>
            <SheetAction icon={<Swap />} label="Swap for another exercise" chevron onClick={run(onSwap)} />
            <SheetAction icon={<ArrowDown />} label="Reorder exercises" onClick={run(() => onReorder())} />
            <SheetAction icon={<Info />} label="Exercise details and history" chevron onClick={run((x) => navigate(`/exercise/${encodeURIComponent(x.exerciseId)}`))} />
          </ActionGroup>
          <ActionGroup>
            <SheetAction icon={<Trash />} label="Remove exercise" danger onClick={run(onRemove)} />
          </ActionGroup>
        </>
      )}
    </Sheet>
  );
}

const REST_CHOICES = [0, 30, 45, 60, 75, 90, 120, 150, 180, 240, 300];

function RestPicker({
  e,
  value,
  onClose,
  onPick,
}: {
  e: WorkoutExercise | null;
  value: number;
  onClose: () => void;
  onPick: (e: WorkoutExercise, seconds: number, always: boolean) => void;
}) {
  const [always, setAlways] = useState(true);
  return (
    <Sheet open={!!e} onClose={onClose} title={e ? `Rest after ${e.name}` : ''}>
      {e && (
        <>
          <div class="rest-grid" role="radiogroup" aria-label="Rest time">
            {REST_CHOICES.map((s) => (
              <button type="button" role="radio" aria-checked={s === value} class="pill rest-choice" onClick={() => onPick(e, s, always)}>
                {s === 0 ? 'Off' : fmtDuration(s)}
              </button>
            ))}
          </div>
          <label class="check-row">
            <input type="checkbox" checked={always} onChange={(ev) => setAlways((ev.target as HTMLInputElement).checked)} />
            <span>Use this every time I do {e.name}</span>
          </label>
        </>
      )}
    </Sheet>
  );
}

function RenameSheet({ open, name, onClose, onSave }: { open: boolean; name: string; onClose: () => void; onSave: (name: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <Sheet open={open} onClose={onClose} title="Workout name">
      <form
        class="stack-12"
        onSubmit={(ev) => {
          ev.preventDefault();
          const v = input.current?.value.trim().replace(/\s+/g, ' ').slice(0, 80);
          if (v) onSave(v);
          onClose();
        }}
      >
        <label for="rename-workout" class="sr-only">
          Workout name
        </label>
        <input id="rename-workout" ref={input} class="input" maxLength={80} value={name} autoComplete="off" />
        <button type="submit" class="btn-primary">
          Save
        </button>
      </form>
    </Sheet>
  );
}

/**
 * The rest timer, pinned to the bottom within thumb reach. It counts from
 * when the rest ends, so it's right after the app was in the background.
 */
function RestBar({ workoutId }: { workoutId: string }) {
  const rest = useRest();
  if (!rest || rest.timer.workoutId !== workoutId) return null;
  const { left, progress, done, timer } = rest;
  return (
    <div class={`rest-bar${done ? ' over' : ''}`} role="timer" aria-live={done ? 'assertive' : 'off'} aria-label={done ? 'Rest is over' : `Rest: ${stopwatch(left)} left`}>
      <div class="rest-inner">
        <div class="rest-progress" aria-hidden="true">
          <span style={{ transform: `scaleX(${done ? 1 : progress.toFixed(4)})` }} />
        </div>
        <div class="rest-row">
          <div class="rest-text">
            <span class="rest-label">{done ? 'Rest is over' : 'Rest'}</span>
            <span class="rest-time num">{done ? 'Go!' : stopwatch(left)}</span>
            <span class="rest-for">{timer.label}</span>
          </div>
          {!done && (
            <>
              <button type="button" class="rest-btn" aria-label="15 seconds less" onClick={() => adjustRest(-15)}>
                −15
              </button>
              <button type="button" class="rest-btn" aria-label="15 seconds more" onClick={() => adjustRest(15)}>
                +15
              </button>
            </>
          )}
          <button type="button" class="rest-btn wide" onClick={() => stopRest()}>
            {done ? 'OK' : 'Skip'}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * A live workout, one exercise per page: swipe or use the arrows, and the
 * strip on top shows where you are and how far each exercise has got. The
 * last page adds exercises and finishes. The page you're on is kept for this
 * tab, so a reload comes back to it.
 */
function Pager({
  workoutId,
  exercises,
  api,
  onOverview,
  children,
}: {
  workoutId: string;
  exercises: WorkoutExercise[];
  api: { current: ((index: number) => void) | null };
  onOverview: () => void;
  children: ComponentChildren[];
}) {
  const box = useRef<HTMLDivElement>(null);
  const key = `gym-tracker:page:${workoutId}`;
  const pages = children.length;
  const [at, setAt] = useState(() => {
    try {
      const saved = Number(sessionStorage.getItem(key));
      return Number.isInteger(saved) && saved >= 0 ? Math.min(saved, pages - 1) : 0;
    } catch {
      return 0;
    }
  });
  const current = useRef(at);

  const remember = (i: number) => {
    current.current = i;
    setAt(i);
    try {
      sessionStorage.setItem(key, String(i));
    } catch {
      // The page just won't be remembered.
    }
  };

  const go = (i: number, smooth = true) => {
    const el = box.current;
    if (!el) return;
    const n = Math.max(0, Math.min(pages - 1, i));
    el.scrollTo({ left: n * el.clientWidth, behavior: smooth && motionOn() ? 'smooth' : 'auto' });
    if (n !== current.current) {
      remember(n);
      // A new page starts at its top.
      if (window.scrollY > 0) window.scrollTo({ top: 0 });
    }
  };
  api.current = go;

  // Open on the page you were on; stay on it when the window changes size.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.scrollLeft = current.current * el.clientWidth;
    const keep = () => (el.scrollLeft = current.current * el.clientWidth);
    window.addEventListener('resize', keep);
    return () => window.removeEventListener('resize', keep);
  }, []);
  // An exercise removed from the end can leave you past the last page.
  useEffect(() => {
    if (current.current > pages - 1) go(pages - 1, false);
  }, [pages]);

  const onScroll = () => {
    const el = box.current;
    if (!el || el.clientWidth === 0) return;
    const i = Math.round(el.scrollLeft / el.clientWidth);
    if (i !== current.current && Math.abs(el.scrollLeft - i * el.clientWidth) < 2) {
      remember(i);
      if (window.scrollY > 0) window.scrollTo({ top: 0 });
    }
  };

  const onEnd = at >= exercises.length;
  return (
    <>
      <div class="pager-strip">
        <button type="button" class="icon-btn" aria-label="Previous exercise" disabled={at === 0} onClick={() => go(at - 1)}>
          <ChevronLeft />
        </button>
        <button type="button" class="pager-where" onClick={onOverview} aria-label={`Exercise ${Math.min(at + 1, exercises.length)} of ${exercises.length}. All exercises`}>
          <ol class="pager-segments" aria-hidden="true">
            {exercises.map((e, i) => {
              const n = e.sets.filter((s) => s.done).length;
              const state = n > 0 && n === e.sets.length ? 'done' : n > 0 ? 'part' : '';
              return <li class={`${state}${i === at ? ' here' : ''}`} />;
            })}
            <li class={`end${onEnd ? ' here' : ''}`} />
          </ol>
          <span class="pager-count num">{onEnd ? 'Finish' : `${at + 1}/${exercises.length}`}</span>
          <ListIcon size={18} />
        </button>
        <button type="button" class="icon-btn" aria-label="Next exercise" disabled={at >= pages - 1} onClick={() => go(at + 1)}>
          <ChevronRight />
        </button>
      </div>
      <div class="pager" ref={box} onScroll={onScroll}>
        {children.map((child, i) => (
          <div class="pager-page" data-here={i === at ? '' : undefined}>
            {child}
          </div>
        ))}
      </div>
    </>
  );
}
