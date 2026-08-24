# Spec: Worktrees panel — live run visibility

> **Note on scope correction.** An earlier version of this spec described a
> worker-centric solution (join `worker_dispatch`/`workers.current_task` into
> the worktrees payload, deep-link into `WorkerActivityLatch`). That direction
> was explicitly rejected in `index.md`. This spec supersedes it. **No API
> endpoint, no worker-join, no new transcript mechanism is in scope.** If
> implementation finds itself adding one, stop and re-read this file.

## Problem Statement

When a Worktrees panel row is running an action — Complete & Merge, AI resolve
conflict, Force merge, Merge to main, or a plain lane re-dispatch that a worker
picked up — the row shows a static `Running…` / `Resolving…` / `Merging…` label
on a *disabled* button. It is decorative: there is nothing to click, and no way
to see what the run is actually doing without knowing to navigate to the track
and open a drawer by hand.

This app already has exactly one per-track live transcript mechanism:
`TrackDetailPanel`'s Transcript drawer (Track 1087 Phase 4 — `transcriptOpen`
state, `TranscriptView`, `GET /api/projects/:id/tracks/:num/transcript` +
`session:event` WebSocket frames). It resolves purely from the **track number**
and needs no `worker_id`. The Worktrees panel is inherently track-centric (one
row per track) and already deep-links each row into `TrackDetailPanel` via
`onSelectTrack`. The whole feature is therefore: **carry an "open the
transcript" intent along the deep-link that already exists.**

`WorkerActivityLatch` (Track 1087 Phase 5) is the *worker*-centric browser and
is deliberately out of scope — wiring the Worktrees panel to it would require
the worker-join this track explicitly does not want.

## Requirements

- **REQ-1 — Running-state derivation.** A pure, testable helper decides whether
  a worktree row is "running". Two independent signals, OR'd:
  1. **Client-side pending** — any of this row's in-flight dispatch keys
     (`mergeKey`/`removeKey`/`completeKey`/`forceKey`/`discardKey`/
     `createPrKey`/`mergePrKey`/`aiResolveKey`), i.e. the existing `rowBusy`
     condition in `WorktreeRow`.
  2. **Server-reported** — `row.lane_status === 'running'`, which the worker's
     worktree audit already reads off each branch's `index.md` (see
     `conductor/services/worktree-audit.mjs`, `laneStatus`). This is what covers
     a plain lane re-dispatch started somewhere other than this panel, and it
     survives a page reload (client pending state does not).

  A row with no `row.track` (detached scratch worktree) is never "running" for
  this feature's purposes — there is no track whose transcript could be opened.

- **REQ-2 — The running indicator is a link, not decoration.** A running row
  renders a clickable `Running…` badge (`data-testid="worktree-running-badge"`)
  in the row header, alongside the existing class/merge-mode badges. Clicking it
  goes through the **same** `onSelectTrack` path the `#<track> ↗` link already
  uses — no second navigation mechanism. The existing per-action button labels
  (`Running…`, `Resolving…`, `Merging…`) stay where they are as busy/disabled
  affordances; the new badge is the clickable one.

- **REQ-3 — The `#<track> ↗` link carries the same intent.** When the row is
  running, the existing `#<track> ↗` link opens the track detail with the
  transcript expanded too. When the row is not running it behaves exactly as
  today (no transcript auto-open).

- **REQ-4 — Arriving via that path auto-opens the Transcript drawer.**
  `TrackDetailPanel` gains one optional prop (default off) that seeds Phase 4's
  `transcriptOpen` to open for the selected track. Constraints:
  - It only ever **opens** the drawer, never force-closes it — a user who
    collapses the drawer manually must not have it reopened, and arriving
    without the flag must not close a drawer that was already open (Track 1087
    REQ-4: "user can collapse manually at any time").
  - Every other entry point into `TrackDetailPanel` (Kanban card click, Inbox,
    Workers list, `WorkerActivityLatch`) is unchanged and defaults to closed.

- **REQ-5 — Works for every worktree-triggered action.** `auto-complete-track`,
  `ai-resolve-conflict`, `merge-worktree` (incl. `force`), `create-pr`,
  `merge-pr`, `discard-track`, and a plain lane re-dispatch. This falls out of
  REQ-1 rather than needing per-action handling: all of them are this track's
  own lane/dispatch activity, and the Phase 4 transcript resolves it from the
  track number alone.

- **REQ-6 — Stale "Running…" must not look broken.** If the row claims running
  but there is genuinely no live activity (e.g. `lane_status` left at `running`
  after a crash), the existing drawer's own empty state (`TranscriptView` →
  *"No transcript yet."*) is the answer. **No new empty/stale handling is to be
  built.** The badge's tooltip should set the expectation honestly rather than
  promising live output.

- **REQ-7 — No new backend surface.** No new/changed API endpoint, no change to
  the heartbeat's `worktrees` payload shape, no `worker_id` join, no new DB
  column. The only fields consumed are ones the row already carries (`track`,
  `lane_status`).

## Acceptance Criteria

- [ ] AC-1: With a worktree row whose `lane_status` is `running`, the row shows
      a clickable `Running…` badge; a non-running row shows no such badge.
- [ ] AC-2: Clicking that badge opens `TrackDetailPanel` for that row's track
      **with the Live Transcript drawer already visible** — the user sees
      transcript content (or its "No transcript yet." empty state) without
      touching the Transcript toggle.
- [ ] AC-3: Clicking the `#<track> ↗` link on a **running** row does the same
      thing as AC-2.
- [ ] AC-4: Clicking `#<track> ↗` on a **non-running** row opens the track
      detail with the transcript drawer closed, exactly as before this track.
- [ ] AC-5: A row busy from a client-initiated dispatch (Complete & Merge / AI
      resolve just clicked, before any server state has changed) is treated as
      running by AC-1–AC-3.
- [ ] AC-6: Manually collapsing the drawer after auto-open keeps it collapsed —
      nothing reopens it on the next poll or re-render.
- [ ] AC-7: A row with no track (detached) renders no running badge and remains
      non-clickable, as today.
- [ ] AC-8: `git diff` for this track touches no file under `ui/server/`,
      `conductor/services/worktree-audit.mjs`, or any migration — REQ-7 holds
      mechanically, not just by intent.
- [ ] AC-9: Unit + component tests pass (`cd ui && npm test`), including new
      tests for the run-state helper, the panel's badge/link wiring, and
      `TrackDetailPanel`'s auto-open.
- [ ] AC-10: A real browser run (Playwright, fast tier) drives AC-1→AC-2 against
      the running UI + API and passes; its result is recorded in the track's
      conversation before the track is marked done.

## Data Model Changes

None. (See REQ-7 / AC-8.)

## Touched Files (expected)

| File | Change |
|------|--------|
| `ui/src/lib/worktreeRunState.js` | **new** — pure `isWorktreeRowRunning()` helper (REQ-1) |
| `ui/src/lib/worktreeRunState.test.js` | **new** — unit tests for the helper |
| `ui/src/components/WorktreesPanel.jsx` | running badge + transcript intent on `onSelectTrack` (REQ-2, REQ-3) |
| `ui/src/components/WorktreesPanel.test.jsx` | **new** — component test for badge/link wiring |
| `ui/src/components/TrackDetailPanel.jsx` | `initialTranscriptOpen` prop → seeds `transcriptOpen` (REQ-4) |
| `ui/src/components/TrackDetailPanel.test.jsx` | **new** — component test for auto-open |
| `ui/src/App.jsx` | `handleInboxSelect` accepts an options arg; passes the flag down |
| `conductor/tests/playwright/track-10024-worktree-running-transcript.spec.js` | **new** — fast-tier E2E (AC-10) |
