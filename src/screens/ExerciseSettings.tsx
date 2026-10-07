import { useEffect, useRef, useState } from "preact/hooks";
import { isModelId, updateSettings, useData } from "../lib/store";
import { plural } from "../lib/format";
import { showToast } from "../lib/toast";
import { GEMINI_SHORTCUTS, listGeminiModels } from "../lib/ai";
import { limitsFor, pacificDayStart, tally, useUsage } from "../lib/ai/usage";
import { Segmented, Switch } from "../components/Common";
import { ChevronRight } from "../components/Icons";
import { OnlyMineOffer } from "../components/Describe";

/** Which exercises to pick from, and the AI that adds your own. */
export function ExerciseSettings() {
  const data = useData();
  const s = data.settings;
  return (
    <>
      <OnlyMineOffer />
      <div class="group">
        <div class="setting">
          <span class="setting-label">
            Pick from
            <span class="muted">
              {s.library === "full"
                ? "The built-in list and your own"
                : "Only your own exercises"}
            </span>
          </span>
          <Segmented
            label="Pick from"
            value={s.library}
            options={[
              { value: "full", label: "All" },
              { value: "mine", label: "Mine" },
            ]}
            onChange={(library) =>
              updateSettings({ library, libraryOffered: true })
            }
          />
        </div>
        <a class="setting" href="#/exercises">
          <span class="setting-label">
            Exercise list
            <span class="muted">
              {plural(data.customExercises.length, "own exercise")}
            </span>
          </span>
          <ChevronRight size={18} />
        </a>
      </div>
      <p class="group-note">
        With only your own, you add exercises by describing them during a
        workout, and the list holds just what you do. Past workouts keep every
        exercise's name either way.
      </p>

      <h3 class="list-label">Gemini</h3>
      <p class="body-text">
        Describe an exercise in your words — “incline chest press on a machine,
        3×10 at 40” — and Gemini fills in its muscles, equipment and how it's
        logged, and saves it as your own. It needs a free key from Google:
      </p>
      <ol class="steps">
        <li>
          Open{" "}
          <a
            href="https://aistudio.google.com/apikey"
            target="_blank"
            rel="noopener noreferrer"
          >
            aistudio.google.com/apikey
          </a>{" "}
          and sign in with a Google account.
        </li>
        <li>
          Tap <strong>Create API key</strong> and copy it. No card is needed.
        </li>
        <li>Paste it below and save.</li>
      </ol>
      <KeyField
        saved={s.geminiKey}
        onSave={(geminiKey) => {
          updateSettings({ geminiKey });
          // The models this key can use, for the picker.
          if (geminiKey)
            listGeminiModels(geminiKey)
              .then((geminiModels) => updateSettings({ geminiModels }))
              .catch(() => undefined);
        }}
      />
      {s.geminiKey.trim() && <GeminiModelPicker />}
      <p class="group-note">
        The key stays on your devices: with sync on it reaches your other
        devices encrypted, so you enter it once. It's never in a backup and
        never shown to Claude. On the free tier Google may use what you send to
        improve its products, so keep descriptions to the exercise.
      </p>
      {s.geminiKey.trim() && <UsageToday />}
    </>
  );
}

function KeyField({
  saved,
  onSave,
}: {
  saved: string;
  onSave: (key: string) => void;
}) {
  const [key, setKey] = useState(saved);
  const [show, setShow] = useState(false);
  // A key can arrive from another device while this screen is open.
  const shown = useRef(saved);
  useEffect(() => {
    if (saved === shown.current) return;
    shown.current = saved;
    setKey(saved);
  }, [saved]);
  return (
    <form
      class="field"
      onSubmit={(e) => {
        e.preventDefault();
        shown.current = key.trim();
        onSave(key.trim());
        showToast(key.trim() ? "Key saved" : "Key removed");
      }}
    >
      <label for="gemini-key" class="field-label">
        Gemini API key
      </label>
      <div class="key-row">
        <input
          id="gemini-key"
          class="input"
          type={show ? "text" : "password"}
          autoComplete="off"
          autoCapitalize="off"
          spellcheck={false}
          placeholder="AIza…"
          value={key}
          onInput={(e) => setKey((e.target as HTMLInputElement).value)}
        />
        <button
          type="button"
          class="btn-secondary small-btn"
          onClick={() => setShow(!show)}
        >
          {show ? "Hide" : "Show"}
        </button>
      </div>
      <button type="submit" class="btn-primary" disabled={key.trim() === saved}>
        {saved && !key.trim() ? "Remove key" : "Save key"}
      </button>
    </form>
  );
}

const CUSTOM = "__custom";

/** ", 500 free a day" for the model picker, when the limit is known. */
function freePerDay(model: string): string {
  const { perDay } = limitsFor(model);
  return perDay ? `, ${perDay.toLocaleString()} free a day` : "";
}

function GeminiModelPicker() {
  const { settings } = useData();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [custom, setCustom] = useState(false);
  const [customId, setCustomId] = useState("");
  const current = settings.geminiModel;
  const listed = settings.geminiModels;
  const known = new Set([
    ...GEMINI_SHORTCUTS.map((m) => m.id),
    ...listed.map((m) => m.id),
  ]);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const geminiModels = await listGeminiModels(settings.geminiKey);
      updateSettings({ geminiModels });
      showToast(`Found ${geminiModels.length} models`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div class="field">
      <label for="gemini-model" class="field-label">
        Model
      </label>
      <select
        id="gemini-model"
        class="input select"
        value={custom ? CUSTOM : current}
        onChange={(e) => {
          const value = (e.target as HTMLSelectElement).value;
          if (value === CUSTOM) {
            setCustom(true);
            setCustomId(known.has(current) ? "" : current);
          } else {
            setCustom(false);
            updateSettings({ geminiModel: value });
          }
        }}
      >
        <optgroup label="Always the newest">
          {GEMINI_SHORTCUTS.map((m) => (
            <option value={m.id}>
              {m.label} — {m.hint}
              {freePerDay(m.id)}
            </option>
          ))}
        </optgroup>
        {listed.length > 0 && (
          <optgroup label={`Models your key can use (${listed.length})`}>
            {listed.map((m) => (
              <option value={m.id}>
                {m.label === m.id ? m.id : `${m.label} · ${m.id}`}
                {freePerDay(m.id)}
              </option>
            ))}
          </optgroup>
        )}
        {!known.has(current) && <option value={current}>{current}</option>}
        <option value={CUSTOM}>Other — type a model ID…</option>
      </select>

      {custom && (
        <form
          class="key-row"
          onSubmit={(e) => {
            e.preventDefault();
            const id = customId.trim();
            if (!isModelId(id)) return;
            updateSettings({ geminiModel: id });
            setCustom(false);
            showToast(`Using ${id}`);
          }}
        >
          <label for="custom-model" class="sr-only">
            Model ID
          </label>
          <input
            id="custom-model"
            class="input"
            type="text"
            autoComplete="off"
            autoCapitalize="off"
            spellcheck={false}
            placeholder="e.g. gemini-3.5-flash"
            value={customId}
            onInput={(e) => setCustomId((e.target as HTMLInputElement).value)}
          />
          <button
            type="submit"
            class="btn-secondary small-btn"
            disabled={!isModelId(customId.trim())}
          >
            Use
          </button>
        </form>
      )}

      <button
        type="button"
        class="link-btn left"
        disabled={loading}
        onClick={load}
      >
        {loading
          ? "Loading models…"
          : listed.length > 0
            ? "Refresh the model list"
            : "Show all models my key can use"}
      </button>
      {error && <span class="field-hint error-text">{error}</span>}

      <div class="group">
        <Switch
          id="gemini-auto"
          checked={settings.geminiAutoSwitch}
          label="Switch models automatically"
          hint="When a model is busy or out of free uses, try the next one"
          onChange={(geminiAutoSwitch) => updateSettings({ geminiAutoSwitch })}
        />
      </div>
    </div>
  );
}

/** Today's requests from this device, by Google's day (it resets at midnight Pacific time). */
function UsageToday() {
  const { records } = useUsage();
  const since = pacificDayStart();
  const t = tally(records.filter((r) => r.at >= since));
  return (
    <p class="group-note num">
      Today on this device: {plural(t.requests, "request")}
      {t.failed > 0 ? `, ${t.failed} failed` : ""}. Flash-Lite is free for about
      500 a day.
    </p>
  );
}
