# Track 1087: Live Session Transcript Panel

**Lane**: plan
**Lane Status**: success
**Progress**: 0%
**Phase**: Planning complete
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
- `conversation.md` remains a derived, human-readable audit log (see 1086);
  this panel is the live/structured counterpart, not a replacement for it.

Full design context: [docs/superpowers/specs/2026-08-07-remote-worker-identity-and-sessions-design.md](../../../docs/superpowers/specs/2026-08-07-remote-worker-identity-and-sessions-design.md)

## Phases
- [ ] Phase 1: Worker — switch claude spawns to `stream-json` output, parse JSONL as it's written
- [ ] Phase 2: Transport — push structured events to the collector API, relay over existing WebSocket
- [ ] Phase 3: UI — collapsible right-side drawer, transcript rendering (text blocks + collapsible tool-call entries)
- [ ] Phase 4: UI — auto-expand on run start for the currently-viewed track, manual collapse
- [ ] Phase 5: Tests — stream-json parsing, WS relay, fallback to raw-text rendering for non-Claude CLIs

## Depends on
[1086](../1086-persistent-track-sessions/index.md) — this panel renders that track's persistent session stream; without 1086 there's no single continuous stream to show, only disconnected per-call logs.
