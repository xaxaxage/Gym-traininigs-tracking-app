import { ApiError, GoogleGenAI } from '@google/genai';
import type { GeminiModelInfo } from '../types';
import {
  AiError,
  describePrompt,
  EXERCISE_SCHEMA,
  normalizeExercise,
  parseJsonReply,
  withPropertyOrdering,
  type DescribedExercise,
  type DescribeInput,
} from './shared';
import {
  checkBudget,
  dayUsedUp,
  googleError,
  modelLimits,
  newOp,
  noteAnswered,
  noteBusy,
  noteLimit,
  noteServed,
  parseGeminiQuota,
  realModel,
  recordUsage,
  resting,
  restUntil,
  type QuotaInfo,
  type UsageOutcome,
} from './usage';

/**
 * Turns a description into an exercise with Google Gemini (ported from the
 * calorie tracker). Gemini API keys from Google AI Studio come with a free
 * daily allowance per model. Requests go straight from the phone to Google.
 * Loaded on demand.
 */

type Failure = 'busy' | 'quota' | 'unsupported' | 'key' | 'location' | 'network' | 'other';

function classify(err: unknown): Failure {
  if (err instanceof ApiError) {
    const msg = err.message ?? '';
    if (/api key not valid|API_KEY_INVALID|api key expired/i.test(msg)) return 'key';
    if (/location is not supported/i.test(msg)) return 'location';
    if (err.status === 429) return 'quota';
    if (err.status >= 500) return 'busy';
    if (err.status === 403) return 'key';
    if (err.status === 404) return 'unsupported';
    if (/not (supported|enabled|found)|unsupported|does not support|json mode/i.test(msg)) return 'unsupported';
    return 'other';
  }
  // A malformed or empty reply from one model: another model may do better.
  if (err instanceof AiError) return 'unsupported';
  return 'network';
}

const FATAL: Failure[] = ['key', 'location', 'network'];

const clock = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** When a model's used-up daily limit resets, for messages. */
function resetNote(model: string): string {
  const until = Math.max(modelLimits(model).dayUsedUpUntil ?? 0, modelLimits(realModel(model)).dayUsedUpUntil ?? 0);
  return until > Date.now() ? ` until ${clock(until)}` : '';
}

const isLite = (model: string) => /lite/i.test(model) || /lite/i.test(realModel(model));

function errorFor(
  kind: Failure,
  err: unknown,
  model: string,
  tried: number,
  quota?: QuotaInfo,
  modelId?: string,
  /** No Flash-Lite model was tried, so switching to one is worth offering. */
  offerLite = false,
): AiError {
  switch (kind) {
    case 'key':
      return new AiError('Your Gemini API key was not accepted. Check it in Settings, or create a new one in Google AI Studio.');
    case 'location':
      return new AiError("Google's Gemini API isn't available in your country, so this key can't be used here.");
    case 'network':
      return new AiError('No connection to Google. Check your internet and try again.');
    case 'busy': {
      const said = err instanceof ApiError ? ` (Google: “${googleError(err.message ?? '', err.status)}”)` : '';
      return new AiError(
        tried > 1
          ? `Gemini is overloaded right now — none of the ${tried} models tried could answer${said}. Try again in a few minutes, or create the exercise yourself.`
          : `Google says ${model} is overloaded right now${said}. This happens a lot with Flash models lately; Flash-Lite usually still answers.`,
        offerLite ? 'use-lite' : undefined,
      );
    }
    case 'quota':
      if (quota?.scope === 'minute') {
        return new AiError(`${model} is at its per-minute limit. Wait a minute and try again, or pick another model in Settings.`);
      }
      return new AiError(
        `The free Gemini allowance is used up for ${tried > 1 ? `all ${tried} models tried` : `${model}${modelId ? resetNote(modelId) : ''}`}. Pick another model in Settings or try later — free allowances reset daily (at midnight in California).`,
      );
    case 'unsupported':
      return new AiError(
        err instanceof AiError && tried === 1
          ? err.message
          : `${tried > 1 ? 'None of the models tried' : model} can do this right now. Pick a different model in Settings.`,
      );
    default:
      return new AiError(`Gemini could not process this (${(err as ApiError)?.status ?? 'error'}). Try again.`);
  }
}

const wait = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(new DOMException('Aborted', 'AbortError'));
      },
      { once: true },
    );
  });

// The schema with an explicit field order, which Gemini keeps.
const JSON_SCHEMA = withPropertyOrdering(EXERCISE_SCHEMA);

/** Gemma models on the Gemini API don't take a JSON schema, so ask for JSON in the prompt instead. */
const isGemma = (model: string) => /^gemma-/i.test(model);

function jsonShape(): string {
  return '\n\nReply with JSON only — no other text — in exactly this shape ("sets" may be empty):\n{"name": "…", "primary_muscles": ["…"], "secondary_muscles": ["…"], "equipment": "…", "log_type": "weight_reps", "notes": "", "sets": [{"weight": 0, "reps": 0, "seconds": 0, "meters": 0}], "weight_unit": "kg"}';
}

/** How a failed request shows up in the usage log; notes what Google said about its limits. */
function failure(err: unknown, model: string, signal?: AbortSignal): { outcome: UsageOutcome; served?: string } {
  if (signal?.aborted) return { outcome: 'cancelled' };
  if (err instanceof ApiError && err.status === 429) {
    const quota = parseGeminiQuota(err.message ?? '');
    // Google names the model the limit belongs to — for an alias, the model behind it.
    noteServed(model, quota.model);
    if (quota.scope !== 'unknown') noteLimit(quota.model ?? model, quota.scope, quota.limit);
    const outcome = quota.scope === 'day' ? 'day-limit' : quota.scope === 'minute' ? 'minute-limit' : 'limit';
    return { outcome, ...(quota.model ? { served: quota.model } : {}) };
  }
  if (err instanceof ApiError && err.status >= 500) {
    // Rest it for a while, so the next estimates go where they get answers.
    noteBusy(realModel(model));
    return { outcome: 'busy' };
  }
  return { outcome: 'failed' };
}

/** What went wrong, in the provider's own words, for the usage log. */
function errorText(err: unknown): string | undefined {
  if (err instanceof ApiError) return googleError(err.message ?? '', err.status);
  if (err instanceof Error && err.message) return err.message.slice(0, 160);
  return undefined;
}

async function callModel(ai: GoogleGenAI, model: string, input: DescribeInput, op: string, signal?: AbortSignal) {
  const prompt = describePrompt(input) + (isGemma(model) ? jsonShape() : '');
  const started = Date.now();
  const logged = { at: started, op, provider: 'gemini' as const, model, kind: 'exercise' as const };
  let response;
  try {
    response = await ai.models.generateContent({
      model,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: {
        ...(isGemma(model) ? {} : { responseMimeType: 'application/json', responseJsonSchema: JSON_SCHEMA }),
        abortSignal: signal,
        httpOptions: { timeout: 60_000 },
      },
    });
  } catch (err) {
    const text = errorText(err);
    recordUsage({ ...logged, ms: Date.now() - started, ...failure(err, model, signal), ...(text ? { error: text } : {}) });
    throw err;
  }
  const served = response.modelVersion;
  noteServed(model, served);
  noteAnswered(realModel(model));
  const meta = response.usageMetadata;
  const out = (meta?.candidatesTokenCount ?? 0) + (meta?.thoughtsTokenCount ?? 0);
  const done = {
    ...logged,
    ...(served ? { served } : {}),
    ms: Date.now() - started,
    ...(meta?.promptTokenCount ? { tokensIn: meta.promptTokenCount } : {}),
    ...(out ? { tokensOut: out } : {}),
  };
  try {
    if (response.promptFeedback?.blockReason) {
      throw new AiError('Gemini declined to answer this. Try describing it differently.');
    }
    const exercise = normalizeExercise(parseJsonReply(response.text));
    recordUsage({ ...done, outcome: 'ok' });
    return exercise;
  } catch (err) {
    const text = errorText(err);
    if (text) Object.assign(done, { error: text });
    recordUsage({ ...done, outcome: 'failed' });
    throw err;
  }
}

export interface GeminiResult {
  exercise: DescribedExercise;
  model: string;
}

/** Wait out a per-minute limit when Google asks for no longer than this; otherwise move on. */
const MAX_LIMIT_WAIT = 15_000;

/**
 * Try each model in turn. A busy model gets one retry, and so does one at its
 * per-minute limit, after the wait Google asks for. A model out of free uses
 * for the day is skipped until the limit resets, so it doesn't cost a failed
 * request every time; any other failure hands over to the next model.
 */
export async function describeWithGemini(
  apiKey: string,
  models: string[],
  input: DescribeInput,
  signal?: AbortSignal,
  onProgress?: (message: string) => void,
  labelFor: (model: string) => string = (m) => m,
): Promise<GeminiResult> {
  const ai = new GoogleGenAI({ apiKey });
  const op = newOp();
  let last: { kind: Failure; err: unknown; model: string; quota?: QuotaInfo } | undefined;

  // Models whose daily free uses are gone are left out until Google resets them. If that's
  // all of them, one request to the chosen model: the limit may have been lifted since.
  // An alias for a model already in the list ("newest Flash" = 3.8 Flash) shares its limits,
  // so each model is tried once.
  // A model Google recently called overloaded rests for a while, the same way.
  const seen = new Set<string>();
  const usable = models.filter((m) => {
    const real = realModel(m);
    if (seen.has(real) || dayUsedUp(m) || checkBudget(m).skipForDay || resting(m)) return false;
    seen.add(real);
    return true;
  });
  const order = usable.length > 0 ? usable : models.slice(0, 1);
  if (usable.length > 0 && order[0] !== models[0]) {
    const chosen = models[0];
    const why =
      dayUsedUp(chosen) || checkBudget(chosen).skipForDay
        ? `is out of free uses${resetNote(chosen)}`
        : `is overloaded on Google's side — resting it until ${clock(restUntil(chosen) ?? Date.now())}`;
    onProgress?.(`${labelFor(chosen)} ${why} — using ${labelFor(order[0])}…`);
  }

  for (const [index, model] of order.entries()) {
    if (last) {
      const why = last.kind === 'quota' ? 'out of free uses' : last.kind === 'busy' ? 'overloaded' : 'unavailable';
      onProgress?.(`${labelFor(last.model)} is ${why} — trying ${labelFor(model)}…`);
    }
    // This device already used the per-minute limit Google reported: wait briefly, or move on.
    const { waitMs } = checkBudget(model);
    if (waitMs !== undefined) {
      if (waitMs > MAX_LIMIT_WAIT && index < order.length - 1) {
        last = { kind: 'quota', err: undefined, model, quota: { scope: 'minute' } };
        continue;
      }
      onProgress?.(`${labelFor(model)} is at its per-minute limit — waiting ${Math.max(1, Math.round(waitMs / 1000))} s…`);
      await wait(Math.min(waitMs, 60_000), signal);
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return { exercise: await callModel(ai, model, input, op, signal), model };
      } catch (err) {
        if (signal?.aborted) throw err;
        const kind = classify(err);
        const quota = kind === 'quota' && err instanceof ApiError ? parseGeminiQuota(err.message ?? '') : undefined;
        console.warn(`Gemini ${model} failed (${kind}${quota ? `, ${quota.scope}` : ''})`, err);
        if (FATAL.includes(kind)) throw errorFor(kind, err, model, index + 1);
        last = { kind, err, model, quota };
        // Overloaded: another model is the better bet (and a retry would use up another of the day's
        // requests). Only when there's nothing else to try, one more attempt after a pause.
        if (kind === 'busy' && attempt === 0 && index === order.length - 1) {
          onProgress?.(`${labelFor(model)} is overloaded — trying again in a few seconds…`);
          await wait(3000, signal);
          continue;
        }
        const pause = quota?.retryAfterMs;
        if (quota?.scope === 'minute' && attempt === 0 && pause !== undefined && pause <= MAX_LIMIT_WAIT) {
          onProgress?.(`${labelFor(model)} is at its per-minute limit — trying again in ${Math.max(1, Math.round(pause / 1000))} s…`);
          await wait(pause + 500, signal);
          continue;
        }
        break;
      }
    }
  }
  throw errorFor(last!.kind, last!.err, labelFor(last!.model), order.length, last!.quota, last!.model, !order.some(isLite));
}

const EXCLUDE = /(embedding|tts|image|live|audio|robotics|computer-use|aqa|veo|imagen|lyria|learnlm)/i;

function version(id: string): number {
  const m = /^(?:gemini|gemma)-(\d+(?:\.\d+)?)/i.exec(id);
  return m ? Number(m[1]) : 0;
}

/** Models this key can use to generate text, newest first (Gemini before Gemma). */
export async function listGeminiModels(apiKey: string): Promise<GeminiModelInfo[]> {
  const ai = new GoogleGenAI({ apiKey });
  const found: GeminiModelInfo[] = [];
  const started = Date.now();
  const logged = { at: started, op: newOp(), provider: 'gemini' as const, model: 'model list', kind: 'models' as const };
  try {
    const pager = await ai.models.list({ config: { pageSize: 200 } });
    for await (const m of pager) {
      const id = (m.name ?? '').replace(/^models\//, '');
      const actions = m.supportedActions ?? [];
      if (!/^(gemini|gemma)-/i.test(id) || EXCLUDE.test(id)) continue;
      if (actions.length > 0 && !actions.includes('generateContent')) continue;
      found.push({ id, label: m.displayName?.trim() || id });
      if (found.length >= 100) break;
    }
    recordUsage({ ...logged, ms: Date.now() - started, outcome: 'ok' });
  } catch (err) {
    recordUsage({ ...logged, ms: Date.now() - started, outcome: 'failed' });
    const kind = classify(err);
    if (kind === 'unsupported' || kind === 'other' || kind === 'busy' || kind === 'quota') {
      throw new AiError('Google did not return the model list. Try again in a moment.');
    }
    throw errorFor(kind, err, '', 1);
  }
  return found.sort((a, b) => {
    const fam = Number(/^gemma/i.test(a.id)) - Number(/^gemma/i.test(b.id));
    return fam || version(b.id) - version(a.id) || a.id.localeCompare(b.id);
  });
}
