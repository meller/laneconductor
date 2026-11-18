# Spec: Stale running claims and human comments mid-run: claim stamp, stale-running lint, warning

## Problem Statement

From the audit (findings B2, A5, B5, severity high/medium). Nothing detects a stale `running` claim: there is no owner or time stamp and the summary code says it is not checked (connector/src/summary.mjs). A crashed track-runner leaves `running` forever and the board shows a phantom in flight; otralingo AM-1291 is `running` now. Also, `update_track` marker edits never compare conversation.md, so a human comment added after the run's context was frozen does not stop the lane transition (daemon: services/stuck-track-sweep.mjs, orphaned-dispatch.mjs, commits 88a94ef7 and 02598a15). Resting states (`non-terminal:success`) are not flagged either (services/resting-state.mjs).

Scope as filed: the claim writes `**Run Started**` (ISO) and `**Run By**`; a lint flags `running` older than N hours with no commit on its branch; a release outcome for the human; when Lane or Lane Status change while conversation.md has a human turn newer than the caller's read, warn (or CONFLICT with an `expect_conversation` option); a resting-state lint derived from workflow.json.

## Requirements

- REQ-1 Claim stamp: when `update_track` sets Lane Status to `running`, the connector writes `**Run Started**` (ISO time) and `**Run By**` (the client name) in index.md. The stamps are derived by the connector, not part of the caller's base; the returned base carries them. Values the caller sets explicitly are respected.
- REQ-2 Re-stamp: a Lane-only move while the status stays `running` re-stamps the claim. A progress or other marker edit while running keeps the existing stamps.
- REQ-3 Release: any Lane Status other than `running` removes both stamps, and so does a `files.index` replacement whose status is not `running`. A human or agent releases a stale claim by moving the track to `queue`.
- REQ-4 Client name cap: `Run By` carries the client name capped at 24 characters.
- REQ-5 Stale report: a track that is `running` with a `Run Started` more than 6 hours old is reported as `stale_running` by `get_track`, as one aggregate line in `list_tracks`, and as a needs-attention reason on the board. The board is deterministic from its generated time.
- REQ-6 No clock in the summary lint: `stale_running` is not part of the summary lint, because the summary file must not depend on the clock.
- REQ-7 Human comment mid-run: when a call changes Lane or Lane Status, the caller had read conversation.md, it has changed since, and its newest turn is the human's, the write succeeds and carries a `human_comment_mid_run` warning. The warning needs `conversation` in `base.files`. It is never a conflict.
- REQ-8 Warning bound: every warning added by this track fits the 200-character envelope bound, including the final period.
- REQ-9 No new tool description text (KC-8). The code lives in `connector/src/claims.mjs`, wired into `update_track`, `get_track`, `list_tracks` and the board.

## Decisions

- 2026-11-18: The human comment mid-run is a warning, not a CONFLICT. An `expect_conversation` option would cost tool-description text (KC-8) and would block a legitimate transition on every unrelated comment.
- 2026-11-18: The stale threshold is 6 hours, a constant (`STALE_RUNNING_HOURS`) in `claims.mjs`.
- 2026-11-18: `stale_running` is not in the summary lint. The summary file is generated into git and must be identical for the same repo state, which a clock-based rule would break. It is reported at read time instead.
- 2026-11-18: The client name in `Run By` is capped at 24 characters so the stale warning always fits the 200-character bound.
- 2026-11-18: Open for the owner, descope or build: the "no commit on the run's branch" check (the connector does not know the run's branch) and the resting-state lint derived from workflow.json (needs a decision on which non-terminal successes count as resting). Until decided both stay unbuilt and the track stays in quality-gate, waiting.

## Data model and API

- index.md markers: `**Run Started**` (ISO 8601 timestamp) and `**Run By**` (client name, at most 24 characters). Both exist only while Lane Status is `running`.
- `get_track`: adds `stale_running` to the track data when REQ-5 holds. `list_tracks`: one aggregate line counting stale claims. Board: a needs-attention reason per stale claim.
- `update_track`: adds the `human_comment_mid_run` warning (REQ-7) to the response warnings; no new input fields.

## Acceptance criteria

- [x] Claiming a track stamps Run Started and Run By; a progress edit keeps them; releasing removes them; the returned base follows (REQ-1, REQ-3).
- [x] A Lane-only move while running re-stamps; a files.index replacement with a status other than running drops the stamps (REQ-2, REQ-3).
- [x] A 44-character client name is capped in Run By (REQ-4).
- [x] A stamped running claim older than 6 hours is reported by get_track, list_tracks and the board; a fresh one is not (REQ-5).
- [x] The summary lint does not report stale claims (REQ-6).
- [x] A human comment after the caller's read warns on a Lane Status change, and does not warn when the read is current or the edit is not a lane edit (REQ-7).
- [x] The stale warning and the comment warning fit 200 characters (REQ-8).
- [ ] The "no commit on the run's branch" check exists. Needs an owner decision to descope.
- [ ] A resting-state lint derived from workflow.json exists. Needs an owner decision to descope.

## Risks and limits

- Legacy `running` claims written before the stamp have no Run Started and are never flagged as stale; the connector cannot judge their age.
- The `human_comment_mid_run` warning needs `conversation` in `base.files`; a caller that never read conversation.md gets no warning.
- The warning does not stop the write. A runner that ignores warnings still moves the lane over a fresh human comment.
- Staleness is judged by time only, not by whether the run's branch has commits, so a long but healthy run past 6 hours is reported too.
- The stamp relies on the client reporting a name; an unnamed client gets a generic `Run By`.

## Out of scope

- A CONFLICT mode (`expect_conversation`) for the human comment.
- Any daemon behaviour: services/stuck-track-sweep.mjs and orphaned-dispatch.mjs are the reference only.
- Automatically releasing a stale claim.
