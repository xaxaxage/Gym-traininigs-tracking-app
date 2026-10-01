import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
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
import { NumberInput, unitFor, type Field } from '../components/NumberInput';
import { Sheet, SheetAction, useElapsed } from '../components/Common';
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronLeft,
  Info,
  More,
  Note,
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

        {workout.exercises.length === 0 && (
          <div class="card empty-workout">
            <p class="body-text center">
              {live ? 'Add the exercises you are doing. Last time\'s numbers are filled in for you.' : 'This workout has no exercises.'}
            </p>
          </div>
        )}

        {workout.exercises.map((e, index) => (
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
          />
        ))}

        <a href={pickHref()} class="btn-secondary add-exercises">
          <Plus />
          Add exercises
        </a>

        <section class="field workout-notes">
          <label for="workout-notes" class="field-label">
            Workout notes <span class="optional">(optional)</span>
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

        <button
          type="button"
          class="link-btn left danger"
          onClick={() => {
            if (live && done === 0 && workout.exercises.length === 0) return discard(workout.id, { undo: false });
            if (confirm(live ? 'Discard this workout? What you logged in it is deleted.' : 'Delete this workout from your history?')) discard(workout.id);
          }}
        >
          <Trash size={18} />
          {live ? 'Discard workout' : 'Delete workout'}
        </button>
      </main>

      {live && <RestBar workoutId={workout.id} />}

      <ExerciseMenu
        e={menu}
        onClose={() => setMenu(null)}
        onNote={(e) => setNotesOpen(new Set([...notesOpen, e.id]))}
        onRest={(e) => setRestFor(e)}
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
            <SheetAction
              icon={<Trash />}
              label="Delete set"
              danger
              onClick={() => {
                change(removeSet(setMenuFor.e, setMenuFor.s.id));
                setSetMenuFor(null);
              }}
            />
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
        <ol class="reorder-list">
          {workout.exercises.map((e, i) => (
            <li key={e.id} class="reorder-row">
              <span class="reorder-name">{e.name}</span>
              <button type="button" class="icon-btn" aria-label={`Move ${e.name} up`} disabled={i === 0} onClick={() => save({ ...getLatest(workout), exercises: moveItem(getLatest(workout).exercises, i, -1) })}>
                <ArrowUp />
              </button>
              <button
                type="button"
                class="icon-btn"
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
            <button type="button" class="btn-secondary danger" onClick={() => (setFinishing(false), discard(workout.id, { undo: false }))}>
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
            <button type="button" class="btn-secondary" onClick={() => setFinishing(false)}>
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
}) {
  const fields = fieldsFor(e.logType);
  const allDone = e.sets.length > 0 && e.sets.every((s) => s.done);
  const headingId = `ex-${e.id}`;
  return (
    <section class={`card exercise-card${allDone ? ' all-done' : ''}`} aria-labelledby={headingId}>
      <div class="exercise-head">
        <h2 class="exercise-name" id={headingId}>
          <a href={`#/exercise/${encodeURIComponent(e.exerciseId)}`}>
            <span class="sr-only">{index + 1}. </span>
            {e.name}
          </a>
        </h2>
        <button type="button" class="icon-btn plain ink" aria-label={`More for ${e.name}`} onClick={onMenu}>
          <More />
        </button>
      </div>
      {rest !== undefined && (
        <button type="button" class="rest-chip" onClick={onRest} aria-label={`Rest ${restLabel(rest)} after each set. Change`}>
          <Timer size={16} />
          {rest > 0 ? `Rest ${fmtDuration(rest)}` : 'No rest timer'}
        </button>
      )}
      {notesOpen && (
        <textarea
          class="input textarea exercise-note"
          rows={1}
          aria-label={`Notes for ${e.name}`}
          placeholder="Notes (seat height, grip…)"
          value={e.notes}
          onInput={(ev) => onChange({ ...e, notes: (ev.target as HTMLTextAreaElement).value.slice(0, 2000) })}
        />
      )}
      <div class={`sets fields-${fields.length}`} role="table" aria-label={`Sets of ${e.name}`}>
        <div class="set-row set-header" role="row">
          <span role="columnheader">Set</span>
          <span role="columnheader" class="set-prev">
            Last
          </span>
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
          <span class="faint" aria-label="No previous set">
            –
          </span>
        )}
      </span>
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
  onNote,
  onRest,
  onSwap,
  onReorder,
  onRemove,
}: {
  e: WorkoutExercise | null;
  onClose: () => void;
  onNote: (e: WorkoutExercise) => void;
  onRest: (e: WorkoutExercise) => void;
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
          <SheetAction icon={<Note />} label={e.notes ? 'Edit note' : 'Add a note'} onClick={run(onNote)} />
          <SheetAction icon={<Timer />} label="Rest time" onClick={run(onRest)} />
          <SheetAction icon={<Swap />} label="Swap for another exercise" onClick={run(onSwap)} />
          <SheetAction icon={<ArrowDown />} label="Reorder exercises" onClick={run(() => onReorder())} />
          <SheetAction icon={<Info />} label="Exercise details and history" onClick={run((x) => navigate(`/exercise/${encodeURIComponent(x.exerciseId)}`))} />
          <SheetAction icon={<Trash />} label="Remove exercise" danger onClick={run(onRemove)} />
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
          <label class="toggle-row">
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
