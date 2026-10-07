import type {
  AppData,
  CustomExercise,
  LogType,
  PlannedSet,
  Units,
  Workout,
  WorkoutSet,
} from "./types";
import { distanceUnit, fmtDistance, fmtDuration, weightLabel } from "./units";
import type { DescribedExercise, DescribedSet } from "./ai/shared";
import { newId } from "./ids";
import type { Exercise } from "./library/catalog";
import { normalize, searchScored } from "./library/search";
import { addExercises, newSet, routineExercise } from "./workout";

/**
 * Adding an exercise by describing it ("now I'm doing incline chest press on
 * a machine, 3×10 at 40"): match it to one you have, or save what the AI
 * made of it as your own, and put it in the workout with the sets you said.
 */

/** The words that name the exercise, without the sets ("3×10 at 40 kg"). */
export function exerciseWords(text: string): string {
  return text
    .toLowerCase()
    .replace(
      /\b(now|i'?m|i am|doing|did|do|then|next|on|a|an|the|with|at|for|of|sets?|reps?|x|kg|kgs|lbs?|pounds?|kilos?)\b/g,
      " ",
    )
    .replace(/\d+([.,]\d+)?\s*(x|×|\*)?\s*\d*/g, " ")
    .replace(/[^\p{L}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** An exercise in the list that the description clearly names, if there's one. */
export function localMatch(
  text: string,
  all: Exercise[],
): Exercise | undefined {
  const words = exerciseWords(text);
  if (words.length < 3) return undefined;
  const top = searchScored(all, words)[0];
  return top && top.tier >= 2 ? top.exercise : undefined;
}

/** Your own exercise with this name, if you have one. */
export function ownByName(
  data: Pick<AppData, "customExercises">,
  name: string,
): CustomExercise | undefined {
  const n = normalize(name);
  return data.customExercises.find((c) => normalize(c.name) === n);
}

/** The exercise to save for a description: a new own one, or the one you already have by that name. */
export function exerciseFor(
  data: Pick<AppData, "customExercises">,
  d: DescribedExercise,
): { exercise: CustomExercise; isNew: boolean } {
  const existing = ownByName(data, d.name);
  if (existing) return { exercise: existing, isNew: false };
  return {
    isNew: true,
    exercise: {
      id: `c-${newId(12)}`,
      name: d.name,
      primary: d.primary,
      secondary: d.secondary.filter((m) => !d.primary.includes(m)),
      equipment: d.equipment,
      logType: d.logType,
      notes: d.notes,
      updatedAt: 0,
    },
  };
}

const setFrom = (s: DescribedSet): Partial<WorkoutSet> => ({
  ...(s.weight !== undefined ? { weight: s.weight } : {}),
  ...(s.reps !== undefined ? { reps: s.reps } : {}),
  ...(s.seconds !== undefined ? { seconds: s.seconds } : {}),
  ...(s.meters !== undefined ? { meters: s.meters } : {}),
});

/**
 * The workout with the exercise added at the end. Sets from the description
 * replace the usual prefill (last time's numbers); they're filled in, not
 * checked off — ticking them is still up to you.
 */
export function addToWorkout(
  w: Workout,
  ex: Pick<CustomExercise, "id" | "name" | "logType">,
  sets: DescribedSet[],
  history: Workout[],
): Workout {
  const next = addExercises(
    w,
    [{ id: ex.id, name: ex.name, logType: ex.logType }],
    history,
  );
  if (sets.length === 0) return next;
  const added = next.exercises[next.exercises.length - 1];
  return {
    ...next,
    exercises: [
      ...next.exercises.slice(0, -1),
      { ...added, sets: sets.map((s) => newSet(setFrom(s))) },
    ],
  };
}

/** Planned sets for a routine (targets have no weight-free check-off). */
export function plannedFrom(sets: DescribedSet[]): PlannedSet[] {
  return sets.length ? sets.map((s) => setFrom(s) as PlannedSet) : [{}, {}, {}];
}

export { routineExercise };

/** After a few of your own exercises, offer to hide the big built-in list (once per device). */
export function shouldOfferOnlyMine(
  data: Pick<AppData, "customExercises" | "settings">,
): boolean {
  return (
    data.settings.library === "full" &&
    !data.settings.libraryOffered &&
    data.customExercises.length >= 3
  );
}

/** "3 sets of 40 kg × 10, 45 kg × 8": the described sets, with repeats counted. */
export function setsText(
  sets: DescribedSet[],
  logType: LogType,
  units: Units,
): string {
  const one = (x: DescribedSet) =>
    [
      x.weight !== undefined ? weightLabel(x.weight, units) : "",
      x.reps !== undefined ? String(x.reps) : "",
      x.meters !== undefined
        ? `${fmtDistance(x.meters, logType, units)} ${distanceUnit(logType, units)}`
        : "",
      x.seconds !== undefined ? fmtDuration(x.seconds) : "",
    ]
      .filter(Boolean)
      .join(" × ");
  const groups: { text: string; n: number }[] = [];
  for (const x of sets) {
    const text = one(x);
    const last = groups[groups.length - 1];
    if (last && last.text === text) last.n++;
    else groups.push({ text, n: 1 });
  }
  return groups
    .map((g) => (g.n > 1 ? `${g.n} sets of ${g.text}` : g.text))
    .join(", ");
}
