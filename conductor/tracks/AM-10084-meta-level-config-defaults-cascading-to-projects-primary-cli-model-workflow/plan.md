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

- [ ] Create `conductor/services/meta-defaults.mjs`:
  - `resolveMetaDefaultsPath()` — `join(META_PROJECT_REPO_PATH, 'conductor', 'meta-defaults.json')`, imported from `meta-project.mjs` (no path duplication).
  - `loadMetaDefaults()` — reads + `JSON.parse`s that path; returns `{}` on missing file or parse error (never throws), matching `conductor/defaults.json`'s existing degrade-gracefully behavior in `laneconductor.sync.mjs`.
  - `mergeEffectivePrimary({ hardcoded, metaDefaults, projectDefaults, projectConfig, inheritMetaDefaults })` — pure function implementing REQ-2's 5-tier precedence for `{ cli, model }`. `inheritMetaDefaults === false` skips the `metaDefaults` tier entirely.
  - `mergeWorkflowConfig({ projectWorkflow, metaWorkflow, globalCanonicalWorkflow, inheritMetaDefaults })` — pure deep-merge implementing REQ-3, keyed by `lanes.<lane>.<key>` and top-level `global`/`defaults` blocks. `projectWorkflow` may be `null` (no project-local file); `metaWorkflow` may be `undefined`/`{}` (no meta defaults configured, or opted out). Merge order highest-to-lowest per REQ-3; a project's own lane's own key always wins over the same key at a lower tier.
- [ ] Unit tests in `conductor/tests/track-10084-meta-defaults.test.mjs`:
  - `loadMetaDefaults()`: missing file → `{}`; malformed JSON → `{}` (no throw); valid file → parsed object.
  - `mergeEffectivePrimary`: each of the 5 tiers wins when it's the highest one with a value set; `inheritMetaDefaults: false` skips straight from project tiers to hardcoded, even when meta has a value.
  - `mergeWorkflowConfig`: project overriding one lane's one key inherits every other lane/key from meta; meta overriding a lane inherits from global-canonical for lanes meta doesn't mention; project value always wins over meta value for the same key; `inheritMetaDefaults: false` skips meta and falls straight to global-canonical.

## Phase 2: Wire into the sync worker

**Problem**: `laneconductor.sync.mjs`'s config cascade (~line 371-410) and
`loadWorkflowConfig()` (~line 1804) don't know about meta defaults yet.
**Solution**: Insert Phase 1's helpers at the right points, gated by
`inherit_meta_defaults`.

- [ ] In the `HARDCODED_DEFAULTS` → `conductor/defaults.json` →
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
- [ ] Replace `loadWorkflowConfig()`'s body: still try project-local
      `conductor/workflow.json` and the global canonical file as raw inputs
      (keep existing read logic, including the legacy `workflow.md` embedded
      block as the ultimate fallback when nothing else parses), but instead
      of "return the first one found," call `mergeWorkflowConfig()` with all
      three plus `inheritMetaDefaults` from `config.project`.
  - `workflowConfig = loadWorkflowConfig()` is re-invoked on the existing
    `conductor/workflow.json` chokidar watcher (~line 3319) — confirm the
    merge re-runs correctly on that reload path too (it does automatically,
    since `loadWorkflowConfig()` is the same function; just verify by
    running the worker and touching `conductor/workflow.json`).
- [ ] Commit: `feat(track-10084): Phase 1-2 - meta-defaults module + sync worker wiring`

## Phase 3: Wire into `bin/lc.mjs`

**Problem**: `bin/lc.mjs` independently loads `cfg.project.primary` (line
~2305) and reads `workflow.json` for `lc workflow`/`lc state` without going
through `laneconductor.sync.mjs` at all — duplicating the resolution logic
here, not reusing it, is how the two already drift (this is the same
duplication pattern noted for `computeSetupGaps` between the two files).
**Solution**: Import the same `conductor/services/meta-defaults.mjs` helpers
from Phase 1 into `bin/lc.mjs` rather than reimplementing the cascade.

- [ ] Wherever `bin/lc.mjs` reads `cfg.project.primary.cli`/`.model` to
      display or act on the *effective* value (`lc state`, `lc status`,
      the `no-provider` gap check around line 2305) — call
      `mergeEffectivePrimary` the same way sync.mjs now does, instead of
      reading `cfg.project?.primary?.cli` raw.
- [ ] `lc workflow` display command: use `mergeWorkflowConfig` so the
      table it prints reflects the same effective values the worker would
      actually use, not just whichever single file `bin/lc.mjs` happens to
      find first.
- [ ] `lc setup`'s primary-CLI prompt (the "Primary agent" step in
      `SKILL.md`'s `/laneconductor setup collection` step 4c / this file's
      corresponding wizard code in `bin/lc.mjs`): when the prompt's default
      would otherwise just be the hardcoded `'claude'`, pre-fill/suggest the
      resolved meta default instead, when a `meta-defaults.json` exists and
      the project hasn't overridden it. A blank answer still means "use the
      shown default," unchanged UX, just a better default.
- [ ] Commit: `feat(track-10084): Phase 3 - bin/lc.mjs uses shared meta-defaults resolution`

## Phase 4: `setup-gaps.mjs` — `worker_mode` + cross-project reachability

**Problem**: `computeSetupGaps` has no concept of "no dedicated worker
expected" or "verified reachable elsewhere on this instance" (REQ-5, REQ-6).
**Solution**: Extend the pure function, keeping the default path byte-for-byte
identical to today.

- [ ] `conductor/services/setup-gaps.mjs`: add `workerMode` (default
      `'dedicated'`) and `primaryProviderReachableAnywhere` (default `false`)
      params. Implement the `no-workers` → advisory
      `manager-driven-no-worker` downgrade and the `no-provider` suppression,
      exactly as specified in spec.md REQ-6.
- [ ] Extend `conductor/tests/track-10069-setup-gaps.test.mjs` (or a new
      `track-10084-setup-gaps.test.mjs` alongside it — match whichever the
      existing file's own convention suggests once you're looking at it) per
      spec.md's Acceptance Criteria: default-path parity, manager-driven +
      no worker → advisory not blocking, manager-driven + reachable-anywhere
      → no `no-provider`, manager-driven + NOT reachable-anywhere → still
      raises `no-provider` (no free pass with zero evidence).
- [ ] Commit: `feat(track-10084): Phase 4 - setup-gaps worker_mode + cross-project reachability`

## Phase 5: Wire `setup-gaps.mjs`'s new inputs into both call sites

**Problem**: The pure function is ready but nothing feeds it the new inputs
yet (REQ-7).
**Solution**: Both call sites already read other per-project markers straight
off `project.repo_path`/`cfg` — extend the same way, no DB migration.

- [ ] `ui/server/index.mjs`'s `/api/state` gap block (~line 660-690): read
      `.laneconductor.json` off `project.repo_path` (same pattern already
      used for `hasProductMd`/`hasTechStackMd`) to get
      `project.worker_mode` and `project.inherit_meta_defaults`; add a query
      `SELECT 1 FROM provider_status WHERE provider = $1 AND status =
      'available' LIMIT 1` (parameterized on `project.primary_cli`) for
      `primaryProviderReachableAnywhere`; pass both into `computeSetupGaps`.
- [ ] `bin/lc.mjs`'s equivalent gap computation (~line 2408): same wiring —
      it already has `cfg` in scope locally for `worker_mode`; add the
      equivalent `provider_status` query (via whatever DB access `lc state`
      already uses for `providers[project?.id]`) for
      `primaryProviderReachableAnywhere`.
- [ ] Manual verification against the real running instance (per spec.md's
      livingwork-specific acceptance criterion): set livingwork's
      `.laneconductor.json` to `worker_mode: manager-driven`, confirm the
      dashboard's setup gaps for livingwork no longer show `no-workers`/
      `no-provider` as blocking once `claude` has been verified reachable by
      at least one other project on this instance.
- [ ] Commit: `feat(track-10084): Phase 5 - wire worker_mode + reachability-anywhere into gap call sites`

## Phase 6: Docs

**Problem**: `workflow.md`'s Model Overrides section documents 3 tiers; this
track adds a 4th and introduces two new project-config fields nowhere
documented yet.
**Solution**: Update the doc that already owns this topic — no new doc file.

- [ ] `conductor/workflow.md`: extend "Model Overrides" with the new 4th
      (lowest) precedence tier (`conductor/meta-defaults.json`), and add a
      short subsection covering: what `meta-defaults.json` is and where it
      lives, `project.inherit_meta_defaults` (default `true`), and
      `project.worker_mode` (`dedicated` default / `manager-driven`) and how
      it changes `no-workers`/`no-provider` gap behavior. Note that both new
      fields are set via the existing generic `lc config set <key> <value>`
      — no new CLI subcommand exists or is needed.
- [ ] Commit: `docs(track-10084): document meta-level config defaults`

## Phase 7: Quality gate

- [ ] Run full `node --test` suite for touched files (`meta-defaults.mjs`,
      `setup-gaps.mjs`, plus existing sync-worker/lc.mjs integration tests
      that exercise config loading) and `cd ui && npx vitest run` for
      anything touching `ui/server/index.mjs`.
- [ ] `conductor/quality-gate.md` checklist.
- [ ] Grep for stub markers per the quality-gate protocol
      (`not yet implemented|TODO|FIXME|FFU`) in newly touched files.
