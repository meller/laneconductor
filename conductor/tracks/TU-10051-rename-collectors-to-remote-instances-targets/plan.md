# Track TU-10051: Rename 'Collectors' to Sync Targets

Ordering rationale: Phase 1 builds the compatibility seam **first**, so every later
phase renames against a stable read path instead of hand-rolling its own fallback.
Phases 2–5 then move outward from the worker core to the CLI, API/UI, and tests.
Docs land last (Phase 6) so they describe what actually shipped.

**Mechanical rule for every phase (REQ-8):** rename by identifier, never by text
substitution. `s/collector/target/g` corrupts the `collector.laneconductor.io`
hostname and collides with the existing `--target` Jira-status flag. After each
phase, re-run the syntax check across touched dirs.

---

## Phase 1: Compatibility seam

**Problem**: `.laneconductor.json`'s `collectors` key and `.env`'s
`COLLECTOR_<n>_TOKEN` already exist on every user's disk. Config is parsed
independently in at least six places, so six ad-hoc fallbacks would drift apart.
**Solution**: One shared module owns dual-read; nothing else implements it.

- [ ] Write failing tests first (TDD): legacy-only config, new-only config, both-keys
      precedence, legacy-only env token, new-only env token, both-tokens precedence
- [ ] Create `conductor/services/sync-targets.mjs` exporting:
    - [ ] `readTargets(config)` → `config.targets ?? config.collectors ?? []` (REQ-1)
    - [ ] `writeTargets(config, targets)` → sets `targets`, `delete`s `collectors` (REQ-2)
    - [ ] `resolveTargetToken(idx)` → `TARGET_<n>_TOKEN` ?? `COLLECTOR_<n>_TOKEN` (REQ-3)
    - [ ] `resolveTargetEnv(name)` covering `PORT`/`URL`/`TOKEN_ENV`/`REACT_APP_*_URL` (REQ-4)
- [ ] Confirm all six tests pass and that nothing yet imports the module

**Impact**: Zero behavior change on its own — pure addition. Every subsequent phase
has one correct place to call.

---

## Phase 2: Worker core + shared modules

**Problem**: `laneconductor.sync.mjs` (142 refs) is the highest-traffic collector
consumer and defines `postToCollectors`/`patchCollectors`/`resolveCollectorToken`.
**Solution**: Rename its identifiers and delete its inline env fallbacks in favor of
Phase 1's helper.

- [ ] `git mv conductor/collector-client.mjs conductor/target-client.mjs` (REQ-7)
- [ ] `git mv conductor/jira-collector.mjs conductor/jira-target.mjs`; rename the
      user-visible `[jira-collector]` log prefix → `[jira-target]` (REQ-8.3)
- [ ] Update importers: `conductor/agent-runtime.mjs`, and every `scratch/*` importer
      of `jira-collector.mjs` (import path only — those scripts stay Category C)
- [ ] `laneconductor.sync.mjs`: rename REQ-6 identifiers; route token/config reads
      through `sync-targets.mjs`
- [ ] `conductor/remote-sync.mjs`: `primaryCollector` → `primaryTarget`, use helper
- [ ] `conductor/lock.mjs` + `conductor/unlock.mjs`: replace direct
      `config.collectors[0].url` reads with `readTargets(config)[0].url`
- [ ] Sweep remaining worker-side files flagged in the survey: `providers.mjs`,
      `services/done-lane-migration.mjs`, `services/orphan-worker-detection.mjs`,
      `services/session-cap.mjs`, `services/wizard-track-plan.mjs`,
      `services/worker-lock.mjs`
- [ ] **Verify for real**: start a worker against a *legacy* config+`.env` fixture and
      confirm a heartbeat lands (AC-1) — not just that the file parses
- [ ] Commit `refactor(track-10051): Phase 2 - worker core to target naming`

**Impact**: The worker speaks "target" internally while still reading legacy config.

---

## Phase 3: CLI (`bin/lc.mjs`)

**Problem**: 132 refs, and it is the component that *writes* config and `.env`, so
REQ-2/REQ-3's write-side rules live here.
**Solution**: New writes emit new names; reads go through the helper.

- [ ] Route all `cfg.collectors` reads through `readTargets()`
- [ ] Every config write path uses `writeTargets()` → emits `targets`, drops
      `collectors` (REQ-2). Covers `lc setup`, `add-target`, `remove-target`,
      `enable-target`, `disable-target`, `config mode`
- [ ] New token writes use `TARGET_<n>_TOKEN`; **assert the `.env` writer never
      rewrites or deletes an existing `COLLECTOR_*` line** (REQ-3 / AC-5)
- [ ] Rename internal identifiers (`collectors`, `collectorIdx`, `collectorUrl`, …)
- [ ] Update prompts, help text, and `lc status` output wording (AC-9)
- [ ] **Verify for real**: run `lc add-target` against a legacy fixture project;
      inspect the resulting `.laneconductor.json` and `.env` (AC-4, AC-5)
- [ ] Commit `refactor(track-10051): Phase 3 - CLI writes targets`

**Impact**: Legacy projects migrate their config the first time a user touches it,
and never lose a secret.

---

## Phase 4: API server + UI

**Problem**: `ui/server/index.mjs` has 85 refs (mostly the `collectorAuth`
middleware), and the UI actively teaches the old vocabulary.
**Solution**: Rename the middleware; rewrite every user-visible string.

- [ ] `ui/server/index.mjs`: `collectorAuth` → `targetAuth` (~20 route registrations),
      `COLLECTOR_0_TOKEN` read → helper. **Route paths are unchanged** (Category C —
      no wire-format break)
- [ ] `ui/server/logger.mjs`: component labels
- [ ] `ProjectConfigSettings.jsx`: section header `Collectors` → **Sync Targets**;
      `+ Add Collector` → `+ Add Target`; `Collector N URL` → `Target N URL`; rewrite
      the primary/mirror explanation paragraph; state key `collectors` → `targets`
      with a legacy-read fallback so an unmigrated project still renders (REQ-9)
- [ ] `CloudOnboarding.jsx`: "Collector URL" field + instruction list
- [ ] `WorkerOnboarding.jsx`: field label, the `.laneconductor.json` snippet
      (`"targets": [...]`), and the `.env` line (`TARGET_0_TOKEN`) (REQ-10)
- [ ] `App.jsx` + `TrackDetailPanel.jsx`: `collectorUrl` → `targetUrl`,
      `REACT_APP_COLLECTOR_URL` via helper. **Keep the
      `collector.laneconductor.io` hostname literal** (REQ-8.1)
- [ ] **Verify for real**: load Project Configuration in a browser, add + save a
      target, confirm it lands in `.laneconductor.json` as `targets` and the worker
      picks it up (AC-6). Restart the API server first — it does not hot-reload
- [ ] **Verify for real**: follow Worker Onboarding's instructions verbatim and
      confirm the resulting token authenticates (AC-7)
- [ ] Commit `refactor(track-10051): Phase 4 - API and UI target naming`

**Impact**: The app stops teaching two names for one thing.

---

## Phase 5: Tests and fixtures

**Problem**: The largest single share of the diff — `collectorPort` (566),
`collectorProc` (147), `startMockCollector` (93), `MOCK_COLLECTOR_PORT` (46) — is in
~70 test files.
**Solution**: Mechanical, high-volume, but low-risk; done after the source is stable
so tests are renamed against their final targets.

- [ ] `git mv conductor/tests/mock-collector.mjs conductor/tests/mock-target.mjs`;
      `startMockCollector` → `startMockTarget`; update the `[mock-collector]` stderr
      prefix and the `spawn(...)` path in every consumer
- [ ] Rename `collectorPort`/`collectorProc`/`MOCK_COLLECTOR_PORT` across
      `conductor/tests/`, `conductor/tests/helpers/`, `conductor/tests/playwright/`,
      `ui/server/tests/`, `ui/e2e/`, `playwright.config.js`
- [ ] Rename `ui/server/tests/collector-endpoints.test.mjs` → `target-endpoints.test.mjs`
- [ ] Update fixtures that hand-build `collectors` config
      (`track-1033-api-keys`, `track-10045-isolated-worker-helper`,
      `per-worker-machine-token`) — **keep at least one deliberately legacy-shaped
      fixture** to hold AC-1/AC-3 honest
- [ ] Add explicit back-compat tests for AC-1 through AC-5
- [ ] **Baseline first**: capture `main`'s failing-test-name set from a scratch
      worktree at `main`'s tip, then diff against this branch's (AC-10) — the suite
      has known environment-dependent failures, so absolute counts prove nothing
- [ ] Commit `test(track-10051): Phase 5 - rename test identifiers and fixtures`

**Impact**: Suite speaks one vocabulary; back-compat is enforced by tests, not by
hope.

---

## Phase 6: Documentation

**Problem**: Docs are where users learn the name; stale docs re-teach "collector".
**Solution**: Update after the code is final so docs describe reality.

- [ ] `.claude/skills/laneconductor/SKILL.md` — the canonical skill file. **Do not
      touch `.claude/.claude/skills/` or `.claude/.claude/.claude/skills/`** —
      quarantined duplicate folders (see commit `016f9e9`)
- [ ] `conductor/product.md` — Multi-Target Synchronization section, the target-type
      table, and the worker/target-management command list (REQ-11)
- [ ] `conductor/tech-stack.md`, `DEPLOYMENT.md`, `landing/docs/jira-integration.md`,
      `conductor/user-stories.md`
- [ ] Add a short **Migration note** documenting that `collectors`/`COLLECTOR_*` are
      still read and that no user action is required
- [ ] **Leave `docs/superpowers/specs/2026-08-07-*.md` unchanged** — dated design
      record (Category C)
- [ ] Commit `docs(track-10051): Phase 6 - target terminology`

**Impact**: One name, everywhere a user reads.

---

## Phase 7: Dead-code decision + anti-regression guard

**Problem**: `conductor/collector/index.mjs` appears unreferenced, and nothing stops
a future change from reintroducing "collector" naming.
**Solution**: Ask before deleting; automate the guard.

- [ ] **Confirm with a human** whether `conductor/collector/index.mjs` is dead
      (REQ-13). Evidence gathered: unreferenced by `bin/lc.mjs`, `Makefile`,
      `package.json`, `ui/package.json`; `ui/server/index.mjs` is the live API.
      **Default if unconfirmed: rename in place, do not delete.** Post the question
      to `conversation.md` and set `**Waiting for reply**: yes` rather than guessing
- [ ] Add a naming-guard test (REQ-12): fails on a new `collector`-cased identifier
      in `bin/`, `conductor/` (excl. tests fixtures), `ui/src/`, `ui/server/`, with
      an allowlist for Category C — the hostname, `scripts/`, `scratch/`,
      `docs/superpowers/`, and the `COLLECTOR_*` back-compat fallback literals
- [ ] Full-suite run + the AC-10 diff against `main`
- [ ] Commit `chore(track-10051): Phase 7 - naming guard`

**Impact**: The rename holds instead of eroding.

---

## Notes

- **`conductor/collector/index.mjs` is the one open decision.** It gates only
  Phase 7's delete-vs-rename choice; Phases 1–6 are unaffected.
- **No DB migration and no HTTP contract change** — both verified during planning,
  which is what keeps this a single-track refactor rather than a coordinated deploy.
- **AC-10's diff-based comparison is not optional.** This repo's worker suite has
  documented environment-dependent failures (`quality-gate.md`, track 1102); judging
  by absolute pass count would produce a false verdict in either direction.
