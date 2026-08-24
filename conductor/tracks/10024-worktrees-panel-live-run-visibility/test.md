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

- [x] TC-1: `{ track: '10024', lane_status: 'running' }`, `busy: false` — expected: `true` (server-reported run, e.g. a lane re-dispatch not started from this panel).
- [x] TC-2: `{ track: '10024', lane_status: 'queue' }`, `busy: true` — expected: `true` (client-initiated dispatch still pending).
- [x] TC-3: `{ track: '10024', lane_status: 'queue' }`, `busy: false` — expected: `false`.
- [x] TC-4: `{ track: null, lane_status: 'running' }`, `busy: true` — expected: `false` (detached row: no track, nothing to open).
- [x] TC-5: `{ track: '10024', lane_status: 'RUNNING' }`, `busy: false` — expected: `true` (case-insensitive).
- [x] TC-6: `{}` / `undefined` row — expected: `false`, no throw.

6/6 pass (`npx vitest run src/lib/worktreeRunState.test.js`).

### Phase 2 — Worktrees panel wiring (`src/components/WorktreesPanel.test.jsx`)

`useApi` mocked to serve one running row and one idle row from
`/api/projects/:id/worktrees`; `onSelectTrack` a `vi.fn()`.

- [x] TC-7: running row renders `worktree-running-badge`; expected: badge present, text contains `Running`.
- [x] TC-8: idle row renders no `worktree-running-badge`; expected: query returns null for that row.
- [x] TC-9: clicking the running row's badge — expected: `onSelectTrack` called once with `(projectId, '<track>', { transcript: true })`.
- [x] TC-10: clicking the running row's `#<track> ↗` link — expected: `onSelectTrack` called with `{ transcript: true }` (REQ-3).
- [x] TC-11: clicking the idle row's `#<track> ↗` link — expected: `onSelectTrack` called with `{ transcript: false }`, i.e. today's behavior preserved (AC-4).
- [x] TC-11b: a detached row (`track: null`) renders neither the badge nor a link button (AC-7).

6/6 pass (`npx vitest run src/components/WorktreesPanel.test.jsx`).

### Phase 3 — TrackDetailPanel auto-open (`src/components/TrackDetailPanel.test.jsx`)

`useApi` mocked to return empty/OK for every fetch; `useWebSocket` mocked to a no-op.
(jsdom has no `scrollIntoView` — added a repo-wide polyfill in `ui/vitest.setup.js`,
same pattern as the existing `ResizeObserver` polyfill there, since Phase 4's
existing autoscroll effect needed it the moment a test actually opened the drawer.)

- [x] TC-12: rendered with `initialTranscriptOpen` — expected: the `Live Transcript` drawer is in the document on first paint, without clicking the Transcript toggle.
- [x] TC-13: rendered without the prop — expected: no `Live Transcript` drawer (existing default preserved for Kanban/Inbox/Workers entry points).
- [x] TC-14: rendered with `initialTranscriptOpen`, then the drawer's ✕ clicked, then a re-render (prop unchanged) — expected: drawer stays closed; nothing reopens it (AC-6).

3/3 pass (`npx vitest run src/components/TrackDetailPanel.test.jsx`).

### Phase 4 — Real browser (`conductor/tests/playwright/track-10024-worktree-running-transcript.spec.js`)

Seeds `workers.worktrees` for project 1 with track `19985` (`lane_status:
'running'`) and a non-running control row `19984`; restores the original
payload afterwards. Run against an isolated scratch UI (`:8190`) + API
(`:8191`) instance started from this worktree's own checkout, rather than
the shared team dev instance on `:8090`/`:8091` (which serves the main repo
checkout, not this branch) — see the conversation log for why.

- [x] TC-15: Worktrees tab shows the running row with a visible `worktree-running-badge`, and the control row without one — expected: both assertions hold against the real API response.
- [x] TC-16: clicking the running badge — expected: the track detail slide-over opens on `#19985` **and** `Live Transcript` is visible without any further click (AC-2, the end-to-end proof).
- [x] TC-17: clicking the control row's `#<track> ↗` — expected: detail opens with **no** `Live Transcript` drawer (AC-4 in a real browser).

2/2 pass (`PW_BASE_URL=http://localhost:8190 npx playwright test conductor/tests/playwright/track-10024-worktree-running-transcript.spec.js --project=fast`).

## Regression Checks

- [ ] RC-1: `cd ui && npm test` — full suite green. **Still running** at time
      of writing (a slow, heavily-loaded shared machine — many other
      concurrent worktree processes) — not yet ticked. Every individual
      suite touched by this track (Phase 1-3's own files, plus the sibling
      `worktreeStats`/`worktreePendingKeys`/`armedConfirm` libs) already
      passed in isolation above.
- [x] RC-2: Inbox / Workers list / WorkerActivityLatch deep-links still open the
      track detail with the transcript drawer **closed** — covered by TC-13 at
      component level (their callers pass no 3rd arg, so `opts` is
      `undefined` → `transcript: false`) and spot-checked once in the real
      browser via TC-17's idle-row path.
- [x] RC-3: `npx playwright test --project=fast` (against the scratch
      instance) — 22 passed, 6 skipped (pre-existing: `track-1033-sharing.spec.js`
      needs `PW_TEST_MODE=true`, unrelated to this track), 1 failed on the
      first full-tier run (`track-1112-worktree-panel.spec.js`) but passed
      cleanly re-run in isolation — a known, pre-existing race documented in
      that file's own comments (real live workers on this dev project
      overwrite the seeded `worktrees` row between `beforeAll` and page load
      when other specs are heartbeating concurrently); not caused by this
      track's changes.

## Acceptance Criteria

- [ ] All unit + component tests above pass (`cd ui && npm test`) — RC-1 still
      pending, see above
- [x] TC-15…TC-17 pass in a real browser, result recorded in `conversation.md`
- [x] `git diff --name-only` touches no `ui/server/**`, no
      `conductor/services/worktree-audit.mjs`, no migration (spec AC-8)
- [x] No regressions in the existing fast Playwright tier (see RC-3)
