# Spec: Transcript Live Check (Track 9998)

## Problem Statement

Track 1087 (Live Session Transcript Panel) adds a new feature to display live Claude session transcripts in the UI drawer during worker runs. Before shipping, we need end-to-end verification that the transcript drawer correctly receives and renders live stream events from a real Claude dispatch, not just unit tests or mock collectors.

## Requirements

**REQ-1: Real Claude dispatch execution**
- Trigger a track implementation via worker dispatch (either auto-launch from queue or manual dispatch)
- Use `--output-format stream-json --include-partial-messages` (added in 1087 Phase 1)
- Verify the worker parses JSONL correctly from the log file

**REQ-2: Live event transport**
- Events reach the UI WebSocket subscription for the track
- WebSocket relay latency is measurable (< 1s from log write to browser)
- No regressions in database sync or API health

**REQ-3: Transcript drawer UI rendering**
- Drawer auto-expands on track detail panel when run starts
- Rendered transcript matches the JSONL log content (text blocks, tool calls visible)
- Collapsible tool-call entries render correctly
- Manual collapse/expand works as expected

**REQ-4: Fallback and non-Claude CLI safety**
- Non-Claude CLI runs (antigravity, gemini, etc.) still render as plain text (no regression)
- Missing or malformed JSONL lines fall back to raw text rendering gracefully

**REQ-5: Cleanup and teardown**
- Test track and associated dispatch records can be safely deleted
- No stale WebSocket subscriptions or orphaned resources left behind

## Acceptance Criteria

- [ ] A real track is launched via worker dispatch (live claude run starts)
- [ ] Stream-json JSONL events appear in `conductor/logs/` file
- [ ] UI WebSocket receives at least 3 transcript events (e.g., assistant text + tool_use)
- [ ] Transcript drawer is visible in the browser during the run
- [ ] Text blocks and tool-call entries render correctly
- [ ] Drawer can be manually collapsed and re-expanded
- [ ] After run completes, full transcript reconstructs on page reload
- [ ] No console errors or WebSocket disconnections during the run
- [ ] Test track is safely deleted and logs cleaned up after verification

## Test Environment

- Local instance: `localhost:8090` (Vite UI) and `localhost:8091` (Collector API)
- Worker running in `sync+poll` mode with real track queue
- Chrome DevTools open to catch live WebSocket events and console output

## Notes

This is a **throwaway test track** (see track 9999 for precedent) — delete after verification is complete.
