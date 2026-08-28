# Tests: Track 10037 — Worker Strip Tracks And Chat

## Test Commands
```bash
# Frontend unit/component tests (Phases 1-4)
cd ui && npx vitest run

# Backend API test for Phase 1 specifically
cd ui && npx vitest run server/tests/track-10037-worker-last-track.test.mjs

# Playwright E2E (Phase 5) — requires a live UI+API instance running this
# branch's code (see the spec file's own header for how to point it at an
# isolated scratch instance via PW_BASE_URL / SCRATCH_API_PORT)
npx playwright test conductor/tests/playwright/track-10037-worker-chat.spec.js --project=fast
```

## Test Cases

### Phase 1: API — last-context track per worker
`ui/server/tests/track-10037-worker-last-track.test.mjs`
- [x] TC-1: `GET /api/projects/:id/workers` returns `last_track_number`/`last_track_project_id` from the newest `track_sessions` row.
- [x] TC-2: a worker with no `track_sessions` rows returns `last_track_number: null`.
- [x] TC-3: the SQL uses `LEFT JOIN LATERAL` on `track_sessions`, ordered `last_used_at DESC`.
- [x] TC-4: `GET /api/workers` (all-projects) carries the same enrichment.

### Phase 2: Strip ordering + chips
`ui/src/lib/workerSort.test.js`, `ui/src/lib/workerTaskInfo.test.js`, `ui/src/components/WorkersList.chat.test.jsx`
- [x] TC-5 (AC-1): a busy worker (or one with a non-null `current_task`) sorts before idle workers.
- [x] TC-6: project workers sort before managers within the same activity class; stable hostname/worker_number tiebreak; input array not mutated.
- [x] TC-7 (AC-2): clicking the running-track chip calls `onSelectTrack(project_id, trackNumber)`.
- [x] TC-8 (AC-3): the last-track chip renders when `last_track_number` is present and differs from the running track, and is absent when it matches.
- [x] TC-9 (AC-3): clicking the last-track chip opens the chat panel pre-scoped to that track.

### Phase 3: WorkerChatPanel + target resolution
`ui/src/lib/workerTaskInfo.test.js` (`resolveWorkerChatTarget`), `ui/src/components/WorkerChatPanel.test.jsx`
- [x] TC-10: a manager never resolves to a chat target, even mid-"track"-shaped task.
- [x] TC-11: running track wins over last-context track.
- [x] TC-12: idle worker falls back to `last_track_number`.
- [x] TC-13: neither running nor last → `null` target → composer disabled with a hint.
- [x] TC-14 (AC-4, UI half): sending a message POSTs to `/api/projects/:id/tracks/:num/comments` with `{author: 'human', body}` — never a `/dispatch` endpoint.
- [x] TC-15 (AC-5): transcript blocks fetched for the resolved track render via `TranscriptView`.

### Phase 4: Machine Workers view parity
`ui/src/components/WorkersList.chat.test.jsx`, `ui/src/components/WorkerActivityLatch.test.jsx`
- [x] TC-16 (AC-6): grid layout worker cards render the same running/last chips and a 💬 chat button; absent for managers.
- [x] TC-17: `WorkerActivityLatch`'s composer targets the running track when busy, the last-context track when idle, is disabled with a hint when neither exists, and is disabled (transcript-only) for managers.
- [x] TC-18: sending a message from `WorkerActivityLatch` POSTs to the comments endpoint, not a dispatch endpoint — same wiring as `WorkerChatPanel`, not a fork.

### Phase 5: E2E verification (real API + DB, isolated instance)
`conductor/tests/playwright/track-10037-worker-chat.spec.js` — real Postgres rows (`workers`, `tracks`, `track_sessions`), driven against an isolated scratch UI+API instance of this branch (`API_PORT=18091` / `SCRATCH_API_PORT=18091` + `vite --port 18090`), never the shared dev stack.
- [x] TC-19 (AC-2): running-track chip shows the real track number and opens the real track detail panel.
- [x] TC-20 (AC-3): last-track chip shows the real last-context track and opens chat pre-scoped to it.
- [x] TC-21 (AC-4): sending a message from the chat panel creates a real `track_comments` row (author `human`) via the real comments endpoint — verified by a direct Postgres query after the UI action.
- [x] TC-22 (AC-4, wake mechanism): posting a human comment against a track sitting idle (`lane_action_status: success`) in an actionable lane (`plan`/`implement`/`review`/`quality-gate`) re-queues it (`lane_action_status → queue`) — live-verified via a direct `curl` POST + `psql` check against the isolated instance (`ui/server/index.mjs`'s `/track/:num/comment` handler, the `safeAuthor === 'human' && !no_wake` branch).
- [ ] TC-23 (AC-4, full loop): a real worker actually claims the re-queued track and resumes the stored Claude session (`--resume <claude_session_id>`, `laneconductor.sync.mjs` line ~5329) and the reply appears in the transcript. **Not run** — would require spawning a real, costed Claude CLI session from inside this already-running autonomous session; verified instead by direct code inspection of `resolveOrCreateTrackSession`/`buildCliArgs` (`conductor/laneconductor.sync.mjs` lines 5283-5329) plus the live TC-22 re-queue result, which together establish every precondition the resume path depends on. See `conversation.md` for the full reasoning.

## Acceptance Criteria
- [x] AC-1: busy worker sorts first in the strip (TC-5).
- [x] AC-2: running-track chip deep-dives into the right project/track (TC-7, TC-19).
- [x] AC-3: last-track chip renders and opens pre-scoped chat (TC-8, TC-9, TC-20).
- [x] AC-4: comment posts through the real endpoint and lands as a real DB row (TC-14, TC-21) and re-queues the track (TC-22); the full agent-resume loop is code-verified, not live-run (TC-23).
- [x] AC-5: live transcript renders for the resolved track (TC-15).
- [x] AC-6: Machine Workers view (grid + `WorkerActivityLatch`) has the same affordances (TC-16, TC-17, TC-18).
- [x] AC-7: `GET /api/workers` carries `last_track_number` without breaking existing consumers (TC-4, full `vitest run` suite green apart from pre-existing unrelated failures).
