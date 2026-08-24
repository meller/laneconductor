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
- [ ] Task 4.2: Browser E2E verification — **still open, and now the only
      remaining gap in this track** (rate-limited on the original pass;
      re-scoped into runnable steps so whoever picks this up isn't
      guessing). Automated coverage is green: **25/25** across this
      track's suites, re-run at the end of [implement] (see plan.md
      Phase 7's verification note). What remains is the real-product
      check the quality gate requires — none of it is satisfied by the
      Vitest run above, since that exercises the Express routes directly,
      never a browser:
  - Restart the API server and the worker first (`lc api restart`,
    `lc worker restart`) — neither hot-reloads, and migration
    `008_worker_cli_model.sql`, the `provision-targets` routes, and the
    Phase 7 `/worker/start` change all postdate any long-running instance.
    Verifying against a stale process is a false pass, not a shortcut.
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
  - **New this phase** — "Start Sync Worker" (zero-worker empty state) →
    confirm the CLI/Model pickers appear, changing CLI repopulates the
    Model dropdown, and starting the worker with a non-default pair
    (e.g. Gemini) produces a worker whose first heartbeat reports
    `cli: 'gemini'` — check the started worker's `[config]` startup log
    line, not just the eventual badge (spec.md §3.4's optimistic-badge
    caveat applies here too). Also confirm `.laneconductor.json` is
    **not** touched by this action (`git diff` / mtime check) — per
    spec.md §3.3, only "Change Model" persists to disk.

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
- [x] Task 7.3 (code): **`spec.md` §3.3's launch picker was only half
      built.** "+ New Worker" (`ProvisionWorkerModal.jsx`) picks CLI + model
      and sends both in the dispatch payload — done, no change needed. The
      other launch path, the localhost-only **"Start Sync Worker"** button,
      called `handleWorkerAction('start')` → bare
      `POST /api/projects/:id/worker/start` with no body and no picker, so a
      locally-started worker still came up on whatever
      `.laneconductor.json` already contained. That was precisely the
      "CLI-only, hand-edit the file" problem in this track's own Problem
      statement, left in place on the path most likely to be used on a dev
      machine.
    - [x] 7.3a: Added a CLI + model picker (two `<select>`s) next to the
          "Start Sync Worker" button in `WorkersList.jsx`'s grid empty-state
          — the only place that button exists (verified: no second
          occurrence in the strip layout, which shows a "⚠ No worker"
          badge and no start button at all). Reuses `CLI_ENGINES` /
          `MODEL_PRESETS` re-exported from `WorkerModelModal.jsx` — no
          third model list. No project/machine selector needed here (unlike
          `ProvisionWorkerModal`) — this button starts worker #1 for
          *this* project on *this* machine; both are already fixed by
          context.
    - [x] 7.3b (**course-corrected during implementation**): the plan as
          written said "write `{ cli, model }` into `.laneconductor.json`
          before spawning." Implementing that literally would have been
          wrong: while doing so I found `bin/lc.mjs` and
          `laneconductor.sync.mjs` already have a `--cli`/`--model` CLI-flag
          mechanism (track 10011) built for exactly this case — applied
          in-memory only to the spawned process's own `config.project.primary`,
          **deliberately never persisted**, per sync.mjs's own comment:
          "this worker instance's own choice, not a change to the project
          default." `/api/projects/:id/workers/start-new` (a sibling
          endpoint, for adding additional numbered workers) already forwards
          `cli`/`model` this exact way. Writing to disk instead would have
          silently changed the **project default** for every future worker
          started from this checkout — a materially different, larger-blast
          effect than "pick this one worker's provider" — and would have
          given the single "Start Sync Worker" button (worker #1) different,
          disk-persisting semantics from its own sibling button/endpoint one
          scroll away. Implemented instead: `POST
          /api/projects/:id/worker/start` now accepts `{ cli, model }`,
          validates `cli` against the registry (`400` on an unknown engine,
          mirroring `PATCH /api/workers/:id/config`'s validation), and
          forwards them as `--cli`/`--model` args to `lc start` via
          `execFileAsync` (not `execAsync`'s shell string — same
          injection-avoidance reasoning as `/workers/start-new`, since these
          are free-text request-body values reaching a real spawned
          command). `.laneconductor.json` is untouched by this endpoint.
    - [x] 7.3c: Verified — an empty body (`{}`) produces `args = ['start']`
          with no flags added, byte-identical to the pre-Phase-7 call.
          Covered by test `TC-P7-3` below.
- [x] Task 7.4 (test): `test.md` TC-3 specified a heartbeat model-update
      test that was never written — `server/tests/track-1096-worker-cli-model.test.mjs`
      covered register / PATCH config / validation / 404, but not
      `PATCH /worker/heartbeat`. The route already handled `cli`/`model`
      correctly (confirmed again by test, not just by reading) — this was a
      coverage hole on a working path, not a bug. Added two cases, mirroring
      the existing precedent in `track-10011-providers.test.mjs`'s
      `PATCH /worker/heartbeat with cli:agy` test: one asserting a `model`
      update reaches the `UPDATE workers SET` params, one asserting that
      omitting `cli`/`model` from the heartbeat body leaves them out of the
      `SET` clause entirely (so an unrelated heartbeat can't null out a
      previously-set model).

**Verification, not just code review:** `npx vitest run
server/tests/track-1096-worker-cli-model.test.mjs
src/components/WorkerModelModal.test.jsx src/components/WorkersList.test.jsx
server/tests/track-10011-providers.test.mjs` → **25/25 pass** (9 in this
track's own suite, up from 4 — 3 new `/worker/start` cases + 2 new
heartbeat cases). Full `npm test` → **327/338 pass**; the 11 failures are in
`auth.test.mjs`, `api-routes.test.mjs`, `bug-to-test.test.mjs`,
`api-keys.test.mjs`, `track-1033-worker-auth.test.mjs` — none touched by
this track. Confirmed pre-existing, not a regression introduced here: ran
the identical `npm test` against `git stash` (this track's changes fully
reverted) and got the exact same 5 failing files / 11 failing tests before
re-applying (`git stash pop`).

**What's still open**: Task 4.2, the manual browser walkthrough. Nothing
in Phase 7 required a UI restart to verify (Vitest exercises the real
Express route via `supertest`, not a mock of it), so this remains the one
genuine gap — see plan.md's Task 4.2 checklist above for the exact steps.

**Why this [implement] run didn't attempt Task 4.2 itself:** two separate
blockers, checked rather than assumed.
1. Browser automation tooling (Playwright MCP) was unavailable in this
   session (disconnected mid-conversation per the harness's own tool
   listing).
2. Even with it available, this would not have been a safe moment to
   restart the API/worker: `ss -tlnp` showed ports 8090/8091 already bound
   by live processes — this is the shared dev stack the running
   environment (including this very orchestration session) depends on, not
   an idle instance safe to bounce unilaterally. Task 4.2's own first step
   is "restart the API server and the worker" — doing that to a stack
   other things depend on, without asking first, is exactly the kind of
   action the "check before disruptive, shared-system actions" rule exists
   for. Left for a human to run deliberately (or to confirm it's fine to
   restart) rather than done silently.

## ⚠️ PARTIAL — [implement] 2026-08-24

Phase 7 (code + tests) is done and verified (25/25 pass, confirmed no
regressions via git-stash comparison). All plan.md tasks are now checked
except Task 4.2, the manual browser E2E — open since the original
implementation pass, not new work introduced here, and not attempted this
run for the two concrete reasons recorded under Phase 7's verification
note above (no Playwright available; the shared dev stack on 8090/8091 is
live and not safe to restart unilaterally). Moving to `review` per
`workflow.json`'s `lanes.implement.on_success` — review/quality-gate
should treat Task 4.2 as the one open item still blocking `done`.
