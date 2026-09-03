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

- [ ] Task 1: Write the failing tests first, per this repo's TDD
      convention (`conductor/tests/track-10016-last-run-log.test.mjs`,
      `node:test`) — TC-1 through TC-5 in `test.md`. TC-2 must fail
      against current `main` (the warning is present); TC-1 must pass
      against current `main` (guarding `edb01b0`, not re-fixing it).
- [ ] Task 2: In `conductor/laneconductor.sync.mjs`'s `spawnCli()` exit
      handler (~line 5622-5632), remove the `relLogPath` /
      `execSync('git add …')` / `catch` → `console.warn` lines. Leave
      `lastRunLogPath` and its `writeFileSync` untouched. Leave the
      hoisted `const workDir` untouched — the `if (updated)` block below
      still uses it, which is what makes AC-1 a live requirement rather
      than dead trivia.
- [ ] Task 3: Replace `edb01b0`'s now-stale F9b comment (it explains a
      `git add` that no longer exists) with one explaining why there is
      deliberately no staging here: `*.log` is ignored, this is a local
      runtime artifact, see track 10016 / `product.md`. A comment that
      describes removed code is worse than none.
- [ ] Task 4: Confirm TC-1..TC-5 all pass, and that the pre-existing
      exit-handler coverage
      (`conductor/tests/track-1102-f9-index-producer.test.mjs`) still
      passes — the index.md write/commit path shares `workDir` with the
      block being edited.

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

- [ ] Task 1: Add a `conductor/tracks/NNN-slug/last_run.log` row to
      `conductor/product.md`'s "File Roles — Separation of Concerns"
      table: written by sync worker (`spawnCli` exit handler), read by
      Claude agents (`/laneconductor implement` step 2), role = per-run
      tail of the CLI log giving the next run its failure context;
      gitignored via `*.log`, not a committed artifact — same category as
      the adjacent `conductor/.runs/<track_number>.json` row.
- [ ] Task 2: Verify no other doc asserts the opposite (grep the
      `conductor/*.md` fundamentals and `.claude/skills/laneconductor/`
      for `last_run.log`); correct anything that implies it is committed.

**Impact**: Documentation-only. Closes AC-6.

## Notes for the implementer

- **Do not** "fix" this by adding `git add -f` or a `!last_run.log`
  negation to `.gitignore`. That is `spec.md`'s explicitly Rejected
  Alternative; AC-4 and AC-5 exist to catch it.
- Phase 1 Task 1 before Task 2 — the point of writing TC-2 first is to
  see the warning actually reproduce, since this track's whole history is
  a lesson in trusting code reading over execution.
