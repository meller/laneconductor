# Track 10024: Worktrees panel — live run visibility

Four phases, TDD per `test.md`. Everything is UI-side; no backend, no worker,
no schema (spec REQ-7). Read `spec.md` first — it supersedes the earlier
worker-centric framing.

---

## Phase 1: Run-state helper (REQ-1)

**Problem**: "Is this row running?" currently exists only as the ad-hoc
`rowBusy` boolean inside `WorktreeRow`, which covers client-initiated dispatches
only and is untestable in isolation. A plain lane re-dispatch (or any run that
survives a page reload) isn't represented at all.

**Solution**: A pure module `ui/src/lib/worktreeRunState.js` — same shape as the
existing `lib/worktreeStats.js` / `lib/worktreePendingKeys.js` siblings.

```js
// isWorktreeRowRunning({ row, busy }) -> boolean
//   row  — a worktrees API row (needs .track, .lane_status)
//   busy — the row's existing rowBusy boolean (client-side pending dispatch)
```

- [ ] Task 1.1: Write `ui/src/lib/worktreeRunState.test.js` first (TC-1…TC-6 in
      `test.md`); confirm it fails (module does not exist).
- [ ] Task 1.2: Implement `isWorktreeRowRunning` — `Boolean(row?.track) && (busy
      || String(row?.lane_status).toLowerCase() === 'running')`. Comment *why*
      both signals exist (client pending is instant but lost on reload;
      `lane_status` is authoritative but only refreshes on the audit cycle) and
      why a track-less detached row is excluded.
- [ ] Task 1.3: Run `cd ui && npx vitest run src/lib/worktreeRunState.test.js` —
      green.

**Impact**: One tested predicate, reusable by the panel and by tests. No
behavior change yet.

---

## Phase 2: Clickable Running badge in the panel (REQ-2, REQ-3, REQ-6)

**Problem**: The `Running…` label lives on a *disabled* action button — nothing
to click. The `#<track> ↗` deep-link exists but carries no intent.

**Solution**: In `ui/src/components/WorktreesPanel.jsx`:

- `WorktreeRow` computes `const isRunning = isWorktreeRowRunning({ row, busy: rowBusy })`
  (reusing the `rowBusy` it already derives).
- New badge rendered in the row header's badge cluster (next to
  `merge-mode-badge` / class badge), **only** when `isRunning && row.track &&
  onSelectTrack`:
  - `data-testid="worktree-running-badge"`, a real `<button>`.
  - Label: `▶ Running… ↗`. Styling follows the file's existing badge
    conventions (`text-[9px]`/`text-[10px]` uppercase, bordered pill); use the
    orange family to match `TrackDetailPanel`'s active-Transcript toggle, so the
    two read as the same feature.
  - `title`: names it honestly — watching this track's live session transcript,
    and that a run that already ended (or never started) will simply show an
    empty transcript. That tooltip is the whole of REQ-6; **no new empty/stale
    UI is built** — `TranscriptView` already renders *"No transcript yet."*
  - `onClick`: `onSelectTrack(row.track, { transcript: true })`.
- The existing `#<track> ↗` button becomes
  `onSelectTrack(row.track, { transcript: isRunning })` — same handler, intent
  attached only while running (REQ-3/AC-4).
- `WorktreesPanel`'s wrapper widens by one argument:
  `onSelectTrack ? (track, opts) => onSelectTrack(projectId, track, opts) : null`.

- [ ] Task 2.1: Write `ui/src/components/WorktreesPanel.test.jsx` first (TC-7…
      TC-11), mocking `../hooks/useApi.js` the way `ConductorPanel.test.jsx`
      does; confirm the new assertions fail.
- [ ] Task 2.2: Implement the badge + widened `onSelectTrack` call sites.
- [ ] Task 2.3: `cd ui && npx vitest run src/components/WorktreesPanel.test.jsx`
      — green, and the existing `worktreeStats`/`worktreePendingKeys` suites
      still pass.

**Impact**: Running rows become clickable. Nothing downstream consumes the new
third argument yet — the panel is correct in isolation, and Phase 3 lands the
receiving end.

---

## Phase 3: Auto-open the transcript on arrival (REQ-4)

**Problem**: `TrackDetailPanel` always mounts with `transcriptOpen = false`;
Phase 4's auto-expand only fires on the *next* live `session:event`, which for
an already-mid-run track can be seconds away or (for a finished run) never.

**Solution**:

- `ui/src/App.jsx`: `handleInboxSelect(projectId, trackNumber, opts)` →
  `setActiveTrack({ projectId, trackNumber, initialTab: 'conversation',
  openTranscript: Boolean(opts?.transcript) })`. All existing 2-arg callers
  (Inbox, WorkersList ×2, WorkerActivityLatch) are unaffected — `opts` is
  `undefined` → `false`.
- `<TrackDetailPanel … initialTranscriptOpen={activeTrack.openTranscript} />`.
- `ui/src/components/TrackDetailPanel.jsx`: accept `initialTranscriptOpen =
  false`; inside the existing per-track effect (the one at
  `[projectId, trackNumber]` that resets `transcriptState` and re-arms
  `autoExpandArmedRef`), add `if (initialTranscriptOpen) setTranscriptOpen(true);`
  and widen its deps to include the flag.
  **Only ever set `true`** — never `setTranscriptOpen(false)` — so a manual
  collapse stays collapsed (AC-6) and other entry points can't close a drawer
  the user opened. Comment the asymmetry, it is the non-obvious part.

- [ ] Task 3.1: Write `ui/src/components/TrackDetailPanel.test.jsx` first
      (TC-12…TC-14), mocking `useApi` + `useWebSocket`; confirm failure.
- [ ] Task 3.2: Implement the prop + App plumbing.
- [ ] Task 3.3: `cd ui && npm test` — full vitest suite green (catches any
      caller this signature change missed).

**Impact**: The click-through from Phase 2 lands on an open drawer. The feature
is functionally complete at the end of this phase.

---

## Phase 4: Real-browser verification + guardrails (AC-8, AC-10)

**Problem**: Component tests can't prove the three real pieces (panel → App →
detail panel, over the real API) are actually wired together — exactly the
failure mode called out in the skill's implement/quality-gate rules.

**Solution**: `conductor/tests/playwright/track-10024-worktree-running-transcript.spec.js`,
modelled on `track-1112-worktree-panel.spec.js` (fast tier — deterministic, no
LLM, no live claim; new specs default to `fast` per `playwright.config.js`).

Seeds `workers.worktrees` directly with two rows for this project: one
`lane_status: 'running'`, one not. Restores the original payload in
`afterAll`. Drives: select project → Worktrees tab → assert badge present on the
running row and absent on the other → click badge → assert the track detail
slide-over is open on that track **and** the `Live Transcript` drawer is
visible.

- [ ] Task 4.1: Write the spec.
- [ ] Task 4.2: Ensure UI + API are running the branch's code (`make ui-start`,
      `make api-start`; **restart** them — they do not hot-reload the server
      half) and run
      `npx playwright test conductor/tests/playwright/track-10024-worktree-running-transcript.spec.js --project=fast`.
      Record the real observed result (pass/fail + screenshot) in
      `conversation.md`. Do not tick this task off a spec that was written but
      never executed.
- [ ] Task 4.3: Verify AC-8 mechanically — `git diff --name-only main...` shows
      no `ui/server/**`, no `conductor/services/worktree-audit.mjs`, no
      migration.
- [ ] Task 4.4: Update `test.md` checkboxes from actual runs, then finish per
      `workflow.json` (`implement.on_success` → `review:queue`).

**Impact**: Proven end-to-end in a real browser, with the "no new backend
surface" constraint enforced by inspection rather than assumed.

---

## Explicit non-goals (do not drift into these)

- No `worker_id` / `worker_dispatch` / `workers.current_task` join anywhere.
- No change to `GET /api/projects/:id/worktrees` or the heartbeat payload.
- No wiring to `WorkerActivityLatch`, and no third transcript mechanism.
- No new stale-run detection or "run finished" reconciliation — REQ-6 is
  satisfied by the existing empty state plus an honest tooltip.

## ✅ REVIEWED

All 4 phases verified against the real diff: `git diff --name-only` confirms
no `ui/server/**`, no `worktree-audit.mjs`, no migration touched (AC-8). Code
read line-by-line against REQ-1..4. Independently re-ran (not just trusted)
all 15 vitest cases for this track's own files, the full `cd ui && npm test`
suite (403 passed / 32 pre-existing-baseline failures, confirmed unrelated via
`git stash` + rerun against untouched baseline), and the Playwright fast spec
against a freshly-started scratch UI+API pair from this worktree's own
checkout (2/2 pass, fixture cleanup confirmed). One non-blocking note left in
conversation.md about a pre-existing Track 1087 auto-expand race that AC-6
doesn't cover. Moved to quality-gate.
