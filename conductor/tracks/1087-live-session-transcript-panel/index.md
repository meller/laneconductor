# Track 1087: Live Session Transcript Panel

**Lane**: done
**Lane Status**: success
**Progress**: 89%
**Phase**: Phases 1-7 complete (8/9, see below for what "complete" is backed by). Phase 8 (Direct Worker Interactive Chat) reopened 2026-08-12: live-tested end-to-end and found the worker has no handler for the chat dispatch actions at all — UI and dispatch-creation work, nothing executes on the worker side. Same shape of gap as track 1089's SSH stub.
**Type**: dev
**Summary**: Collapsible right-side panel rendering a track's session live, replacing the raw log tail.

## Problem

The existing "Logs" tab tails raw stdout text (5s PATCH interval, plain
`<pre>` rendering) from `claude -p` in default text mode — not a structured
chat transcript, and not useful for catching issues as a run happens. Once
track 1086 gives each (worker, track) pair one persistent session spanning
both lane actions and conversation replies, there is exactly one event
stream per track worth watching live, not several.

## Solution

- For `cli === 'claude'` spawns, use `--output-format stream-json
  --include-partial-messages` (other CLIs keep today's raw-text tailing).
- Stdout still lands in the existing `conductor/logs/` file (unchanged audit
  trail), now as structured JSONL. Worker parses new lines and pushes them to
  the collector API, which relays over the existing WebSocket
  (`ui/src/hooks/useWebSocket.js`) to any UI client watching that track.
- UI: a collapsible right-side drawer (not a tab) on the track detail view,
  auto-expanding when a run starts on the currently-viewed track, rendering
  the stream as a transcript — assistant text as chat-style blocks, tool
  calls as collapsible entries.
- Applies uniformly to auto-launched runs, manually-dispatched runs (1085),
  and any conversation turn — since after 1086 they're all the same
  underlying session, this is one live view, not several mechanisms.
- Also covers non-track dispatches — `deploy` (1085) has no associated
  track, so it gets a standalone view keyed on `worker_dispatch.id`
  instead of `track_number`. **Corrected 2026-08-10**: `deploy` doesn't
  produce a claude session/JSONL (it runs a plain shell command via
  `deploy-runner.mjs`), so this is a raw-text log viewer, not the
  structured transcript mechanism above. `create-project` (1091) deferred
  — doesn't exist yet.
- `conversation.md` remains a derived, human-readable audit log (see 1086);
  this panel is the live/structured counterpart, not a replacement for it.

Full design context: [docs/superpowers/specs/2026-08-07-remote-worker-identity-and-sessions-design.md](../../../docs/superpowers/specs/2026-08-07-remote-worker-identity-and-sessions-design.md)

## Phases
- [x] Phase 1: Worker — switch claude spawns to `stream-json` output, parse JSONL as it's written
- [x] Phase 2: Transport — push structured events to the collector API, relay over existing WebSocket
- [x] Phase 3: UI — transcript rendering (text blocks + collapsible tool-call entries) — reducer + component built, mounted in Phase 4
- [x] Phase 4: UI — auto-expand on run start for the currently-viewed track, manual collapse
- [x] Phase 5: UI — cross-worker activity view (global worker activity latch, design revised from spec.md's snippet-in-WorkersList to a persistent reachable-from-anywhere panel)
- [x] Phase 6: Non-track dispatch transcripts — deploy gets a raw-text log viewer keyed on dispatch id (revised scope, see spec.md REQ-6's correction); create-project deferred (1091 doesn't exist yet)
- [x] Phase 7: Tests — audited coverage against every task, closed the two real gaps found, honest about what's automated vs. manually-verified
- [ ] Phase 8 (reopened 2026-08-12): Direct Worker Interactive Chat — UI + dispatch creation done; worker-side execution of `worker_adhoc_chat`/`track_chat` was never implemented, confirmed by live end-to-end test (dispatch created, then failed with "missing track_number" — falls through to the generic lane-action handler, no dedicated handler exists)

## Depends on
[1086](../1086-persistent-track-sessions/index.md) — this panel renders that track's persistent session stream; without 1086 there's no single continuous stream to show, only disconnected per-call logs. Phase 6 also depends on [1085](../1085-manual-worker-dispatch/index.md) (deploy) and [1091](../1091-manager-worker-and-new-project-flow/index.md) (create-project) existing as dispatch actions to have anything non-track-scoped to render.
