import { useState } from 'preact/hooks';
import type { CustomExercise, Equipment, LogType, Muscle } from '../lib/types';
import { LOG_TYPES } from '../lib/types';
import { deleteCustomExercise, finishedWorkouts, getData, getRoutine, getWorkout, putCustomExercise, putRoutine, putWorkout } from '../lib/store';
import { goBack, navigate } from '../lib/router';
import { showToast } from '../lib/toast';
import { newId } from '../lib/ids';
import { EQUIPMENT, EQUIPMENT_LABEL, LOG_TYPE_LABEL, MUSCLE_LABEL, MUSCLES } from '../lib/library/catalog';
import { addExercises, routineExercise } from '../lib/workout';
import { requestScrollTo } from '../lib/scroll';
import { TopBar } from '../components/Common';
import { Trash } from '../components/Icons';

const LOG_HINT: Record<LogType, string> = {
  weight_reps: 'Most gym exercises: 80 kg × 8',
  bodyweight: 'Pull-ups, dips, push-ups: 12 reps, or +10 kg × 8',
  duration: 'Holds and stretches: 0:45',
  distance: 'Cardio: 5 km in 25:00',
  weight_distance: 'Carries and sleds: 40 kg × 30 m',
};

/** Make or edit one of your own exercises. They sync like everything else. */
export function CustomExerciseEditor({ exercise, initialName = '', pickTo = '' }: { exercise?: CustomExercise; initialName?: string; pickTo?: string }) {
  const [name, setName] = useState(exercise?.name ?? initialName);
  const [primary, setPrimary] = useState<Muscle[]>(exercise?.primary ?? []);
  const [secondary, setSecondary] = useState<Muscle[]>(exercise?.secondary ?? []);
  const [equipment, setEquipment] = useState<Equipment>(exercise?.equipment ?? 'barbell');
  const [logType, setLogType] = useState<LogType>(exercise?.logType ?? 'weight_reps');
  const [notes, setNotes] = useState(exercise?.notes ?? '');
  const [error, setError] = useState('');

  const toggle = (list: Muscle[], m: Muscle) => (list.includes(m) ? list.filter((x) => x !== m) : [...list, m]);

  const save = (e: Event) => {
    e.preventDefault();
    const clean = name.trim().replace(/\s+/g, ' ').slice(0, 80);
    if (!clean) return setError('Give it a name.');
    const saved = putCustomExercise({
      id: exercise?.id ?? `c-${newId(12)}`,
      name: clean,
      primary,
      secondary: secondary.filter((m) => !primary.includes(m)),
      equipment,
      logType,
      notes: notes.slice(0, 2000),
      updatedAt: 0,
    });
    const ref = { id: saved.id, name: saved.name, logType: saved.logType };
    const [kind, id] = pickTo.split(':');
    if (!exercise && kind === 'workout' && id) {
      const w = getWorkout(id);
      if (w) {
        const next = addExercises(w, [ref], finishedWorkouts(getData()));
        putWorkout(next);
        requestScrollTo(next.exercises.at(-1)?.id);
      }
      showToast(`Added ${saved.name}`, undefined, { carry: true });
      // The picker made way for this screen, so back is the workout.
      return goBack(w && !w.endedAt ? '/workout' : `/workout/${id}/edit`);
    }
    if (!exercise && kind === 'routine' && id) {
      const r = getRoutine(id);
      if (r) putRoutine({ ...r, exercises: [...r.exercises, routineExercise(ref)] });
      showToast(`Added ${saved.name}`, undefined, { carry: true });
      return goBack(`/routine/${id}`);
    }
    showToast(exercise ? 'Saved' : `Made ${saved.name}`, undefined, { carry: true });
    if (exercise) goBack(`/exercise/${saved.id}`);
    else navigate(`/exercise/${saved.id}`, { replace: true });
  };

  return (
    <main class="screen custom-exercise">
      <TopBar title={exercise ? 'Edit exercise' : 'New exercise'} back="/exercises" />
      <form class="stack-16" onSubmit={save}>
        <div class="field">
          <label for="cx-name" class="field-label">
            Name
          </label>
          <input
            id="cx-name"
            class="input"
            maxLength={80}
            autoComplete="off"
            value={name}
            placeholder="e.g. Landmine row"
            onInput={(e) => (setName((e.target as HTMLInputElement).value), setError(''))}
          />
          {error && <span class="field-hint error-text">{error}</span>}
        </div>

        <fieldset class="field plain-fieldset">
          <legend class="field-label">How it's logged</legend>
          <div class="choice-list">
            {LOG_TYPES.map((t) => (
              <label class={`choice${logType === t ? ' on' : ''}`}>
                <input type="radio" name="logType" value={t} checked={logType === t} onChange={() => setLogType(t)} />
                <span>
                  <strong>{LOG_TYPE_LABEL[t]}</strong>
                  <span class="muted">{LOG_HINT[t]}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <div class="field">
          <label for="cx-equipment" class="field-label">
            Equipment
          </label>
          <select id="cx-equipment" class="input select" value={equipment} onChange={(e) => setEquipment((e.target as HTMLSelectElement).value as Equipment)}>
            {EQUIPMENT.map((eq) => (
              <option value={eq}>{EQUIPMENT_LABEL[eq]}</option>
            ))}
          </select>
        </div>

        <MuscleChips legend="Main muscles" value={primary} onToggle={(m) => setPrimary(toggle(primary, m))} />
        <MuscleChips legend="Also works" optional value={secondary} disabled={primary} onToggle={(m) => setSecondary(toggle(secondary, m))} />

        <div class="field">
          <label for="cx-notes" class="field-label">
            Notes <span class="optional">(optional)</span>
          </label>
          <textarea id="cx-notes" class="input textarea" rows={3} value={notes} onInput={(e) => setNotes((e.target as HTMLTextAreaElement).value)} />
        </div>

        <button type="submit" class="btn-primary">
          {exercise ? 'Save' : pickTo ? 'Make it and add it' : 'Make exercise'}
        </button>
        {exercise && (
          <button
            type="button"
            class="link-btn left danger"
            onClick={() => {
              if (!confirm(`Delete “${exercise.name}”? Workouts that used it keep it in their history.`)) return;
              deleteCustomExercise(exercise.id);
              showToast(`Deleted ${exercise.name}`, undefined, { carry: true });
              navigate('/exercises', { replace: true });
            }}
          >
            <Trash size={18} />
            Delete exercise
          </button>
        )}
      </form>
    </main>
  );
}

function MuscleChips({
  legend,
  optional,
  value,
  disabled = [],
  onToggle,
}: {
  legend: string;
  optional?: boolean;
  value: Muscle[];
  disabled?: Muscle[];
  onToggle: (m: Muscle) => void;
}) {
  return (
    <fieldset class="field plain-fieldset">
      <legend class="field-label">
        {legend} {optional && <span class="optional">(optional)</span>}
      </legend>
      <div class="chip-wrap">
        {MUSCLES.map((m) => (
          <button type="button" class="pill" aria-pressed={value.includes(m) && !disabled.includes(m)} disabled={disabled.includes(m)} onClick={() => onToggle(m)}>
            {MUSCLE_LABEL[m]}
          </button>
        ))}
      </div>
    </fieldset>
  );
}
