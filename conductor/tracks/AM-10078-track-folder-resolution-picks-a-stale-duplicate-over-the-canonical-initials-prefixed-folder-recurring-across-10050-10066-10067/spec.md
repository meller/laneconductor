# Spec: Track folder resolution picks a stale duplicate over the canonical INITIALS-prefixed folder

## Problem Statement

A track that should live in exactly one folder, `conductor/tracks/INITIALS-<n>-slug/`,
routinely ends up with a second bare `<n>-slug/` folder beside it. Code that resolves a
track number to a folder then silently picks the wrong one, because git and `readdir`
both sort `10067-...` before `TU-10067-...` (ASCII `1` < `T`) and several resolvers just
take the first match.

This is not cosmetic. It caused a confirmed live failure on 2026-09-07:
`mainHasReopenedTrackIndependently()` read main's state for track 10067 from the stale
bare folder (`Lane: plan`) instead of the canonical `TU-10067-...` one (`Lane: done`),
which masked an unrelated legitimate fix until the duplicate was quarantined by hand.

The investigation for this track found the problem is materially worse than the three
instances that prompted it.

### Measured scope

| Finding | Count |
|---|---|
| Live unquarantined duplicate pairs in `conductor/tracks/` today | 19 |
| Already-quarantined folders still committed in git | 34 `_duplicate-*` + 11 `_quarantine-*` |
| Bare `<n>-slug` folders tracked in git HEAD | 165 |
| Resolver call sites blind to the `INITIALS-` prefix entirely | 12 |

The 19 live pairs are 10044, 10045, 10046, 10047, 10049, 10050, 10051, 10052, 10053,
10055, 10059, 10060, 10061, 10062, 10063, 10064, 10065, 10069, 1121. Track 10044 has
**four** folders at once: `10044-...`, `AM-10044-...`, `_duplicate-10044-...`, and
`_duplicate-AM-10044-...`.

## Root Causes

Five distinct defects. They compound, which is why prior single-point fixes (tracks
10040, 10046, 10063, 1119) each closed one hole and the symptom kept returning.

### RC-1 — Two track-creation writers disagree on the naming convention (creation)

`lc new` derives author initials and creates `INITIALS-<n>-slug`
(`bin/lc.mjs:2393-2397`). The UI's New Track endpoint creates bare `<n>-slug`
(`ui/server/index.mjs:977-978`) with no prefix and no author lookup, and guards only on
`existsSync` of that bare path — so it cannot see an existing prefixed folder and will
happily create a second one. The worker's file-queue handler is a third writer with the
same defect (`conductor/laneconductor.sync.mjs:3988-3990`).

Any track touched by more than one of these paths gets two folders. This is the primary
creation mechanism, and it explains the observed shape exactly: bare folder from the API,
prefixed folder from the CLI or the skill following the documented convention.

### RC-2 — Quarantine is a rename, and quarantined folders are committed (recurrence)

`quarantineStaleFolder()` (`conductor/laneconductor.sync.mjs:1881-1882`) renames the
loser to `_duplicate-<name>`. Nothing ever deletes it, and it is not gitignored, so the
next routine `git add`/commit sweep captures it permanently. 34 such folders are in git
HEAD today.

The consequence is that the folder population only ever grows, and any checkout, worktree
creation, or branch switch restores every duplicate the rename was supposed to retire.
This is why the same three tracks were quarantined repeatedly across sessions and why
commit `016f9e9d`'s remediation did not hold. **Quarantine-by-rename cannot terminate the
loop while its output is a committed file.**

### RC-3 — `readTrackStateFromBranch()` takes git's alphabetical first match (resolution)

`conductor/services/worktree-audit.mjs:90-94` builds the correct
`^(?:[a-zA-Z0-9]+-)?<n>-` pattern but resolves with `.find()` over `git ls-tree` output,
which is sorted. With both folders present the bare one always wins. There is no
preference for the prefixed form, no content tie-break, and no signal that the choice was
ambiguous. This is the resolver that produced the confirmed 10067 failure. It does not
share the canonical decision logic that `decideTrackFolder()` already implements.

### RC-4 — 12 resolvers are structurally blind to the `INITIALS-` prefix (resolution)

`readdirSync(tracksDir).find(d => d.startsWith(`${trackNum}-`))` matches only the legacy
bare form. This is the exact AM-10046 root cause, fixed in `decideTrackFolder()` but
never swept from its other call sites:

- `conductor/measure.mjs:206`
- `conductor/agent-runtime.mjs:358`, `:425`
- `bin/lc.mjs:472`, `:2461`, `:2490`, `:2528`, `:2592`, `:2698`, `:2729`, `:3872`, `:3932`

Each will fail to find a prefixed-only track, or find the stale bare one when both exist.

### RC-5 — `isTrackDirName()` excludes `_duplicate-` but not `_quarantine-` (scan hygiene)

`conductor/laneconductor.sync.mjs:1921-1923` returns `/\d+/.test(name) &&
!name.startsWith('_duplicate-')`. The 11 hand-quarantined `_quarantine-*` folders contain
digits and do not start with `_duplicate-`, so every scan in the worker still treats them
as live tracks. Their markers are live-looking: `_quarantine-10049-nonprefixed-*` reads
`Lane: implement / Lane Status: queue`; `_quarantine-10066-nonprefixed-*` reads
`Lane: review / Lane Status: queue`. This reproduces track 10040's Finding 2 (a stale
folder permanently burning a lane's `parallel_limit` slot) for a prefix that fix never
covered.

## Requirements

**Creation — one writer, one convention**

- REQ-1: A single shared helper owns "what folder should a new track for number `N`
  with title `T` and author `A` be created at". `lc new`, the UI's `/track-create`
  endpoint, and the worker's `handleTrackCreate` all call it. It always produces
  `INITIALS-<n>-slug`, and falls back to bare `<n>-slug` only when no author initials can
  be derived from any source.
- REQ-2: Every creation site resolves the track number through the canonical resolver
  (`resolveTrackFolderFs`) before creating anything, never through `existsSync` of a
  single guessed path. If any folder already exists for that number under any convention,
  the creation site uses it and creates nothing.
- REQ-3: The UI `/track-create` endpoint derives author initials from the same source
  `lc new` uses (`getAuthorInfo()` / git config), falling back to the request's
  authenticated user, then to the DB `tracks.author` column.

**Resolution — never silently pick a stale duplicate**

- REQ-4: `readTrackStateFromBranch()` stops using `.find()` on the raw listing. It
  collects all matches and applies the shared decision, preferring an `INITIALS-`
  prefixed match over a bare one when both exist.
- REQ-5: `decideTrackFolder()` gains an explicit prefix preference as a tie-break, ranked
  below registered metadata and content size but above alphabetical order. A bare folder
  is never chosen over a prefixed one on alphabetical grounds alone.
- REQ-6: Ambiguity is surfaced, not swallowed. Whenever 2+ folders match a track number,
  the resolver's callers log a warning naming the number, the chosen folder, and the
  rejected ones. `lc track-dir --json` reports `matches` and the rejected names so the
  condition is inspectable without reading logs.
- REQ-7: The 12 `startsWith(`${trackNum}-`)` call sites in REQ RC-4's list are converted
  to the canonical resolver, or to a shared prefix-aware matcher where a full resolution
  is too heavy.

**Quarantine — terminate the loop**

- REQ-8: Quarantined folders are excluded from git. `conductor/tracks/_duplicate-*/` and
  `conductor/tracks/_quarantine-*/` are added to `.gitignore`, and the 34 + 11 currently
  committed ones are removed from tracking with `git rm -r --cached`. Without this, every
  other fix in this track is undone by the next checkout.
- REQ-9: `isTrackDirName()` excludes any folder whose name begins with `_`, not just
  `_duplicate-`. The rule becomes "underscore-prefixed folders are bookkeeping, never
  tracks", which is stable against future quarantine prefixes.
- REQ-10: Quarantine records what it did somewhere durable and readable — an appended
  line in a `conductor/tracks/.quarantine-log` (gitignored) naming timestamp, track
  number, winner, and loser — so a recurrence is diagnosable without git archaeology.

**Sweep**

- REQ-11: The 19 live duplicate pairs are resolved. For each, the canonical folder is
  confirmed by content and by `tracks-metadata.json`, the loser is removed from git
  tracking and from disk, and `tracks-metadata.json` is corrected to name the winner.
- REQ-12: The sweep is a script (`scripts/sweep-duplicate-tracks.mjs`), not a manual
  sequence of renames, with a `--dry-run` default so its decisions are reviewable before
  anything is touched. Ad-hoc manual quarantine is what let this recur four times.

## Acceptance Criteria

- [ ] AC-1: Creating a track for the same number via the UI endpoint and via `lc new`
      produces exactly one folder, named `INITIALS-<n>-slug`. Verified by running both
      against a temp repo and listing `conductor/tracks/`.
- [ ] AC-2: With both `10067-x/` (`Lane: plan`) and `TU-10067-x/` (`Lane: done`) present
      on a branch, `readTrackStateFromBranch()` returns `Lane: done` — the prefixed
      folder. This is the exact live 10067 failure, reproduced and fixed.
- [ ] AC-3: `lc track-dir <n>` returns the prefixed folder for every one of the 19
      affected numbers, and `--json` reports `matches > 1` where duplicates remain.
- [ ] AC-4: A `_quarantine-*` folder carrying `**Lane Status**: running` does not count
      toward its lane's `parallel_limit` and is not scanned by the auto-launch loop.
- [ ] AC-5: `git status --porcelain` is clean after the worker quarantines a duplicate —
      the quarantine leaves no new tracked file. `git ls-files conductor/tracks/ | grep
      -E '_duplicate-|_quarantine-'` returns nothing.
- [ ] AC-6: After the sweep, `ls conductor/tracks/ | grep -v '^_' | sed -E
      's/^([A-Za-z]+-)?([0-9]+)-.*/\2/' | sort | uniq -d` returns nothing.
- [ ] AC-7: The regression test from REQ/TC-1 fails against the pre-fix resolver and
      passes after — demonstrated by running it on the parent commit.

## Non-Goals

- Renaming the 146 legacy bare folders that have no prefixed twin. They are the
  documented, supported legacy convention and are not duplicates. Only genuine pairs are
  in scope.
- Changing the `INITIALS-<n>-slug` convention itself.
- Migrating `tracks-metadata.json`'s schema.

## Fundamentals Check

No conflict. `conductor/product.md` and the LaneConductor skill both document
`INITIALS-NNN-slug` as the convention and bare `NNN-slug` as supported legacy. The
documentation is correct; three creation sites simply do not follow it. This track
changes code to match the documented fundamentals, not the reverse.
