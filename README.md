# Gym Tracker

A gym workout tracker built for iPhone (and just as usable on a Windows PC), installed from the browser like an
app. No backend and no account: your training log stays on your devices, with optional end-to-end encrypted sync
between them through a 12-word key, and a Claude connector so you can ask Claude about your training or log a
workout by describing it. It is built the same way as the [Calorie Tracker](https://github.com/xaxaxage/Calorie-tracking-web-app),
and reuses its sync, service worker, palettes, animations, connector and deploy workflow.

**Open it:** https://xaxaxage.github.io/Gym-traininigs-tracking-app/

## What it does

- **Train** – start a routine with one tap, or an empty workout. A workout in progress stays one tap away from every
  screen. This week at a glance, and two starter plans (Full body A/B, Push · Pull · Legs) for an empty start.
- **Look** – warm and calm (Harbor by default, Night in dark mode with Auto), Bricolage Grotesque for headings and
  Figtree for text. Instrument, a dark flat look with a lime accent, and its light twin Paper are among the palettes.
- **Workout** – one exercise per page: swipe or use the arrows; the strip on top shows where you are and how far
  each exercise has got, and opens an overview to jump to one. Checking off an exercise's last set moves on to the
  next; the last page adds exercises, takes notes and finishes. Each exercise has its sets: weight × reps (or reps, time, distance — see below). Last time's
  numbers are shown next to each set and filled in, so one tap on ✓ completes a set. Change a weight once and the
  sets below follow. Add or remove sets and exercises, reorder, swap an exercise, notes per exercise and for the
  workout. The time runs at the top. Every change is saved at once: closing the app, a crash or a reload never loses
  a set, and opening the app continues the workout. The screen stays on during a workout where the browser allows it.
- **Rest timer** – starts when you complete a set: a default for each exercise and an overall one, ±15 s, skip. It
  counts from timestamps, so it's right after the app was in the background. It shows on screen only — an iPhone web
  app can't sound an alarm or vibrate while the phone is locked.
- **Routines** – workout templates: a name and exercises in order with their planned sets (target reps and weight
  optional). Create, edit, reorder, duplicate, or save a finished workout as one.
- **Add an exercise by describing it** – on the workout's last page (and at the top of the exercise picker) type
  what you're doing, e.g. "Now I'm doing incline chest press on a machine, 3×10 at 40". With a free
  [Gemini](https://aistudio.google.com/apikey) key, Gemini names it, fills in the muscles it works, the equipment
  and how it's logged, and picks up the sets you mention; you check it in a sheet, and it's saved as your own
  exercise (synced) and added as the next page, sets filled in but not checked off. Describing one you already have
  adds that one instead of a copy. Without a key, the description is matched to the list, or you create the
  exercise yourself. The Gemini code (as in the Calorie Tracker: the model picker, automatic switching when a model
  is busy or out of free uses, a usage count) is only downloaded when first used.
- **Exercise library** – 876 exercises from [free-exercise-db](https://github.com/yuhonas/free-exercise-db) plus a
  few common ones it lacks (burpee, wall sit, kettlebell swing, Pendlay row…), with muscles, equipment, level,
  compound/isolation, step-by-step instructions and photos. About 150 popular ones come first; filters by muscle group
  (chest, back, shoulders, biceps, triceps, legs, glutes, core) and equipment; search understands common words and
  shorthand ("bench", "RDL", "pull-up" = "pullup" = "pull up", "db row", "kb swing", plurals). Recently done
  exercises and favorites rise to the top; hide the ones you never do. Make your own exercises — they sync.
  After a few exercises of your own, the app offers once to switch to **only mine** (Settings → Exercises and AI →
  Pick from): the picker then shows your own exercises plus the built-in ones you've already done, so their
  history carries on, and nothing else.
- **How an exercise is logged** – weight × reps, bodyweight reps (optionally with added weight), time, distance and
  time (cardio), or weight × distance (carries, sleds). Worked out from the dataset's category and equipment, with
  obvious mistakes fixed by hand (planks are timed, dips and pull-ups are bodyweight, farmer's walks are distance).
- **Exercise page** – muscles, equipment, instructions, photos (start and end position), and your own history: a
  progress chart of the best estimated 1-rep max (Epley) and heaviest set per workout, personal records (heaviest
  weight, best estimated 1-rep max, most reps at each weight, most volume in one workout) and recent sets.
- **Progress** – volume per week for the last seven weeks (tap a week for its workouts, sets and volume) and every
  exercise you've done, with a small trend line, its best and the change since the start. The whole exercise list
  opens from here.
- **History** – past workouts as a list by month or a month calendar. Open one to look at it, edit it (sets, start
  time, duration) or delete it.
- **Workout done** – duration, sets, volume and new records.
- **Settings** – one page with sections: training (kg or lb, stored in kg; the rest timer; keep the screen on),
  exercises and AI (all or only mine; the Gemini key and model), appearance, sync, Use with Claude, backup and data,
  design versions, and about. `#/settings/<section>` opens at a section.

Everything works offline once the app has been opened. Exercise photos load only on an exercise's page, from the
dataset's pinned commit, and the ones you've looked at are kept for offline use; the app works fully without them.

## Install it

**iPhone:** open the address above in Safari → **Share** → **Add to Home Screen**. Open it from the new icon from
now on: it runs full screen and works offline at the gym.

The Home Screen app keeps **its own data, separate from Safari** — a workout logged in a Safari tab doesn't show up
in the Home Screen app, and the other way round. Use the icon, or turn on sync. Removing the icon can delete its
data, so export a backup first (Settings → Export backup → Save to Files).

**Windows PC:** open the address in Edge or Chrome and use the install button in the address bar (or just keep the
tab). Turn on sync on both devices to share one log.

## Sync between devices

Devices are linked with a **12-word sync key** — no account.

1. On the first device: **Settings → Sync between devices → Create sync key**. Save the 12 words (a password manager
   or Notes), tick the box, **Start syncing**.
2. On each other device: **Settings → Sync between devices → I have a key**, enter the words, **Connect**. What's
   already on that device is combined with what's synced — nothing is overwritten.

From then on every change syncs within a few seconds while the app is open (the workout in progress too, so you can
start on the phone and carry on on the computer), and fully whenever the app starts, comes back into view or comes
back online. **Devices** lists every device using the key (named after the browser, e.g. "iPhone · Home Screen app";
rename this one with the pencil, hide others with the bin). **Change sync key** moves everything to a new key: it
uploads all of it under the new key first, then marks every part of the old key as retired, so devices still using
the old words stop syncing and ask for the new ones.

How it works (ported from the calorie tracker):

- The key is a standard BIP-39 phrase. On the device it becomes (PBKDF2 → HKDF) a signing key, an AES-256-GCM key
  and a key for naming the data. Everything is compressed and encrypted **before** it leaves the device.
- This app uses its own HKDF salt (`gym-tracker-sync`), so the same 12 words used in the calorie tracker or any other
  app give completely different keys: the apps can never read, mix up or overwrite each other's data.
- The encrypted parts go to free public [Nostr](https://nostr.com) relays (`relay.damus.io`, `nos.lol`,
  `relay.primal.net`, `nostr.mom`, editable under **Relays**) as replaceable app-data events (kind 30078). Relays only
  ever see a random public key, opaque labels and ciphertext — no exercise names, dates or weights.
- The data is split into parts well under the relays' 64 KB limit: one for custom exercises and library preferences
  (favorites, hidden, rest times), one for routines, one for settings, and one per month of workouts. Only parts that
  changed are uploaded again.
- Merging is item by item: every workout, routine, exercise and preference has an id and a time of its last change;
  the newest edit wins and a deletion wins over edits made before it. Every device writes each part in exactly the
  same form, so equal data gives equal bytes, and an event's time never goes backwards.
- A relay that's down is simply skipped; one that accepts the connection but never answers doesn't hold up syncing.

Things to know: public relays are run by volunteers and can be slow or disappear — that's why several are used and
why every device keeps its full copy. Keep exporting a backup now and then. Anyone with the 12 words can read and
change your log. **Delete everything** deletes on every synced device.

## Use with Claude

Claude can read and change your training log — on claude.ai, in the Claude phone app and in Claude Desktop. Ask
*"how is my bench press going?"*, *"what did I do this week?"*, say *"log today: bench 3×8 at 80 kg, then rows 3×10
at 60"*, or *"make me a 4-day upper/lower program"* and it becomes four routines in the app.

It works through a connector (an MCP server) that uses the same encrypted sync as your devices, so turn on **Sync
between devices** first. Then:

1. In the app: **Settings → Use with Claude → Show my connector address → Copy the address**.
2. In Claude on a computer (claude.ai or Claude Desktop): **Customize → Connectors → + → Add custom connector**,
   name it *Gym Tracker*, paste the address, **Add**.
3. That's it — it works in the Claude phone app too.

**Tools:** `get_workouts` (a day or a period), `get_workout`, `get_exercise_progress` (records and trend),
`search_exercises` (the whole library with aliases and muscle/equipment filters), `log_workout`, `update_workout`,
`delete_workout`, `update_set`, `delete_set`, `list_routines`, `create_routine`, `update_routine`, `delete_routine`
and `create_exercise`. Weights are in your unit, dates are your local dates, and Claude picks exercises from the
library before making custom ones. Your sync key is never shown to Claude.

**The address** is `https://<server>/mcp/<your sync key, sealed>?tz=<your time zone>`: the server seals your key with
its own secret when the app asks (`POST /link`), so the address doesn't reveal it and only that server can open it.
Treat it like a password. After changing the sync key, copy the new address and replace it in Claude.

**Privacy:** to answer Claude, the connector server opens your log, so whoever runs it could see it — for the shared
server, that's this app's maker. For a log opened only by you, host your own (below) or use the Claude Desktop
extension.

### Host the connector

The connector (`mcp/cloud.ts`) is one stateless function for [Vercel](https://vercel.com)'s free plan; the app's
builds use `gym.xaxaxage.vercel.app`. Each person's log is kept in memory per person, requests run one at a time,
and relay connections are closed whenever no request is in flight. To host one:

1. [vercel.com/new](https://vercel.com/new) → sign in with GitHub → import this repository. **Application Preset:**
   *Other* (the rest comes from `vercel.json`).
2. Add the **Environment Variable** `CONNECTOR_SECRET`: 32 or more random characters (from a password generator).
   It seals everyone's addresses; changing it later makes everyone copy a new address. **Deploy.**
3. Open the project's address under **Domains** (not a single deployment's, which Vercel keeps private). It should
   say *"Connector addresses: ready"*.
4. This app's builds expect the shared connector at `gym.xaxaxage.vercel.app`: give the project that domain under
   **Settings → Domains** (as for the calorie tracker's `calories.xaxaxage.vercel.app`). A connector at any other
   address works too: build the app with `VITE_CONNECTOR_HOST=<address>`, or enter it in the app under **Settings →
   Use with Claude → Use your own connector server**.

Optional variables: `TIME_ZONE` (for addresses without `?tz=`), `RELAYS` (for addresses without `&r=`),
`DEVICE_NAME` (its name in the app's device list), and `SYNC_KEY` (seals addresses when `CONNECTOR_SECRET` isn't set,
and answers an older single-person address `/mcp/<32 hex characters>`).

**Free plan limits** (Hobby, per month, per account): 1,000,000 function invocations, 4 hours of active CPU (time
spent waiting for the relays doesn't count), 360 GB-hours of memory, personal non-commercial use. Going over pauses
the project until the window resets; there's no bill. A question to Claude takes a few calls of about 0.1–0.3 s of
CPU each, so a few dozen people asking several times a day fit — watch **Usage** in the dashboard.

Anywhere else: `npm run build:cloud` makes `.vercel/output/functions/mcp.func/index.mjs`, one file; run it with
`CONNECTOR_SECRET="…" PORT=8787 node index.mjs` behind HTTPS. It speaks MCP Streamable HTTP without sessions; GET and
DELETE get 405.

### Claude Desktop extension (runs on your computer)

The same tools, run by Claude Desktop on your computer over stdio, so your log is opened only there (it doesn't reach
Claude on your phone).

1. Download [`gym-tracker.mcpb`](https://xaxaxage.github.io/Gym-traininigs-tracking-app/mcp/gym-tracker.mcpb) (or in
   the app: **Settings → Use with Claude → Claude Desktop extension**).
2. Open it with Claude Desktop (double-click, or drag it into **Settings → Extensions**) → **Install**.
3. Paste your 12 words when it asks for the sync key, and start a new chat.

Claude Desktop runs it with its own Node.js. It appears in the app's device list as *Claude Desktop · Windows*. After
changing the sync key, paste the new words into the extension's settings.

<details>
<summary>Without the extension (manual setup on Windows, Claude Code)</summary>

The server as one file, for any MCP client; needs [Node.js](https://nodejs.org) 20 or newer.

1. Download [`gym-tracker-mcp.mjs`](https://xaxaxage.github.io/Gym-traininigs-tracking-app/mcp/gym-tracker-mcp.mjs),
   e.g. to `C:\Users\<you>\gym-tracker-mcp.mjs`.
2. Claude Desktop: **Settings → Developer → Edit Config** opens `%APPDATA%\Claude\claude_desktop_config.json`
   (on a Mac `~/Library/Application Support/Claude/claude_desktop_config.json`). Add:

   ```json
   {
     "mcpServers": {
       "gym-tracker": {
         "command": "node",
         "args": ["C:\\Users\\<you>\\gym-tracker-mcp.mjs"],
         "env": { "SYNC_KEY": "your twelve words here" }
       }
     }
   }
   ```

   Then quit Claude Desktop completely (also from the tray icon) and open it again.
3. Claude Code: `claude mcp add gym-tracker -e SYNC_KEY="your twelve words here" -- node C:\Users\<you>\gym-tracker-mcp.mjs`

Optional: `RELAYS` (space- or comma-separated `wss://` URLs) and `DEVICE_NAME`.

</details>

## Your data

The Gemini key is a synced setting, so it travels to your other devices inside the encrypted sync and you enter it
once. It's never written to a backup, and the Claude connector never passes it to Claude (its tools read only your unit from the settings). On
Google's free tier Google may use what you send to improve its products; only the description you type is sent.

There's no server and no account. Everything is one JSON record in the app's `localStorage` (`gym-tracker:v1`),
saved on every change: workouts (with their exercises and sets), routines, custom exercises, library preferences
and settings. Weights are stored in kg, distances in meters, times in seconds. If saving ever fails because the
device is full, a red banner says so. **Export backup** saves all of it as a JSON file (it never contains the sync
key or the Gemini key); **Import backup** restores it on any device.

The data model leaves room for what's planned next: supersets (exercises sharing a group), warm-up, drop and failure
sets, RPE, programs with automatic progression (routines in a program), a plate calculator and body weight and
measurements (a new sync part).

## Development

Requires Node.js 22.

```bash
npm install
npm run dev          # local dev server
npm test             # unit tests (Vitest, jsdom)
npm run build        # typecheck, the app in dist/, and the Claude Desktop extension in dist/mcp/
npm run build:cloud  # the online connector for Vercel, in .vercel/output/
npm run test:built   # the built connectors over HTTP and stdio
npm run build:versions  # the saved design versions into dist/versions/ (after npm run build)
npm run test:e2e     # Playwright against the production build (vite preview), iPhone sizes and desktop
node scripts/validate-mcpb.mjs   # checks the extension with @anthropic-ai/mcpb, installed in a temp folder
```

Stack: [Vite](https://vite.dev) + [Preact](https://preactjs.com) + TypeScript, hash routes, no backend. The
service worker is generated at build time (`sw-template.js`): the page comes from the network first, the rest from
the cache; only an HTML answer is kept as the app page; it looks for a new version when the app comes back into view
and every hour, and offers **Reload**. Sync, crypto, the chart and the exercise library each load only when needed.

The exercise dataset is pinned: `data/free-exercise-db.json` at the commit in `data/dataset.json`, plus the
hand-made additions in `data/curation.ts` (popular list, clearer names, aliases, logging fixes, extra exercises).
`plugins/exercise-library.ts` turns them into two lazy chunks at build time. To move to a newer dataset:
`npm run dataset:update -- <commit sha>` (the build fails if a curated name disappeared).

```
src/
  app.tsx, main.tsx       routes and start-up
  screens/                Train, Workout, Summary, RoutineEditor, Library, ExerciseDetail, CustomExercise,
                          History, WorkoutView, Settings (+ Appearance, Sync, Claude, Design versions)
  components/             icons, sheets, number fields, the progress chart (lazy)
  lib/                    store, schema (validation), workout logic, stats (e1RM, records), units, timer,
                          wake lock, theme, motion, router, starters
  lib/library/            exercise catalog, loading, search
  lib/sync/               sync key and encryption, parts and merging, relay engine, device list
mcp/                      Claude connector: tools, relay sync, Desktop (stdio) and online (HTTP) servers
plugins/, data/           the exercise library build and its pinned data
tests/, e2e/              unit tests; Playwright tests (local mock relay, never public relays)
```

## Design versions

To compare designs, earlier ones stay inside the app: **Settings → Design versions** lists them, and each opens as a
preview over your own workouts, with a bar at the top that leads back.

**A preview never changes your data.** It reads what's on the device, but everything it writes goes to a separate
copy (keys starting `gym-tracker:preview:`), which the current version throws away when you come back. Sync is off in
a preview (it can't see your sync key or open a connection), and it installs no service worker, so the current
version's offline files stay as they are. The current version's service worker leaves `versions/` alone.

**Save the current design as a version** by adding its commit to `design-versions.json` (newest first), or by
tagging the commit `design-` something with a short description as the message. The next deploy includes it:

```json
{ "name": "design-v3", "commit": "<commit sha>", "label": "Bigger buttons, darker cards" }
```

```bash
git tag -a design-v3 -m "Bigger buttons, darker cards"   # or, as a tag
git push origin design-v3
```

`scripts/build-versions.mjs` builds each saved version from its own checkout (in `.versions/`, with its own
dependencies) into `dist/versions/<tag>/`, injects `scripts/preview-shim.js` at the top of its page, removes its service
worker, and writes the list to `dist/versions.json`. To go back to a saved design for good, merge or revert in git —
the tags are also the versions to return to.

## Deploy

`.github/workflows/deploy.yml` runs the unit tests, builds the app and both connectors, tests the built connectors,
validates the extension, builds the saved design versions, runs the Playwright tests and deploys `dist/` to GitHub Pages on every push to `main` (and to
the feature branch). **One-time setup:** in the repository, **Settings → Pages → Source: GitHub Actions**.

## Credits

- Exercises, instructions and photos: [free-exercise-db](https://github.com/yuhonas/free-exercise-db) by yuhonas,
  released into the public domain under the [Unlicense](https://unlicense.org). Thank you! Names, aliases and a few
  extra exercises were added here.
- Fonts: [Bricolage Grotesque](https://fonts.google.com/specimen/Bricolage+Grotesque) and
  [Figtree](https://fonts.google.com/specimen/Figtree), SIL Open Font License.
- Sync, service worker, palettes, animations and the connector come from the
  [Calorie Tracker](https://github.com/xaxaxage/Calorie-tracking-web-app).
