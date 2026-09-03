# Track 10016: last_run.log staging

## Planning outcome — scope changed

The originally-filed scope is **already fixed in `main`** by `edb01b0`
(track 1102 F9b): `workDir` is hoisted above both blocks, and the empty
`catch (e) {}` now logs a warning. That was Task 1 and Task 3 of the
original plan.

What planning found underneath it: `last_run.log` matches `.gitignore`'s
`*.log`, so the `git add` can never succeed — verified empirically (`git
add` on an ignored path exits 1) and corroborated by 89 `last_run.log`
files on disk with zero commits in the repo's entire history. F9b's
`console.warn` therefore fires on nearly every run. See `spec.md`
Findings A and B.

The remaining work is small and is a **cleanup of the now-dead call**,
plus documenting the file's intended status. REQ-2 (commit the log) is
withdrawn, not deferred — `spec.md`'s Rejected Alternative records why.

## Phase 1: Remove the dead `git add` and lock in the hoist

**Problem**: The `git add` for `last_run.log` cannot succeed under
`.gitignore`'s `*.log`, and since `edb01b0` it emits a
`Failed to stage last_run.log` warning on every run that produces log
output.

**Solution**: Delete the `git add` call and its now-pointless
`try`/`catch`. Keep the unconditional `writeFileSync` (REQ-5 —
`/laneconductor implement` reads this file). Add a source-level
regression assertion so the original scoping defect cannot come back.

- [x] Task 1: Write the failing tests first. **Real finding during
      implementation**: `conductor/tests/track-1102-f9b-log-staging.test.mjs`
      already existed (from `edb01b0`/F9b itself) and asserted the
      *opposite* of this track's conclusion — that `git add` must
      succeed. It only passed because its scratch fixture never wrote a
      `.gitignore`. Added a `.gitignore` with `*.log` to that fixture
      (matching production's `.gitignore:17`) and reran against
      unmodified code: reproduced live — `Failed to stage last_run.log:
      Command failed: git add …` fires, and the test's own "must be
      tracked" assertion fails. That's the red, via the strongest
      available evidence (real spawned worker, real git). Also added
      `conductor/tests/track-10016-last-run-log.test.mjs` for two fast
      static guards (TC-1, TC-6) that don't need a full worker spawn.
- [x] Task 2: Removed the `relLogPath` / `execSync('git add …')` /
      `catch` → `console.warn` lines from `spawnCli()`'s exit handler
      (`conductor/laneconductor.sync.mjs`). Left `lastRunLogPath` and its
      `writeFileSync` untouched, and left `const workDir` in place (the
      `if (updated)` block below still needs it — TC-1 guards this).
- [x] Task 3: Replaced the stale F9b comment (which described the now
      -removed `git add`) with one explaining the file is deliberately
      not staged — `*.log` is ignored, this is a local runtime artifact,
      see track 10016 / `product.md`.
- [x] Task 4: Updated `track-1102-f9b-log-staging.test.mjs`'s assertions
      to match the corrected behavior (written to disk, NOT tracked,
      `git check-ignore` matches `*.log`, no warning) and reran green.
      Also reran `track-1102-f9-index-producer.test.mjs` (unaffected,
      still green) and the new `track-10016-last-run-log.test.mjs`
      (green). All three: `pass 1/1/2, fail 0`.

**Impact**: One spurious warning per lane action disappears. No change to
what lands on disk or in git — `last_run.log` was never committed and
still isn't.

## Phase 2: Document the artifact's status

**Problem**: That `last_run.log` is intentionally uncommitted is
currently tribal knowledge. This track was filed precisely because the
code read as if committing it were the intent — the next reader will make
the same inference.

**Solution**: Give it a row in the file-roles table that already
documents its sibling artifact.

- [x] Task 1: Added the `conductor/tracks/NNN-slug/last_run.log` row to
      `conductor/product.md`'s file-roles table (written by sync worker,
      read by `/laneconductor implement`, gitignored / not committed,
      same category as `conductor/.runs/<track_number>.json`).
- [x] Task 2: Grepped `conductor/*.md` and `.claude/skills/laneconductor/`
      for `last_run.log` — only hit besides the new row is SKILL.md's
      existing "read this to see why the previous run failed", which is
      already consistent. Nothing implies it's committed.

**Impact**: Documentation-only. Closes AC-6.

## ✅ COMPLETE

Both phases done, all tests green. See the completion comment in
`conversation.md` for the full write-up, including the mid-implementation
discovery that `track-1102-f9b-log-staging.test.mjs` (existing coverage
from the original F9b fix) asserted the opposite of this track's
conclusion and needed updating, not just new coverage added alongside it.
