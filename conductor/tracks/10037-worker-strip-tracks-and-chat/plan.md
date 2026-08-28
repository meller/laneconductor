# Track AM-10037: Worker Strip — Running/Last Track + Chat With Worker

## Phase 1: API — last-context track per worker

**Problem**: The UI has no way to know which track a worker last worked on (and thus holds a warm session for).
**Solution**: Enrich the worker list endpoints server-side from `track_sessions` — no schema change.

- [x] Task 1: In `ui/server/index.mjs`, find every endpoint that returns worker rows consumed by WorkersList / Machine Workers view (`GET /api/workers`, project-scoped variant) and add a `LEFT JOIN LATERAL` on `track_sessions` (order `last_used_at DESC LIMIT 1`) exposing `last_track_number`, `last_track_used_at`; set `last_track_project_id` from `w.project_id`.
- [x] Task 2: Unit/integration test: seed a worker + two `track_sessions` rows with different `last_used_at`; assert the endpoint returns the newer `track_number` and that workers with no sessions return `last_track_number: null`.

**Impact**: Every worker payload carries its last-context track; no consumer breaks (additive fields only).

## Phase 2: Strip — active-first ordering + running/last track chips

**Problem**: Busy workers can be scrolled out of view; running track is a low-affordance text chip; last track is absent.
**Solution**: Sort and add chips in `ui/src/components/WorkersList.jsx` (strip layout, ~line 583+).

- [ ] Task 1: Sort the `workers` array for the strip render: (a) `status === 'busy'` or non-null `current_task` first, (b) project workers before managers within each class, (c) stable tiebreak hostname + worker_number. Extract as a pure exported helper `sortWorkersForStrip(workers)` for testability.
- [ ] Task 2: Promote the running-track chip: keep the existing `parseWorkerTask`/`onSelectTrack` deep-dive behavior, styled as a first-class chip (track number + action), still truncating gracefully.
- [ ] Task 3: Add the last-track chip (`last: NNN`) when `last_track_number` is present and differs from the running track; tooltip per spec REQ-3; clicking opens the worker chat (Phase 3) scoped to that track.
- [ ] Task 4: Component tests (Vitest + RTL, alongside existing `WorkersList.test.jsx`): ordering (AC-1), running-chip deep-dive callback args (AC-2), last-chip render + click handler (AC-3 UI half).

**Impact**: The strip surfaces what matters first and makes both track contexts one click away.

## Phase 3: Worker chat panel (reusing Live Transcript machinery)

**Problem**: No way to talk to a worker from the UI.
**Solution**: A `WorkerChatPanel` component: live transcript (reused) + message input wired to the track-conversation comment path.

- [ ] Task 1: Create `ui/src/components/WorkerChatPanel.jsx`. Transcript pane: reuse `TranscriptView.jsx` + `createTranscriptState`/`reduceStreamEvent` + the `/transcript` fetch + WS stream-event subscription exactly as `WorkerActivityLatch.jsx` does (extract a shared hook `useTrackTranscript(projectId, trackNumber)` into `ui/src/lib/` if the duplication is nontrivial — do not fork the reducer).
- [ ] Task 2: Target-track resolution: running track (`parseWorkerTask(current_task)`) if busy, else `last_track_number`; show the scoped track prominently in the panel header ("Talking to <hostname> about track NNN"). Neither → disabled input + hint (REQ-5), managers → transcript-only (REQ-7).
- [ ] Task 3: Message send: POST to the same comments endpoint the Conversation tab uses (`author: 'human'`); optimistic append in the panel; the existing waiting_for_reply/resume machinery does the rest. Only add a `POST /api/workers/:id/message` delegating wrapper if the direct endpoint proves insufficient.
- [ ] Task 4: Open the panel from the strip: clicking the worker's hostname/body (or a small 💬 button) opens `WorkerChatPanel`; last-track chip opens it pre-scoped to the last track.
- [ ] Task 5: Component tests: target-track resolution matrix (busy / idle-with-last / neither / manager), send → fetch called with right endpoint+body, transcript events render.

**Impact**: "Push the worker" exists — one surface to watch and talk to a worker, at the cost the warm session already paid for.

## Phase 4: Machine Workers view parity

**Problem**: The same affordances must exist in workers mode, not just the lanes strip.
**Solution**: Wire the chat into the grid layout and `WorkerActivityLatch`.

- [ ] Task 1: Grid layout worker cards (`WorkersList.jsx` grid branch): add the same running/last chips and 💬 chat affordance.
- [ ] Task 2: `WorkerActivityLatch.jsx`: its transcript pane gains the message input (same component/hook as Phase 3 — compose, don't duplicate), so selecting a worker there shows transcript + chat in place.
- [ ] Task 3: Component tests for both surfaces (AC-6).

**Impact**: Watching and talking to workers is consistent everywhere workers are shown.

## Phase 5: E2E verification (real worker, local API)

**Problem**: The wake-the-agent half of AC-4 cannot be proven by component tests.
**Solution**: One real end-to-end pass against the local stack.

- [ ] Task 1: With the local API + a real `--sync-only` worker running and a track it previously ran (warm `track_sessions` row): send a message from the worker chat; verify (a) the comment lands in `conversation.md` in the required `> **human**:` format, (b) the worker's next cycle wakes the agent with `--resume` (observe log line / transcript activity), (c) the agent's reply appears back in the chat's transcript view. Record observed evidence in conversation.md.
- [ ] Task 2: Playwright spec (alongside `conductor/tests/playwright/`) covering strip ordering + opening chat + sending a message against the mock/real stack as feasible.

**Impact**: AC-4/AC-5 verified against the real product, per quality-gate rules.
