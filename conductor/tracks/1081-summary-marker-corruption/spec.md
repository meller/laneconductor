# Spec: `**Summary**` marker gets silently overwritten with wrong content

## Problem Statement

`index.md`'s `**Summary**` marker gets clobbered with wrong/generic or stale/truncated content
by two distinct mechanisms.

## Mechanism 1 — hardcoded "Answered user question" placeholder

**Status: already fixed, predates this track's investigation.** `conductor/laneconductor.sync.mjs`
used to mandate `/laneconductor pulse ${track_number} ${lane_status} ${parseProgress(content)}
"Answered user question"` as part of the `waitingForReply` auto-answer prompt, permanently
replacing the real Summary with that literal string. Track AM-10046 Phase 2 (commit `68752c17`,
"fix(track-10046): Phase 2 — narrow conversation-reply write scope") replaced that whole prompt
template — the current code (around `laneconductor.sync.mjs`'s `waitingForReply` branch, ~line
7804) only tells the agent to `/laneconductor comment` a reply and, if asked, update design docs
through the normal `/laneconductor move` path. There is no more mandated `pulse` call with a fixed
summary string anywhere in the file (`grep -rn "Answered user question" conductor/laneconductor.sync.mjs`
returns nothing). No code change needed here — verified by reading current source and `git log -S`.

Pre-existing damage from before the fix (`conductor/tracks/LAN-11-per-lane-llm/index.md`,
`conductor/tracks/KAN-861-per-lane-llm/index.md`) is old data, not a live bug; not in scope to
retroactively repair every historical track.

## Mechanism 2 — Summary truncated on push, then the truncated copy is written back to disk

**Root cause found.** This is the same bug already partially (and only partially) fixed by
track 10056-10058 (see `conductor/tests/track-10035-new-track-flags.test.mjs`'s "a long
description is written in full to `**Problem**`, not truncated into `**Summary**`" test and its
comment) — but that fix only prevents `lc new` from ever writing a long `**Summary**` marker at
creation time. It does not fix the underlying mechanism, which still fires for any track whose
`**Summary**` marker is written directly (by a human or an agent, e.g. during `plan`/`implement`)
with more than 200 characters — exactly what mechanism 2 reproduced live on tracks 1079/1080.

**The round trip:**
1. `parseSummaryMarker(content)` (`conductor/laneconductor.sync.mjs`) reads the file's
   `**Summary**` marker and unconditionally truncates it to 200 chars via `truncateSummary()`
   before it's pushed to the DB as `content_summary` (`syncTrack`'s payload, `content_summary:
   summary`).
2. The DB's `content_updated_at` trigger (`migrations/20260709071724_add_content_updated_at_trigger.sql`)
   bumps `content_updated_at = NOW()` whenever `content_summary` (among other columns) changes —
   which it does, the instant a >200-char Summary is first pushed (truncated value differs from
   whatever was there before).
3. `pullTracksMetadataFromDB`'s `isConcurrentEdit` grace period (10s) suppresses the DB→FS pull
   only while the push's own timestamp is still "recent" relative to now. Once that expires
   (routine — the pull runs every 5s via `setInterval(pullTracksMetadataFromDB, 5000)`, so this
   expires within roughly 10-15s of any push with no further edits needed), `compareTimestamps`
   finds the DB's `content_updated_at` newer than the file's mtime (the DB write necessarily
   commits after the file was read) and `updateIndexMDFromDB` writes the DB's **truncated**
   `content_summary` back into the file's `**Summary**` marker — permanently discarding whatever
   was past 200 characters.
   - This reproduces with **zero concurrent editing** — it is deterministic for any Summary over
     200 chars, given ~10-15 quiet seconds. Confirmed live: this very track's own `index.md`
     `**Summary**` marker is truncated to exactly 200 chars ending in "…" and cutting off
     mid-word ("...not yet…", the rest of "not yet root-caused" lost) — self-inflicted evidence
     of the exact bug this track investigates.
   - A second, narrower variant is a genuine TOCTOU race: if a second edit to `**Summary**`
     lands after `syncTrack`'s file read but before its DB write commits, the DB row reflects the
     *first* edit's (truncated) content while getting a timestamp that can be later than the
     *second* edit's file mtime — so the next pull overwrites the second edit with stale content
     from the first. This explains the "stale, not just truncated" variant of the symptom
     reported on track 1009. This narrower race is not fixed by this track (see Non-Goals) — the
     truncation fix below removes the far more common, fully deterministic trigger.
4. The truncation itself was never actually load-bearing: `content_summary` is a Postgres `TEXT`
   column (no length limit — see `prisma/schema.prisma`), and the one place `content_summary` is
   rendered in the UI (`ui/src/components/TrackCard.jsx`) already applies `line-clamp-3` CSS to
   visually clip it. Storing the full text and clipping only at render time is strictly better:
   it fixes the corruption and loses nothing (the Kanban card looks identical either way).

## Requirements

- REQ-1: `**Summary**` markers longer than 200 characters must survive a full push (FS→DB) +
  pull (DB→FS) round trip unchanged — no truncation, no "…".
- REQ-2: The `**Phase**` marker's existing truncation (`parseCurrentPhaseMarker`, track 1114's
  intentional bound on an unrelated field) is unaffected — this track's fix is scoped to Summary
  only.
- REQ-3: The truncation/parsing logic must be unit-testable without importing
  `conductor/laneconductor.sync.mjs` directly (that file runs chokidar watchers and
  `setInterval`s as import-time side effects — see `conductor/sync-timestamp-utils.mjs`'s own
  header comment for the established precedent of extracting pure helpers to a sibling module
  for exactly this reason).

## Non-Goals

- The narrower stale-content TOCTOU race described in step 3's second bullet (an edit landing
  inside `syncTrack`'s own read-to-DB-write-commit window) is a distinct, much lower-frequency
  timing issue that would need a different mechanism (e.g. content-hash-based conflict detection
  instead of wall-clock timestamps) to close fully. Out of scope for this track; flagging for a
  follow-up track if it reproduces again after this fix ships (truncation was almost certainly
  the dominant trigger for what's been observed so far).
- Not retroactively repairing already-corrupted historical `**Summary**` values on existing
  tracks (e.g. `LAN-11-per-lane-llm`, `KAN-861-per-lane-llm`).

## Acceptance Criteria

- [ ] A `**Summary**` marker with content longer than 200 characters, read via the extracted
      summary-parsing helper, returns the full text unchanged (no truncation, no "…").
- [ ] The same holds for the `**Problem**`-derived fallback path used when no `**Summary**`
      marker is present.
- [ ] `parseCurrentPhaseMarker`'s existing 200-char truncation behavior for `**Phase**` is
      unchanged (regression check).
- [ ] Mechanism 1 is confirmed fixed by reading current source + `git log`, documented here —
      no code change required.
