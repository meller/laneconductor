# Track 9998: Transcript Live Check — Implementation Plan

## Phase 1: Test Harness Setup

**Problem**: We need a minimal, instrumented test track that will be auto-launched by the worker so we can observe live transcript events.

**Solution**: Create a simple test CLI action — a `/laneconductor` command that performs a quick operation (e.g., reads a spec file, makes a simple git query) — that will produce enough JSONL events to verify the transcript drawer works.

- [ ] Create a test `.laneconductor.json` config or use the current project config
- [ ] Ensure worker is running in `sync+poll` mode (`lc worker status` to confirm)
- [ ] Verify Vite UI is running (`lc ui start` if needed)
- [ ] Check DevTools WebSocket tab is ready for inspection

**Impact**: Establishes the baseline environment for the live transcript test.

## Phase 2: Trigger Real Claude Dispatch

**Problem**: The transcript drawer only displays during an active run. We need to trigger one and observe it live.

**Solution**: Manually dispatch a track to the worker via the API or queue a track and let the worker auto-launch it.

- [ ] From the Kanban UI or via API (`POST /api/projects/:id/dispatch`), queue this track (9998) in `implement:queue` lane
- [ ] Worker polls and picks up the track within ~5 seconds
- [ ] Monitor `conductor/logs/` for a new JSONL log file (format: `implement-9998-<timestamp>.log` or similar)
- [ ] Confirm the log file contains valid JSONL lines (each parseable as JSON)

**Impact**: Worker now runs; JSONL events begin flowing to the log file.

## Phase 3: Monitor WebSocket and Live Transcript

**Problem**: Raw JSONL in the file is not sufficient; we need to verify the UI receives and renders it.

**Solution**: Open track detail panel in browser, keep DevTools open, watch for WebSocket events.

- [ ] Open `http://localhost:8090` in browser
- [ ] Navigate to track 9998's detail view
- [ ] Open DevTools → Network tab → filter by WebSocket connections
- [ ] Confirm WebSocket subscription to this track (should see `subscribe` message or similar)
- [ ] Monitor the WebSocket Messages tab for incoming transcript events
- [ ] Visually confirm the transcript drawer is auto-expanded and rendering:
  - Assistant text blocks are visible
  - Tool calls appear as collapsible entries
  - Live updates appear as events arrive (not just static after completion)

**Impact**: Live event flow and UI rendering verified.

## Phase 4: Verify Transcript Reconstruction and Fallback

**Problem**: Need to confirm that reloading the page reconstructs the transcript from the log file, and non-Claude CLIs degrade gracefully.

**Solution**: Reload the page mid-run, check for data loss; then optionally test a non-Claude command.

- [ ] While the run is still active, reload the track detail page (Ctrl+R)
- [ ] Confirm the drawer appears with the previously-received events (reconstructed from the log)
- [ ] Continue watching for new incoming events (live WS feed resumes without duplication)
- [ ] (Optional) Queue a test with a non-Claude CLI (e.g., Gemini or antigravity) and verify the drawer falls back to raw text rendering with no errors

**Impact**: Transcript persistence and fallback behavior verified.

## Phase 5: Cleanup and Documentation

**Problem**: Test tracks must be cleaned up to avoid clutter; document findings for future reference.

**Solution**: Delete the test track and log results.

- [ ] Once the run completes and verification is done, delete track 9998 via `lc delete 9998`
- [ ] Remove any associated dispatch records (if using manual dispatch)
- [ ] Confirm no stale WebSocket subscriptions or orphaned resources remain
- [ ] (Optional) Append a summary note to `conversation.md` with test results: "Live transcript drawer verified — events arrived with <latency> latency, rendering correct, no regressions."

**Impact**: Test environment cleaned up; verification complete.

---

## Notes

- **Throwaway track**: This track is intentionally temporary, meant to be deleted after verification (see track 9999 for the same pattern).
- **Real claude runs only**: The test must use an actual `claude -p` dispatch, not a mock; the whole point is to verify the real event stream.
- **No manual fixes during the run**: If the JSONL parsing fails or the WebSocket drops, note the error (do NOT silently fix the code) — capture it for debugging.
- **Phase 3 is critical**: Live WebSocket observation is the primary validation; test failures here block shipping track 1087.
