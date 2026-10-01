import { useEffect, useState } from 'preact/hooks';
import type { PlannedSet, Routine, RoutineExercise, Units } from '../lib/types';
import { activeWorkout, deleteRoutine, getData, getRoutine, prefFor, putRoutine, useData } from '../lib/store';
import { goBack, href, navigate, useRoute } from '../lib/router';
import { showToast } from '../lib/toast';
import { startWorkout } from '../lib/actions';
import { fieldsFor, moveItem } from '../lib/workout';
import { fmtDuration } from '../lib/units';
import { plural } from '../lib/format';
import { scrollToPending } from '../lib/scroll';
import { NumberInput, unitFor } from '../components/NumberInput';
import { Sheet, SheetAction, TopBar } from '../components/Common';
import { ArrowDown, ArrowUp, Minus, More, Note, Play, Plus, Swap, Timer, Trash } from '../components/Icons';

const REST_CHOICES = [0, 30, 45, 60, 75, 90, 120, 150, 180, 240, 300];

/** Edit a routine: its name, exercises in order and planned sets. Saved as you type. */
export function RoutineEditor({ routine }: { routine: Routine }) {
  const data = useData();
  const { units } = data.settings;
  const route = useRoute();
  const isNew = route.query.get('new') === '1';
  const [menu, setMenu] = useState<RoutineExercise | null>(null);
  const [restFor, setRestFor] = useState<RoutineExercise | null>(null);
  const [notes, setNotes] = useState<Set<string>>(new Set());

  useEffect(() => scrollToPending((id) => `rx-${id}`), []);

  const latest = () => getRoutine(routine.id) ?? routine;
  const save = (patch: Partial<Routine>) => putRoutine({ ...latest(), ...patch });
  const changeExercise = (e: RoutineExercise) => save({ exercises: latest().exercises.map((x) => (x.id === e.id ? e : x)) });

  const leave = () => {
    const r = latest();
    // A new routine left empty isn't worth keeping.
    if (isNew && r.exercises.length === 0 && r.name === 'New routine') deleteRoutine(r.id);
    goBack('/');
  };

  const pick = (swap?: string) => navigate(href('/exercises/pick', { to: `routine:${routine.id}`, swap }));
  const index = (e: RoutineExercise) => latest().exercises.findIndex((x) => x.id === e.id);

  return (
    <>
      <main class="screen with-footer routine-editor">
        <TopBar title={isNew ? 'New routine' : 'Edit routine'} onBack={leave} />

        <div class="field">
          <label for="routine-name" class="field-label">
            Name
          </label>
          <input
            id="routine-name"
            class="input title-input"
            maxLength={80}
            value={routine.name}
            autoComplete="off"
            onFocus={(e) => isNew && routine.name === 'New routine' && (e.target as HTMLInputElement).select()}
            onInput={(e) => {
              const v = (e.target as HTMLInputElement).value;
              if (v.trim()) save({ name: v.slice(0, 80) });
            }}
          />
        </div>

        {routine.exercises.length === 0 && (
          <div class="card">
            <p class="body-text center">Add the exercises in the order you do them. You can set the sets, reps and weights for each.</p>
          </div>
        )}

        {routine.exercises.map((e, i) => (
          <RoutineExerciseCard
            key={e.id}
            e={e}
            index={i}
            units={units}
            rest={e.restSeconds ?? prefFor(e.exerciseId, data).restSeconds ?? data.settings.restSeconds}
            restIsDefault={e.restSeconds === undefined}
            showNotes={notes.has(e.id) || !!e.notes}
            onChange={changeExercise}
            onMenu={() => setMenu(e)}
            onRest={() => setRestFor(e)}
          />
        ))}

        <button type="button" class="btn-secondary add-exercises" onClick={() => pick()}>
          <Plus />
          Add exercises
        </button>

        <div class="field">
          <label for="routine-notes" class="field-label">
            Notes <span class="optional">(optional)</span>
          </label>
          <textarea
            id="routine-notes"
            class="input textarea"
            rows={2}
            value={routine.notes}
            placeholder="Warm-up, tempo, what to focus on…"
            onInput={(e) => save({ notes: (e.target as HTMLTextAreaElement).value.slice(0, 4000) })}
          />
        </div>

        <button
          type="button"
          class="link-btn left danger"
          onClick={() => {
            const r = latest();
            deleteRoutine(r.id);
            showToast(`Deleted “${r.name}”`, { label: 'Undo', run: () => putRoutine(r) }, { carry: true });
            goBack('/');
          }}
        >
          <Trash size={18} />
          Delete routine
        </button>
      </main>

      <div class="footer">
        <div class="footer-inner">
          <button
            type="button"
            class="btn-primary"
            disabled={routine.exercises.length === 0 || !!activeWorkout(getData())}
            onClick={() => startWorkout(latest())}
          >
            <Play size={18} />
            {activeWorkout(getData()) ? 'A workout is in progress' : 'Start this routine'}
          </button>
        </div>
      </div>

      <Sheet open={!!menu} onClose={() => setMenu(null)} title={menu?.name ?? ''}>
        {menu && (
          <>
            {index(menu) > 0 && (
              <SheetAction
                icon={<ArrowUp />}
                label="Move up"
                onClick={() => (save({ exercises: moveItem(latest().exercises, index(menu), -1) }), setMenu(null))}
              />
            )}
            {index(menu) < latest().exercises.length - 1 && (
              <SheetAction
                icon={<ArrowDown />}
                label="Move down"
                onClick={() => (save({ exercises: moveItem(latest().exercises, index(menu), 1) }), setMenu(null))}
              />
            )}
            <SheetAction icon={<Note />} label={menu.notes ? 'Edit note' : 'Add a note'} onClick={() => (setNotes(new Set([...notes, menu.id])), setMenu(null))} />
            <SheetAction icon={<Timer />} label="Rest time" onClick={() => (setRestFor(menu), setMenu(null))} />
            <SheetAction icon={<Swap />} label="Swap for another exercise" onClick={() => (setMenu(null), pick(menu.id))} />
            <SheetAction
              icon={<Trash />}
              label="Remove from routine"
              danger
              onClick={() => {
                const before = latest().exercises;
                save({ exercises: before.filter((x) => x.id !== menu.id) });
                setMenu(null);
                showToast(`Removed ${menu.name}`, { label: 'Undo', run: () => save({ exercises: before }) });
              }}
            />
          </>
        )}
      </Sheet>

      <Sheet open={!!restFor} onClose={() => setRestFor(null)} title={restFor ? `Rest after ${restFor.name}` : ''}>
        {restFor && (
          <>
            <div class="rest-grid" role="radiogroup" aria-label="Rest time">
              <button
                type="button"
                role="radio"
                aria-checked={restFor.restSeconds === undefined}
                class="pill rest-choice wide"
                onClick={() => {
                  const { restSeconds: _, ...rest } = restFor;
                  changeExercise(rest);
                  setRestFor(null);
                }}
              >
                Default
              </button>
              {REST_CHOICES.map((s) => (
                <button
                  type="button"
                  role="radio"
                  aria-checked={restFor.restSeconds === s}
                  class="pill rest-choice"
                  onClick={() => (changeExercise({ ...restFor, restSeconds: s }), setRestFor(null))}
                >
                  {s === 0 ? 'Off' : fmtDuration(s)}
                </button>
              ))}
            </div>
            <p class="field-hint">Default is the exercise's own rest time, or the one in Settings.</p>
          </>
        )}
      </Sheet>
    </>
  );
}

function RoutineExerciseCard({
  e,
  index,
  units,
  rest,
  restIsDefault,
  showNotes,
  onChange,
  onMenu,
  onRest,
}: {
  e: RoutineExercise;
  index: number;
  units: Units;
  rest: number;
  restIsDefault: boolean;
  showNotes: boolean;
  onChange: (e: RoutineExercise) => void;
  onMenu: () => void;
  onRest: () => void;
}) {
  const fields = fieldsFor(e.logType);
  const setSet = (i: number, s: PlannedSet) => onChange({ ...e, sets: e.sets.map((x, j) => (j === i ? s : x)) });
  return (
    <section class="card exercise-card plan" aria-labelledby={`rx-${e.id}`}>
      <div class="exercise-head">
        <h2 class="exercise-name" id={`rx-${e.id}`}>
          <span class="sr-only">{index + 1}. </span>
          {e.name}
        </h2>
        <button type="button" class="icon-btn plain ink" aria-label={`More for ${e.name}`} onClick={onMenu}>
          <More />
        </button>
      </div>
      <button type="button" class="rest-chip" onClick={onRest}>
        <Timer size={16} />
        {rest > 0 ? `Rest ${fmtDuration(rest)}` : 'No rest timer'}
        {restIsDefault ? ' (default)' : ''}
      </button>
      {showNotes && (
        <textarea
          class="input textarea exercise-note"
          rows={1}
          aria-label={`Notes for ${e.name}`}
          placeholder="Notes (seat height, grip…)"
          value={e.notes}
          onInput={(ev) => onChange({ ...e, notes: (ev.target as HTMLTextAreaElement).value.slice(0, 2000) })}
        />
      )}
      <div class={`sets plan-sets fields-${fields.length}`} role="table" aria-label={`Planned sets of ${e.name}`}>
        <div class="set-row set-header" role="row">
          <span role="columnheader">Set</span>
          {fields.map((f) => (
            <span role="columnheader">
              {unitFor(f, units, e.logType)} <span class="optional">target</span>
            </span>
          ))}
        </div>
        {e.sets.map((s, i) => (
          <div class="set-row" role="row">
            <span class="set-num static" role="cell">
              {i + 1}
            </span>
            {fields.map((f) => (
              <span role="cell" class="set-cell">
                <NumberInput
                  id={`plan-${e.id}-${i}-${f}`}
                  field={f}
                  value={s[f]}
                  units={units}
                  logType={e.logType}
                  label={`Set ${i + 1} target ${f === 'weight' ? `weight in ${units}` : f === 'seconds' ? 'time' : f === 'meters' ? 'distance' : 'reps'}`}
                  placeholder="–"
                  onChange={(v) => {
                    const next = { ...s, [f]: v };
                    if (v === undefined) delete next[f];
                    setSet(i, next);
                  }}
                />
              </span>
            ))}
          </div>
        ))}
      </div>
      <div class="set-count">
        <span class="muted small-text">{plural(e.sets.length, 'set')}</span>
        <button
          type="button"
          class="icon-btn"
          aria-label={`One set less of ${e.name}`}
          disabled={e.sets.length <= 1}
          onClick={() => onChange({ ...e, sets: e.sets.slice(0, -1) })}
        >
          <Minus />
        </button>
        <button
          type="button"
          class="icon-btn"
          aria-label={`One set more of ${e.name}`}
          disabled={e.sets.length >= 30}
          onClick={() => onChange({ ...e, sets: [...e.sets, { ...(e.sets[e.sets.length - 1] ?? {}) }] })}
        >
          <Plus />
        </button>
      </div>
    </section>
  );
}
