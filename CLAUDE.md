# Gym Tracker

A workout log for the iPhone home screen (and a desktop browser): routines, a live workout one exercise per page,
history, progress and an exercise library. No backend: data is one JSON record in localStorage (`gym-tracker:v1`),
with optional end-to-end encrypted sync over Nostr and a Claude connector. General preferences for all of xaxaxage's
apps are in the app-playbook skill; this file holds what is specific to this one.

- App: https://xaxaxage.github.io/Gym-traininigs-tracking-app/ — branch `claude/gym-tracker-web-app-87lzrm`;
  every push runs `.github/workflows/deploy.yml` (tests, build, e2e, Pages deploy).
- Connector: https://gym.xaxaxage.vercel.app (`vite.cloud.config.ts`), plus a Claude Desktop extension (`.mcpb`).

## Where things are

- `src/screens/` screens · `src/components/` shared parts (`Common`, `Icons`, `Describe`) · `src/lib/` store,
  `sync/`, `theme.ts`, `workout.ts`, `progress.ts`, `describe.ts`, `ai/` (Gemini), `library/` (free-exercise-db).
- CSS: `styles.css` (tokens and base parts), `screens.css`, `workout.css` (the paged workout), `motion.css`.
- `mcp/` the connector · `plugins/exercise-library.ts` builds the exercise chunk · `tests/` Vitest · `e2e/` Playwright.

## Commands

- `npm test` · `npm run typecheck` · `npm run build` (typecheck, app and the Desktop extension).
- Before e2e: `npm run build && npm run build:versions`, then `npx playwright test` (iPhone 390/375 and desktop).
- Connector: `npm run build:cloud && npm run test:built`; `node scripts/validate-mcpb.mjs`.
- No formatter config: write single quotes, 140 columns, like the code around it. Don't run prettier with defaults.

## Decisions (newest first)

- 2026-11 Rest between sets should work like Bevel's. Waiting for their screenshots (App Store and screenshot
  galleries are blocked from cloud sessions). Recommended first step: save when each set is checked off and show
  the actual rest between sets; it changes the data model, so it needs their yes.
- 2026-10 Look: the design-v2 style plus the polish pass (see the playbook's "refined look"). Harbor is the default,
  Night with Auto. The dark "instrument" look was rejected and kept only as design-v3; Instrument and Paper stay as
  palettes. A device moved to Instrument by that release went back to Harbor once.
- `src/styles.css` `:root` must equal `paletteTokens(HARBOR)` (a unit test checks it); derive extra shades in CSS.
- Design versions are listed in `design-versions.json` (v1, v2, v3) and built into `dist/versions/`; a preview reads
  your data, keeps nothing it changes and never syncs. (Pushing git tags is refused by the proxy, so no tags.)
- Live workout: one exercise per page (swipe or arrows, a strip of segments, an overview sheet); checking off an
  exercise's last set moves on after 0.7 s; the last page has Describe, Add exercises, notes and Finish. The page
  is kept per tab (`sessionStorage`).
- Tabs: Train · History · Progress. The full exercise list opens from Progress → All exercises.
- Settings is one page with sections; `#/settings/<section>` scrolls to one.
- Add an exercise by describing it: with a Gemini key, Gemini fills in muscles, equipment, log type and the sets
  said; you check it, it's saved as your own and added as the next page. Same name → the existing one is reused.
  Without a key: matched to the list. The key syncs encrypted, is never in backups and never reaches Claude.
- Library: All or Mine. Mine = your own plus built-in exercises you've already used (so their history goes on).
  Offered once per device after three exercises of your own.
- "Done" (a set, a trained day, switches) is the theme's main color, not green.
- The rest timer counts from timestamps and shows on screen only (no alerts while the phone is locked).

## Known gaps

- The connector's `search_exercises` ignores "Mine".
- Sets have no timestamps, so actual rest and set durations aren't recorded yet.
