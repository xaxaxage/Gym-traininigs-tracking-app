import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadLibrary, pickable } from "../src/lib/library/load";
import type { Exercise } from "../src/lib/library/catalog";
import { normalizeExercise, parseJsonReply } from "../src/lib/ai/shared";
import {
  addToWorkout,
  exerciseFor,
  exerciseWords,
  localMatch,
  plannedFrom,
  setsText,
  shouldOfferOnlyMine,
} from "../src/lib/describe";
import {
  backupJson,
  cleanSetting,
  emptyData,
  getData,
  parseBackup,
  reload,
  restoreBackup,
  updateSettings,
} from "../src/lib/store";
import { emptyWorkout } from "../src/lib/workout";
import type { CustomExercise } from "../src/lib/types";
import { MAX_WEIGHT } from "../src/lib/schema";

let all: Exercise[] = [];
beforeAll(async () => {
  all = await loadLibrary();
});
beforeEach(() => {
  localStorage.clear();
  reload();
});

const own = (name: string, id = `c-${name.length}`): CustomExercise => ({
  id,
  name,
  primary: ["chest"],
  secondary: [],
  equipment: "machine",
  logType: "weight_reps",
  notes: "",
  updatedAt: 1,
});

describe("what the AI answers", () => {
  it("keeps only known muscles, equipment and log types", () => {
    const e = normalizeExercise({
      name: "  Incline   Chest Press (Machine) ",
      primary_muscles: ["Chest", "pecs", "chest"],
      secondary_muscles: ["shoulders", "chest", "Lower Back"],
      equipment: "smith-machine",
      log_type: "sprints",
      notes: "Seat on 4",
      sets: [],
      weight_unit: "kg",
    });
    expect(e).toMatchObject({
      name: "Incline Chest Press (Machine)",
      primary: ["chest"],
      secondary: ["shoulders", "lower-back"],
      equipment: "other",
      logType: "weight_reps",
      notes: "Seat on 4",
    });
  });

  it("stores weights in kg, and keeps only the numbers its log type has", () => {
    const lb = normalizeExercise({
      name: "Leg Press",
      log_type: "weight_reps",
      sets: [{ weight: 100, reps: 12, seconds: 30, meters: 0 }],
      weight_unit: "lb",
    });
    expect(lb.sets).toEqual([{ weight: 45.359, reps: 12 }]);
    const plank = normalizeExercise({
      name: "Plank",
      log_type: "duration",
      sets: [
        { weight: 0, reps: 3, seconds: 60, meters: 0 },
        { weight: 0, reps: 0, seconds: 0, meters: 0 },
      ],
    });
    expect(plank.sets).toEqual([{ seconds: 60 }]);
    const silly = normalizeExercise({
      name: "Squat",
      log_type: "weight_reps",
      sets: [{ weight: 1e9, reps: -4 }],
    });
    expect(silly.sets[0].weight).toBe(MAX_WEIGHT);
    expect(silly.sets[0].reps).toBeUndefined();
  });

  it("refuses answers without an exercise", () => {
    expect(() => normalizeExercise({ name: "  " })).toThrow(
      /didn't sound like an exercise/,
    );
    expect(() => normalizeExercise("nope")).toThrow(/unexpected format/);
    expect(parseJsonReply('```json\n{"name":"X"}\n```')).toEqual({ name: "X" });
    expect(() => parseJsonReply('{"name":')).toThrow(/incomplete/);
  });
});

describe("describing without AI", () => {
  it("reads the exercise out of a sentence with sets in it", () => {
    expect(
      exerciseWords("Now I'm doing incline bench press, 3x10 at 40 kg"),
    ).toBe("incline bench press");
  });

  it("matches a clear description to the list, and nothing to gibberish", () => {
    expect(localMatch("now doing romanian deadlift 3×8", all)?.name).toBe(
      "Romanian Deadlift",
    );
    expect(localMatch("zzqx flurb", all)).toBeUndefined();
    expect(localMatch("do it", all)).toBeUndefined();
  });
});

describe("saving and adding", () => {
  const described = normalizeExercise({
    name: "Incline Chest Press (Machine)",
    primary_muscles: ["chest"],
    secondary_muscles: ["chest", "triceps"],
    equipment: "machine",
    log_type: "weight_reps",
    sets: [
      { weight: 40, reps: 10 },
      { weight: 45, reps: 8 },
    ],
  });

  it("makes a new own exercise, or reuses the one with the same name", () => {
    const made = exerciseFor({ customExercises: [] }, described);
    expect(made.isNew).toBe(true);
    expect(made.exercise.id).toMatch(/^c-/);
    expect(made.exercise).toMatchObject({
      primary: ["chest"],
      secondary: ["triceps"],
      equipment: "machine",
    });
    const mine = own("incline chest press (machine)", "c-mine");
    expect(exerciseFor({ customExercises: [mine] }, described)).toEqual({
      exercise: mine,
      isNew: false,
    });
  });

  it("adds it to the workout with the sets you said, not yet checked off", () => {
    const w = addToWorkout(
      emptyWorkout(Date.UTC(2026, 9, 7, 17)),
      own("Incline Chest Press (Machine)", "c-x"),
      described.sets,
      [],
    );
    expect(w.exercises).toHaveLength(1);
    expect(w.exercises[0]).toMatchObject({
      exerciseId: "c-x",
      name: "Incline Chest Press (Machine)",
    });
    expect(w.exercises[0].sets.map((s) => [s.weight, s.reps, s.done])).toEqual([
      [40, 10, false],
      [45, 8, false],
    ]);
    // Without sets in the description, the usual prefill stays.
    expect(
      addToWorkout(emptyWorkout(), own("Fly", "c-f"), [], []).exercises[0].sets
        .length,
    ).toBeGreaterThan(0);
    expect(plannedFrom([])).toEqual([{}, {}, {}]);
  });

  it("shows the sets briefly, with repeats counted", () => {
    const sets = [
      { weight: 40, reps: 10 },
      { weight: 40, reps: 10 },
      { weight: 40, reps: 10 },
      { weight: 45, reps: 8 },
    ];
    expect(setsText(sets, "weight_reps", "kg")).toBe(
      "3 sets of 40 kg × 10, 45 kg × 8",
    );
    expect(setsText([{ meters: 5000, seconds: 1500 }], "distance", "kg")).toBe(
      "5 km × 25:00",
    );
  });
});

describe("only my own exercises", () => {
  it("offers it once, after three of your own", () => {
    const d = emptyData();
    expect(shouldOfferOnlyMine(d)).toBe(false);
    d.customExercises = [own("A", "c-a"), own("B", "c-b"), own("C", "c-c")];
    expect(shouldOfferOnlyMine(d)).toBe(true);
    expect(
      shouldOfferOnlyMine({
        ...d,
        settings: { ...d.settings, libraryOffered: true },
      }),
    ).toBe(false);
    expect(
      shouldOfferOnlyMine({
        ...d,
        settings: { ...d.settings, library: "mine" },
      }),
    ).toBe(false);
  });

  it("keeps your own and the built-in ones you have used, so their history goes on", () => {
    const d = emptyData();
    d.customExercises = [own("Meadows Row", "c-m")];
    const w = emptyWorkout();
    w.exercises = [
      {
        id: "p",
        exerciseId: "Barbell_Squat",
        name: "Squat",
        logType: "weight_reps",
        notes: "",
        sets: [],
      },
    ];
    d.workouts = [w];
    expect(pickable(d, all).length).toBe(all.length + 1);
    d.settings.library = "mine";
    expect(
      pickable(d, all)
        .map((e) => e.id)
        .sort(),
    ).toEqual(["Barbell_Squat", "c-m"]);
  });
});

describe("the Gemini key", () => {
  it("is never in a backup, and a restore keeps this device’s", () => {
    updateSettings({
      geminiKey: "AIzaSecretKey123",
      geminiModel: "gemini-flash-latest",
      library: "mine",
    });
    const json = backupJson();
    expect(json).not.toContain("AIzaSecretKey123");
    const back = parseBackup(json);
    expect(back.settings).toMatchObject({
      geminiKey: "",
      geminiModel: "gemini-flash-latest",
      library: "mine",
    });
    restoreBackup(back);
    expect(getData().settings.geminiKey).toBe("AIzaSecretKey123");
  });

  it("accepts only plausible values from sync", () => {
    expect(cleanSetting("geminiKey", "AIza-abc_123")).toBe("AIza-abc_123");
    expect(cleanSetting("geminiKey", 'x"><script>')).toBeUndefined();
    expect(cleanSetting("geminiModel", "gemini-3.5-flash")).toBe(
      "gemini-3.5-flash",
    );
    expect(cleanSetting("geminiModel", "../../etc")).toBeUndefined();
    expect(cleanSetting("library", "mine")).toBe("mine");
    expect(cleanSetting("library", "some")).toBeUndefined();
  });
});
