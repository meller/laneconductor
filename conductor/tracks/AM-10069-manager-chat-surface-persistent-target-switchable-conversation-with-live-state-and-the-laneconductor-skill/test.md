# Tests: Track AM-10069 — Manager chat surface — persistent, target-switchable conversation with live state and the /laneconductor skill

## Test Commands

```bash
# Pure worker/CLI modules and integration (node:test — spawns processes, touches fs)
node --test conductor/tests/track-10069-instance-state.test.mjs
node --test conductor/tests/track-10069-setup-gaps.test.mjs
node --test conductor/tests/track-10069-manager-chat-plumbing.test.mjs
node --test conductor/tests/track-10069-manager-chat-contract.test.mjs

# UI unit/integration (Vitest) and server routes (Vitest + supertest)
cd ui && npm test

# Browser E2E
cd ui && npx playwright test e2e/track-10069-chat-view.spec.js

# Whole suite
cd ui && npm test && cd .. && node --test conductor/tests/
```

## Test Cases

### Phase 1 — Instance state and setup gaps (`conductor/tests/track-10069-instance-state.test.mjs`, `…-setup-gaps.test.mjs`)

- [ ] TC-1.1: `buildInstanceState` with injected fixtures for two projects returns per-lane
      track counts matching the fixtures exactly — expected: counts equal, no lane invented,
      no lane dropped.
- [ ] TC-1.2: A worker whose `last_heartbeat` is one second inside the staleness window is
      `online: true`; one second outside is `online: false` — expected: the boundary matches
      `isWorkerOffline`'s threshold, asserted by importing it rather than restating it.
- [ ] TC-1.3: `buildInstanceState` on an empty instance (zero projects) returns a valid
      snapshot, not a throw — expected: `projects: []`, no exception.
- [ ] TC-1.4: `computeSetupGaps` on a fully configured fixture returns `[]` — expected:
      empty array, the case that must stay free (REQ-18).
- [ ] TC-1.5: Each of D4's seven gap conditions, one test apiece, produces exactly its own
      gap id with the right severity — expected: `no-projects`/`no-workers`/`no-provider`
      are `blocking`; `no-manager`/`no-conductor-context`/`no-quality-gate`/`no-tracks` are
      `advisory`.
- [ ] TC-1.6: Every returned gap carries a non-empty `remedy` string — expected: no gap can
      reach the wizard with nothing actionable to say (REQ-19).
- [ ] TC-1.7: The digest projection over a large fixture (50 tracks, 8 workers) stays under
      its stated character budget — expected: under budget, so REQ-14's cost bound holds at
      realistic scale, not just on a toy fixture.
- [ ] TC-1.8: `lc state --json` on a real temp project prints parseable JSON whose track
      counts match a direct read of the same `conductor/tracks/*/index.md` files — expected:
      equal counts (AC-11).
- [ ] TC-1.9: `GET /api/state` with `AUTH_ENABLED` and a second user's private worker omits
      that worker — expected: absent, matching `/api/workers/:id/chat-history`'s scoping.

### Phase 2 — Live-turn affordances (`ui/src/lib/streamTranscript.test.js`, `TurnStatusBar.test.jsx`)

Fixtures are drawn from a **real** captured log (`conductor/logs/dispatch-plan-10069-*.log`),
not hand-written events — the same discipline `streamTranscript.test.js`'s existing header
already documents.

- [ ] TC-2.1: Every existing `streamTranscript` test passes unmodified — expected: `blocks`
      behaviour byte-for-byte unchanged (the regression guard for the whole phase).
- [ ] TC-2.2: A `system`/`init` event sets `turn.active`, `turn.model` and `turn.sessionId`
      — expected: populated from the event, not defaulted.
- [ ] TC-2.3: A sequence of `stream_event`/`message_delta` events leaves
      `turn.outputTokens` at the **last** value, not a sum of deltas — expected: matches the
      final event's `usage.output_tokens`.
- [ ] TC-2.4: `turn.contextTokens` is derived from `assistant` events only; feeding a
      `result` event with a large cumulative `cache_read_input_tokens` does **not** change it
      — expected: unchanged (the 14x-inflation trap `extractSessionContextTokens` documents).
- [ ] TC-2.5: A `content_block_start` with a `tool_use` block sets `turn.activity` to that
      tool's name — expected: e.g. `Read`, not a generic label (REQ-21).
- [ ] TC-2.6: `system`/`status` and `system`/`thinking_tokens` each change `turn.activity`,
      and replaying the real log produces at least three distinct activity values —
      expected: ≥3 distinct, proving it is not a static string (AC-4).
- [ ] TC-2.7: A terminal `result` event clears `turn.active` — expected: `active: false`,
      timers freeze downstream.
- [ ] TC-2.8: A log with no stream-json (plain text lines) yields `turn.active: false` and
      zero tokens — expected: `TurnStatusBar` renders nothing (REQ-24, AC-13).
- [ ] TC-2.9: `TurnStatusBar` with an active turn renders an elapsed value that advances
      across a fake-timer tick — expected: advances; with `active: false` it renders a frozen
      value and does not tick (REQ-22).

### Phase 3 — Chat view and target switcher (`ui/src/components/ChatView.test.jsx`)

- [ ] TC-3.1: A **Chat** nav button renders alongside CI/CD and is present with no project
      selected — expected: visible in All-Projects mode (REQ-1).
- [ ] TC-3.2: Opening the view with a manager in the worker list selects the manager by
      default — expected: manager row active on first render (REQ-3).
- [ ] TC-3.3: Selecting a worker target swaps the transcript to that worker's resolved
      track — expected: `useTrackTranscript` called with that track, one renderer, no modal
      mounted (REQ-4).
- [ ] TC-3.4: Switching projects and returning preserves the selected target — expected:
      same target still active (REQ-2).
- [ ] TC-3.5: A worker target's composer posts to
      `POST /api/projects/:id/tracks/:num/comments` for its resolved track — expected: that
      exact endpoint, i.e. 10037's behaviour, not a new dispatch action (D5).
- [ ] TC-3.6: A worker with neither a running nor a last-context track shows the existing
      "nothing to talk about" state rather than an enabled composer — expected: composer
      disabled with a hint.

### Phase 4 — Manager chat plumbing (`conductor/tests/track-10069-manager-chat-plumbing.test.mjs`, `ui/src/lib/workerTaskInfo.test.js`)

Every case here runs against a **fixture** `conductor/tracks/manager/` folder in a temp
project, so the phase is testable before track 10067 merges (REQ-31).

- [ ] TC-4.1: `resolveWorkerChatTarget({ type: 'manager', project_id: null }, 7)` returns
      `{ trackNumber: 'manager', projectId: 7 }` — expected: non-null, resolving to the
      passed `fallbackProjectId`, since a manager's own `project_id` is null by construction
      (REQ-25).
- [ ] TC-4.2: The existing resolver cases are unchanged — a worker running a track still
      resolves to that track, and an idle worker with no last-context track still returns
      `null` — expected: the current test file passes with only the manager case added.
- [ ] TC-4.3: `WorkerChatPanel` with a manager worker renders an **enabled** composer and no
      "Managers are transcript-only" hint — expected: enabled (REQ-26).
- [ ] TC-4.4: `GET /api/projects/:id/tracks/manager/comments` against a fixture folder
      returns the parsed turns as JSON — expected: 200 with the turns, not 404, and no
      `getTrackId` query issued (REQ-27).
- [ ] TC-4.5: `POST /api/projects/:id/tracks/manager/comments` appends a
      `> **human**: …` turn to the fixture's `conversation.md`, advances `.conv-cursor` past
      it, sets `**Waiting for reply**: yes` in the fixture's `index.md`, and issues **no**
      `collectorWrite` — expected: all four, asserted on the file contents and the mocked
      collector (REQ-27, D8).
- [ ] TC-4.6: With the marker set, `autoLaunchLocalFs` dispatches the reserved folder as
      `CONVERSATION_REPLY_ACTION` — expected: one dispatch, that action, and no lane
      transition written to the fixture's `index.md` (REQ-28).
- [ ] TC-4.7 (**the negative, and the more important half**): with `**Waiting for reply**`
      absent, the same folder is skipped by both digit guards — expected: no dispatch, no
      claim, no run marker, however long the loop runs.
- [ ] TC-4.8: `syncConversation` on the fixture's `conversation.md` returns early — expected:
      zero POSTs to `/track/manager/comment`, and `extractTrackNumber`'s own behaviour
      unchanged for every numbered input (REQ-29).
- [ ] TC-4.9: After a full fixture exchange, `init-tracks-summary` produces no `manager`
      line and the tracks-list query returns no row for it — expected: absent from both
      (REQ-30).

### Phase 5 — Manager target contract and skill-driven turns (`conductor/tests/track-10069-manager-chat-contract.test.mjs`)

- [ ] TC-5.1 (**contract, spec.md D7**): `conductor/tracks/manager/` exists with `index.md`
      and `conversation.md` for a supervised project — expected: present; a failure here is
      raised on track 10067, not patched around. This is one of only two things still
      consumed from that track.
- [ ] TC-5.2 (**contract**): the reserved folder name contains no digit in any position —
      expected: `/\d/` does not match it, so `isTrackDirName` keeps excluding it. A rename
      that reintroduces a digit silently un-hides the pseudo-track to the claim loop, which
      is why this is asserted rather than assumed.
- [ ] TC-5.3: A human turn in the real pseudo-track's conversation triggers a reply turn —
      expected: a spawned session against it within one worker cycle. This exercises Phase
      4's own trigger (D8) against the merged folder, not a 10067 contract.
- [ ] TC-5.4: A manager-target message spawns through the conversation-reply path, not the
      `--print` chat handler — expected: the spawned argv contains
      `--output-format stream-json`, asserted against the recorded command (REQ-6).
- [ ] TC-5.5: The opening manager turn's prompt contains the digest; the **second** message
      to the same target does not — expected: present then absent (REQ-15).
- [ ] TC-5.6: Two consecutive manager messages produce one `track_sessions` row, not two —
      expected: one row (AC-6).
- [ ] TC-5.7: `track_chat` and `worker_adhoc_chat` dispatches still complete and still
      return their reply in `worker_dispatch.result` — expected: unchanged, existing
      `track-1087-worker-chat-dispatch.test.mjs` and `chat-reply-conversation-md.test.mjs`
      pass untouched (AC-14).

### Phase 6 — Queued intervention (`ui/src/components/ChatView.queued.test.jsx`)

- [ ] TC-6.1: Sending while the target has a live run marker renders a **queued** state
      naming what it is waiting on — expected: queued, with the running action named (REQ-9).
- [ ] TC-6.2: The queued state clears when the WS event stream reports the turn ended —
      expected: cleared without a user action and without a new poll (REQ-10).
- [ ] TC-6.3: Sending to an idle target never shows the queued state — expected: normal send
      path, no false queueing.
- [ ] TC-6.4: No string rendered by the composer or its hints claims the running turn is
      interrupted, stopped or cancelled — expected: assert against the rendered text
      (REQ-11).

### Phase 7 — Conditional wizard (`ui/src/components/ChatView.wizard.test.jsx`)

- [ ] TC-7.1: With a blocking gap present, opening the view renders the wizard message
      naming that gap and its remedy — expected: both strings present (REQ-17, REQ-19).
- [ ] TC-7.2: With only advisory gaps, no wizard message renders; they appear as a header
      note instead — expected: no opening message (REQ-17).
- [ ] TC-7.3: With zero gaps, opening the view issues no POST at all — expected: no
      `worker_dispatch` insert, no comment write, asserted on the mocked API (REQ-18, AC-10).
- [ ] TC-7.4: The wizard message is rendered client-side from the gap list, with no model
      turn dispatched to produce it — expected: no dispatch, asserted the same way as TC-7.3.

### Phase 8 — Real-product E2E (`ui/e2e/track-10069-chat-view.spec.js`)

- [ ] TC-8.1: Navigate to Chat, confirm the view renders with a target list and a composer
      — expected: both present in a real browser (AC-1).
- [ ] TC-8.2: Select a busy worker, confirm its live transcript renders and the composer
      targets its track — expected: transcript blocks visible (AC-8).
- [ ] TC-8.3: Against a fixture instance with a blocking gap, confirm the wizard appears;
      against a configured one, confirm it does not — expected: both branches (AC-9, AC-10).
- [ ] TC-8.4: Confirm the affordances also render on an ordinary lane-action transcript in
      `TrackDetailPanel` — expected: same bar, one implementation (AC-12).

## Acceptance Criteria

- [ ] All unit tests pass (`cd ui && npm test`)
- [ ] All worker/CLI tests pass (`node --test conductor/tests/`)
- [ ] Playwright spec passes against a restarted worker and API (never a stale process)
- [ ] AC-2 through AC-7 verified manually against a live manager, with the observed result
      recorded in `conversation.md` — these are not unit-testable and must not be claimed
      from a passing unit suite
- [ ] Phase 4's plumbing re-verified against the **real** merged 10067 pseudo-track, not
      only the fixture (AC-15..AC-19) — the fixture proves the branches work, not that the
      folder 10067 ships matches them
- [ ] No regression in `track_chat` / `worker_adhoc_chat` (AC-14), in the existing
      `streamTranscript` block behaviour (TC-2.1), or in `WorkerChatPanel` /
      `WorkerActivityLatch` / `TrackDetailPanel`
