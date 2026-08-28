# Spec: Worker Strip — Running/Last Track + Chat With Worker

## Problem Statement

The worker strip at the top of the lanes view (`WorkersList.jsx`, `layout='strip'`) lists workers, but:
1. Not all workers fit in the strip, and idle workers can push busy ones out of view — there is no ordering by activity.
2. The running track is shown only as a small `current_task` text chip; there is no first-class affordance to deep-dive into the running track or interact with the worker.
3. There is no way to **send a worker a message** from the UI at all — neither from the strip nor from the Machine Workers view.
4. There is no visibility into the **last track a worker worked on**, even though the worker holds a warm Claude session for it (`track_sessions`), meaning a conversation about that track is cheap (session `--resume`, no cold-start context reload).

## Requirements

- REQ-1 (Ordering): In the strip layout, workers are sorted active-first: `busy` workers (or those with a non-null `current_task`) before idle ones; managers after project workers within the same activity class; stable tiebreak by hostname + worker_number.
- REQ-2 (Running-track chip): Each busy worker shows a clickable running-track chip. Clicking it deep-dives into that track (opens `TrackDetailPanel` via the existing `onSelectTrack(projectId, trackNumber)` path), consistent with the current `current_task` button behavior but visually promoted (track number + lane action, not just raw text).
- REQ-3 (Last-track chip): Each worker with at least one entry in `track_sessions` shows a "last: NNN" chip for the most recent `last_used_at` session's track (excluding the currently running one). Tooltip explains: "This worker still has session context for this track — talking about it is cheap." Clicking opens the worker chat (REQ-5) pre-scoped to that track.
- REQ-4 (API): `GET /api/workers` (and the project-scoped equivalent used by the lanes view) includes per-worker `last_track_number` and `last_track_project_id`, derived server-side from `track_sessions` joined on `worker_id`, ordered by `last_used_at DESC`. No schema change — `track_sessions(track_number, worker_id, claude_session_id, last_used_at)` already stores this.
- REQ-5 (Worker chat): A chat panel for a worker, openable from both the strip and the Machine Workers view (grid layout / `WorkerActivityLatch`). It contains:
  - The worker's live transcript, reusing the existing machinery: `TranscriptView.jsx` + `createTranscriptState`/`reduceStreamEvent` from `ui/src/lib/streamTranscript.js`, fed by the `/transcript` endpoint + WebSocket stream events — the same pattern `WorkerActivityLatch.jsx` already implements. Do NOT build a second transcript renderer.
  - A message input. Sending posts a human comment into the **target track's conversation** (running track if busy, otherwise the last-context track) through the existing comments API — the same mechanism the track Conversation tab uses. The sync worker then writes it to `conversation.md`, sets `waiting_for_reply`, and the worker's existing conversation-reply resume path wakes the agent with `--resume` on its stored session.
  - If the worker has neither a running nor a last track, the input is disabled with an explanatory hint (there is no session to talk to).
- REQ-6 (Machine Workers view parity): The same chat affordance appears on worker cards in the Machine Workers view (grid layout). `WorkerActivityLatch`'s transcript pane gains the message input so "watch the worker" and "talk to the worker" are one surface.
- REQ-7 (Scope guard): Chat only targets workers whose messages can actually reach an agent — i.e. project workers with a track context. Managers get transcript-only view (no input) in this pass.

## Non-Requirements (explicitly out of scope)

- No new "direct worker mailbox" channel outside the track conversation model — messages always flow through a track's conversation (that is what wakes the agent and keeps history synced to `conversation.md`).
- No cross-machine SSH control; chat rides existing DB/API sync, so remote workers work exactly as well as local ones.
- No voice input — "transcribe" here refers to the Live Transcript stream machinery, not speech-to-text.

## Acceptance Criteria

- [ ] AC-1: With 1 busy and N idle workers registered, the busy worker renders first in the strip (verifiable in a component test with a scrollable strip).
- [ ] AC-2: Clicking a busy worker's running-track chip opens the track detail panel for that exact project/track.
- [ ] AC-3: A worker that finished track X in a prior run shows "last: X"; clicking it opens the chat panel scoped to track X.
- [ ] AC-4: Typing a message in the worker chat and sending it results in a `> **human**: ...` comment appearing in that track's `conversation.md` on the worker's machine (via sync), and the worker's next cycle wakes the agent on its resumed session — verified end-to-end with a real worker against the local API.
- [ ] AC-5: The chat panel shows the live transcript of the worker's current agent run while it responds (same events as the track detail panel's Live Transcript drawer).
- [ ] AC-6: The Machine Workers view exposes the same chat (input visible for project workers with track context, absent for managers).
- [ ] AC-7: `GET /api/workers` returns `last_track_number` populated from `track_sessions` without breaking existing consumers (WorkersList grid + strip, Machine Workers view).

## API Contracts / Data Models

No schema changes.

**Extended worker payload** (added fields):
```json
{
  "id": 998, "hostname": "meller-X1-AI", "status": "idle",
  "current_task": null,
  "last_track_number": "10036",
  "last_track_project_id": 1,
  "last_track_used_at": "2026-08-26T10:12:00Z"
}
```
Derived via `LEFT JOIN LATERAL (SELECT track_number, last_used_at FROM track_sessions ts WHERE ts.worker_id = w.id ORDER BY last_used_at DESC LIMIT 1)`. `last_track_project_id` comes from the worker's own `project_id` (track_sessions has no project column; a worker's sessions are always tracks of its own project).

**Message send**: reuse `POST /api/projects/:projectId/tracks/:trackNumber/comments` (the exact endpoint the Conversation tab uses — confirm name during implementation) with `author: 'human'`. No new endpoint unless the existing one is unreachable from worker context, in which case a thin `POST /api/workers/:id/message` wrapper resolves the target track server-side and delegates to the same comment-insert code path.
