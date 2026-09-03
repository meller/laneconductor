# Spec: last_run.log staging — scoping bug (already fixed) + the ignore-rule blocker behind it

## Problem Statement

As originally filed: `spawnCli()`'s exit handler referenced `workDir`
inside the `if (lastRunLog)` block before it was declared (`const
workDir = worktreePath || process.cwd();` lived in a later, sibling `if
(updated)` block), throwing a `ReferenceError` swallowed by an empty
`catch (e) {}` — so `last_run.log` was written to disk but never
`git add`ed.

**Planning investigation changed this picture materially.** Two findings,
both verified against the live tree, not read off the code:

### Finding A — the scoping bug is already fixed in `main`

Commit `edb01b0` ("fix(track-1102): F9b - fix workDir ReferenceError that
skipped last_run.log staging") already hoisted the declaration above both
blocks **and** replaced the empty catch with a `console.warn`.
`conductor/laneconductor.sync.mjs:5614-5632` (current `main`) reads:

```js
// Track 1102 F9b: workDir used to be declared inside the sibling
// `if (updated)` block below, so the `git add` for last_run.log ...
const workDir = worktreePath || process.cwd();

const lastRunLog = tailLog(logPath, 100);
if (lastRunLog) {
  const lastRunLogPath = join(tracksDir, trackDir, 'last_run.log');
  writeFileSync(lastRunLogPath, lastRunLog, 'utf8');
  const relLogPath = join('conductor', 'tracks', trackDir, 'last_run.log');
  try {
    execSync(`git add "${relLogPath}"`, { cwd: workDir, stdio: 'pipe' });
  } catch (e) {
    console.warn(`[${label}] Failed to stage last_run.log: ${e.message}`);
  }
}
```

That is exactly this track's original Task 1 and Task 3. Both are done,
by another track, before this one ever ran. **Nothing remains of the
originally-filed scope.**

### Finding B — the fix does not achieve REQ-2, because `last_run.log` is gitignored

`.gitignore:17` contains `*.log`, which matches `last_run.log`. Git
**refuses** to stage an explicitly-named ignored path without `-f`:

```
$ git add "conductor/tracks/x/last_run.log"
The following paths are ignored by one of your .gitignore files:
conductor/tracks/x/last_run.log
hint: Use -f if you really want to add them.
EXIT=1
```

(Reproduced in a scratch repo with only `*.log` ignored — this is git's
behavior, not a repo quirk. `git check-ignore -v` confirms the match
against the real file: `.gitignore:17:*.log`.)

Corroborating evidence that this was never a working code path: **89
`last_run.log` files exist across `conductor/tracks/` in the primary
checkout, and `git log --all -- '*last_run.log'` returns nothing** — not
one has ever been committed in the repo's entire history.

So the sequence is: pre-`edb01b0`, the `git add` died on a
`ReferenceError` into an empty catch (silent). Post-`edb01b0`, it reaches
git and dies on the ignore rule instead — into a `console.warn` that now
fires **on every run that produces log output**, which is nearly every
run. F9b correctly fixed the scoping defect but traded a silent no-op for
guaranteed per-run log noise, because the underlying call could never
have succeeded either way.

### The actual decision this track must make

REQ-2 (as originally written) presumed committing `last_run.log` is
desirable. That presumption should be rejected:

- `*.log` being ignored is deliberate, and 89-files-zero-commits shows the
  intent has held in practice.
- There is direct precedent for exactly this kind of file. `product.md`'s
  file-roles table documents `conductor/.runs/<track_number>.json` as
  "gitignored, primary checkout only … **Not a committed artifact**" — a
  per-run worker liveness marker. `last_run.log` is the same category: a
  per-run, tail-100-lines runtime artifact.
- Committing it would churn git history on every lane action and create
  routine index-level conflicts between each worktree and `main`.
- The consumer does not need git. `/laneconductor implement` step 2 reads
  `last_run.log` off the local filesystem to learn why the previous run
  failed; the unconditional `writeFileSync` already satisfies that, and it
  runs before (and independently of) the failing `git add`.

The one real cost of not committing: in `branch` mode, worktree cleanup at
merge deletes the log. That is acceptable — retries happen while the
worktree still exists; a track that reached merge has already passed
quality-gate and has no failure context left worth preserving.

## Requirements

- REQ-1: ~~`workDir` must be computed once, in a scope visible to every
  place inside this exit handler that needs it.~~ **Already satisfied by
  `edb01b0` (track 1102 F9b).** Retained only as a regression assertion —
  see AC-1.
- REQ-2: ~~`last_run.log` must actually be staged (`git add`) as part of
  the same commit as the index.md update.~~ **Withdrawn — see Finding B.**
  Superseded by REQ-3.
- REQ-3: The exit handler must stop attempting to stage `last_run.log`.
  The `git add` call and its `catch`/`console.warn` are removed, since the
  call cannot succeed under `.gitignore`'s `*.log` and its only observable
  effect today is a spurious warning on every run.
- REQ-4: `last_run.log`'s status as a deliberately-uncommitted, local
  runtime artifact must be documented, not left as tribal knowledge — a
  row in `conductor/product.md`'s file-roles table, alongside the existing
  `conductor/.runs/<track_number>.json` row it parallels.
- REQ-5: No behavior change to the write itself. `writeFileSync` of
  `last_run.log` stays exactly as-is, unconditional, before the `if
  (updated)` block — `/laneconductor implement` depends on reading it.

## Acceptance Criteria

- [ ] AC-1: `const workDir` is declared once in the exit handler, in a
      scope enclosing both the `if (lastRunLog)` and `if (updated)`
      blocks, and is not shadowed or redeclared inside either. Asserted by
      a test that parses the source, so a future refactor cannot silently
      reintroduce the original defect.
- [ ] AC-2: A real spawned worker run that produces log output completes
      with **no** `Failed to stage last_run.log` warning in the worker's
      output — the current per-run noise is gone.
- [ ] AC-3: After that same run, `last_run.log` is present on disk in the
      track folder and its content matches the tail of the run's log.
- [ ] AC-4: After that same run, `git status --porcelain` in the run's
      working directory does **not** list `last_run.log` in any state
      (neither staged nor untracked) — it is ignored, which is the
      intended end state.
- [ ] AC-5: `git check-ignore -v <track>/last_run.log` still matches
      `*.log` — i.e. the fix did not "solve" this by un-ignoring the file
      or adding a `!last_run.log` negation.
- [ ] AC-6: `conductor/product.md`'s file-roles table has a
      `conductor/tracks/NNN-slug/last_run.log` row naming the sync worker
      as writer, Claude agents (`implement`) as reader, and stating it is
      gitignored and not a committed artifact.

## Rejected Alternative

`git add -f` (plus optionally a `!last_run.log` negation in `.gitignore`)
would make staging work. **Not recommended**, for the reasons in Finding
B: it commits a per-run runtime artifact, churns history on every lane
action, and creates routine worktree↔main conflicts. If a human decides
they do want run logs committed, it should be its own track with that as
the explicit, argued goal — not smuggled in as a "fix" to a scoping bug
that is already fixed.
