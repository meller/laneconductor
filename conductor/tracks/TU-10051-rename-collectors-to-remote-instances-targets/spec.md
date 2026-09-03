# Spec: Rename 'Collectors' to Sync Targets

## Problem Statement

LaneConductor's sync-endpoint concept is named inconsistently across the product.
The **user-facing CLI already says "target"** — `lc add-target`, `lc list-targets`,
`lc enable-target`, `lc disable-target`, `lc remove-target`, `lc add-target-mapping` —
and `lc status` already prints `Active Targets: N sites connected`. `product.md`'s own
table header is `Target Type`.

Everything *behind* that CLI still says "collector":

| Surface | Current name |
|---|---|
| Config key in `.laneconductor.json` | `collectors: [...]` |
| Env vars in `.env` | `COLLECTOR_<n>_TOKEN`, `COLLECTOR_PORT`, `COLLECTOR_URL`, `COLLECTOR_TOKEN_ENV`, `REACT_APP_COLLECTOR_URL` |
| Worker functions | `postToCollectors`, `patchCollectors`, `resolveCollectorToken`, `getCollectorToken`, `syncTrackToCollector` |
| Shared identifiers | `primaryCollector`, `collectorAuth`, `collectorUrl`, `collectorWrite`, `collectorIdx`, `collectorHeaders`, `collectorConfig`, `activeCollectors`, `enabledCollectors` |
| Test identifiers | `collectorPort`, `collectorProc`, `startMockCollector`, `MOCK_COLLECTOR_PORT` |
| Modules | `conductor/collector-client.mjs`, `conductor/jira-collector.mjs`, `conductor/tests/mock-collector.mjs`, `conductor/collector/index.mjs` |
| UI | Project Configuration's **"Collectors"** section, `+ Add Collector`, `Collector N URL`; `CloudOnboarding` and `WorkerOnboarding` both say "Collector URL" |
| Docs | `SKILL.md`, `product.md`, `tech-stack.md`, `DEPLOYMENT.md`, `landing/docs/jira-integration.md` |

The cost is real, not cosmetic: a user who reads `lc list-targets`, then opens
`.laneconductor.json` and finds `collectors`, then opens Project Configuration and
finds a **"Collectors"** section, has to learn that three names mean one thing. The
Worker Onboarding panel actively teaches the old vocabulary — it prints a
`.laneconductor.json` snippet using `collectors` and tells the user to set
`COLLECTOR_0_TOKEN`.

## Naming Decision

**The chosen name is `target`** (prose: "sync target"), *not* "remote instance".

Rationale — this is the cheaper and less confusing of the two options in the track
title:
- The entire shipped CLI verb surface already uses it. Choosing "remote instance"
  would mean renaming `lc add-target` → `lc add-remote-instance` and breaking every
  documented command, turning a refactor into a breaking CLI change.
- `product.md`'s target-type table already uses it.
- It is shorter and reads correctly in both directions (`postToTargets`,
  `TARGET_0_TOKEN`, "Sync Targets").

"Remote instance" is also imprecise: a `local-api` target at `localhost:8091` is not
remote.

**Open question for human confirmation (see REQ-11):** this decision is recorded here
rather than assumed. If "remote instance" is preferred, only Phase 1's vocabulary
constant changes and the remaining phases follow mechanically — but the CLI verbs
would then also need deprecation aliases, which is out of this track's scope as
written.

## Requirements

### Compatibility boundary (the core of this track)

Renames split into three categories. **This split is the spec** — treating them
uniformly is what would break users.

**Category A — free renames.** Internal identifiers and module filenames. No
compatibility surface; rename outright.

**Category B — dual-read, single-write.** Names that already exist on users' disks.
Read both old and new; write only new; never rewrite a user's file to force
migration.

**Category C — out of scope.** Not renamed by this track.

- **REQ-1** — Config key `collectors` → `targets` (Category B). Config readers MUST
  accept `targets ?? collectors`, preferring `targets` when both are present. A
  project whose `.laneconductor.json` still says `collectors` MUST keep working with
  zero user action.
- **REQ-2** — Any code path that *writes* `.laneconductor.json` MUST emit `targets`
  and MUST drop the `collectors` key in the same write (opportunistic migration on
  a write the user already triggered — never a standalone rewrite pass over their
  file).
- **REQ-3** — Token env vars `COLLECTOR_<n>_TOKEN` → `TARGET_<n>_TOKEN` (Category B).
  Resolution MUST try `TARGET_<n>_TOKEN` first, then fall back to
  `COLLECTOR_<n>_TOKEN`. **The worker MUST NOT rewrite the user's `.env`** — these
  tokens also live in CI secrets and GCP Secret Manager entries that this codebase
  cannot reach. New tokens written by `lc setup` / `lc add-target` use the new name.
- **REQ-4** — Same dual-read treatment for `COLLECTOR_PORT`, `COLLECTOR_URL`,
  `COLLECTOR_TOKEN_ENV`, and `REACT_APP_COLLECTOR_URL`.
- **REQ-5** — A single shared normalization helper owns REQ-1/3/4. Config is
  currently parsed independently in at least six places (`bin/lc.mjs`,
  `conductor/laneconductor.sync.mjs`, `conductor/lock.mjs`, `conductor/unlock.mjs`,
  `conductor/collector/index.mjs`, `ui/src/pages/ProjectConfigSettings.jsx`); six
  hand-rolled fallbacks would drift. All server-side readers MUST route through it.

### Rename scope

- **REQ-6** — Rename Category A identifiers across `bin/`, `conductor/`, `ui/`:
  `getCollectors`→`getTargets`, `postToCollectors`→`postToTargets`,
  `patchCollectors`→`patchTargets`, `resolveCollectorToken`→`resolveTargetToken`,
  `getCollectorToken`→`getTargetToken`, `syncTrackToCollector`→`syncTrackToTarget`,
  `primaryCollector`→`primaryTarget`, `collectorAuth`→`targetAuth`,
  `collectorUrl`→`targetUrl`, `collectorWrite`→`targetWrite`,
  `collectorIdx`→`targetIdx`, `collectorHeaders`→`targetHeaders`,
  `collectorConfig`→`targetConfig`, `activeCollectors`/`enabledCollectors`→
  `activeTargets`/`enabledTargets`, `collectorPort`→`targetPort`,
  `collectorProc`→`targetProc`, `startMockCollector`→`startMockTarget`,
  `MOCK_COLLECTOR_PORT`→`MOCK_TARGET_PORT`.
- **REQ-7** — Rename modules and update every importer:
  `conductor/collector-client.mjs`→`conductor/target-client.mjs`,
  `conductor/jira-collector.mjs`→`conductor/jira-target.mjs`,
  `conductor/tests/mock-collector.mjs`→`conductor/tests/mock-target.mjs`.
  Use `git mv` so history follows the file.
- **REQ-8** — **The rename MUST be identifier-scoped, never a text-wide
  `s/collector/target/g`.** Three things a blind substitution corrupts, all present
  in this repo:
  1. The hostname `collector.laneconductor.io` (`ui/src/App.jsx:841`,
     `WorkerOnboarding.jsx:12`, `CloudOnboarding`) — a real DNS name, Category C.
  2. `lc add-target-mapping --target "<jira_status>"` — an existing flag where
     `target` already means *Jira status*, a different concept. Renaming toward
     `target` must not collide with it; the Jira status flag keeps its meaning and
     the module rename must not introduce a second `--target`.
  3. Log prefixes like `[jira-collector]` are user-visible in `lc worker logs` and
     must be renamed deliberately, not incidentally.
- **REQ-9** — No user-visible string in the running app says "Collector". Covers
  Project Configuration's section header, `+ Add Collector` button, `Collector N URL`
  labels and the explanatory paragraph under them; `CloudOnboarding`'s "Collector
  URL" field and its numbered instructions; `WorkerOnboarding`'s "Collector URL"
  field, its `.laneconductor.json` snippet, and its `.env` instruction line.
- **REQ-10** — `WorkerOnboarding`'s copy-paste snippets MUST teach the new names
  (`targets`, `TARGET_0_TOKEN`) — this panel is how users learn the vocabulary, and
  a token pasted from it MUST actually authenticate.
- **REQ-11** — Terminology in `conductor/product.md` and `conductor/tech-stack.md`
  is updated to match. These are fundamental docs; see the Fundamentals Conflict
  note below — a human confirms the vocabulary before this phase lands.
- **REQ-12** — An anti-regression check fails if a new `collector`-cased identifier
  is introduced into live source, with an explicit allowlist for Category C
  (hostnames, historical migration scripts, `docs/superpowers/specs/` design
  records, and any `.env` back-compat fallback literals).

### Explicitly out of scope (Category C)

- **HTTP wire format.** Verified: no route path contains "collector"
  (`ui/server/index.mjs` — `collectorAuth` is a *middleware variable*, Category A).
  No client/server contract changes; workers on old builds keep talking to new
  servers and vice versa.
- **Database.** Verified: no table or column is named for collectors
  (`prisma/schema.prisma`, `migrations/`). No migration is needed.
- **The `collector.laneconductor.io` hostname** and any deployed DNS/Firebase config.
- **`scratch/*.mjs`** one-off debugging scripts and `scripts/merge-apis.js` /
  `scripts/replace-collector-calls.js`, which are historical migration tooling, not
  shipped product.
- **`docs/superpowers/specs/2026-08-07-*.md`** — a dated design record; renaming it
  would falsify history.

### Deferred with a decision point

- **REQ-13** — `conductor/collector/index.mjs` appears to be **dead code**: nothing
  in `bin/lc.mjs`, `Makefile`, `package.json`, or `ui/package.json` references it,
  and `ui/server/index.mjs` is the live API (`scripts/merge-apis.js` suggests the
  two were merged). Its status MUST be confirmed with a human before Phase 7 acts.
  Default action if unconfirmed: rename in place like any other module and leave it
  alone. Deleting it is a separate decision, not this track's to make silently.

## Acceptance Criteria

Each criterion is a user-observable outcome. **None is satisfiable by a stub.**

- [ ] **AC-1** — An existing project whose `.laneconductor.json` still contains
      `collectors` and whose `.env` still contains `COLLECTOR_0_TOKEN` starts its
      worker, authenticates, and syncs a track edit through to the Kanban board with
      **zero user action and zero warnings that demand one**.
- [ ] **AC-2** — A project using the new `targets` key + `TARGET_0_TOKEN` does the
      same.
- [ ] **AC-3** — A project with *both* keys present uses `targets` and ignores
      `collectors`.
- [ ] **AC-4** — Running `lc add-target --url ...` against a legacy project leaves
      `.laneconductor.json` with a `targets` array, no `collectors` key, and a
      working sync afterward.
- [ ] **AC-5** — Running the worker against a legacy `.env` leaves that `.env`
      byte-identical (no silent secret rewriting).
- [ ] **AC-6** — Project Configuration shows a **"Sync Targets"** section; adding,
      editing, and saving a target persists to `.laneconductor.json` under `targets`
      and the worker picks the change up.
- [ ] **AC-7** — Worker Onboarding's snippet shows `"targets": [...]` and
      `TARGET_0_TOKEN`, and a token configured exactly as instructed authenticates
      against the API (verified by an actual authenticated request, not by reading
      the code).
- [ ] **AC-8** — `grep -rniE '\bcollector' ui/src` returns only the
      `collector.laneconductor.io` hostname — no labels, headings, buttons, or
      instruction text.
- [ ] **AC-9** — `lc status`, `lc list-targets`, `lc worker logs` output and all
      `lc --help` text use "target" consistently; no command output says "collector".
- [ ] **AC-10** — The worker test suite is no worse than `main`'s on the same
      commit, compared by **diffing the failing-test-name sets** against a scratch
      worktree at `main`'s tip — not by absolute pass count. (This repo's suite has
      known environment-dependent failures; see `quality-gate.md`.)
- [ ] **AC-11** — REQ-12's anti-regression check passes and is wired into the test
      suite.

## Data Model Changes

None. No schema migration — verified against `prisma/schema.prisma` and
`migrations/`.

## Fundamentals Conflict (flagged per plan step 5b)

⚠️ This track requires editing two fundamental docs — `conductor/product.md` (which
currently says "you configure individual **Collectors** in `.laneconductor.json`"
directly above a table whose header is already `Target Type`) and
`conductor/tech-stack.md`. Those edits are the track's intended deliverable rather
than an unexpected conflict, but the **vocabulary choice itself** is a project-wide
decision, so it is surfaced for review rather than made silently. Non-blocking:
planning continues, and Phase 6 carries the doc edits. See the conversation thread.
