# Tests: Track 10024 — Worktrees panel live run visibility

## Test Commands

```bash
# Unit + component (vitest) — the whole UI suite
cd ui && npm test

# Just this track's new specs, while iterating
cd ui && npx vitest run src/lib/worktreeRunState.test.js
cd ui && npx vitest run src/components/WorktreesPanel.test.jsx
cd ui && npx vitest run src/components/TrackDetailPanel.test.jsx

# Real browser (fast tier) — requires UI :8090 + API :8091 running THIS branch's
# code (restart them; the server half does not hot-reload)
npx playwright test conductor/tests/playwright/track-10024-worktree-running-transcript.spec.js --project=fast
```

## Test Cases

### Phase 1 — `isWorktreeRowRunning` (`src/lib/worktreeRunState.test.js`)

- [ ] TC-1: `{ track: '10024', lane_status: 'running' }`, `busy: false` — expected: `true` (server-reported run, e.g. a lane re-dispatch not started from this panel).
- [ ] TC-2: `{ track: '10024', lane_status: 'queue' }`, `busy: true` — expected: `true` (client-initiated dispatch still pending).
- [ ] TC-3: `{ track: '10024', lane_status: 'queue' }`, `busy: false` — expected: `false`.
- [ ] TC-4: `{ track: null, lane_status: 'running' }`, `busy: true` — expected: `false` (detached row: no track, nothing to open).
- [ ] TC-5: `{ track: '10024', lane_status: 'RUNNING' }`, `busy: false` — expected: `true` (case-insensitive).
- [ ] TC-6: `{}` / `undefined` row — expected: `false`, no throw.

### Phase 2 — Worktrees panel wiring (`src/components/WorktreesPanel.test.jsx`)

`useApi` mocked to serve one running row and one idle row from
`/api/projects/:id/worktrees`; `onSelectTrack` a `vi.fn()`.

- [ ] TC-7: running row renders `worktree-running-badge`; expected: badge present, text contains `Running`.
- [ ] TC-8: idle row renders no `worktree-running-badge`; expected: query returns null for that row.
- [ ] TC-9: clicking the running row's badge — expected: `onSelectTrack` called once with `(projectId, '<track>', { transcript: true })`.
- [ ] TC-10: clicking the running row's `#<track> ↗` link — expected: `onSelectTrack` called with `{ transcript: true }` (REQ-3).
- [ ] TC-11: clicking the idle row's `#<track> ↗` link — expected: `onSelectTrack` called with `{ transcript: false }`, i.e. today's behavior preserved (AC-4).
- [ ] TC-11b: a detached row (`track: null`) renders neither the badge nor a link button (AC-7).

### Phase 3 — TrackDetailPanel auto-open (`src/components/TrackDetailPanel.test.jsx`)

`useApi` mocked to return empty/OK for every fetch; `useWebSocket` mocked to a no-op.

- [ ] TC-12: rendered with `initialTranscriptOpen` — expected: the `Live Transcript` drawer is in the document on first paint, without clicking the Transcript toggle.
- [ ] TC-13: rendered without the prop — expected: no `Live Transcript` drawer (existing default preserved for Kanban/Inbox/Workers entry points).
- [ ] TC-14: rendered with `initialTranscriptOpen`, then the drawer's ✕ clicked, then a re-render (prop unchanged) — expected: drawer stays closed; nothing reopens it (AC-6).

### Phase 4 — Real browser (`conductor/tests/playwright/track-10024-worktree-running-transcript.spec.js`)

Seeds `workers.worktrees` for project 1 with `{ track: '19997', lane_status:
'running', class: 'open' }` and a non-running control row; restores the original
payload afterwards.

- [ ] TC-15: Worktrees tab shows the running row with a visible `worktree-running-badge`, and the control row without one — expected: both assertions hold against the real API response.
- [ ] TC-16: clicking the running badge — expected: the track detail slide-over opens on `#19997` **and** `Live Transcript` is visible without any further click (AC-2, the end-to-end proof).
- [ ] TC-17: clicking the control row's `#<track> ↗` — expected: detail opens with **no** `Live Transcript` drawer (AC-4 in a real browser).

## Regression Checks

- [ ] RC-1: `cd ui && npm test` — full suite green, in particular the existing
      `WorkersList`, `ConductorPanel`, `worktreeStats`, `worktreePendingKeys`
      and `streamTranscript` suites (the `onSelectTrack` signature widening and
      the `TrackDetailPanel` prop must not disturb them).
- [ ] RC-2: Inbox / Workers list / WorkerActivityLatch deep-links still open the
      track detail with the transcript drawer **closed** (covered by TC-13 at
      component level; spot-check once in the browser).
- [ ] RC-3: `npx playwright test --project=fast` — the pre-existing fast tier
      still passes (notably `track-1112-worktree-panel.spec.js` and
      `track-10018-pr-worktree-panel.spec.js`, which render the same rows).

## Acceptance Criteria

- [ ] All unit + component tests above pass (`cd ui && npm test`)
- [ ] TC-15…TC-17 pass in a real browser, result recorded in `conversation.md`
- [ ] `git diff --name-only` touches no `ui/server/**`, no
      `conductor/services/worktree-audit.mjs`, no migration (spec AC-8)
- [ ] No regressions in the existing fast Playwright tier
