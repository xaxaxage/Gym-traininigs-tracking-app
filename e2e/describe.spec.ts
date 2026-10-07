import { expect, test, type Page } from "@playwright/test";
import { fresh, watchErrors } from "./helpers";

/** What the stubbed Gemini makes of each description. */
const ANSWERS: Record<string, object> = {
  incline: {
    name: "Incline Chest Press (Machine)",
    primary_muscles: ["chest"],
    secondary_muscles: ["shoulders", "triceps"],
    equipment: "machine",
    log_type: "weight_reps",
    notes: "",
    sets: [1, 2, 3].map(() => ({
      weight: 40,
      reps: 10,
      seconds: 0,
      meters: 0,
    })),
    weight_unit: "kg",
  },
  hack: {
    name: "Hack Squat (Machine)",
    primary_muscles: ["quads"],
    secondary_muscles: ["glutes"],
    equipment: "machine",
    log_type: "weight_reps",
    notes: "",
    sets: [],
    weight_unit: "kg",
  },
  fly: {
    name: "Cable Fly (High to Low)",
    primary_muscles: ["chest"],
    secondary_muscles: [],
    equipment: "cable",
    log_type: "weight_reps",
    notes: "",
    sets: [],
    weight_unit: "kg",
  },
};

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "*",
  "access-control-allow-methods": "*",
};

/** Gemini, answered here: tests never reach Google. */
async function stubGemini(page: Page) {
  const asked: string[] = [];
  await page.route(
    "https://generativelanguage.googleapis.com/**",
    async (route) => {
      const req = route.request();
      if (req.method() === "OPTIONS")
        return route.fulfill({ status: 204, headers: CORS });
      if (req.url().includes(":generateContent")) {
        const prompt: string = req.postDataJSON().contents[0].parts[0].text;
        asked.push(prompt);
        const said =
          /<description>([\s\S]*)<\/description>/
            .exec(prompt)?.[1]
            .toLowerCase() ?? "";
        const key =
          Object.keys(ANSWERS).find((k) => said.includes(k)) ?? "incline";
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          headers: CORS,
          body: JSON.stringify({
            candidates: [
              {
                content: {
                  role: "model",
                  parts: [{ text: JSON.stringify(ANSWERS[key]) }],
                },
                finishReason: "STOP",
              },
            ],
          }),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: CORS,
        body: JSON.stringify({
          models: [
            {
              name: "models/gemini-3.5-flash-lite",
              displayName: "Gemini 3.5 Flash-Lite",
              supportedGenerationMethods: ["generateContent"],
            },
          ],
        }),
      });
    },
  );
  return asked;
}

const here = (page: Page) => page.locator(".pager-page[data-here]");

async function describeIt(page: Page, text: string) {
  await here(page).getByLabel("Describe the exercise").fill(text);
  await here(page).getByRole("button", { name: "Add", exact: true }).click();
  return page.getByRole("dialog", { name: "Check the exercise" });
}

test("describe an exercise: Gemini fills it in, it is saved as my own, and after a few the big list can go", async ({
  page,
}) => {
  const errors = watchErrors(page);
  await fresh(page);
  const asked = await stubGemini(page);

  // Without a key, a description is matched to the list.
  await page.getByRole("button", { name: "Start an empty workout" }).click();
  await here(page)
    .getByLabel("Describe the exercise")
    .fill("now doing romanian deadlift");
  await here(page).getByRole("button", { name: "Add", exact: true }).click();
  await expect(
    here(page).getByText("Romanian Deadlift", { exact: true }),
  ).toBeVisible();
  await expect(
    here(page).getByRole("link", {
      name: "Create “Romanian deadlift” yourself",
    }),
  ).toBeVisible();
  expect(asked).toEqual([]);

  // Set up Gemini.
  await page.goto("./#/settings/exercises");
  await page.getByLabel("Gemini API key").fill("AIza-test-key");
  await page.getByRole("button", { name: "Save key" }).click();
  await expect(page.getByLabel("Model", { exact: true })).toBeVisible();
  await expect(
    page
      .getByLabel("Model", { exact: true })
      .locator("option", { hasText: "Gemini 3.5 Flash-Lite" }),
  ).toHaveCount(1);

  // Back in the workout, describe one with sets.
  await page.goto("./");
  await page
    .getByRole("link", { name: /Resume/ })
    .first()
    .click();
  const review = await describeIt(
    page,
    "Now im doing incline chest press on a machine, 3x10 at 40",
  );
  await expect(review.getByLabel("Name")).toHaveValue(
    "Incline Chest Press (Machine)",
  );
  await expect(review).toContainText("Chest");
  await expect(review).toContainText("Shoulders, Triceps");
  await expect(review).toContainText("Machine");
  await review.getByRole("button", { name: "Save and add" }).click();

  // It's the page you're on now, with the sets filled in but not checked off.
  await expect(here(page).locator(".exercise-name")).toHaveText(
    /Incline Chest Press \(Machine\)$/,
  );
  await expect(here(page).getByLabel("Set 3 weight in kg")).toHaveValue("40");
  await expect(here(page).getByLabel("Set 1 reps")).toHaveValue("10");
  await expect(
    here(page).getByRole("button", { name: "Complete set 1" }),
  ).toBeVisible();
  expect(asked[0]).toContain("Now im doing incline chest press on a machine");

  // Two more of my own; then the app offers to drop the big list.
  for (const [text, name] of [
    ["hack squat machine", "Hack Squat (Machine)"],
    ["cable fly high to low", "Cable Fly (High to Low)"],
  ]) {
    await page.getByRole("button", { name: "Next exercise" }).click();
    await expect(here(page).locator(".workout-end")).toBeVisible();
    await (await describeIt(page, text))
      .getByRole("button", { name: "Save and add" })
      .click();
    await expect(here(page).locator(".exercise-name")).toHaveText(
      new RegExp(`${name.replace(/[()]/g, "\\$&")}$`),
    );
  }
  // Describing one I already have adds that one instead of a copy.
  await page.getByRole("button", { name: "Next exercise" }).click();
  const again = await describeIt(page, "incline press again");
  await expect(again).toContainText(
    "You already have an exercise with this name",
  );
  await again.getByRole("button", { name: "Add it" }).click();
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("gym-tracker:v1")!).customExercises
          .length,
    ),
  ).toBe(3);

  await page.getByRole("button", { name: "Next exercise" }).click();
  const offer = here(page).getByRole("note");
  await expect(offer).toContainText("You're building your own list");
  await offer.getByRole("button", { name: "Only mine" }).click();
  await expect(offer).toBeHidden();

  // The picker now has only my own (and ones I've done) — the built-in bench press is gone.
  await here(page).getByRole("link", { name: "Add exercises" }).click();
  await expect(
    page.getByRole("region", { name: "Your exercises" }),
  ).toContainText("Cable Fly (High to Low)");
  await expect(page.getByRole("region", { name: "Popular" })).toHaveCount(0);
  await page.getByLabel("Search exercises").fill("bench");
  await expect(page.getByText("No matches")).toBeVisible();

  // Settings shows the choice, and switching back brings the list back.
  await page.goto("./#/settings/exercises");
  await expect(
    page
      .getByRole("group", { name: "Pick from" })
      .getByRole("button", { name: "Mine" }),
  ).toHaveAttribute("aria-pressed", "true");
  await page
    .getByRole("group", { name: "Pick from" })
    .getByRole("button", { name: "All" })
    .click();
  await page.goto("./#/exercises");
  await expect(page.getByRole("region", { name: "Popular" })).toBeVisible();
  expect(errors).toEqual([]);
});
