# Plan: Sync Worker Metadata Corruption — Bug Sprint (Track 1088)

## Phase 1: Fix Summary Truncation

**Problem**: `parseSummary`'s `**Problem**:` fallback stopped at the first
newline, truncating multi-line paragraphs; both branches hard-cut at 200
chars mid-word with no ellipsis.
**Solution**: Shared `truncateSummary()` helper (word-boundary + ellipsis);
capture the full paragraph in the fallback regex; make `index.md`'s own
`**Summary**` marker win over deriving one from `plan.md`.

- [x] Task 1: Add `truncateSummary(text, maxLen)` — word-boundary cut + ellipsis
- [x] Task 2: Fix `**Problem**:` fallback regex to capture full multi-line paragraph
- [x] Task 3: Prefer `stateContent`'s own Summary marker over `plan.md`-derived value
- [x] Task 4: Verified against real corrupted tracks (1042, 1062, 1067, etc.)

**Commit**: b047ea6

## Phase 2: Fix Progress/Phase Precedence

**Problem**: Same root cause as Phase 1 — `primaryInfo = planContent ||
stateContent` meant `parseProgress`/`parseCurrentPhase` always preferred
`plan.md`, silently overwriting `index.md`'s explicit `**Progress**`/
`**Phase**` markers. Confirmed live: track 1052's `Progress: 100%` got
overwritten with a `plan.md` checkbox-derived `53%`; `current_phase` would
have been nulled in the DB entirely (no null-guard on that write path).
**Solution**: `parseProgressMarker`/`parseCurrentPhaseMarker` (marker-only,
no fallback), checked before falling back to `plan.md`-derived values.

- [x] Task 1: Add `parseProgressMarker`/`parseCurrentPhaseMarker`
- [x] Task 2: Update call site to check `stateContent`'s marker first for all three fields
- [x] Task 3: Verified fix against 1052's actual files (correct 100%/"KPI Window..." output)
- [x] Task 4: Diagnosed and repaired 1052's DB row via targeted `UPDATE`

**Commit**: edcd86f

## Phase 3: Fix Marker Regex Newline-Crossing

**Problem**: The marker regexes used `\s*` right after the colon — `\s`
matches `\n`, so an empty `**Summary**:`/`**Phase**:` marker followed by a
blank line would greedily cross into unrelated later content. Observed live:
three tracks' Summary became the literal string `"## Problem"` (the next
heading, not real content).
**Solution**: Restrict post-colon whitespace to `[ \t]*` (same line only);
treat an empty captured value as "no marker" so the caller falls back
correctly instead of latching an empty/wrong value.

- [x] Task 1: Change `\s*` → `[ \t]*` in all three marker regexes
- [x] Task 2: Treat empty captured value as null in `parseSummaryMarker`/`parseCurrentPhaseMarker`
- [x] Task 3: Verified against 1028/1034/1064 (previously produced `"## Problem"`, now correctly `null`)

**Commit**: ee33aa0

## Phase 4: Duplicate Track-Number Folders

**Problem**: `1052-show-hn`/`1052-show-hn-post` and
`9999-hook-test`/`9999-prod-sync-test` each share a numeric track-number
prefix. The DB is keyed by `(project_id, track_number)` only — no
folder-path component — so both folders in each pair collided on one DB
row, with `readdirSync(tracksDir).find(d => d.startsWith(...))`
non-deterministically picking whichever one to read/write on any given
call.
**Solution**: Diagnose canonical vs. duplicate per pair using
`tracks-metadata.json` + content/git history; remove the duplicates; add
`resolveTrackFolder()` and apply it at every lookup call site so future
collisions are auto-detected and auto-remediated rather than silently
picked.

- [x] Task 1: Cross-check both pairs against `tracks-metadata.json`'s registered `folder_path`
- [x] Task 2: Confirm via content/git history which folder in each pair is canonical vs. abandoned/garbage
- [x] Task 3: Remove `1052-show-hn-post` and `9999-hook-test`
- [x] Task 4: Add `resolveTrackFolder(tracksDir, trackNumber)` — prefers `tracks-metadata.json`'s canonical folder on ambiguity, auto-renames non-canonical matches with a `_duplicate-` prefix, updates the metadata index
- [x] Task 5: Replace all ~10 `readdirSync(tracksDir).find(d => d.startsWith(...))` call sites in `conductor/laneconductor.sync.mjs` with `resolveTrackFolder`
- [x] Task 6: Verified against a synthetic duplicate-folder scenario (two folders, one registered as canonical) — correct pick, correct quarantine rename, metadata updated
- [ ] Follow-up (not done): `bin/lc.mjs` and `ui/server/index.mjs` have the same lookup pattern in a few places — not hardened in this pass

**Commits**: 39f4138 (hardening + duplicate folder removal, landed together)

## ✅ COMPLETE
