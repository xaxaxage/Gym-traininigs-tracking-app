/**
 * Turning a description ("now I'm doing incline chest press on a machine,
 * 3×10 at 40") into an exercise the app can save and log: what we ask for,
 * the JSON shape we expect back, and a validator that keeps odd model output
 * out of the training log. Shared by every AI provider.
 */
import type { Equipment, LogType, Muscle, Units } from '../types';
import { LOG_TYPES } from '../types';
import { EQUIPMENT, MUSCLES } from '../library/catalog';
import { MAX_REPS, MAX_SECONDS, MAX_WEIGHT, MAX_METERS } from '../schema';
import { toKg } from '../units';

export interface DescribedSet {
  /** kg */
  weight?: number;
  reps?: number;
  seconds?: number;
  meters?: number;
}

export interface DescribedExercise {
  name: string;
  primary: Muscle[];
  secondary: Muscle[];
  equipment: Equipment;
  logType: LogType;
  /** A short how-to or what to watch for, when the description gives a reason to add one. */
  notes: string;
  /** Sets the description mentions ("3×10 at 40"), already in kg. */
  sets: DescribedSet[];
}

export interface DescribeInput {
  text: string;
  /** The person's unit, for weights without one. */
  units: Units;
  /** Their own exercises, so a description of one of them reuses it instead of making a copy. */
  known: string[];
}

export const MAX_DESCRIPTION = 500;

/** An error whose message can be shown to the user as is. */
export class AiError extends Error {
  constructor(
    message: string,
    /** A one-tap fix the screen can offer: switch to Flash-Lite. */
    readonly fix?: 'use-lite',
  ) {
    super(message);
  }
}

const MUSCLE_HINT = `Muscles, using only these names: ${MUSCLES.join(', ')}. "mid-back" is the upper and middle back (rhomboids, mid traps); "shoulders" covers all three delts.`;

export const EXERCISE_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string', description: 'The exercise as gyms commonly call it, short and in title case, e.g. "Incline Chest Press (Machine)".' },
    primary_muscles: { type: 'array', items: { type: 'string', enum: MUSCLES }, description: 'The muscles it mainly works, 1–3.' },
    secondary_muscles: { type: 'array', items: { type: 'string', enum: MUSCLES }, description: 'Muscles that help, 0–4.' },
    equipment: { type: 'string', enum: EQUIPMENT },
    log_type: {
      type: 'string',
      enum: LOG_TYPES,
      description:
        'How a set is logged: weight_reps (weight × reps), bodyweight (reps, optional added weight), duration (time), distance (distance and/or time), weight_distance (weight × distance, carries and sleds).',
    },
    notes: { type: 'string', description: 'Empty, or one short line worth remembering (a setting, a cue) that the person mentioned.' },
    sets: {
      type: 'array',
      description: 'Sets the person said they did or are doing, in order; empty when they gave none. Repeat a set for "3×10".',
      items: {
        type: 'object',
        properties: {
          weight: { type: 'number', description: 'Weight in the unit given in weight_unit; 0 when not given.' },
          reps: { type: 'number', description: '0 when not given.' },
          seconds: { type: 'number', description: '0 when not given.' },
          meters: { type: 'number', description: '0 when not given.' },
        },
        required: ['weight', 'reps', 'seconds', 'meters'],
        additionalProperties: false,
      },
    },
    weight_unit: { type: 'string', enum: ['kg', 'lb'], description: 'The unit of the weights in "sets".' },
  },
  required: ['name', 'primary_muscles', 'secondary_muscles', 'equipment', 'log_type', 'notes', 'sets', 'weight_unit'],
  additionalProperties: false,
} as const;

/**
 * Gemini also takes an explicit field order; it's added only for Gemini, as
 * `propertyOrdering` isn't standard JSON Schema.
 */
export function withPropertyOrdering(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(withPropertyOrdering);
  if (!schema || typeof schema !== 'object') return schema;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema)) out[k] = k === 'properties' ? mapValues(v, withPropertyOrdering) : withPropertyOrdering(v);
  const props = (schema as { properties?: Record<string, unknown> }).properties;
  if (props) out.propertyOrdering = Object.keys(props);
  return out;
}

const mapValues = (o: unknown, f: (v: unknown) => unknown) =>
  Object.fromEntries(Object.entries(o as Record<string, unknown>).map(([k, v]) => [k, f(v)]));

export function describePrompt(input: DescribeInput): string {
  const text = input.text.trim().slice(0, MAX_DESCRIPTION);
  const known = input.known.slice(0, 200);
  return `Someone in the gym described, in their workout tracker, the exercise they're doing now. Turn it into one exercise they can save and log.

Name it the way gyms commonly call it — short and in title case, with the equipment in brackets when it tells similar exercises apart (like "Incline Chest Press (Machine)" or "Romanian Deadlift (Dumbbell)"). Write the name in the language of the description.
${known.length ? `\nThese are exercises they already have. If the description means one of them, use its name exactly as written here instead of a new name:\n<their_exercises>\n${known.map((n) => `- ${n}`).join('\n')}\n</their_exercises>\n` : ''}
${MUSCLE_HINT} List the muscles the exercise mainly works as primary (1–3), and the ones that help as secondary (0–4).

Pick the equipment it's done with, and how a set is logged. Weight and reps for most strength exercises; bodyweight for pull-ups, dips, push-ups and the like; time for holds and stretches; distance for running, rowing and cycling; weight and distance for carries and sled pushes.

If they mention sets ("3×10 at 40", "did 12 reps with 20 kg"), list each set in order, repeating one for "3×10". Weights without a unit are in ${input.units}. If they mention none, leave "sets" empty — don't invent any.

<description>
${text}
</description>`;
}

const finite = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v));
const clamp = (v: unknown, lo: number, hi: number) => {
  const n = finite(v);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : 0;
};
const isRecord = (it: unknown): it is Record<string, unknown> => !!it && typeof it === 'object';

function muscleList(raw: unknown, max: number): Muscle[] {
  if (!Array.isArray(raw)) return [];
  const list = raw.map((m) => String(m).trim().toLowerCase().replace(/\s+/g, '-')).filter((m): m is Muscle => (MUSCLES as string[]).includes(m));
  return [...new Set(list)].slice(0, max);
}

/** Validate model output into an exercise the app can save. */
export function normalizeExercise(raw: unknown): DescribedExercise {
  if (!isRecord(raw)) throw new AiError('The answer came back in an unexpected format. Try again.');
  const name = String(raw.name ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  if (!name) throw new AiError("That didn't sound like an exercise. Try describing it differently.");
  const primary = muscleList(raw.primary_muscles, 3);
  const secondary = muscleList(raw.secondary_muscles, 4).filter((m) => !primary.includes(m));
  const equipment = (EQUIPMENT as string[]).includes(String(raw.equipment)) ? (raw.equipment as Equipment) : 'other';
  const logType = (LOG_TYPES as string[]).includes(String(raw.log_type)) ? (raw.log_type as LogType) : 'weight_reps';
  const unit: Units = raw.weight_unit === 'lb' ? 'lb' : 'kg';
  const sets = (Array.isArray(raw.sets) ? raw.sets : [])
    .filter(isRecord)
    .slice(0, 20)
    .map((s) => {
      const out: DescribedSet = {};
      const weight = clamp(s.weight, 0, MAX_WEIGHT);
      const reps = Math.round(clamp(s.reps, 0, MAX_REPS));
      const seconds = Math.round(clamp(s.seconds, 0, MAX_SECONDS));
      const meters = Math.round(clamp(s.meters, 0, MAX_METERS));
      if (weight > 0 && logType !== 'duration' && logType !== 'distance') out.weight = Math.min(MAX_WEIGHT, toKg(weight, unit));
      if (reps > 0 && (logType === 'weight_reps' || logType === 'bodyweight')) out.reps = reps;
      if (seconds > 0 && (logType === 'duration' || logType === 'distance')) out.seconds = seconds;
      if (meters > 0 && (logType === 'distance' || logType === 'weight_distance')) out.meters = meters;
      return out;
    })
    .filter((s) => Object.keys(s).length > 0);
  return { name, primary, secondary, equipment, logType, notes: String(raw.notes ?? '').trim().slice(0, 300), sets };
}

/** Parse a JSON reply, tolerating a code fence or a sentence around the JSON object. */
export function parseJsonReply(text: string | undefined): unknown {
  if (!text) throw new AiError('The answer came back empty. Try again.');
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        // fall through
      }
    }
    throw new AiError('The answer came back incomplete. Try again.');
  }
}
