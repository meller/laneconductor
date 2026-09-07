# Track 10078: Track folder resolution picks a stale duplicate over the canonical INITIALS-prefixed folder

Six phases, ordered so the loop is broken before anything is cleaned up. Phase 1 must
land first: while quarantine output stays committed, every later fix is reverted by the
next checkout.

## Phase 1: Stop quarantine output from being committed (RC-2, REQ-8/9/10)

**Problem**: `quarantineStaleFolder()` renames a duplicate to `_duplicate-<name>`, and
nothing gitignores or deletes it, so routine commits capture it. 34 `_duplicate-*` and 11
`_quarantine-*` folders are in git HEAD. Any checkout restores every duplicate the
quarantine retired, which is why this problem recurred four times across sessions.

**Solution**: Make quarantine output invisible to git and to every scan, and give it a
durable log.

- [x] Task 1.1: Add `conductor/tracks/_duplicate-*/` and `conductor/tracks/_quarantine-*/`
      to `.gitignore`.
- [x] Task 1.2: `git rm -r --cached` the 34 `_duplicate-*` and 11 `_quarantine-*` folders.
      Files stay on disk; only tracking is dropped. Commit separately from any code change
      so the diff is reviewable.
- [x] Task 1.3: Widen `isTrackDirName()` (`conductor/laneconductor.sync.mjs:1921`) from
      `!name.startsWith('_duplicate-')` to `!name.startsWith('_')`. Update the comment to
      explain the rule is "underscore prefix means bookkeeping", stable against future
      quarantine prefixes.
- [x] Task 1.4: Apply the same exclusion to the other scanners that filter track dirs by
      a bare `/\d+/` or `/^\d+-/` test: `bin/lc.mjs:2138`, `:2377`, `:2647`;
      `ui/server/build-manager.mjs:142`, `:250`; `conductor/init-tracks-summary.mjs:32`;
      `scripts/summarize.mjs:8`.
- [x] Task 1.5: Append a `conductor/tracks/.quarantine-log` line (gitignored) on every
      quarantine: ISO timestamp, track number, winner, loser, and the reason
      `decideTrackFolder` gave.

**Impact**: Quarantine becomes terminal instead of self-perpetuating. `git status` stays
clean after the worker quarantines. Stale `Lane Status: running` markers in quarantined
folders stop burning `parallel_limit` slots (track 10040 Finding 2, for the prefix that
fix missed).

## Phase 2: One creation path, one convention (RC-1, REQ-1/2/3)

**Problem**: Three writers create track folders with two different conventions. `lc new`
writes `INITIALS-<n>-slug`; the UI endpoint (`ui/server/index.mjs:977`) and the worker's
file-queue handler (`conductor/laneconductor.sync.mjs:3988`) write bare `<n>-slug`. The
UI endpoint guards only on `existsSync` of the bare path, so it cannot see a prefixed
folder and creates a second one. This is the primary duplicate-creation mechanism.

**Solution**: Extract the naming decision into a shared pure helper and route all three
writers through it and through the canonical resolver.

- [ ] Task 2.1: Add `conductor/services/track-folder-name.mjs` exporting
      `buildTrackFolderName({ trackNumber, title, initials })` — slugifies the title
      identically to `lc new` and returns `INITIALS-<n>-slug`, or bare `<n>-slug` only
      when `initials` is null/empty. Pure, no I/O, mirroring `track-folder.mjs`'s style.
- [ ] Task 2.2: Add `resolveInitials()` covering the three sources in priority order:
      explicit argument, git config via `getAuthorInfo()`, DB `tracks.author` column.
- [ ] Task 2.3: Rewrite `ui/server/index.mjs`'s `/track-create` folder block to call
      `resolveTrackFolderFs` first and reuse any existing folder; only on a genuine miss
      call `buildTrackFolderName` with initials from `resolveInitials()`.
- [ ] Task 2.4: Same rewrite for `handleTrackCreate` (`conductor/laneconductor.sync.mjs`
      ~3988). It already calls `resolveTrackFolder` for the existence check, so this is
      only the naming half.
- [ ] Task 2.5: Point `lc new` (`bin/lc.mjs:2393-2397`) at the shared helper so the three
      cannot drift again.
- [ ] Task 2.6: Confirm `syncTrackToFile`'s recreate path (`ui/server/index.mjs:1662-1666`)
      uses the shared helper. Its track-10063 prefix recovery is already correct — this is
      consolidation, not a behavior change.

**Impact**: A track created from the UI and a track created from the CLI land in the same
folder. The duplicate creation mechanism is closed at the source.

## Phase 3: Resolution never silently prefers a stale duplicate (RC-3, REQ-4/5/6)

**Problem**: `readTrackStateFromBranch()` (`conductor/services/worktree-audit.mjs:90-94`)
resolves with `.find()` over sorted `git ls-tree` output, so the bare folder always wins.
Confirmed: `git ls-tree main` lists `10044-...` before `AM-10044-...`. This produced the
live 10067 misclassification.

**Solution**: Give `decideTrackFolder` an explicit prefix preference, and make the audit
path use the shared decision instead of its own `.find()`.

- [ ] Task 3.1: Add a prefix tie-break to `decideTrackFolder`
      (`conductor/services/track-folder.mjs`), ranked below registered metadata and below
      content size, above alphabetical. Preserve every existing precedence rule — tracks
      1119, 10040, and 10046 each depend on the current ordering.
- [ ] Task 3.2: Rewrite `readTrackStateFromBranch()` to collect all matching basenames and
      call `decideTrackFolder` with `registeredFolder: null` (no metadata on a bare branch
      read) rather than `.find()`ing the first.
- [ ] Task 3.3: Log a warning from `readTrackStateFromBranch()` when 2+ folders match,
      naming branch, track number, winner, and rejected names.
- [ ] Task 3.4: Extend `lc track-dir --json` to report the rejected names alongside the
      existing `matches` count.

**Impact**: The exact 10067 failure cannot recur. Ambiguity becomes visible instead of
silently resolved the wrong way.

## Phase 4: Sweep the 12 prefix-blind resolvers (RC-4, REQ-7)

**Problem**: Twelve call sites still use `startsWith(`${trackNum}-`)`, matching only the
legacy bare form. This is the AM-10046 root cause, fixed centrally but never swept. Each
site either misses a prefixed-only track entirely or picks the stale bare one.

**Solution**: Convert each to the canonical resolver, or to a shared prefix-aware matcher
where a full resolution is too heavy for the call site.

- [ ] Task 4.1: Export `trackFolderPattern(trackNumber)` from `track-folder.mjs` returning
      the canonical `^(?:[A-Za-z]+-)?<n>-` regex, so no site hand-writes it again.
- [ ] Task 4.2: Convert `conductor/measure.mjs:206` and `conductor/agent-runtime.mjs:358`,
      `:425`.
- [ ] Task 4.3: Convert the nine `bin/lc.mjs` sites: `472`, `2461`, `2490`, `2528`, `2592`,
      `2698`, `2729`, `3872`, `3932`. Prefer `resolveTrackFolderFs` where the site already
      has `tracksDir` and can afford the metadata read.
- [ ] Task 4.4: Add a guard test asserting no `startsWith(`${...}-`)` track-folder
      resolution remains outside `conductor/services/`, so the pattern cannot reappear.

**Impact**: Every resolver in the codebase answers "where is track N" the same way.

## Phase 5: Sweep the 19 existing duplicate pairs (REQ-11/12)

**Problem**: 19 unquarantined pairs exist today (10044, 10045, 10046, 10047, 10049,
10050, 10051, 10052, 10053, 10055, 10059, 10060, 10061, 10062, 10063, 10064, 10065,
10069, 1121). Track 10044 carries four folders. Manual ad-hoc quarantine is what let this
recur; the remediation has to be a reviewable script.

**Solution**: A dry-run-by-default sweep script that reports its decisions before acting.

- [ ] Task 5.1: Write `scripts/sweep-duplicate-tracks.mjs`. It enumerates duplicate
      groups, calls `resolveTrackFolderFs` for each, and prints winner, losers, per-folder
      content size, and metadata registration. `--dry-run` is the default; `--apply` acts.
- [ ] Task 5.2: Run with `--dry-run` and review all 19 groups by hand. Where content size
      and the prefix disagree about which folder is canonical, decide from the actual
      file contents and record the reason. Do not let the script auto-decide a contested
      group.
- [ ] Task 5.3: Run with `--apply`: `git rm -r --cached` the loser, delete it from disk,
      and correct `tracks-metadata.json` to name the winner.
- [ ] Task 5.4: Also retire the pre-existing `_duplicate-*` / `_quarantine-*` folders on
      disk once Phase 1 has untracked them.
- [ ] Task 5.5: Verify AC-6 — the duplicate-detection one-liner returns nothing.

**Impact**: The repo reaches a clean state that Phases 1-4 keep clean.

## Phase 6: Regression coverage (REQ, AC-7)

**Problem**: Prior fixes (10040, 10046, 10063, 1119) each landed with tests for their own
narrow case, and the symptom still returned. Coverage has to mirror the live failure
shapes, not just the internal helper.

**Solution**: Tests at the level the bugs actually occurred.

- [ ] Task 6.1: `conductor/tests/track-10078-folder-resolution.test.mjs` — build a temp
      git repo with both `10067-x/` (`Lane: plan`) and `TU-10067-x/` (`Lane: done`)
      committed, and assert `readTrackStateFromBranch()` returns `done`. Confirm it fails
      on the parent commit.
- [ ] Task 6.2: Unit tests for the prefix tie-break in `decideTrackFolder`, including that
      registered metadata and content size still outrank it.
- [ ] Task 6.3: Creation-parity test — the UI endpoint's naming path and `lc new` produce
      the identical folder name for the same number, title, and author.
- [ ] Task 6.4: Assert a `_quarantine-*` folder with `Lane Status: running` is excluded
      from `isTrackDirName` and from the parallel-limit count.
- [ ] Task 6.5: Assert quarantining leaves `git status --porcelain` clean.

**Impact**: Each of the five root causes has a test that fails without its fix.
