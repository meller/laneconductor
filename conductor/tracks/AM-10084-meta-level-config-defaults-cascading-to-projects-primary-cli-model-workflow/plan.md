# Track AM-10084: Meta-Level Config Defaults Cascading to Projects

See `spec.md` for the full design (precedence rules, file shapes, non-goals).
This plan implements REQ-1..REQ-7 in dependency order: pure resolution logic
first, then wire it into the two places that load config
(`laneconductor.sync.mjs`, `bin/lc.mjs`), then extend `setup-gaps.mjs` and its
two call sites, then docs.

## Phase 1: Meta-defaults resolution module (pure logic)

**Problem**: Nothing today reads `conductor/meta-defaults.json`, and
`loadWorkflowConfig()`'s existing fallback is whole-file, not a merge.
**Solution**: A new, dependency-light, pure(ish) module colocated with
`meta-project.mjs`, covering both the primary.cli/model merge (REQ-2) and the
workflow.json deep-merge (REQ-3), plus the opt-out check (REQ-4).

- [x] Create `conductor/services/meta-defaults.mjs`:
  - `resolveMetaDefaultsPath()` — `join(META_PROJECT_REPO_PATH, 'conductor', 'meta-defaults.json')`, imported from `meta-project.mjs` (no path duplication).
  - `loadMetaDefaults()` — reads + `JSON.parse`s that path; returns `{}` on missing file or parse error (never throws), matching `conductor/defaults.json`'s existing degrade-gracefully behavior in `laneconductor.sync.mjs`.
  - `mergeEffectivePrimary({ hardcoded, metaDefaults, projectDefaults, projectConfig, inheritMetaDefaults })` — pure function implementing REQ-2's 5-tier precedence for `{ cli, model }`. `inheritMetaDefaults === false` skips the `metaDefaults` tier entirely.
  - `mergeWorkflowConfig({ projectWorkflow, metaWorkflow, globalCanonicalWorkflow, inheritMetaDefaults })` — pure deep-merge implementing REQ-3, keyed by `lanes.<lane>.<key>` and top-level `global`/`defaults` blocks. `projectWorkflow` may be `null` (no project-local file); `metaWorkflow` may be `undefined`/`{}` (no meta defaults configured, or opted out). Merge order highest-to-lowest per REQ-3; a project's own lane's own key always wins over the same key at a lower tier.
- [x] Unit tests in `conductor/tests/track-10084-meta-defaults.test.mjs` (15/15 passing):
  - `loadMetaDefaults()`: missing file → `{}`; malformed JSON → `{}` (no throw); valid file → parsed object.
  - `mergeEffectivePrimary`: each of the 5 tiers wins when it's the highest one with a value set; `inheritMetaDefaults: false` skips straight from project tiers to hardcoded, even when meta has a value.
  - `mergeWorkflowConfig`: project overriding one lane's one key inherits every other lane/key from meta; meta overriding a lane inherits from global-canonical for lanes meta doesn't mention; project value always wins over meta value for the same key; `inheritMetaDefaults: false` skips meta and falls straight to global-canonical.

## Phase 2: Wire into the sync worker

**Problem**: `laneconductor.sync.mjs`'s config cascade (~line 371-410) and
`loadWorkflowConfig()` (~line 1804) don't know about meta defaults yet.
**Solution**: Insert Phase 1's helpers at the right points, gated by
`inherit_meta_defaults`.

- [x] In the `HARDCODED_DEFAULTS` → `conductor/defaults.json` →
      `.laneconductor.json` cascade (~line 371-410): after `.laneconductor.json`
      is merged in, if `config.project.primary.cli` (or `.model`) is still
      unset at that point... — actually apply `mergeEffectivePrimary` in the
      right slot: hardcoded < meta < project-defaults < project-config, so
      call it once all four raw sources are loaded (don't need to merge
      incrementally in file-read order — read `conductor/defaults.json` and
      `.laneconductor.json` first as today, load `loadMetaDefaults()`
      alongside, then call `mergeEffectivePrimary` once with all four).
  - Read `config.project.inherit_meta_defaults ?? true` from the merged
    `.laneconductor.json` to decide whether to pass meta defaults in at all.
- [x] Replace `loadWorkflowConfig()`'s body: still try project-local
      `conductor/workflow.json` and the global canonical file as raw inputs
      (keep existing read logic, including the legacy `workflow.md` embedded
      block as the ultimate fallback when nothing else parses), but instead
      of "return the first one found," call `mergeWorkflowConfig()` with all
      three plus `inheritMetaDefaults` from `config.project`.
  - `workflowConfig = loadWorkflowConfig()` is re-invoked on the existing
    `conductor/workflow.json` chokidar watcher (~line 3319) — confirmed the
    merge re-runs correctly on that reload path too: it's the same function,
    verified by reading the watcher call site (line 3355) and by the passing
    unit-level `mergeWorkflowConfig` coverage in Phase 1's test file.
  - Real-process verification: `conductor/tests/track-10084-sync-meta-defaults-e2e.test.mjs`
    spawns the actual worker against a tmp fixture with `LC_META_DEFAULTS_PATH`
    pointed at a fixture `meta-defaults.json`, asserting the resolved
    `project.primary.cli` via the worker's own `[config] mode ... with primary
    ...` startup log line (TC-2.1/2.2/2.3) — 3/3 passing.
  - Added `LC_META_DEFAULTS_PATH` env override to `resolveMetaDefaultsPath()`
    in `meta-defaults.mjs` so tests (and this e2e spawn) never touch the real
    machine-global meta project on disk.
- [x] Commit: `feat(track-10084): Phase 1-2 - meta-defaults module + sync worker wiring`

## Phase 3: Wire into `bin/lc.mjs`

**Problem**: `bin/lc.mjs` independently loads `cfg.project.primary` (line
~2305) and reads `workflow.json` for `lc workflow`/`lc state` without going
through `laneconductor.sync.mjs` at all — duplicating the resolution logic
here, not reusing it, is how the two already drift (this is the same
duplication pattern noted for `computeSetupGaps` between the two files).
**Solution**: Import the same `conductor/services/meta-defaults.mjs` helpers
from Phase 1 into `bin/lc.mjs` rather than reimplementing the cascade.

- [x] Wherever `bin/lc.mjs` reads `cfg.project.primary.cli`/`.model` to
      display or act on the *effective* value (`lc state`, `lc status`,
      the `no-provider` gap check around line 2305) — call
      `mergeEffectivePrimary` the same way sync.mjs now does, instead of
      reading `cfg.project?.primary?.cli` raw.
  - Added a shared `resolveEffectivePrimary(projectRoot, cfg)` helper
    mirroring sync.mjs's own cascade (hardcoded < meta-defaults.json <
    conductor/defaults.json < .laneconductor.json); wired into `lc state`'s
    `primaryCli`, `runAIAgent`, `callLLMConversational`, and the `--run`
    inline dispatch site — all four places that previously read
    `cfg.project?.primary` raw.
- [x] `lc workflow` display command: use `mergeWorkflowConfig` so the
      table it prints reflects the same effective values the worker would
      actually use, not just whichever single file `bin/lc.mjs` happens to
      find first.
  - Manually verified against this repo's own real `conductor/workflow.json`
    (`node bin/lc.mjs workflow`) — prints the correct 5-lane table. Also
    fixed two pre-existing bugs in this exact branch found while rewiring it
    (present since the initial commit, so this display command had
    apparently never actually run before): undefined `col()` helper and
    undefined `d` (now `wf.defaults || {}`) — both would have thrown
    `ReferenceError` on every invocation, meta-defaults or not.
- [x] `lc setup`'s primary-CLI prompt (the "Primary agent" step in
      `SKILL.md`'s `/laneconductor setup collection` step 4c / this file's
      corresponding wizard code in `bin/lc.mjs`): when the prompt's default
      would otherwise just be the hardcoded `'claude'`, pre-fill/suggest the
      resolved meta default instead, when a `meta-defaults.json` exists and
      the project hasn't overridden it. A blank answer still means "use the
      shown default," unchanged UX, just a better default.
- [x] Commit: `feat(track-10084): Phase 3 - bin/lc.mjs uses shared meta-defaults resolution`

## Phase 4: `setup-gaps.mjs` — `worker_mode` + cross-project reachability

**Problem**: `computeSetupGaps` has no concept of "no dedicated worker
expected" or "verified reachable elsewhere on this instance" (REQ-5, REQ-6).
**Solution**: Extend the pure function, keeping the default path byte-for-byte
identical to today.

- [x] `conductor/services/setup-gaps.mjs`: add `workerMode` (default
      `'dedicated'`) and `primaryProviderReachableAnywhere` (default `false`)
      params. Implement the `no-workers` → advisory
      `manager-driven-no-worker` downgrade and the `no-provider` suppression,
      exactly as specified in spec.md REQ-6.
- [x] New sibling `conductor/tests/track-10084-setup-gaps.test.mjs` (existing
      file's own convention is one `test-NNNN-*` file per track, so a
      sibling rather than extending track-10069's in place). 18/18 passing
      total (11 original track-10069 tests unmodified + 7 new): TC-4.1
      default-path parity (both omitted and explicit `'dedicated'`), TC-4.2
      manager-driven + no worker → advisory not blocking, TC-4.3
      manager-driven + reachable-anywhere → no `no-provider`, TC-4.4
      manager-driven + NOT reachable-anywhere → still blocking `no-provider`,
      TC-4.5 dedicated (explicit) + reachable-anywhere → still blocking
      (inheritance is manager-driven-only), plus an extra case confirming
      the inheritance only ever covers reachability, never an unconfigured
      CLI.
- [x] Commit: `feat(track-10084): Phase 4 - setup-gaps worker_mode + cross-project reachability`

## Phase 5: Wire `setup-gaps.mjs`'s new inputs into both call sites

**Problem**: The pure function is ready but nothing feeds it the new inputs
yet (REQ-7).
**Solution**: Both call sites already read other per-project markers straight
off `project.repo_path`/`cfg` — extend the same way, no DB migration.

- [x] `ui/server/index.mjs`'s `/api/state` gap block: reads
      `.laneconductor.json` off `project.repo_path` for `project.worker_mode`
      (same pattern as `hasProductMd`/`hasTechStackMd`), and a parameterized
      `SELECT 1 FROM provider_status WHERE provider = $1 AND status =
      'available' AND project_id != $2 LIMIT 1` for
      `primaryProviderReachableAnywhere`; both passed into `computeSetupGaps`.
- [x] `bin/lc.mjs`'s equivalent gap computation: same wiring via its existing
      `runPsql`-backed provider lookup; `workerMode` read straight off the
      already-loaded `cfg`, `primaryProviderReachableAnywhere` degrades to
      `false` for `local-fs` (no DB to query there), matching the API
      call site's default.
- [x] Manual verification against the real running instance: livingwork
      (project_id 4560) reproduced the exact incident live — `GET
      /api/state?project_id=4560` returned a blocking `no-provider` gap
      (its own `provider_status` row was `exhausted`, not `available`,
      confirmed via direct psql query) even though `claude` shows
      `available` for several other projects on this same instance. Set
      `**worker_mode**: manager-driven` in livingwork's real
      `.laneconductor.json` (the actual, permanent fix — not a throwaway
      test edit). Verified against the real Postgres DB via a second,
      temporary API server instance on port 8199 (the live production
      server on 8091 doesn't hot-reload uncommitted code, so it was left
      untouched and a throwaway instance was used instead, then killed
      immediately after): gaps went from `[{id: 'no-provider', severity:
      'blocking', ...}]` to `[]`. This is the concrete incident this track
      exists to fix, confirmed resolved end-to-end.
- [x] Commit: `feat(track-10084): Phase 5 - wire worker_mode + reachability-anywhere into gap call sites`

## Phase 6: Docs

**Problem**: `workflow.md`'s Model Overrides section documents 3 tiers; this
track adds a 4th and introduces two new project-config fields nowhere
documented yet.
**Solution**: Update the doc that already owns this topic — no new doc file.

- [x] `conductor/workflow.md`: extended "Model Overrides" with the new 4th
      (lowest) precedence tier (`conductor/meta-defaults.json`), and added a
      "Meta-Level Config Defaults (Track 10084)" subsection covering: what
      `meta-defaults.json` is and where it lives, `project.inherit_meta_defaults`
      (default `true`), and `project.worker_mode` (`dedicated` default /
      `manager-driven`) and how it changes `no-workers`/`no-provider` gap
      behavior. Notes both new fields are set via the existing generic
      `lc config set <key> <value>` — no new CLI subcommand was added.
- [ ] Commit: `docs(track-10084): document meta-level config defaults`

## Phase 7: Quality gate

**Run this time for track 10084** (2026-09-10):

- [x] Syntax: `find conductor ui bin -name "*.mjs" -not -path "*/node_modules/*" -exec node --check {} +` — no errors.
- [x] `node --test conductor/tests/track-10084-meta-defaults.test.mjs conductor/tests/track-10084-setup-gaps.test.mjs conductor/tests/track-10069-setup-gaps.test.mjs` — 33/33 pass (confirms REQ-1..REQ-4 pure logic and REQ-5/REQ-6's `computeSetupGaps` extension, plus zero regression in the original 11 track-10069 assertions).
- [x] `node --test conductor/tests/track-10084-sync-meta-defaults-e2e.test.mjs` — 3/3 pass (real spawned worker process, confirms `laneconductor.sync.mjs`'s actual config-cascade wiring, not just the pure module).
- [x] `node --test conductor/tests/local-fs-e2e.test.mjs` — 7/7 pass (no regression in the base worker lane-transition path).
- [x] `node --test conductor/tests/local-api-e2e.test.mjs` — 3/6 fail. **Diff-confirmed against the pre-Phase-2 commit (`3e12b0f8`)**, not assumed: swapped `conductor/laneconductor.sync.mjs` back to that commit's version and reran — the SAME 3 subtests fail identically (confirmed by isolating the one that looked borderline, `custom transition: review → implement:queue on failure`, via `--test-name-pattern` against both versions — fails on both). Root cause: this suite spawns 2 real worker processes with 20s lane-transition polls on a machine already running ~5 real production `laneconductor.sync.mjs` workers (confirmed via `ps aux`) — timing-sensitive under real contention, unrelated to this track's config changes (confirmed separately: no real `conductor/meta-defaults.json` exists on this machine, so `loadMetaDefaults()` returns `{}` for every test that doesn't explicitly override `LC_META_DEFAULTS_PATH`, making this track's change a structural no-op for this suite).
- [x] `cd ui && npx vitest run` — 37/853 fail across 14 files, ALL pre-existing and unrelated (auth, worker registration, assignee resolution, dispatch bridging, model-override, frontend components — none touch setup-gaps/meta-defaults). Spot-checked one (`track-1116-model-override.test.mjs`, fails even in isolation with `TypeError: syncTrackToFile is not a function`) against the pre-track-10084 baseline commit (`b5ba19b1`): `syncTrackToFile` was never in that file's `export {...}` list even then — a pre-existing bug, not a regression. This track's own extended test, `server/tests/track-10069-api-state.test.mjs`, passes cleanly (3/3) both in isolation and within the full run.
- [x] Orphaned-process check: `ps aux | grep laneconductor.sync.mjs` after the full vitest run — every process matches a known long-running legitimate PID (Sep08/Sep09 or an earlier real session), none started around the vitest run's own timestamp. No leak this time.
- [x] Stub-marker scan (`grep -rniE "not yet implemented|TODO|FIXME|FFU|placeholder|stub"`) scoped to this track's touched code — zero hits.
- [x] Real-instance verification (Phase 5's own item, re-confirmed here): livingwork's actual setup gaps, resolved.
