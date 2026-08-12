# Track 1088: Sync Worker Metadata Corruption — Bug Sprint

**Lane**: review
**Lane Status**: running
**Progress**: 100%
**Phase**: Complete
**Type**: dev
**Summary**: Fixed four sync-worker bugs corrupting Progress/Phase/Summary; found and resolved a fifth, separate structural issue (duplicate track-number folders) with an auto-remediating fix.

## Problem

While debugging a reported Summary-field truncation bug in
`conductor/laneconductor.sync.mjs`, restarting the worker to verify the fix
(which triggers chokidar's one-time `ignoreInitial: false` full rescan of
every track) surfaced three distinct, compounding bugs — all stemming from
the same root pattern: `index.md` is documented in the sync worker as "the
absolute authority for the track's state," but `Progress`/`Phase`/`Summary`
parsing silently preferred deriving values from `plan.md` instead, whenever
a `plan.md` existed.

## Fixes (committed)

1. **[b047ea6](../../../conductor/laneconductor.sync.mjs)** — `parseSummary`'s
   `**Problem**:` fallback stopped at the first newline (truncating
   multi-line paragraphs), and both branches hard-cut at 200 chars mid-word
   with no ellipsis. Fixed with a shared `truncateSummary()` helper
   (word-boundary + ellipsis) and made `index.md`'s own `**Summary**` marker
   win over deriving one from `plan.md`.
2. **edcd86f** — Same precedence bug, but for `Progress`/`Phase`: silently
   overwrote track 1052's `Progress: 100%` with a `plan.md` checkbox-derived
   `53%`, and would have nulled `current_phase` in the DB entirely (no
   null-guard on the DB write side in `ui/server/index.mjs`, unlike the
   guarded DB→file write-back path — invisible to a file diff). Fixed with
   `parseProgressMarker`/`parseCurrentPhaseMarker` (marker-only, no
   fallback), checked before falling back to `plan.md`.
3. **ee33aa0** — The marker regexes themselves used `\s*` right after the
   colon, which matches `\n`. An *empty* `**Summary**:`/`**Phase**:` marker
   followed by a blank line would greedily cross into unrelated later
   content — observed live turning three tracks' Summary into the literal
   string `"## Problem"` (the next heading, not real content). Fixed by
   restricting post-colon whitespace to `[ \t]*` (same line only), and
   treating an empty captured value as "no marker" rather than a real
   empty-string value.

**Data repair**: track 1052's DB row (`progress_percent`, `current_phase`)
was repaired via a targeted `UPDATE` after diagnosis. Its `content_summary`
was already stale before this session (unrelated to bugs 1-3 — see below).

## Duplicate track-number folders (not a code bug — separate root cause)

`conductor/tracks/1052-show-hn/` and `1052-show-hn-post/` both claimed track
number `1052`; same for `9999-hook-test/` and `9999-prod-sync-test/`. The DB
is keyed by `(project_id, track_number)` only, not folder path, so both
folders in each pair collided on one DB row — whichever the sync worker's
non-deterministic `readdirSync().find(d => d.startsWith(...))` folder lookup
picked last silently overwrote the other's data. This is what made track
1052 look like it was pulling in unrelated content during earlier diagnosis:
it was pulling from its own colliding sibling folder, not a different
project.

**Diagnosis**: cross-checked both pairs against `tracks-metadata.json` (the
canonical index per `SKILL.md`'s "Protocol: Locating Tracks") and each
folder's content/git history:
- `1052-show-hn` = canonical, real KPI-tracked HN launch history. Removed
  `1052-show-hn-post` = an abandoned 0%-progress draft, never executed.
- `9999-prod-sync-test` = canonical, clean test fixture. Removed
  `9999-hook-test` = accumulated duplicate garbage from repeated Jira-sync
  test runs (the same "test of the workflow hooks" content pattern also
  appears in unrelated `LAN-`/`KAN-` duplicate folders elsewhere in this
  repo — a known, broader Jira-sync duplication issue, out of scope here).

**Fix — [39f4138](../../../conductor/laneconductor.sync.mjs)**: added
`resolveTrackFolder(tracksDir, trackNumber)` and replaced every
`readdirSync(tracksDir).find(d => d.startsWith(...))`-style call site (~10
of them) in `conductor/laneconductor.sync.mjs` with it. On ambiguity (>1
folder matches a track number prefix), it prefers `tracks-metadata.json`'s
registered `folder_path` as canonical, then **auto-remediates** by renaming
every non-canonical match with a `_duplicate-` prefix — which structurally
can no longer match `${trackNumber}-`, so the collision is fixed once rather
than silently re-risked on every future sync cycle. Nothing is ever deleted
by this path; quarantined folders keep their full content and history.
Verified against a synthetic duplicate-folder scenario before landing.
`bin/lc.mjs` and `ui/server/index.mjs` have the same lookup pattern in a few
places but were left out of scope — noted here as a known follow-up if
similar collisions turn up there.

## Phases
- [x] Phase 1: Fix Summary truncation (mid-word cut, multi-line fallback)
- [x] Phase 2: Fix Progress/Phase precedence (plan.md silently winning over index.md)
- [x] Phase 3: Fix marker regex newline-crossing (empty marker swallowing later content)
- [x] Phase 4: Resolve duplicate track-number folders (1052, 9999) — diagnosed, removed the non-canonical duplicates, and hardened the folder-lookup code to auto-detect and auto-remediate future collisions instead of silently picking one
