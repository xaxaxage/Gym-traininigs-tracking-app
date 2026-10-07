import { useRef, useState } from "preact/hooks";
import type { CustomExercise } from "../lib/types";
import {
  finishedWorkouts,
  getData,
  getRoutine,
  getWorkout,
  putCustomExercise,
  putRoutine,
  putWorkout,
  updateSettings,
  useData,
} from "../lib/store";
import { aiReady, describeExercise, type DescribedExercise } from "../lib/ai";
import { AiError, MAX_DESCRIPTION } from "../lib/ai/shared";
import {
  addToWorkout,
  exerciseFor,
  exerciseWords,
  localMatch,
  setsText,
  plannedFrom,
  routineExercise,
  shouldOfferOnlyMine,
} from "../lib/describe";
import {
  EQUIPMENT_LABEL,
  LOG_TYPE_LABEL,
  MUSCLE_LABEL,
  type Exercise,
} from "../lib/library/catalog";
import { normalize, searchScored } from "../lib/library/search";
import { href, navigate } from "../lib/router";
import { allExercises, loadLibrary, pickable } from "../lib/library/load";
import { showToast } from "../lib/toast";
import { Sheet } from "./Common";
import { Sparkle } from "./Icons";

export type DescribeTarget =
  | { kind: "workout"; workoutId: string }
  | { kind: "routine"; routineId: string };

type State =
  | { step: "idle" }
  | { step: "working"; message: string }
  | {
      step: "review";
      exercise: DescribedExercise;
      source: string;
      listed?: Exercise;
    }
  | { step: "matched"; exercise: Exercise }
  | { step: "unknown" }
  | { step: "error"; message: string };

/**
 * "Now I'm doing incline chest press on a machine, 3×10 at 40": with a Gemini
 * key, the AI fills in its muscles, equipment and how it's logged, you check
 * it, and it's saved as your own exercise and added. Without one, it's matched
 * to an exercise you can pick from, or you create it yourself.
 */
/** `onAdded` gets the added exercise's place in the workout (or routine). */
export function DescribeBox({
  target,
  onAdded,
}: {
  target: DescribeTarget;
  onAdded?: (placeId: string) => void;
}) {
  const data = useData();
  const settings = data.settings;
  const [text, setText] = useState("");
  const [state, setState] = useState<State>({ step: "idle" });
  const abort = useRef<AbortController | null>(null);
  const ready = aiReady(settings);
  /** What you can pick from, loaded on the first description (a workout doesn't need the whole list otherwise). */
  const pool = useRef<Exercise[]>([]);
  /** One you can pick with exactly this name (your own, or from the list). */
  const sameName = (name: string) => {
    const n = normalize(name);
    return pool.current.find((x) => normalize(x.name) === n);
  };

  const add = (
    ex: Pick<CustomExercise, "id" | "name" | "logType">,
    sets: DescribedExercise["sets"],
  ) => {
    const history = finishedWorkouts(getData());
    let placeId: string;
    if (target.kind === "workout") {
      const w = getWorkout(target.workoutId);
      if (!w) return;
      const next = addToWorkout(w, ex, sets, history);
      putWorkout(next);
      placeId = next.exercises[next.exercises.length - 1].id;
    } else {
      const r = getRoutine(target.routineId);
      if (!r) return;
      const added = routineExercise(
        { id: ex.id, name: ex.name, logType: ex.logType },
        plannedFrom(sets),
      );
      putRoutine({ ...r, exercises: [...r.exercises, added] });
      placeId = added.id;
    }
    setText("");
    setState({ step: "idle" });
    showToast(`Added ${ex.name}`, undefined, { carry: true });
    onAdded?.(placeId);
  };

  const submit = async (e: Event) => {
    e.preventDefault();
    const t = text.trim();
    if (!t || state.step === "working") return;
    // Without a connection on the first visit the list can't load; your own exercises still can be matched.
    const list = await loadLibrary().catch(() => []);
    const all = (pool.current = list.length
      ? pickable(getData(), list)
      : allExercises(getData(), []));
    if (!ready) {
      const match = localMatch(t, all);
      setState(
        match ? { step: "matched", exercise: match } : { step: "unknown" },
      );
      return;
    }
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setState({ step: "working", message: "Asking Gemini…" });
    try {
      const { exercise, source } = await describeExercise(
        settings,
        { text: t, units: settings.units, known: knownNames(data, all) },
        controller.signal,
        (message) => setState({ step: "working", message }),
      );
      if (controller.signal.aborted) return;
      // A close match from the built-in list is offered as well.
      const top = searchScored(
        all.filter((x) => !x.custom),
        exercise.name,
      )[0];
      const listed =
        top && top.tier >= 3 && !sameName(exercise.name)
          ? top.exercise
          : undefined;
      setState({ step: "review", exercise, source, listed });
    } catch (err) {
      if (controller.signal.aborted) return;
      setState({
        step: "error",
        message:
          err instanceof AiError
            ? err.message
            : "Something went wrong. Try again.",
      });
    }
  };

  const save = (d: DescribedExercise) => {
    const same = sameName(d.name);
    if (same) return add(same, d.sets);
    const { exercise, isNew } = exerciseFor(getData(), d);
    const saved = isNew ? putCustomExercise(exercise) : exercise;
    add(saved, d.sets);
  };

  // "Now I'm doing cable crunches 3×15" → "Cable crunches"
  const words = exerciseWords(text) || text.trim();
  const guess = (words.charAt(0).toUpperCase() + words.slice(1)).slice(0, 80);
  const createHref = `#${href("/exercise/new", { name: guess, to: target.kind === "workout" ? `workout:${target.workoutId}` : `routine:${target.routineId}` })}`;

  return (
    <section class="describe">
      <form class="stack-8" onSubmit={submit}>
        <label for="describe-text" class="field-label">
          Describe the exercise
        </label>
        <div class="describe-row">
          <textarea
            id="describe-text"
            class="input textarea"
            rows={2}
            maxLength={MAX_DESCRIPTION}
            placeholder="e.g. Incline chest press on a machine, 3×10 at 40"
            value={text}
            onInput={(ev) => setText((ev.target as HTMLTextAreaElement).value)}
            onKeyDown={(ev) => {
              if (ev.key === "Enter" && !ev.shiftKey) {
                ev.preventDefault();
                (ev.target as HTMLTextAreaElement).form?.requestSubmit();
              }
            }}
          />
          <button
            type="submit"
            class="btn-primary describe-go"
            disabled={!text.trim() || state.step === "working"}
          >
            <Sparkle size={18} />
            Add
          </button>
        </div>
        {state.step === "working" && (
          <p class="field-hint" role="status">
            <span class="spinner small" aria-hidden="true" /> {state.message}
          </p>
        )}
        {state.step === "error" && (
          <p class="field-hint error-text" role="alert">
            {state.message}
          </p>
        )}
        {state.step === "idle" && (
          <p class="field-hint">
            {ready ? (
              "Gemini fills in its muscles and equipment, and it’s saved as your own exercise."
            ) : (
              <>
                With a free Gemini key (
                <a href="#/settings/exercises">Settings</a>) its muscles and
                equipment are filled in for you.
              </>
            )}
          </p>
        )}
      </form>

      {state.step === "matched" && (
        <div class="describe-result" role="status">
          <span class="row-main">
            <span class="eyebrow">Found</span>
            <span class="row-title">{state.exercise.name}</span>
          </span>
          <button
            type="button"
            class="btn-tonal btn-small"
            onClick={() => add(state.exercise, [])}
          >
            Add it
          </button>
        </div>
      )}
      {(state.step === "matched" || state.step === "unknown") && (
        <p
          class="field-hint"
          role={state.step === "unknown" ? "status" : undefined}
        >
          {state.step === "unknown" ? "No exercise matches that. " : "Not it? "}
          <a
            href={createHref}
            onClick={(ev) => {
              ev.preventDefault();
              navigate(createHref.slice(1));
            }}
          >
            Create “{guess.slice(0, 40)}” yourself
          </a>
          .
        </p>
      )}

      <OnlyMineOffer />

      <Sheet
        open={state.step === "review"}
        onClose={() => setState({ step: "idle" })}
        title="Check the exercise"
      >
        {state.step === "review" && (
          <Review
            state={state}
            existing={(n) =>
              !!sameName(n) ||
              !exerciseFor(getData(), { ...state.exercise, name: n }).isNew
            }
            onSave={save}
            onUseListed={(x) => add(x, state.exercise.sets)}
            units={settings.units}
          />
        )}
      </Sheet>
    </section>
  );
}

function Review({
  state,
  existing: exists,
  onSave,
  onUseListed,
  units,
}: {
  state: Extract<State, { step: "review" }>;
  existing: (name: string) => boolean;
  onSave: (d: DescribedExercise) => void;
  onUseListed: (x: Exercise) => void;
  units: "kg" | "lb";
}) {
  const [name, setName] = useState(state.exercise.name);
  const d = state.exercise;
  const existing = exists(name);
  return (
    <form
      class="stack-16"
      onSubmit={(e) => {
        e.preventDefault();
        const clean = name.trim().replace(/\s+/g, " ").slice(0, 80);
        if (clean) onSave({ ...d, name: clean });
      }}
    >
      <div class="field">
        <label for="review-name" class="field-label">
          Name
        </label>
        <input
          id="review-name"
          class="input"
          value={name}
          maxLength={80}
          onInput={(e) => setName((e.target as HTMLInputElement).value)}
        />
      </div>
      <dl class="review-facts">
        <div>
          <dt>Works</dt>
          <dd>{d.primary.map((m) => MUSCLE_LABEL[m]).join(", ") || "—"}</dd>
        </div>
        {d.secondary.length > 0 && (
          <div>
            <dt>Also</dt>
            <dd>{d.secondary.map((m) => MUSCLE_LABEL[m]).join(", ")}</dd>
          </div>
        )}
        <div>
          <dt>Equipment</dt>
          <dd>{EQUIPMENT_LABEL[d.equipment]}</dd>
        </div>
        <div>
          <dt>Logged as</dt>
          <dd>{LOG_TYPE_LABEL[d.logType]}</dd>
        </div>
        {d.sets.length > 0 && (
          <div>
            <dt>Sets</dt>
            <dd class="num">{setsText(d.sets, d.logType, units)}</dd>
          </div>
        )}
      </dl>
      <p class="field-hint">
        {existing
          ? "You already have an exercise with this name, so that one is added."
          : "Saved as your own exercise; change its details any time on its page."}{" "}
        By {state.source}.
      </p>
      <button type="submit" class="btn-primary">
        {existing ? "Add it" : "Save and add"}
      </button>
      {state.listed && (
        <button
          type="button"
          class="btn-tonal"
          onClick={() => onUseListed(state.listed!)}
        >
          Use “{state.listed.name}” from the list instead
        </button>
      )}
    </form>
  );
}

/** Your own exercises and the built-in ones you've used: the names the AI should reuse. */
function knownNames(
  data: ReturnType<typeof getData>,
  all: Exercise[],
): string[] {
  const used = new Set(
    data.workouts.flatMap((w) => w.exercises.map((e) => e.exerciseId)),
  );
  return all.filter((x) => x.custom || used.has(x.id)).map((x) => x.name);
}

/** Offered once, after a few exercises of your own: hide the built-in list. */
export function OnlyMineOffer() {
  const data = useData();
  if (!shouldOfferOnlyMine(data)) return null;
  return (
    <div class="notice plain only-mine" role="note">
      <p>
        <strong>You're building your own list.</strong> Pick only from yours,
        and hide the built-in ones you haven't used? You can switch back in
        Settings.
      </p>
      <div class="button-pair">
        <button
          type="button"
          class="btn-tonal btn-small"
          onClick={() => updateSettings({ libraryOffered: true })}
        >
          Keep both
        </button>
        <button
          type="button"
          class="btn-primary btn-small"
          onClick={() => {
            updateSettings({ library: "mine", libraryOffered: true });
            showToast("Only your own exercises now");
          }}
        >
          Only mine
        </button>
      </div>
    </div>
  );
}
