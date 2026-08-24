# Track 1096 Plan: Choose/Change Worker CLI + Model from UI

## Phase 1: Database Migration & API Server Support
- [x] Task 1.1: Create database migration (`008_worker_cli_model.sql`) adding `cli` and `model` columns to `workers` table.
- [x] Task 1.2: Update `POST /worker/register` in `ui/server/index.mjs` to receive, validate, and persist `cli` and `model`.
- [x] Task 1.3: `GET /api/workers` query includes `w.cli` and `w.model` columns.
- [x] Task 1.4: Implemented `PATCH /api/workers/:id/config` endpoint — validates CLI engine, updates `workers` table, queues `set_model` action into `worker_dispatch`.

## Phase 2: Worker Daemon Sync Engine
- [x] Task 2.1: Worker heartbeat payload includes `cli` and `model` fields (via `laneconductor.sync.mjs`).
- [x] Task 2.2: `set_model` dispatch action handler updates in-memory config on next heartbeat without restart.

## Phase 3: UI Components & Model Picker Modal
- [x] Task 3.1: Created `WorkerModelModal.jsx` with CLI engine toggle buttons (Claude, Gemini, Copilot, Antigravity) and per-provider model dropdown with preset model lists + custom model fallback.
- [x] Task 3.2: Updated `WorkersList.jsx` grid and strip layouts to render CLI icon badge + model tag on each worker card.
- [x] Task 3.3: "Change Model" button on worker cards (both grid and strip) opens `WorkerModelModal`.
- [x] Task 3.4: Modal submits to `PATCH /api/workers/:id/config`; triggers `onRefresh` callback to refresh worker list.
- [x] Task 3.5: Exported `MODEL_PRESETS` and `CLI_ENGINES` from `WorkerModelModal.jsx` for reuse in `ProvisionWorkerModal`.
- [x] Task 3.6: ~~Updated `MODEL_PRESETS` to current model IDs~~ —
      **superseded, verified this planning pass.** The hardcoded per-CLI
      lists this task described are gone. `WorkerModelModal.jsx` now does
      `import { PROVIDERS, PROVIDER_IDS, providerLabel } from
      '../../../conductor/providers.mjs'` and derives `MODEL_PRESETS` /
      `CLI_ENGINES` from the canonical registry (track 10011), re-exporting
      them under those historical names so `ProvisionWorkerModal.jsx`'s
      existing import keeps working. Adding a model is a one-file change in
      `conductor/providers.mjs`, which is the behavior spec.md §3.2 asks
      for. The model ids listed above are now stale (the registry leads with
      Claude Sonnet 5 / Opus 5) — kept struck through as history, not as a
      description of the code.

## Phase 4: Integration Testing & Verification
- [x] Task 4.1: `ui/server/tests/track-1096-worker-cli-model.test.mjs` — 4 tests pass:
  - PATCH config updates worker + queues `set_model` dispatch
  - Validates CLI engine (rejects unsupported engines)
  - Returns 404 for unknown workers
  - POST /worker/register persists CLI + model
- [ ] Task 4.2: Browser E2E verification — **still open** (rate-limited on
      the original pass; re-scoped here into runnable steps so whoever picks
      this up isn't guessing). Automated coverage is green and was re-run
      this planning pass: `npx vitest run
      src/components/WorkerModelModal.test.jsx
      server/tests/track-1096-worker-cli-model.test.mjs` → **8/8 pass**.
      What remains is the real-product check the quality gate requires:
  - Restart the API server and the worker first (`lc api restart`,
    `lc worker restart`) — neither hot-reloads, and migration
    `008_worker_cli_model.sql` plus the `provision-targets` routes postdate
    any long-running instance. Verifying against a stale process is a false
    pass, not a shortcut.
  - Workers View → confirm a card renders the CLI icon badge and model tag,
    and that the strip layout shows the compact tag.
  - "Change Model" → change model within the same CLI → Save → confirm the
    badge updates and `worker_dispatch` got a `set_model` row.
  - Confirm the worker log shows `[dispatch] set_model cli=…, model=…` and
    that `.laneconductor.json`'s `project.primary.model` was rewritten on
    disk — that on-disk write is the actual mechanism (spec.md §4.1), so
    the badge alone is not sufficient evidence.
  - "+ New Worker" → confirm the CLI/model picker populates from the
    registry (or live `available_models` when a manager reports them).

## Phase 5: UX Fixes (post-implementation)
- [x] Fix: `+ New Worker` button and `Change Model` button were not opening modals — modals were not rendered in grid layout when workers are present. Fixed by including all three modals in both grid and strip layout return blocks.
- [x] Fix: `ProvisionWorkerModal` had no model list per provider — replaced free-text input with per-CLI preset dropdown (shared from `WorkerModelModal`).
- [x] Fix: Added **Project selector** to `ProvisionWorkerModal` — fetches all projects from `/api/projects`, lets user pick which project the new remote worker will be assigned to. `target_project_id` included in dispatch payload.
- [x] Fix: Launcher worker list now shows manager workers first (preferred as SSH delegators) and includes project name for clarity.

## Phase 6 (2026-08-12): Provider vs. model — session continuity constraint

**Problem** (raised during live e2e review): the "Change Model" dialog lets
you change both the **CLI/provider** and the **model** on an existing
worker, but those aren't equivalent operations. A Claude session is resumed
via `claude --resume <claude_session_id>` (track 1086's `track_sessions`) —
that id is Claude-specific. Changing the *model* within Claude keeps
`--resume` working, so the worker keeps its conversation history. Changing
the *provider* (Claude → Gemini/Antigravity/Copilot) makes every stored
session id meaningless: there is nothing to resume, and the worker starts
cold on its next turn, silently losing continuity the user believed they
had.

Today the UI presents both dropdowns identically, with no indication that
one is lossy.

- [x] Task 6.1: Decided the rule — model is freely changeable on an
      existing worker with no extra confirmation (session ids are
      CLI-specific, so a same-provider model change never breaks
      `--resume`). Provider changes require an explicit confirm that
      names the consequence ("starts a new conversation ... history isn't
      deleted, it's available again if you switch back").
- [x] Task 6.2: Implemented in `WorkerModelModal.jsx` — `isProviderSwitch`
      compares `selectedCli` against the CLI the worker had when the modal
      opened (`originalCli`). When it differs: an amber warning banner
      names both providers and the consequence, a checkbox
      ("I understand — switch this worker to X") must be ticked, and
      `Save Configuration` is disabled until it is. Re-picking a different
      CLI resets the checkbox, so a stale confirmation can't cover a later
      choice. Model-only changes (`selectedCli === originalCli`) never
      show the banner and Save stays enabled throughout.
      `ProvisionWorkerModal.jsx` was checked and confirmed out of scope —
      it only configures brand-new workers, which have no prior session to
      lose.
- [x] Task 6.3: Confirmed by reading `buildCliArgs`
      (`conductor/laneconductor.sync.mjs` ~4143-4233) — it already handles
      a provider switch gracefully, by construction, not by luck. Session
      resolution (`resolveTrackSession`) always runs before the CLI is
      chosen, but the resolved `session` is only included in the tuple
      `buildCliArgs` returns for the `claude` branch (and the
      `LC_MOCK_CLI` test branch) — the `gemini`/`antigravity`/default
      branches return 5-element arrays with no `session` element at all.
      Downstream in `spawnCli`'s exit handler, `if (session)
      persistTrackSession(...)` is therefore only ever true for an actual
      claude spawn. Switching a worker to a non-claude provider never
      calls `persistTrackSession`, so it can't overwrite or clobber the
      track's stored `claude_session_id`; switching back to claude later
      resolves and resumes that same untouched session. No backend change
      was needed — this finding is what the UI copy above is based on
      ("isn't deleted... available again if you switch back"), instead of
      the more alarmist wording originally guessed at in Task 6.1's draft.

## Phase 7 (2026-08-24): Gaps found by verifying the spec against the code

This planning pass read the shipped code rather than the previous pass's
notes, and found three places where `spec.md` promised something the
implementation does not do. Two are doc defects (fixed in `spec.md` this
pass, no code needed); one is a genuinely unbuilt requirement.

- [x] Task 7.1 (doc): `spec.md` §3.2 named a browser mirror of the provider
      registry at `ui/src/lib/providers.js`. **That file does not exist** —
      not on `main`, not in this worktree, not in git. The real mechanism is
      a direct cross-boundary ESM import of `conductor/providers.mjs` from
      `WorkerModelModal.jsx`, which Vite and Vitest both resolve fine (the
      8/8 test run proves it). §3.2 now describes the real mechanism.
      Note: `conductor/providers.mjs`'s own header comment repeats the same
      phantom-mirror claim. That file is track 10011's, and `plan` does not
      edit code — flagged in `conversation.md` for whoever owns 10011.
- [x] Task 7.2 (doc): `spec.md` §5 claimed a three-tier model precedence
      with "Worker Runtime Assignment" between the lane override and the
      project default. `buildCliArgs` implements exactly two tiers
      (`laneConfig.primary_model ?? proj.primary?.model`), and
      `workers.cli`/`workers.model` are never read at spawn time — they are
      display columns. The `set_model` dispatch takes effect by mutating
      `config.project.primary` and rewriting `.laneconductor.json`, i.e. it
      changes the **project default**, which two workers sharing a checkout
      share. §5 and §4.1 now say so, and the open design question (should
      this be per-worker? if so it belongs with 1084/1109) is recorded there
      rather than silently answered.
- [ ] Task 7.3 (code): **`spec.md` §3.3's launch picker is only half
      built.** "+ New Worker" (`ProvisionWorkerModal.jsx`) picks CLI + model
      and sends both in the dispatch payload — done. The other launch path,
      the localhost-only **"Start Sync Worker"** button, calls
      `handleWorkerAction('start')` → bare
      `POST /api/projects/:id/worker/start` with no body and no picker, so a
      locally-started worker still comes up on whatever
      `.laneconductor.json` already contains. That is precisely the
      "CLI-only, hand-edit the file" problem in this track's own Problem
      statement, left in place on the path most likely to be used on a dev
      machine. To close it:
    - [ ] 7.3a: Give the Start button the same CLI/model picker
          `ProvisionWorkerModal` uses (reuse `CLI_ENGINES`/`MODEL_PRESETS`
          re-exported from `WorkerModelModal.jsx` — do not add a third
          copy of a model list).
    - [ ] 7.3b: Accept `{ cli, model }` on
          `POST /api/projects/:id/worker/start` and write them into the
          project's `.laneconductor.json` before spawning, so the worker
          boots on the chosen pair. This is the same write `set_model`
          performs, so the two paths stay consistent by construction.
    - [ ] 7.3c: Leaving the picker untouched must keep today's behavior
          exactly (no body → no config write → boots on existing config).
- [ ] Task 7.4 (test): `test.md` TC-3 specifies a heartbeat model-update
      test that was never written — `server/tests/track-1096-worker-cli-model.test.mjs`
      covers register / PATCH config / validation / 404, but not
      `PATCH /worker/heartbeat`. The route does handle `cli`/`model`
      (verified by reading it this pass), so this is a coverage hole on a
      working path, not a bug. Add the test.

**Scope note**: 7.3 and 7.4 are the only remaining *work*. Until they are
done this track is not at 100% and must not be marked `done` — the
done-gate exists because a track that shipped a half-built requirement and
was marked complete is the exact failure it was written for.
