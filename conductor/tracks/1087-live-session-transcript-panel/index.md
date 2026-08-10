# Track 1087: Live Session Transcript Panel

**Lane**: plan
**Lane Status**: running
**Progress**: 43%
**Phase**: Phase 3 complete — transcript reducer + rendering component built and unit tested (found that one `assistant` event = one completed content block, not a cumulative snapshot — verified against the real CLI). Not yet mounted in the UI; Phase 4 (drawer placement) next.
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
- Also covers non-track dispatches — `deploy` (1085) and `create-project`
  (1091) have no associated track, so the same transcript mechanism is keyed
  on `worker_dispatch.id` instead of `track_number` and shown in a
  standalone view rather than a track's drawer.
- `conversation.md` remains a derived, human-readable audit log (see 1086);
  this panel is the live/structured counterpart, not a replacement for it.

Full design context: [docs/superpowers/specs/2026-08-07-remote-worker-identity-and-sessions-design.md](../../../docs/superpowers/specs/2026-08-07-remote-worker-identity-and-sessions-design.md)

## Phases
- [x] Phase 1: Worker — switch claude spawns to `stream-json` output, parse JSONL as it's written
- [x] Phase 2: Transport — push structured events to the collector API, relay over existing WebSocket
- [x] Phase 3: UI — transcript rendering (text blocks + collapsible tool-call entries) — reducer + component built, not yet mounted (see Phase 4)
- [ ] Phase 4: UI — auto-expand on run start for the currently-viewed track, manual collapse
- [ ] Phase 5: UI — cross-worker activity view (Workers list live-activity snippets)
- [ ] Phase 6: Non-track dispatch transcripts — deploy/create-project, keyed on dispatch id, standalone view
- [ ] Phase 7: Tests — stream-json parsing, WS relay, fallback to raw-text rendering for non-Claude CLIs, non-track dispatch transcripts

## Depends on
[1086](../1086-persistent-track-sessions/index.md) — this panel renders that track's persistent session stream; without 1086 there's no single continuous stream to show, only disconnected per-call logs. Phase 6 also depends on [1085](../1085-manual-worker-dispatch/index.md) (deploy) and [1091](../1091-manager-worker-and-new-project-flow/index.md) (create-project) existing as dispatch actions to have anything non-track-scoped to render.
