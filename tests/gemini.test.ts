import { afterEach, describe, expect, it, vi } from "vitest";
import { describeWithGemini, listGeminiModels } from "../src/lib/ai/gemini";
import { geminiChain, geminiLabel } from "../src/lib/ai";
import { emptyData } from "../src/lib/store";
import { allLimits, forgetDayLimit } from "../src/lib/ai/usage";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const PRESS = {
  name: "Incline Chest Press (Machine)",
  primary_muscles: ["chest"],
  secondary_muscles: ["shoulders", "triceps"],
  equipment: "machine",
  log_type: "weight_reps",
  notes: "",
  sets: [
    { weight: 40, reps: 10, seconds: 0, meters: 0 },
    { weight: 40, reps: 10, seconds: 0, meters: 0 },
  ],
  weight_unit: "kg",
};

const reply = (exercise: unknown = PRESS) =>
  json(200, {
    candidates: [
      {
        content: { role: "model", parts: [{ text: JSON.stringify(exercise) }] },
        finishReason: "STOP",
      },
    ],
  });

const failure = (code: number, message: string, status: string) =>
  json(code, { error: { code, message, status } });

const INPUT = {
  text: "incline chest press on a machine, 2×10 at 40",
  units: "kg" as const,
  known: [],
};

function stubFetch(handler: (model: string, body: any) => Response) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url instanceof Request ? url.url : url);
      const model = /models\/([^:?]+)/.exec(u)?.[1] ?? "";
      calls.push(model);
      return handler(
        model,
        init?.body ? JSON.parse(String(init.body)) : undefined,
      );
    }),
  );
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
  // Each test starts without models resting from the one before.
  Object.keys(allLimits()).forEach(forgetDayLimit);
});

describe("describing an exercise with Gemini", () => {
  it("turns a description into an exercise with muscles, equipment and the sets", async () => {
    let body: any;
    stubFetch((_m, b) => {
      body = b;
      return reply();
    });
    const { exercise, model } = await describeWithGemini(
      "AIza-test",
      ["gemini-flash-lite-latest"],
      { ...INPUT, known: ["Hack Squat (Machine)"] },
    );
    expect(model).toBe("gemini-flash-lite-latest");
    expect(exercise).toEqual({
      name: "Incline Chest Press (Machine)",
      primary: ["chest"],
      secondary: ["shoulders", "triceps"],
      equipment: "machine",
      logType: "weight_reps",
      notes: "",
      sets: [
        { weight: 40, reps: 10 },
        { weight: 40, reps: 10 },
      ],
    });
    const prompt: string = body.contents[0].parts[0].text;
    expect(prompt).toContain("incline chest press on a machine");
    // Their own exercises are named, so the same one isn't made twice.
    expect(prompt).toContain("- Hack Squat (Machine)");
  });

  it("moves on at once past an overloaded model and an out-of-quota one", async () => {
    const calls = stubFetch((model) => {
      if (model === "gemini-flash-lite-latest")
        return failure(503, "The model is overloaded.", "UNAVAILABLE");
      if (model === "gemini-flash-latest")
        return failure(
          429,
          "Resource has been exhausted.",
          "RESOURCE_EXHAUSTED",
        );
      return reply();
    });
    const progress: string[] = [];
    const result = await describeWithGemini(
      "AIza-test",
      ["gemini-flash-lite-latest", "gemini-flash-latest", "gemini-3.5-flash"],
      INPUT,
      undefined,
      (m) => progress.push(m),
    );
    expect(result.model).toBe("gemini-3.5-flash");
    expect(calls).toEqual([
      "gemini-flash-lite-latest",
      "gemini-flash-latest",
      "gemini-3.5-flash",
    ]);
    expect(progress).toEqual([
      "gemini-flash-lite-latest is overloaded — trying gemini-flash-latest…",
      "gemini-flash-latest is out of free uses — trying gemini-3.5-flash…",
    ]);
  }, 10_000);

  it("explains when every model is overloaded", async () => {
    stubFetch(() => failure(503, "The model is overloaded.", "UNAVAILABLE"));
    await expect(
      describeWithGemini("AIza-test", ["gemini-flash-lite-latest"], INPUT),
    ).rejects.toThrow(/overloaded right now/);
  }, 10_000);

  it("stops straight away on a bad key instead of trying other models", async () => {
    const calls = stubFetch(() =>
      failure(
        400,
        "API key not valid. Please pass a valid API key.",
        "INVALID_ARGUMENT",
      ),
    );
    await expect(
      describeWithGemini(
        "bad",
        ["gemini-flash-lite-latest", "gemini-flash-latest"],
        INPUT,
      ),
    ).rejects.toThrow(/key was not accepted/);
    expect(calls).toHaveLength(1);
  });

  it("asks Gemma models for JSON in the prompt instead of JSON mode", async () => {
    let body: any;
    stubFetch((_m, b) => {
      body = b;
      return json(200, {
        candidates: [
          {
            content: {
              parts: [{ text: `Sure! Here you go:\n${JSON.stringify(PRESS)}` }],
            },
          },
        ],
      });
    });
    const { exercise } = await describeWithGemini(
      "AIza-test",
      ["gemma-3-27b-it"],
      INPUT,
    );
    expect(exercise.name).toBe("Incline Chest Press (Machine)");
    expect(body.generationConfig?.responseMimeType).toBeUndefined();
    expect(body.contents[0].parts[0].text).toContain("Reply with JSON only");
  });

  it("sends the schema with an explicit field order", async () => {
    let body: any;
    stubFetch((_m, b) => {
      body = b;
      return reply();
    });
    await describeWithGemini("AIza-test", ["gemini-flash-lite-latest"], INPUT);
    const schema = body.generationConfig.responseJsonSchema;
    expect(schema.propertyOrdering).toEqual([
      "name",
      "primary_muscles",
      "secondary_muscles",
      "equipment",
      "log_type",
      "notes",
      "sets",
      "weight_unit",
    ]);
    expect(schema.properties.sets.items.propertyOrdering).toEqual([
      "weight",
      "reps",
      "seconds",
      "meters",
    ]);
  });

  it("lists usable models, newest first, without non-text ones", async () => {
    stubFetch(() =>
      json(200, {
        models: [
          {
            name: "models/gemini-2.5-flash",
            displayName: "Gemini 2.5 Flash",
            supportedGenerationMethods: ["generateContent"],
          },
          {
            name: "models/gemini-3.8-flash",
            displayName: "Gemini 3.8 Flash",
            supportedGenerationMethods: ["generateContent"],
          },
          {
            name: "models/gemma-3-27b-it",
            displayName: "Gemma 3 27B",
            supportedGenerationMethods: ["generateContent"],
          },
          {
            name: "models/gemini-3.5-flash-lite",
            displayName: "Gemini 3.5 Flash-Lite",
            supportedGenerationMethods: ["generateContent"],
          },
          {
            name: "models/gemini-embedding-001",
            displayName: "Embedding",
            supportedGenerationMethods: ["embedContent"],
          },
          {
            name: "models/gemini-2.5-flash-preview-tts",
            displayName: "TTS",
            supportedGenerationMethods: ["generateContent"],
          },
        ],
      }),
    );
    const models = await listGeminiModels("AIza-test");
    expect(models.map((m) => m.id)).toEqual([
      "gemini-3.8-flash",
      "gemini-3.5-flash-lite",
      "gemini-2.5-flash",
      "gemma-3-27b-it",
    ]);
    expect(models[0].label).toBe("Gemini 3.8 Flash");
  });
});

describe("which models to try", () => {
  const base = {
    ...emptyData().settings,
    geminiKey: "AIza",
    geminiModels: [
      { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash" },
      { id: "gemini-3.8-pro", label: "Gemini 3.8 Pro" },
      { id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash-Lite" },
      { id: "gemma-3-27b-it", label: "Gemma 3 27B" },
    ],
  };

  it("tries the chosen model first, then free alternatives (never Pro), up to five", () => {
    expect(geminiChain({ ...base, geminiModel: "gemini-3.8-flash" })).toEqual([
      "gemini-3.8-flash",
      "gemini-flash-lite-latest",
      "gemini-flash-latest",
      "gemini-3.5-flash-lite",
      "gemma-3-27b-it",
    ]);
  });

  it("keeps a chosen Pro model, and only it when switching is off", () => {
    expect(geminiChain({ ...base, geminiModel: "gemini-3.8-pro" })[0]).toBe(
      "gemini-3.8-pro",
    );
    expect(
      geminiChain({
        ...base,
        geminiModel: "gemini-3.8-pro",
        geminiAutoSwitch: false,
      }),
    ).toEqual(["gemini-3.8-pro"]);
  });

  it("names models readably", () => {
    expect(geminiLabel(base, "gemini-flash-lite-latest")).toBe(
      "Flash-Lite (newest)",
    );
    expect(geminiLabel(base, "gemini-3.8-flash")).toBe("Gemini 3.8 Flash");
    expect(geminiLabel(base, "my-custom-model")).toBe("my-custom-model");
  });
});
