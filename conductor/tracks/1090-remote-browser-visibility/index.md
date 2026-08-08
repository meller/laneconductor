# Track 1090: Remote Browser Visibility

**Lane**: backlog
**Lane Status**: queue
**Progress**: 0%
**Phase**: Awaiting decision — not yet brainstormed
**Type**: dev
**Summary**: Options for letting the app show a browser a remote worker is driving (e.g. during E2E tests) — not yet decided which, if any, to build.

## Problem

Claude Code Desktop's advantage is that you can watch a real browser it
opens. Our workers run remotely, so the closest analog would be a worker
using Playwright (e.g. via Playwright MCP) to run E2E tests on a server —
but there's currently no way to actually *see* that browser through the
app. Raised while discussing tracks 1084-1089 (worker identity/dispatch/
sessions); explicitly deferred to its own track rather than folded into
that batch.

**Note**: Playwright MCP itself doesn't provide this. It's built for an LLM
to *drive* a page (navigate/click/read the accessibility tree/one-off
screenshots) — not for a human to watch a continuous live feed. Whatever
gets built here sits alongside Playwright MCP, not inside it.

## Options (undecided — for review)

**Option 1 — CDP screencast (live view)**
- Chrome DevTools Protocol's native `Page.startScreencast` streams JPEG/PNG
  frames of a running page over a WebSocket as it renders. Same primitive
  Chrome's own remote-debugging UI uses, and what powers this session's own
  "Browser pane" tooling (`mcp__Claude_Browser__*`) — proven, not
  speculative. Works against headless or headed Chromium, no virtual
  display needed.
- Could ride the same WebSocket channel [1087](../1087-live-session-transcript-panel/index.md)
  already sets up for live session transcripts — one more event type on an
  existing pipe, not new infrastructure.
- View-only (no interactivity) unless combined with something else.
- Effort: moderate.

**Option 2 — VNC / noVNC (full interactivity)**
- Virtual display (Xvfb) + VNC server + a web-based VNC client (noVNC) so
  the UI can embed a live, *interactive* remote desktop view (mouse/
  keyboard control), not just watch.
- Bigger operational lift: extra process, extra port, extra security
  surface, for a capability (taking manual control) that may not be needed
  if the actual goal is just watching an agent's E2E run.
- Effort: high.

**Option 3 — Playwright Trace Viewer (post-hoc replay)**
- Record a trace during the E2E run (`context.tracing.start()`), producing
  a scrubbable, after-the-fact replay: screenshots + DOM snapshots +
  network + console. Not live, but often more useful for "did my test pass
  and why" than a live feed.
- No streaming infrastructure at all — just save and open a `.zip` (via
  Playwright's own standalone trace viewer, or embedded).
- Effort: low. Best effort-to-value ratio if the goal is debugging E2E
  runs specifically, rather than general live browser visibility.

## Decision needed

Which (if any) to build, and whether the goal is primarily "debug what an
E2E test did" (favors Option 3, cheapest) vs. "watch/interact with a live
remote browser in general" (favors Option 1 or 2). Not brainstormed in
depth yet — this track captures the choice space, not a committed plan.
