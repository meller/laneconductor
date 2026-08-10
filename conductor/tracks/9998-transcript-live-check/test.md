# Tests: Track 9998 — Transcript Live Check

## Test Commands

```bash
# Verify worker is running and ready to dispatch
lc worker status

# Verify UI is running
lc ui status

# Tail the worker logs to see dispatch activity
lc worker logs

# Tail the API logs to see WebSocket connections
tail -f ui/.api.log | grep -i websocket
```

## Test Cases

### TC-1: JSONL Log File Creation and Parsing
- **Setup**: Queue track 9998 for implementation
- **Expected**: 
  - A new log file appears in `conductor/logs/` within 5 seconds
  - File path matches pattern: `*9998*.log` or similar
  - File contains valid JSONL (each line is parseable as JSON)
  - Lines include event types: `content_block_start`, `content_block_delta`, `message_stop`, etc.
- **Verification**: 
  ```bash
  ls -ltr conductor/logs/ | tail -1
  cat conductor/logs/<latest> | jq . | head -10  # Verify JSON validity
  ```

### TC-2: WebSocket Connection and Event Delivery
- **Setup**: Open track 9998 detail view in browser, open DevTools Network tab
- **Expected**:
  - A WebSocket connection appears in DevTools for this track
  - Connection message includes track subscription (e.g., `{ "action": "subscribe", "track_number": "9998" }`)
  - At least 3 events arrive on the WebSocket (assistant text, tool_use, etc.)
  - Events correspond to the JSONL log file lines
- **Verification**: 
  - DevTools Network → Messages tab shows incoming WebSocket frames
  - Each frame contains valid JSON with event data

### TC-3: Transcript Drawer UI Rendering
- **Setup**: Keep track detail view open during the run
- **Expected**:
  - Drawer is auto-expanded on the right side of the track view
  - At least one assistant text block appears (paragraph or chat-style)
  - Tool calls appear as collapsible entries (e.g., "Used tool: Read(...)")
  - No console errors in DevTools
- **Verification**: 
  - Visual inspection of the drawer content
  - DevTools Console tab has no red error messages
  - Text content matches the log file

### TC-4: Manual Collapse/Expand
- **Setup**: Drawer is rendered and visible
- **Expected**:
  - Clicking the collapse button hides the drawer
  - Clicking expand shows it again
  - Collapsed state persists on page reload (if localStorage is implemented)
- **Verification**: 
  - Visual inspection of toggle behavior

### TC-5: Page Reload Reconstruction
- **Setup**: Drawer is rendering during an active run
- **Expected**:
  - Reload the page (Ctrl+R) while run is still active
  - Drawer reappears with all previously-received events
  - New incoming events continue to appear (no duplication, no data loss)
- **Verification**: 
  - Event count before/after reload shows no losses or duplicates
  - Timestamps in the rendered transcript are ordered correctly

### TC-6: Non-Claude CLI Fallback (Optional)
- **Setup**: Queue a test track with Gemini or Antigravity CLI
- **Expected**:
  - Drawer still appears and renders content
  - No JSON parsing errors in the logs or console
  - Content renders as plain text (not as structured transcript)
  - No regressions in existing functionality
- **Verification**: 
  - DevTools Console shows no parse errors
  - Drawer content is readable (even if less structured than Claude output)

### TC-7: Cleanup and Resource Release
- **Setup**: Run is complete
- **Expected**:
  - Delete track via `lc delete 9998`
  - No error messages during deletion
  - WebSocket connection to the track is cleanly closed
  - No orphaned database rows or file handles
- **Verification**: 
  - `lc delete 9998` exits with code 0
  - `ls conductor/tracks/ | grep 9998` returns nothing
  - Worker logs show graceful cleanup (no hanging connections)

## Acceptance Criteria (Test-Driven)

- [ ] **JSONL log file is created and contains valid JSON events**
- [ ] **WebSocket connection receives at least 3 transcript events**
- [ ] **Transcript drawer renders with text blocks and tool calls**
- [ ] **Drawer can be manually collapsed and re-expanded**
- [ ] **Page reload reconstructs transcript without data loss**
- [ ] **Non-Claude CLI runs render as plain text (no regressions)**
- [ ] **Cleanup removes all traces of the test track**
- [ ] **No console errors or WebSocket disconnections during the entire flow**

## Notes

- This is a **manual, observational test** — success criteria rely on browser inspection and log file verification.
- Automation of these tests (Playwright-based) is deferred to track 1087 Phase 7.
- Keep this track **disabled or in backlog** until all track 1087 phases are complete.
