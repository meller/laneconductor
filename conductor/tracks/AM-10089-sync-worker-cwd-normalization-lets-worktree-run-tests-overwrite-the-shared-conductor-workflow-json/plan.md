# Track AM-10089: Sync worker cwd-normalization lets worktree-run tests overwrite the shared conductor/workflow.json

## Audit Findings (this planning session)

A full per-file audit of the 25 files named in `index.md`'s Problem confirmed the
mechanism and refined scope:

- **`conductor/tests/track-1084-worker-identity.test.mjs` is already fixed** (commit
  `2b4e32b3`, landed before this track existed) — not touched by this plan.
- **All 24 remaining files genuinely spawn the real worker (`conductor/laneconductor.sync.mjs`)
  or `bin/lc.mjs`** against an in-repo, ungitted `join(ROOT, '.test-tmp-...')`-style
  sandbox, with no `git init`, no `LC_SKIP_CWD_NORMALIZATION`, and no
  `isolated-worker.mjs` usage. No false positives.
- **New finding, not in the original audit**: `resolvePrimaryCwdDecision` / the
  worker-lock path / `resolveConfigRoot` all gate on `isManager` (true only when
  `--manager` is in `process.argv`) — a manager-mode spawn is **structurally immune**
  to the redirect-into-primary-checkout mechanism regardless of its sandbox's git
  state, because `isManager` short-circuits every `resolvePrimaryRepoRoot()` call
  site this bug depends on (`laneconductor.sync.mjs` lines ~183, ~199, ~251, and
  `config-root.mjs`'s `resolveConfigRoot`). Grepped every `spawn(` call in the 6
  manager-touching files to confirm which spawns are manager-mode vs project-mode:
  - **Manager-only spawns (immune to REQ-1's specific bug, fixed here only for
    hygiene — see Phase 5)**: `track-10049-e2e-real-launch.test.mjs`,
    `track-1089-provision-worker-dispatch.test.mjs`,
    `track-1091-manager-worker.test.mjs`, `track-1119-wizard-dispatch.test.mjs`,
    `track-AM-1121-marketing-tracks.test.mjs` (2 manager spawns each file/one).
  - **`track-1119-phase6-e2e-autorun.test.mjs` has one of each**: `managerWorker`
    (immune) and `projectWorker` spawned with `--sync-and-work` (L169-173, no
    `--manager`) — genuinely vulnerable, fixed in Phase 3.
  - **`track-1091-orphan-worker-reaping.test.mjs` was double-checked** (name
    suggested manager involvement) — both its real spawns use `--sync-only` only,
    no `--manager` — genuinely vulnerable, fixed in Phase 3.

This does not remove anything from `spec.md`'s file list (still fixing all 25 for
consistency and because an in-repo `.test-tmp-*` dir has its own, separate hygiene
cost — see `isolated-worker.mjs`'s own comment on dirtying the checkout and
blocking `**Workspace**: main` lane actions) — it changes *priority*: Phases 1-4
fix files with a real corruption vector; Phase 5 is the same mechanical change
applied to files that were never actually exploitable by this specific bug.

**Fix pattern used throughout** (per `conductor/tests/helpers/isolated-worker.mjs`,
the track-10045/1084 precedent):
- `makeSandbox(name)` replaces `join(ROOT, '.test-tmp-...')` — returns an
  `mkdtemp`'d, `git init -q`'d directory under `os.tmpdir()`, structurally outside
  any repo.
- `startIsolatedWorker({ sandbox, args, env, collectorPort })` replaces the
  hand-rolled `spawn('node', [join(ROOT, 'conductor/laneconductor.sync.mjs'), ...])`
  wherever the file spawns `laneconductor.sync.mjs` directly — same `args`/`env`
  callers already pass, just routed through the helper.
- `stopWorker(worker)` replaces hand-rolled `SIGTERM`/`SIGKILL` teardown where one
  exists (optional — only swap if trivial; a file's own death-confirmation logic
  that's more specific than `stopWorker`'s default is preserved as-is).
- Where a file spawns `bin/lc.mjs` (not the worker script directly) —
  `startIsolatedWorker` doesn't apply (it hardcodes the worker script path) — use
  `makeSandbox()` alone for the sandbox, keep the existing manual
  `spawn('node', [LC, ...])` call, matching `track-1084`'s `TMP_CLI` precedent
  exactly.

---

## Phase 1: Single-sandbox, single-spawn files → full helper migration

**Problem**: 10 files each build one `TMP = join(ROOT, '.test-tmp-...')` and spawn
`laneconductor.sync.mjs` against it once. Simplest, most mechanical fix — do these
first to validate the pattern before the more complex phases.

**Solution**: For each file, replace the `TMP` constant and its `spawn(...)` call
site with `makeSandbox()` + `startIsolatedWorker()`; replace manual teardown with
`stopWorker()` where the file's teardown is generic (keep it as-is where the file
asserts something specific about the shutdown sequence itself).

- [ ] `chat-reply-conversation-md.test.mjs` — `TMP` L33, spawn L109-113
- [ ] `track-10011-gemini-discovery.test.mjs` — `TMP` L16, spawn L95-102
- [ ] `track-10020-resumed-session-unanswered-tail.test.mjs` — `TMP` L29, spawn L104-108
- [ ] `track-1086-session-resilience-worker.test.mjs` — `TMP` L24, spawn L124-129
- [ ] `track-1086-session-worker.test.mjs` — `TMP` L25, spawn L120-125
- [ ] `track-1087-non-claude-fallback.test.mjs` — `TMP` L21, spawn L98-102
- [ ] `track-1087-worker-chat-dispatch.test.mjs` — `TMP` L20, spawn L87-91
- [ ] `track-1111-model-precedence.test.mjs` — `TMP` L30, spawn ~L197
- [ ] `track-1113-chat-coordination.test.mjs` — `TMP` L31, spawn ~L116
- [ ] `worker-id-watchdog.test.mjs` — `TMP` L28, spawn ~L94
- [ ] **REQ-6 regression coverage**: in ONE of the above (pick
      `worker-id-watchdog.test.mjs` — smallest/simplest), add an explicit assertion
      using the helper's `waitForServingRoot()` that the worker's reported serving
      root equals the sandbox path itself, not this repo's primary checkout — proves
      the fix under the real failure condition, not just "git init exists".

**Impact**: 10 files immune to the redirect; establishes the copy-paste pattern for
Phases 2-3. Zero test-logic changes — only sandbox plumbing.

---

## Phase 2: "BASE/LOCAL stands-in-for-primary" files

**Problem**: 3 files build `BASE = join(ROOT, '.test-tmp-...')` then
`LOCAL = join(BASE, 'local')`, with `LOCAL` explicitly playing the role of "the
primary checkout the worker runs from" in the test's own scenario (per
`track-10035-direct-merge-e2e.test.mjs`'s comment at L28). Same vulnerability,
slightly different variable naming.

- [ ] `track-10017-auto-run-phase7-e2e.test.mjs` — `BASE` L43, `LOCAL` L45, spawn L187-194
- [ ] `track-10035-direct-merge-e2e.test.mjs` — `BASE` L27, `LOCAL` L28, spawn L127-134
- [ ] `track-10035-pr-flow-e2e.test.mjs` — `BASE` L38, `LOCAL` L40, spawn L189-196

**Solution**: `LOCAL` becomes the `sandbox` from `makeSandbox()` directly (it's
already meant to BE an isolated stand-in checkout — no behavior change, just where
it physically lives and its git-init state). Anything else the test builds under
`BASE` (e.g. a separate "remote" fixture) is unaffected — only replace the piece
that gets spawned into.

**Impact**: 3 files fixed; these are merge/PR-flow e2e tests, so extra care to run
each one fully (not just smoke-check) since they exercise git operations
themselves — a broken sandbox here could plausibly mask a real merge-logic bug
instead of just a test-isolation one.

---

## Phase 3: Multi-sandbox / multi-spawn files

**Problem**: 5 files either spawn the worker more than once, build more than one
sandbox dir, or both — the mechanical 1:1 swap from Phase 1 needs applying at each
call site rather than once.

- [ ] `track-1085-dispatch-worker.test.mjs` — one `TMP` (L26), two spawns (L108-113, L128-133) — same sandbox reused for both is fine, migrate the shared `TMP` once.
- [ ] `track-1091-orphan-worker-reaping.test.mjs` — two `TMP`/`TMP2`-style dirs (L98, L142), two spawns (L101-105, L145-149) — both project-mode (`--sync-only`, confirmed no `--manager`), both genuinely vulnerable, migrate independently.
- [ ] `track-10047-bounded-resume.test.mjs` — a shared local `startWorker(tmp, ...)` helper (L120-131) that every test case (tc14 L150, tc16 L199, tc17 L238, tc18 L282, tc19 L313) calls with its own `TMP`. Migrate `startWorker()` itself to call `startIsolatedWorker()` internally and have each call site pass a `makeSandbox()` result instead of its own `join(ROOT, ...)` path — one change covers all 5 call sites.
- [ ] `worker-mode.test.mjs` — 4 independent `testDir`s, each built and spawned inline per `it()` (L29/48-52, L67/87-91, L106/126-130, L147/…) — migrate each of the 4 independently (no shared helper to factor out here, per the audit).
- [ ] `track-1119-phase6-e2e-autorun.test.mjs` — spawns BOTH `managerWorker` (`--manager`, immune, L101-105) and `projectWorker` (`--sync-and-work`, no `--manager`, L169-173, **genuinely vulnerable**). Fix `TARGET_DIR` (feeding `projectWorker`) for real; fix `MANAGER_DIR` (feeding `managerWorker`) too while touching this file, since it's the same one-line change and keeps the file internally consistent — but note in the commit message that only `TARGET_DIR` was a correctness fix, `MANAGER_DIR` was hygiene.

**Impact**: 5 files fixed, including the two structurally trickiest (shared helper
function, and a mixed manager/project file).

---

## Phase 4: `bin/lc.mjs`-spawning files (helper doesn't cover CLI spawns)

**Problem**: `conductor/tests/helpers/isolated-worker.mjs`'s `startIsolatedWorker()`
hardcodes `workerScript = join(repoRoot, 'conductor/laneconductor.sync.mjs')` — it
spawns the worker script directly, not `bin/lc.mjs`. Two files spawn `bin/lc.mjs
start`/`stop` instead, and **`bin/lc.mjs` calls `resolvePrimaryRepoRoot()` directly
at several sites (worker-start, worker-stop-status), not gated by
`LC_SKIP_CWD_NORMALIZATION`** (that env var is checked only inside
`laneconductor.sync.mjs` itself — confirmed via grep, zero hits in `bin/lc.mjs`,
`primary-cwd.mjs`, or `worktree-merge.mjs`). So the escape-hatch env var alone
would NOT close this gap even if added — only `git init`-ing (or moving fully
outside the repo) the sandbox actually does.

- [ ] `track-1110-lc-start-lock.test.mjs` — `LC = join(ROOT, 'bin/lc.mjs')` L20, `TMP = join(ROOT, '.test-tmp-lc-start-lock')` L21, spawns `[LC, 'start']` L41-42 and `[LC, 'stop']` L52.
- [ ] `track-1110-stop-confirms-death.test.mjs` — `LC = join(ROOT, 'bin/lc.mjs')` L25, `TMP = join(ROOT, '.test-tmp-stop-confirms-death')` L26, spawns `[LC, 'stop']` L72.

**Solution**: replace `TMP`'s construction with `makeSandbox()` (imported from
`isolated-worker.mjs`) — do NOT use `startIsolatedWorker()` (wrong binary). Keep
every existing `spawn('node', [LC, ...], { cwd: TMP, ... })` call exactly as-is,
just pointed at the new sandbox path. Matches `track-1084-worker-identity.test.mjs`'s
`TMP_CLI` / `gitInitSandbox()` treatment precisely (that file is the working
precedent for this exact "spawns bin/lc.mjs, not the worker script" shape).

**Impact**: 2 files fixed; closes the one sub-class of this bug that the
`isolated-worker.mjs` helper's main entry point (`startIsolatedWorker`) does not
already cover, using `makeSandbox()` alone.

---

## Phase 5: Hygiene fixes — manager-only spawns (not exploitable, still worth fixing)

**Problem**: 5 files spawn the worker exclusively with `--manager`, which the audit
in this session confirmed is structurally immune to the redirect-into-primary
mechanism (see "Audit Findings" above — `isManager` gates every
`resolvePrimaryRepoRoot()` call site this bug depends on). These are NOT part of
the live corruption vector `spec.md`'s Acceptance Criteria are checking for, but
their sandboxes are still plain in-repo `.test-tmp-*` dirs with the same downsides
`isolated-worker.mjs`'s own header comment calls out (dirtying the checkout,
blocking `**Workspace**: main` lane actions on an unrelated track) — worth the same
one-line fix for consistency, at lower priority than Phases 1-4.

- [ ] `track-10049-e2e-real-launch.test.mjs` — `MANAGER_DIR` under `TMP`, spawn L111-115 (`--manager`)
- [ ] `track-1089-provision-worker-dispatch.test.mjs` — `TMP` L25, spawn L103-107 (`--manager`)
- [ ] `track-1091-manager-worker.test.mjs` — `TMP` L19, spawn ~L78 (`--manager`)
- [ ] `track-1119-wizard-dispatch.test.mjs` — `MANAGER_DIR` under `TMP` L24, spawn L95-99 (`--manager`)
- [ ] `track-AM-1121-marketing-tracks.test.mjs` — `MANAGER_DIR`/`MANAGER_DIR2`, spawns L90-94 and L255-259 (both `--manager`)

**Solution**: same `makeSandbox()` swap as Phase 1 (these can still go through
`startIsolatedWorker()` for the worker spawn itself — `--manager` is just one of
the `args` it forwards).

**Impact**: 5 files fixed. This phase may be deferred or dropped without
compromising `spec.md`'s Acceptance Criteria around real corruption risk, but
should be done in the same pass since it's mechanically identical, cheap, and
completes the "all 25" scope the track was filed against.

---

## Phase 6: Full-suite verification

- [ ] Run `node --test conductor/tests/<file>` for every one of the 24 files
      touched above, individually — confirm each still passes with its original
      assertions unchanged (REQ-5).
- [ ] `ps aux | grep laneconductor.sync.mjs` clean (no orphans) after each run —
      per this project's own test-hygiene incidents (see memory:
      `track_10073_orphaned_test_worker_incident`,
      `track_10080_vitest_leaked_primary_worker_incident`).
- [ ] `git status --porcelain` clean for `conductor/workflow.json` in both this
      worktree and (spot-check only, don't touch it) the primary checkout, after
      running the full fixed suite back-to-back from inside THIS worktree — the
      exact repro condition described in `spec.md`.
- [ ] Per REQ-8: also check `SELECT conductor_files->>'workflow_json' FROM
      projects WHERE id = 1` directly — a clean disk file is not sufficient
      proof by itself, since a prior escape can have pushed the corrupted
      content into that DB column, which then re-clobbers disk on every
      worker's next `pullWorkflow()` poll (every `LC_AUTO_LAUNCH_INTERVAL_MS`,
      default 5s) regardless of how many times disk is restored. If found
      non-null with test-fixture content, clear it (`UPDATE projects SET
      conductor_files = conductor_files - 'workflow_json' WHERE id = 1`)
      before concluding this phase's suite run left no lasting damage.
- [ ] `grep -rn "join(ROOT, '\.test-tmp" conductor/tests/` — confirm none of the 24
      fixed files still reference an in-repo sandbox path (files intentionally out
      of scope, like `track-1084-worker-identity.test.mjs` or
      `primary-root-normalization.test.mjs`, are expected to still show up here —
      the former already uses `gitInitSandbox()` on its in-repo dir, the latter
      is itself the unit test for the mechanism and deliberately builds/destroys a
      throwaway git repo in-place).
