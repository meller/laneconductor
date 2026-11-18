# Track 10141: Stale running claims and human comments mid-run: claim stamp, stale-running lint, warning

Design approach: a new `connector/src/claims.mjs` holds the stamp, stale and comment rules; `update_track`, `get_track`, `list_tracks` and the board call it. No new tool text (KC-8). Stamps are derived by the connector and are not part of the caller's base. The summary lint stays free of the clock.

## Phase 1: Claim stamp and release

- [x] Stamp `**Run Started**` and `**Run By**` when Lane Status becomes running; re-stamp on a Lane-only move while running; keep them on other edits
- [x] Cap the client name in `Run By` at 24 characters
- [x] Remove both stamps for any other status and for a files.index replacement whose status is not running

## Phase 2: Stale-running report

- [x] `staleRunning` flags a stamped running claim older than 6 hours
- [x] Report it in `get_track`, as one aggregate line in `list_tracks`, and as a board needs-attention reason
- [x] Keep it out of the summary lint

## Phase 3: Human comment mid-run

- [x] Warn `human_comment_mid_run` when a Lane or Lane Status change follows a human turn newer than the caller's read (warning, never a conflict)
- [x] Keep every added warning within the 200-character bound

## Phase 4: Tests and release gate

- [x] Tests in `connector/test/claims.test.mjs` for stamps, stale, through the connector, board and comment
- [x] Read-only review, verdict pass
- [ ] Branch-commit check: "no commit on the run's branch" (the connector does not know the run's branch). Needs an owner decision to descope
- [ ] Resting-state lint derived from workflow.json (needs a decision on which non-terminal successes count as resting). Needs an owner decision to descope

Gate: the track leaves quality-gate when the owner descopes or builds the two unticked items.
