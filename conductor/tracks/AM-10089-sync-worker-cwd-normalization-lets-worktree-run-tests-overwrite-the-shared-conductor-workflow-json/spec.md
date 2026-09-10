# Spec: Sync worker cwd-normalization lets worktree-run tests overwrite the shared conductor/workflow.json

## Problem Statement

`conductor/laneconductor.sync.mjs`'s startup cwd-normalization (REQ-1,
`resolvePrimaryCwdDecision` / `resolvePrimaryRepoRoot` in
`conductor/services/primary-cwd.mjs` and `conductor/services/worktree-merge.mjs`)
exists to redirect a worker that's accidentally launched from inside a
linked git worktree back to the real primary checkout. `resolvePrimaryRepoRoot(fromDir)`
runs `git rev-parse --git-dir` / `--git-common-dir` from `fromDir`; git
walks *up* the directory tree looking for the nearest `.git`, so this only
"just works" when `fromDir` is itself outside any git repo. If a test
spawns the real worker with `cwd` set to a plain, ungitted directory
**nested inside the repo** (e.g. `join(ROOT, '.test-tmp-...')`), and that
test is itself invoked from inside a track's own linked worktree
(`.worktrees/NNN/...` — exactly what happens when an `implement` or
`quality-gate` session runs its own test suite), git's directory walk
finds the *worktree's* `.git/worktrees/<name>` first. `resolvePrimaryRepoRoot`
then correctly (by its own logic) concludes the sandbox belongs to a
linked worktree and resolves the primary checkout as a different physical
directory — and the worker `process.chdir()`s straight into it before
doing any of its relative-path reads/writes of `conductor/workflow.json`,
`conductor/tracks/**`, `.laneconductor.json`, etc.

**This is not theoretical.** It happened live in this repo during this
track's own investigation: the primary checkout's `conductor/workflow.json`
(5 real lanes: plan/implement/review/quality-gate/done) was found
overwritten with a single-lane `{"implement": {...}}` mock fixture,
breaking every lane transition project-wide until restored via
`git checkout`. It happened again independently in *this worktree's own*
copy of `conductor/workflow.json` during this planning session — same
fixture shape, confirmed via `git diff` before being restored. Both
incidents match this exact mechanism: some worker-spawning test's sandbox
resolved into a git worktree instead of staying isolated.

The established, working precedent is `conductor/tests/helpers/isolated-worker.mjs`
(`makeSandbox()`/`startIsolatedWorker()`, from track 10045): the sandbox is
created via `mkdtempSync` under `os.tmpdir()` — structurally outside any
repo's working tree — and `git init -q`'d, so `resolvePrimaryRepoRoot`
always resolves it to itself; nothing to chdir out of, regardless of which
directory the *test file* physically lives in. `conductor/tests/local-fs-e2e.test.mjs`
and `conductor/tests/local-api-e2e.test.mjs` already migrated to it.
`conductor/tests/track-1084-worker-identity.test.mjs` was fixed the same
session this track was filed by giving each of its three sandboxes (TMP,
TMP_CLI, TMP_P3) their own `git init` in place (commit `2b4e32b3`) — that
file is **done**, not part of this track's remaining scope.

A repo-wide audit in that same session found **25 more test files**
spawning the real worker (`conductor/laneconductor.sync.mjs`) or
`bin/lc.mjs` against a comparable ungitted, repo-nested sandbox with
neither a `git init`, the `LC_SKIP_CWD_NORMALIZATION` escape hatch, nor
the isolated-worker helper protecting them. Each is a live vector for the
same corruption whenever it happens to run from inside a linked worktree
— which, for a track's own `implement`/`quality-gate` lane action running
`npm test`/`node --test` from `.worktrees/NNN`, is the *normal* case, not
an edge case.

## Requirements

- REQ-1: Every one of the 25 audited test files below must be made
  structurally immune to cwd-normalization redirecting their spawned
  worker/CLI process into the primary checkout — not just "usually fine",
  immune regardless of which directory (primary checkout or any linked
  worktree) the test itself is invoked from.
- REQ-2: The preferred fix is migrating the file's sandbox creation and
  worker/CLI spawn to `conductor/tests/helpers/isolated-worker.mjs`'s
  `makeSandbox()` / `startIsolatedWorker()` (or `stopWorker()` for
  teardown), matching the precedent already set by
  `local-fs-e2e.test.mjs`, `local-api-e2e.test.mjs`, and
  `track-1084-worker-identity.test.mjs`.
- REQ-3: Where full migration to the helper is impractical in one pass
  (e.g. the file spawns `bin/lc.mjs` with CLI-specific flags/prompts the
  helper doesn't model, or has bespoke multi-worker/multi-sandbox
  orchestration the helper doesn't support), the minimum acceptable fix is
  giving the file's own sandbox directory a real `git init -q` (+
  `git config user.email`/`user.name`, matching `gitInitSandbox()`'s
  shape in `track-1084-worker-identity.test.mjs`) **before** any real
  worker/CLI process is spawned against it, and moving the sandbox
  directory itself outside the repo working tree (`os.tmpdir()`) rather
  than `join(ROOT, '.test-tmp-...')` wherever that's a small change — an
  in-repo-but-git-inited sandbox is spec-compliant per REQ-1, but an
  outside-the-repo one removes an entire class of accidental
  interaction with the *worktree's own* untracked/gitignore state and is
  preferred when the diff is trivial.
- REQ-4: A comment or `.gitignore` entry alone does not satisfy REQ-1 —
  the fix must actually prevent the redirect, verified by REQ-6.
- REQ-5: No behavior change to what each test actually verifies — this is
  an isolation fix, not a test-logic change. Existing assertions,
  fixtures, and test case coverage must be preserved as-is.
- REQ-6: For at least one representative fixed file, add or extend a test
  assertion that proves the fix works under the exact failure condition
  (spawn the test's worker with the *test process's own* `cwd` set to a
  path inside a linked worktree, or equivalently assert the sandbox's
  `resolvePrimaryRepoRoot()` result equals itself) — regression coverage
  for the mechanism, not just a hope that git-init is enough.
- REQ-7: `conductor/tests/helpers/isolated-worker.mjs` itself is not
  touched by this track except if the audit (see plan.md) turns up a file
  whose needs reveal a genuine gap in the helper — in that case extending
  the helper is in scope, but only as needed by a concrete file in the
  list below, not speculatively.

## Files In Scope (from the repo-wide audit)

All paths relative to `conductor/tests/`:

- chat-reply-conversation-md.test.mjs
- track-10011-gemini-discovery.test.mjs
- track-10017-auto-run-phase7-e2e.test.mjs
- track-10020-resumed-session-unanswered-tail.test.mjs
- track-10035-direct-merge-e2e.test.mjs
- track-10035-pr-flow-e2e.test.mjs
- track-10047-bounded-resume.test.mjs
- track-10049-e2e-real-launch.test.mjs
- track-1085-dispatch-worker.test.mjs
- track-1086-session-resilience-worker.test.mjs
- track-1086-session-worker.test.mjs
- track-1087-non-claude-fallback.test.mjs
- track-1087-worker-chat-dispatch.test.mjs
- track-1089-provision-worker-dispatch.test.mjs
- track-1091-manager-worker.test.mjs
- track-1091-orphan-worker-reaping.test.mjs
- track-1110-lc-start-lock.test.mjs
- track-1110-stop-confirms-death.test.mjs
- track-1111-model-precedence.test.mjs
- track-1113-chat-coordination.test.mjs
- track-1119-phase6-e2e-autorun.test.mjs
- track-1119-wizard-dispatch.test.mjs
- track-AM-1121-marketing-tracks.test.mjs
- worker-id-watchdog.test.mjs
- worker-mode.test.mjs

**Not in scope** (already fixed, prior to this track):
`conductor/tests/track-1084-worker-identity.test.mjs` (commit `2b4e32b3`),
`conductor/tests/local-fs-e2e.test.mjs`, `conductor/tests/local-api-e2e.test.mjs`.

Note: the file-by-file audit (done during planning — see `plan.md`'s "Audit
Findings") found no false positives — all 25 genuinely spawn the real
worker/CLI against a vulnerable sandbox — but did find that 5 of them
(`track-10049-e2e-real-launch.test.mjs`,
`track-1089-provision-worker-dispatch.test.mjs`,
`track-1091-manager-worker.test.mjs`, `track-1119-wizard-dispatch.test.mjs`,
`track-AM-1121-marketing-tracks.test.mjs`) spawn the worker *exclusively* in
`--manager` mode, which is structurally immune to this specific
redirect-into-primary mechanism (`isManager` gates every
`resolvePrimaryRepoRoot()` call site the bug depends on). Those 5 are still
fixed (`plan.md` Phase 5) for hygiene/consistency, but are not part of the
live corruption vector the Acceptance Criteria below are checking for.

## Acceptance Criteria

- [ ] Every file in "Files In Scope" either (a) spawns the real
      worker/CLI exclusively via `isolated-worker.mjs`'s
      `makeSandbox()`/`startIsolatedWorker()`, or (b) has its own sandbox
      directory `git init -q`'d before any real worker/CLI spawn against
      it (the `bin/lc.mjs`-spawning files, via `makeSandbox()` alone — see
      `plan.md` Phase 4), or (c) is documented in `plan.md` with evidence
      that it does not actually spawn the real worker/CLI (false
      positive) or spawns it only in structurally-immune `--manager` mode
      (see `plan.md` Phase 5).
- [ ] `grep -rn "join(ROOT" conductor/tests/<fixed files>` shows no
      remaining ungitted-in-repo sandbox path reaching a real
      `spawn('node', [... 'laneconductor.sync.mjs' ...])` or
      `spawn('node', [... 'bin/lc.mjs' ...])` call without a preceding
      `git init` in the same file.
- [ ] Full suite for each fixed file passes: `node --test conductor/tests/<file>`.
- [ ] REQ-6's regression test (worktree-cwd repro) exists and passes.
- [ ] No orphaned worker/CLI child processes left behind by any fixed
      file's test run (`ps aux | grep laneconductor.sync.mjs` clean after
      the run — see the project's own test-hygiene incidents for why this
      matters).
- [ ] `conductor/workflow.json` in both the primary checkout and this
      track's worktree is the real 5-lane config, unmodified by running
      the fixed test suite.
