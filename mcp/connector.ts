import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { applyMerged, getData } from '../src/lib/store';
import { isValidPhrase, normalizePhrase } from '../src/lib/sync/crypto';
import { DEFAULT_RELAYS, isRelayUrl } from '../src/lib/sync/state';
import { EQUIPMENT, GROUPS, MUSCLES } from '../src/lib/library/catalog';
import { LOG_TYPES } from '../src/lib/types';
import { OfflineError, RelaySync, type DeviceInfo } from './relays';
import {
  createExercise,
  createRoutine,
  editRoutine,
  editSet,
  editWorkout,
  findExercises,
  logWorkout,
  progressReport,
  removeRoutine,
  removeSet,
  removeWorkout,
  routinesReport,
  ToolError,
  workoutReport,
  workoutsReport,
  type WriteResult,
} from './tools';

/**
 * The Gym Tracker connector: tools for Claude that read and write the same
 * training log as the app, through the app's encrypted device sync (ported
 * from the calorie tracker's connector). Runs in Claude Desktop (server.ts,
 * over stdio) or online for claude.ai and the Claude phone apps (cloud.ts,
 * over HTTP).
 */

declare const __MCP_VERSION__: string;

const INSTRUCTIONS = `These tools read and change the user's Gym Tracker training log: the same workouts, routines and exercises as in the app on their phone, kept in sync.

Units: weights are in the user's unit, kg or lb — every reply says which in "units". Give weights in that unit too (or pass unit to say otherwise). Distances are in meters (distance_m), times in seconds.

Dates are YYYY-MM-DD in the user's local time, and times HH:MM (24-hour); leave the date out for today.

Exercises: pick them from the app's library first. search_exercises finds them by name, common words and abbreviations ("bench", "RDL", "pull-up"), muscle group and equipment; use the exercise's id or exact name in other tools. Only when nothing in the library fits, create_exercise makes a custom one.

To log a workout ("bench 3×8 at 80 kg, then rows 3×10 at 60"), call log_workout once with every exercise and its sets; repeated sets can use count. Each exercise is logged one way: weight_reps (weight × reps), bodyweight (reps, with optional added weight), duration (seconds), distance (distance_m and/or seconds) or weight_distance (weight × distance_m). Afterwards, tell the user briefly what was logged and any new records.

To change or delete a workout or a set, get its id (and the exercise and set numbers) from get_workouts or get_workout first. For a training plan ("a 4-day upper/lower program"), create one routine per day with create_routine; the user starts them in the app.`;

/** Where the connector runs, for messages that say how to fix its setup. */
export type Host = 'desktop' | 'cloud';

const MESSAGES: Record<Host, { missing: string; invalid: string; retired: string; noData: string }> = {
  desktop: {
    missing:
      'The sync key is not set. In the app, open Settings → Sync between devices, turn sync on and copy the 12 words; then add them as SYNC_KEY in the Claude Desktop settings for this server (or reinstall the extension and paste them).',
    invalid:
      'The sync key is not a valid 12-word phrase. Copy it again from the app (Settings → Sync between devices → Show sync key) and update the server settings in Claude Desktop.',
    retired:
      "The sync key was changed in the app, so the one set up here doesn't open the training log anymore. Copy the new 12 words (in the app: Settings → Sync between devices → Show sync key), paste them into this extension's settings in Claude Desktop (Settings → Extensions → Gym Tracker), and restart Claude Desktop.",
    noData:
      'No synced training log was found for this sync key. In the app, check that sync is on (Settings → Sync between devices) and that the 12 words match the ones set up in Claude Desktop.',
  },
  cloud: {
    missing:
      "This connector isn't set up yet. Whoever runs it needs to set CONNECTOR_SECRET in its Vercel project (Settings → Environment Variables) and redeploy.",
    invalid:
      "The sync key in this connector's SYNC_KEY setting is not a valid 12-word phrase. Copy your connector address from the app instead (Settings → Use with Claude).",
    retired:
      "The sync key was changed in the app, so this connector address doesn't open the training log anymore. Copy the new address in the app (Settings → Use with Claude) and replace this connector's address in Claude (Customize → Connectors).",
    noData:
      'No synced training log was found for this connector address. In the app, check that sync is on (Settings → Sync between devices), then copy the address again (Settings → Use with Claude).',
  },
};

/** Relay addresses from a setting: separated by commas, spaces or new lines. */
export function relaysFrom(text: string | undefined): string[] {
  return (text ?? '').split(/[\s,]+/).filter(isRelayUrl);
}

export interface ConnectorOptions {
  /** The 12 words, as pasted. */
  syncKey: string;
  /** Relays to use; the app's defaults when empty. */
  relays: string[];
  /** How it shows up in the app's device list. */
  device: Omit<DeviceInfo, 'version'>;
  host: Host;
  /**
   * Runs before each request's work, while it has the training log to itself: an online connector
   * serving several people puts this person's log in place here.
   */
  enter?: () => void;
}

export interface Connector {
  /** The sync key, normalized. */
  phrase: string;
  /** Why the connector can't work as set up, if it can't. */
  setupProblem: string | null;
  sync: RelaySync | null;
  /** A server with the tools, to connect to a transport. Every server shares the same training log. */
  newServer(): McpServer;
  /** Fetch the log now, so the first question doesn't wait for it. */
  warmUp(): Promise<void>;
}

type Reply = { content: { type: 'text'; text: string }[]; isError?: boolean };

// One request at a time, even across people, so a write never races a pull and each request
// has the (one, shared) in-memory store to itself.
let chain: Promise<unknown> = Promise.resolve();
function serial<T>(task: () => Promise<T>): Promise<T> {
  const run = chain.then(task, task);
  chain = run.catch(() => undefined);
  return run;
}

const reply = (value: unknown): Reply => ({ content: [{ type: 'text', text: JSON.stringify(value, null, 1) }] });
const failure = (message: string): Reply => ({ content: [{ type: 'text', text: message }], isError: true });

export function createConnector({ syncKey, relays, device, host, enter = () => {} }: ConnectorOptions): Connector {
  const say = MESSAGES[host];
  const phrase = normalizePhrase(syncKey);
  const setupProblem = !phrase ? say.missing : !isValidPhrase(phrase) ? say.invalid : null;
  const sync = setupProblem
    ? null
    : new RelaySync(phrase, relays.length ? relays : DEFAULT_RELAYS, { ...device, version: __MCP_VERSION__ });

  /** Parts no relay accepted yet; retried on the next request. */
  const pending = new Set<string>();

  const mine = <T>(task: () => Promise<T>) =>
    serial(() => {
      enter();
      return task();
    });

  async function retryPending(s: RelaySync) {
    if (pending.size === 0) return;
    const { failed } = await s.push([...pending]);
    pending.clear();
    failed.forEach((n) => pending.add(n));
  }

  /** Pull, finish earlier uploads, and keep this connector in the app's device list. */
  async function refresh(s: RelaySync) {
    await s.pull();
    if (s.retiredAt) return;
    await retryPending(s);
    await s.announce().catch((err) => console.error('Could not update the device list:', (err as Error).message));
  }

  function explain(err: unknown, writing: boolean): Reply {
    if (err instanceof ToolError) return failure(err.message);
    if (err instanceof OfflineError) return failure(writing ? `${err.message} Nothing was changed.` : err.message);
    console.error(err);
    return failure(`Something went wrong: ${(err as Error)?.message ?? String(err)}`);
  }

  function read(run: () => unknown | Promise<unknown>) {
    return mine(async (): Promise<Reply> => {
      if (!sync) return failure(setupProblem!);
      try {
        let note: string | undefined;
        try {
          await refresh(sync);
        } catch (err) {
          if (!(err instanceof OfflineError) || !sync.lastPullAt) throw err;
          note = `Offline: this is the training log as of ${new Date(sync.lastPullAt).toLocaleTimeString()}.`;
        }
        if (sync.retiredAt) return failure(say.retired);
        if (!note && sync.partCount === 0) note = say.noData;
        const value = (await run()) as object;
        return reply(note ? { note, ...value } : value);
      } catch (err) {
        return explain(err, false);
      }
    });
  }

  function write(run: () => WriteResult<object> | Promise<WriteResult<object>>) {
    return mine(async (): Promise<Reply> => {
      if (!sync) return failure(setupProblem!);
      try {
        await refresh(sync);
        if (sync.retiredAt) return failure(`${say.retired} Nothing was changed.`);
        if (sync.partCount === 0) return failure(`${say.noData} Nothing was changed.`);
        const before = getData();
        let outcome: WriteResult<object>;
        try {
          outcome = await run();
        } catch (err) {
          // A tool that failed part-way leaves nothing behind.
          applyMerged(before);
          throw err;
        }
        const { result, touched } = outcome;
        const { sent, failed } = await sync.push(touched);
        if (failed.length > 0 && sent === 0) {
          applyMerged(before);
          return failure("Couldn't reach any of the sync relays, so nothing was saved. Check the internet connection and try again.");
        }
        failed.forEach((n) => pending.add(n));
        const note = failed.length ? 'Saved, but not every change reached the relays yet; it will finish uploading on the next request.' : undefined;
        return reply(note ? { note, ...result } : result);
      } catch (err) {
        return explain(err, true);
      }
    });
  }

  function newServer(): McpServer {
    const server = new McpServer({ name: 'gym-tracker', version: __MCP_VERSION__ }, { instructions: INSTRUCTIONS });
    registerTools(server, read, write);
    return server;
  }

  return {
    phrase,
    setupProblem,
    sync,
    newServer,
    warmUp: () => (sync ? mine(() => refresh(sync)) : Promise.resolve()),
  };
}

// ── Tools ─────────────────────────────────────────────────────────────────

function registerTools(
  server: McpServer,
  read: (run: () => unknown | Promise<unknown>) => Promise<Reply>,
  write: (run: () => WriteResult<object> | Promise<WriteResult<object>>) => Promise<Reply>,
) {
  const date = z.string().optional().describe("Day as YYYY-MM-DD in the user's local time. Leave out for today.");
  const unit = z.enum(['kg', 'lb']).optional().describe("Unit of the weights given. Leave out for the user's own unit.");
  const weight = z.number().min(0).max(3000);
  const set = z.object({
    weight: weight.optional().describe('Weight, or for bodyweight exercises the added weight. In the user\'s unit.'),
    reps: z.number().int().min(0).max(9999).optional(),
    seconds: z.number().min(0).max(86400).optional().describe('Time, for duration and distance exercises.'),
    distance_m: z.number().min(0).max(1_000_000).optional().describe('Distance in meters.'),
    count: z.number().int().min(1).max(30).optional().describe('The same set this many times (3×8 = count 3, reps 8).'),
  });
  const exercise = z.string().min(1).max(120).describe('Exercise id from search_exercises, or its name.');
  const exerciseWithSets = z.object({
    exercise,
    sets: z.array(set).min(1).max(100),
    notes: z.string().max(2000).optional(),
  });
  const routineExercise = z.object({
    exercise,
    sets: z.number().int().min(1).max(30).optional().describe('Number of sets (default 3).'),
    reps: z.union([z.number().int().min(0).max(9999), z.array(z.number().int().min(0).max(9999)).max(30)]).optional().describe('Target reps: one number, or one per set (e.g. [10, 8, 6]).'),
    weight: weight.optional().describe("Target weight in the user's unit."),
    seconds: z.number().min(0).max(86400).optional(),
    distance_m: z.number().min(0).max(1_000_000).optional(),
    rest_seconds: z.number().int().min(0).max(3600).optional(),
    notes: z.string().max(2000).optional(),
  });
  const workoutId = z.string().describe('Workout id from get_workouts.');
  const ro = { readOnlyHint: true, openWorldHint: false } as const;
  const rw = (destructive: boolean, idempotent: boolean) =>
    ({ readOnlyHint: false, destructiveHint: destructive, idempotentHint: idempotent, openWorldHint: false }) as const;

  server.registerTool(
    'get_workouts',
    {
      title: 'Workouts on a day or over a period',
      description:
        "The user's workouts on one day (date) or over a period (from–to; default the last 14 days): id, name, date, start time, duration, sets, volume and each exercise's best set, plus totals. A workout in progress is marked in_progress.",
      inputSchema: {
        date: z.string().optional().describe('One day, YYYY-MM-DD.'),
        from: z.string().optional().describe('First day, YYYY-MM-DD.'),
        to: z.string().optional().describe('Last day, YYYY-MM-DD. Default: today.'),
      },
      annotations: ro,
    },
    (input) => read(() => workoutsReport(input)),
  );

  server.registerTool(
    'get_workout',
    {
      title: 'One workout in full',
      description: 'Every exercise and set of a workout (numbered, for update_set and delete_set), its notes, and the records set in it.',
      inputSchema: { id: workoutId },
      annotations: ro,
    },
    ({ id }) => read(() => workoutReport(id)),
  );

  server.registerTool(
    'get_exercise_progress',
    {
      title: 'Records and progress for an exercise',
      description:
        "The user's records for an exercise (heaviest weight, best estimated 1-rep max, most volume in a workout, most reps, most reps at each weight) and its trend: per workout, the best estimated 1-rep max (Epley) and the top set weight.",
      inputSchema: {
        exercise,
        from: z.string().optional().describe('Only workouts from this day, YYYY-MM-DD.'),
        to: z.string().optional().describe('Only workouts up to this day, YYYY-MM-DD.'),
      },
      annotations: ro,
    },
    (input) => read(() => progressReport(input)),
  );

  server.registerTool(
    'search_exercises',
    {
      title: 'Find exercises',
      description: `Search the whole exercise library (800+ exercises and the user's own) by name, common words and abbreviations, with optional filters. Without a query, lists the most popular ones. Muscle groups: ${GROUPS.join(', ')}. Equipment: ${EQUIPMENT.join(', ')}.`,
      inputSchema: {
        query: z.string().max(120).optional(),
        muscle_group: z.enum(GROUPS as [string, ...string[]]).optional(),
        equipment: z.enum(EQUIPMENT as [string, ...string[]]).optional(),
        limit: z.number().int().min(1).max(50).optional().describe('Default 15.'),
      },
      annotations: ro,
    },
    (input) => read(() => findExercises(input)),
  );

  server.registerTool(
    'log_workout',
    {
      title: 'Log a workout',
      description:
        'Add a finished workout with its exercises and sets (all counted as done). Leave date out for today; without start_time it ends now (today) or starts at 18:00 (another day). Records it sets are in the reply.',
      inputSchema: {
        exercises: z.array(exerciseWithSets).min(1).max(40),
        date,
        start_time: z.string().optional().describe('HH:MM, 24-hour.'),
        duration_minutes: z.number().min(1).max(600).optional().describe('Default 60.'),
        name: z.string().max(80).optional().describe('E.g. "Push day". Default "Workout".'),
        notes: z.string().max(4000).optional(),
        unit,
      },
      annotations: rw(false, false),
    },
    (input) => write(() => logWorkout(input)),
  );

  server.registerTool(
    'update_workout',
    {
      title: 'Change a workout',
      description: "Change a workout's name, notes, day, start time or duration; add exercises with their sets; or remove an exercise (by its number from get_workout).",
      inputSchema: {
        id: workoutId,
        name: z.string().max(80).optional(),
        notes: z.string().max(4000).optional(),
        date: z.string().optional().describe('Move to this day, YYYY-MM-DD.'),
        start_time: z.string().optional().describe('HH:MM, 24-hour.'),
        duration_minutes: z.number().min(1).max(600).optional(),
        add_exercises: z.array(exerciseWithSets).max(40).optional(),
        remove_exercise: z.number().int().min(1).optional().describe('Exercise number from get_workout.'),
        unit,
      },
      annotations: rw(false, false),
    },
    (input) => write(() => editWorkout(input)),
  );

  server.registerTool(
    'delete_workout',
    {
      title: 'Delete a workout',
      description: 'Remove a workout from the history (on every synced device).',
      inputSchema: { id: workoutId },
      annotations: rw(true, true),
    },
    ({ id }) => write(() => removeWorkout(id)),
  );

  const setAddress = {
    workout_id: workoutId,
    exercise: z.number().int().min(1).describe('Exercise number in the workout, from get_workout.'),
    set: z.number().int().min(1).describe('Set number within the exercise, from get_workout.'),
  };

  server.registerTool(
    'update_set',
    {
      title: 'Change a set',
      description: "Change one set's weight, reps, time or distance, or mark it done or not done.",
      inputSchema: {
        ...setAddress,
        weight: weight.optional(),
        reps: z.number().int().min(0).max(9999).optional(),
        seconds: z.number().min(0).max(86400).optional(),
        distance_m: z.number().min(0).max(1_000_000).optional(),
        done: z.boolean().optional(),
        unit,
      },
      annotations: rw(false, true),
    },
    (input) => write(() => editSet(input)),
  );

  server.registerTool(
    'delete_set',
    {
      title: 'Delete a set',
      description: 'Remove one set from a workout. An exercise left without sets is removed too.',
      inputSchema: setAddress,
      annotations: rw(true, false),
    },
    (input) => write(() => removeSet(input)),
  );

  server.registerTool(
    'list_routines',
    {
      title: 'Routines',
      description: "The user's routines (workout templates) in order, with their exercises, planned sets (target reps and weights) and when each was last done.",
      inputSchema: {},
      annotations: ro,
    },
    () => read(() => routinesReport()),
  );

  server.registerTool(
    'create_routine',
    {
      title: 'Create a routine',
      description: 'Make a routine: a named list of exercises with planned sets. For a program, make one routine per training day.',
      inputSchema: {
        name: z.string().min(1).max(80),
        exercises: z.array(routineExercise).max(40),
        notes: z.string().max(4000).optional(),
        unit,
      },
      annotations: rw(false, false),
    },
    (input) => write(() => createRoutine(input)),
  );

  server.registerTool(
    'update_routine',
    {
      title: 'Change a routine',
      description: "Rename a routine, change its notes, or replace its exercises (give the whole new list, in order).",
      inputSchema: {
        id: z.string().describe('Routine id from list_routines.'),
        name: z.string().max(80).optional(),
        notes: z.string().max(4000).optional(),
        exercises: z.array(routineExercise).max(40).optional(),
        unit,
      },
      annotations: rw(false, true),
    },
    (input) => write(() => editRoutine(input)),
  );

  server.registerTool(
    'delete_routine',
    {
      title: 'Delete a routine',
      description: 'Remove a routine (workouts done with it stay in the history).',
      inputSchema: { id: z.string().describe('Routine id from list_routines.') },
      annotations: rw(true, true),
    },
    ({ id }) => write(() => removeRoutine(id)),
  );

  server.registerTool(
    'create_exercise',
    {
      title: 'Create a custom exercise',
      description: `Add the user's own exercise, only when search_exercises has nothing that fits. Muscles: ${MUSCLES.join(', ')}. Logging: ${LOG_TYPES.join(', ')}.`,
      inputSchema: {
        name: z.string().min(1).max(80),
        primary_muscles: z.array(z.enum(MUSCLES as [string, ...string[]])).min(1).max(6),
        secondary_muscles: z.array(z.enum(MUSCLES as [string, ...string[]])).max(10).optional(),
        equipment: z.enum(EQUIPMENT as [string, ...string[]]).optional(),
        logging: z.enum(LOG_TYPES as [string, ...string[]]).optional().describe('Default weight_reps.'),
      },
      annotations: rw(false, false),
    },
    (input) => write(() => createExercise(input)),
  );
}
