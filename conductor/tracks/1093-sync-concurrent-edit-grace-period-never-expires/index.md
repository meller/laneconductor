# Track 1093: Sync Worker Bug Sprint — Track 180 Investigation

**Lane**: implement
**Lane Status**: success
**Progress**: 100%
**Phase**: Both bugs fixed, verified live end-to-end (including a real content backfill)
**Type**: dev
**Summary**: Two independent sync bugs found investigating one live report ("track 180 not syncing") — a DB→FS timestamp bug and an FS→DB conversation.md parser bug, both permanent-silent-failure patterns, not transient ones.

## Bug 1: Concurrent-Edit Grace Period Never Expires (DB→FS, index.md)

## Problem

Reported live: "aitutor" (coachai, project 855) track 180 wasn't syncing.
Investigation (`conductor/.sync.log`, 3.7GB) showed the same 42 of 173
tracks logging `[SKIPPED] concurrent_edit_grace_period` on *every single*
5-second heartbeat cycle, for hours, with the exact same frozen timestamps
each time — 2.5 million occurrences of the line in that one log file alone.
Checking other currently-running projects' workers found the same pattern:
`tokentalos` (234M), `otralingo` (203M), `chesstrainer` (343M), `5elements`
(315M) logs, all almost certainly from the same loop.

## Root Cause

`isConcurrentEdit(fileMtime, dbLastUpdated)` in
`conductor/laneconductor.sync.mjs` (now `conductor/sync-timestamp-utils.mjs`)
only checked whether a track's file mtime and DB `last_updated` were within
a 10-second "grace period" *of each other* — never whether that pair of
events was itself recent. Once nothing else touches either side, both
timestamps are frozen forever; if they happened to land close together (the
normal case immediately after any successful two-way sync — exactly when
you'd expect them to be close), `Math.abs(fileMtime - dbTime) < 10000`
stays true indefinitely. The "grace period" intended as "wait one cycle,
the race will resolve" never actually resolves — it's permanent, silently
disabling DB→FS sync for that track from that point on, with no error, just
an infinite skip loop generating unbounded log growth as a side effect.

## Fix (committed)

- Extracted `compareTimestamps`/`isConcurrentEdit` out of
  `laneconductor.sync.mjs` into a new pure module,
  `conductor/sync-timestamp-utils.mjs` — the original file runs side effects
  (chokidar watchers, `setInterval`s) at import time, so wasn't safe to
  import directly just to unit-test a pure function; this codebase already
  has precedent for this exact move (`deploy-runner.mjs`, track 1085).
- `isConcurrentEdit` now also requires the pair to be *recent*
  (`now - max(fileMtime, dbTime) < gracePeriodMs`), not just close to each
  other. A stale-but-close pair from hours ago no longer reads as an active
  race.
- New regression test, `conductor/tests/sync-concurrent-edit-grace-period.test.mjs`
  — reproduces track 180's exact real-world shape (timestamps ~483ms apart,
  3+ hours old) as the primary bug case, plus the genuine-fresh-race case
  that must still correctly skip.

## Resolution (user-authorized, 2026-08-09)

- [x] Restarted all 5 affected project workers (`tokentalos`, `otralingo`,
      `chesstrainer`, `5elements`, `coachai`/aitutor) via `lc worker stop` +
      `lc worker start --sync-only`, matching each one's prior mode.
- [x] Truncated each project's oversized `conductor/.sync.log` before
      restart (coachai 3.5G, chesstrainer 343M, 5elements 315M, tokentalos
      234M, otralingo 203M).
- [x] **Verified live**, not just assumed: the first heartbeat cycle after
      each restart shows `conflicts` dropping from a nonzero steady-state to
      `0`, with exactly that many tracks pulling through in the same cycle —
      coachai (42 pulled, incl. track 180: `[PULLED] db_newer`), otralingo
      (11), tokentalos (6), chesstrainer (1), 5elements (1, already clean on
      its first post-restart cycle).

## Bug 2: conversation.md FS→DB Parser Silently Truncates/Drops Content

### Problem

Follow-up report on the same track: "still not seeing conversation.md
updated for track 180." Different bug, different direction — `index.md`
(Bug 1) is DB→FS; `conversation.md` sync is FS→DB (`syncConversation()`),
tracked by a `.conv-cursor` byte offset, separate from the misleading
`<!-- Last synced comment ID -->` marker in the file itself (that marker
is decorative, not actually read by the sync code).

`.conv-cursor` was at 15025 of a 15090-byte file — not stuck, it had
already scanned almost the entire file. The problem: track 180's
`conversation.md` was written as a narrative document (an agent's
`## V1 — ...` / `## V2 — ...` section headers plus plain blockquoted
email/contract text) instead of the turn-based `> **author**: body` format
the parser requires. Two distinct parser gaps compounded:

1. **Zero-match content is silently swallowed.** If new content matches no
   `> **author**:` turn at all, `syncConversation()` still advanced the
   cursor past it (correctly, to avoid reprocessing forever) but logged
   nothing — 15KB of real negotiation history never reached
   `track_comments` with zero trace anywhere.
2. **Found while verifying the backfill, before writing anything real**:
   the continuation-line check excluded *any* line starting with `> **`,
   not just lines that actually match the full author-turn pattern — so
   quoted content with its own bold sub-headers (e.g. pasted contract
   clauses like `> **1.1 Role.** Contractor shall...`) looked like the
   start of a new turn and silently truncated the comment right there,
   dropping everything after.

### Fix (committed)

- Extracted the parser into `conductor/sync-conversation-utils.mjs`
  (`parseConversationComments`) — same reasoning as Bug 1's extraction:
  `laneconductor.sync.mjs` isn't safe to import directly for a unit test.
- `syncConversation()` now logs a clear warning (track number, byte count,
  content preview) when new content matches zero comments, instead of
  silently discarding it.
- Continuation-line detection now checks against the *specific* new-turn
  pattern (reuses the same match `m` already computed) instead of the
  overly broad `> **` prefix — a bolded sub-header inside quoted content no
  longer looks like a new turn.
- New tests in `conductor/tests/sync-conversation-parser.test.mjs` (6),
  including both bug shapes reproduced directly from track 180's real
  content.
- **`.claude/skills/laneconductor/SKILL.md`**: added a new "Protocol:
  conversation.md Format" section stating the turn-format requirement
  explicitly and up front, with guidance for wrapping long reference
  material (the exact case that caused this) under one `> **author**:`
  opening line instead of dropping into prose.

### Backfill (user-authorized, 2026-08-09)

Reformatted track 180's existing narrative content into one
`> **claude**:`-wrapped turn (preserving every line byte-for-byte —
verified via `diff` against the original before writing anything), reset
`.conv-cursor` to just past the already-synced portion, and let the fixed
worker resync it.

Hit — and recovered from — a real race mid-backfill: the *old*, not-yet-
restarted worker process's chokidar watcher fired on the file write before
the restart landed, running the pre-fix parser and pushing a truncated
1386-char comment. Caught immediately by checking the DB after restart;
deleted that one row (a bug artifact from seconds earlier, not real data)
and re-triggered the resync against the now-running fixed worker.

**Verified**: `track_comments` row for track 180 now has the full
14,736-character body, confirmed ending at the file's true last line,
content matching the source file exactly (diffed, not assumed).

## Follow-up (not blocking, separate/smaller)

- [ ] Consider a log-rotation/size-cap safeguard in the sync worker itself,
      so a *future* stuck-loop bug (of any kind) can't silently grow a log
      file to multiple GB unbounded again.

## Verification

- `node --test conductor/tests/sync-concurrent-edit-grace-period.test.mjs` — 4/4 pass
- `node --test conductor/tests/sync-conversation-parser.test.mjs` — 6/6 pass
- Full regression pass (1084/1085/worker-mode/deploy-runner suites) — 33/33 pass total, no regressions from either extraction
- Track 180's conversation.md backfill verified in the real DB, not just the test suite
