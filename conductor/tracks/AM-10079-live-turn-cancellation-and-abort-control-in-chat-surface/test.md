# Tests: Track AM-10079 — Live turn cancellation and abort control in Chat surface

## Test Commands

```bash
# Phase 1 + 3 + 5 — worker-side, real processes (zero deps)
env -u NODE_TEST_CONTEXT node --test conductor/tests/track-10079-run-abort.test.mjs
env -u NODE_TEST_CONTEXT node --test conductor/tests/track-10079-abort-lifecycle.test.mjs

# Phase 4 — UI
cd ui && npx vitest run src/components/TurnStatusBar.test.jsx src/components/ChatView.test.jsx

# Regression: every suite that asserts on exit-handler outcomes Phase 3 touches
env -u NODE_TEST_CONTEXT node --test conductor/tests/track-10020-run-marker-lifecycle.test.mjs \
  conductor/tests/track-10020-run-marker.test.mjs \
  conductor/tests/track-10065-*.test.mjs \
  conductor/tests/track-1102-f21-*.test.mjs \
  conductor/tests/track-10055-*.test.mjs

# Full suites
env -u NODE_TEST_CONTEXT node --test conductor/tests/*.test.mjs
cd ui && npm test

# Syntax
find conductor ui bin -name "*.mjs" -not -path "*/node_modules/*" -exec node --check {} +
```

> **`env -u NODE_TEST_CONTEXT` is required** on every `node --test` invocation here —
> the track-1096 gotcha, already documented in `conductor/quality-gate.md`.

## Test Cases

### Phase 1 — `conductor/services/run-abort.mjs` (`track-10079-run-abort.test.mjs`)

- [ ] TC-1.1: `writeAbortIntent` sets `abort_requested`, `abort_requested_at`,
      `abort_requested_by` — expected: set, and `pid`/`pgid`/`worker_pid`/`action`/
      `command`/`started_at` all byte-identical to the input marker (REQ-2).
- [ ] TC-1.2: `readAbortIntent` on a marker with no `abort_requested` field — expected:
      `null`, so every pre-existing marker behaves exactly as today (REQ-3).
- [ ] TC-1.3: `readAbortIntent` on an intent-bearing marker — expected: the intent, with
      its requester and timestamp.
- [ ] TC-1.4: `signalRunGroup` when `isPidAlive` returns false — expected: no `kill` call
      at all, and a `pid-gone` reason returned (REQ-4).
- [ ] TC-1.5: **Pid reuse.** `isPidAlive` true but `readProcessCommand` returns a command
      that does not contain the marker's recorded `command` — expected: **no `kill` call**,
      reason `command-mismatch`. This is the criterion that stops an innocent recycled pid
      being killed (AC-10).
- [ ] TC-1.6: `pgid` of `0`, `1`, `-3`, `undefined` and `"1234"` — expected: refused, no
      `kill` call, for each (REQ-4).
- [ ] TC-1.7: On a live marker, `signalRunGroup` calls `kill(-pgid, sig)` — expected: the
      first argument is **negative**, asserting the group and not the bare pid is signalled.
- [ ] TC-1.8: `nextAbortStage` — expected: `null → SIGINT → SIGTERM → SIGKILL`, and
      `SIGKILL` is terminal (REQ-5).
- [ ] TC-1.9: `getAbortGraceConfig` with `LC_ABORT_SIGINT_GRACE_MS=250` — expected: 250,
      overriding the 5000 default; unset — expected: 5000 (REQ-5).
- [ ] TC-1.10: `abortRun` against a marker whose pid belongs to a **real process that has
      already exited** — expected: refused, nothing signalled, no intent written.

### Phase 2 — endpoint and CLI (`track-10079-abort-lifecycle.test.mjs`)

- [ ] TC-2.1: `POST .../abort` with a live marker — expected: `202`, body carries the
      marker's `pid`/`pgid` and `signal: 'SIGINT'`, and the intent is on disk in
      `conductor/.runs/<n>.json` **before** the response returns (REQ-6, REQ-8).
- [ ] TC-2.2: `POST .../abort` with no marker present — expected: `409`, reason names the
      track, and no process is signalled (AC-9).
- [ ] TC-2.3: `POST .../abort` with a stale (pid-gone) marker — expected: `409`, not `202`.
- [ ] TC-2.4: Second `POST .../abort` while the run is still live — expected: `202` with
      `already_requested: true`, and the signal stage has escalated (REQ-8).
- [ ] TC-2.5: `POST /api/projects/:id/tracks/manager/abort` against a live
      `conductor/.runs/manager.json` — expected: `202`, no `tracks`-row lookup performed,
      no lane reconciliation attempted (REQ-7, AC-11).
- [ ] TC-2.6: Unknown project id — expected: `404` (REQ-8).
- [ ] TC-2.7: Marker whose pid is not a local process — expected: `501` naming the remote
      deferral, **not** `202` and not a silent success (REQ-9).
- [ ] TC-2.8: `lc abort <track>` in a `local-fs` sandbox with **no API server running** —
      expected: exit 0, the child's process group is gone, the intent is on disk (REQ-10,
      AC-12).
- [ ] TC-2.9: `lc abort <track>` with nothing running — expected: non-zero exit and a
      diagnostic on stderr, matching `lc track-dir`'s failure convention.

### Phase 3 — abort semantics (`track-10079-abort-lifecycle.test.mjs`)

Each of these spawns a **real** worker and a real long-running mock CLI child in a sandbox,
then aborts it — following `track-10020-run-marker-lifecycle.test.mjs`'s pattern.

- [ ] TC-3.1: **The group actually dies.** After abort, no member of the recorded `pgid`
      survives the SIGINT grace window — asserted with `process.kill(-pgid, 0)` throwing
      `ESRCH` (AC-1).
- [ ] TC-3.2: **Escalation.** A child that ignores SIGINT and SIGTERM is still gone after
      the SIGKILL stage, with the grace windows shortened by env override (REQ-5).
- [ ] TC-3.3: **Lane unchanged.** `index.md`'s `**Lane**` after abort equals its value
      before — for a run aborted in `implement`, and again in `quality-gate` (whose
      `on_failure` is `plan:queue`, the most destructive misroute) (AC-2, REQ-13).
- [ ] TC-3.4: **Parked, with a reason.** `**Lane Status**: waiting` and a
      `**Waiting Reason**` of "Cancelled by user"; DB `lane_action_result` is `'aborted'`
      (AC-2, REQ-14).
- [ ] TC-3.5: **No retry consumed.** The lane's fail count after abort equals its value
      before (AC-4, REQ-13).
- [ ] TC-3.6: **No re-claim.** On an `**Auto Run**: yes` track, after abort, the worker
      runs several full poll cycles and **no** new dispatch log file appears for that track
      — proving absence over time, not with a single immediate check (AC-3).
- [ ] TC-3.7: **The comment.** `conversation.md` gains exactly one new `system` turn whose
      body's first character is `⚠️` and which says the turn was cancelled by the user;
      the string "Automation failed" appears nowhere in the file (AC-5, REQ-15).
- [ ] TC-3.8: **The race.** With an intent written but the child exiting `0` before the
      signal lands, the run is reported as `success` and the track transitions normally —
      never as a cancellation (REQ-12). Driven by a mock CLI that exits immediately.
- [ ] TC-3.9: **Locks released.** After abort: the track's git lock file is gone, and
      `git status --porcelain` in the primary checkout shows no merge/rebase state
      (AC-6, REQ-17).
- [ ] TC-3.10: **Worktree preserved.** Under `per-cycle` lifecycle the worktree still
      exists after abort and still contains a marker file the mock CLI wrote before it was
      killed — proving partial work survives (AC-6, REQ-17).
- [ ] TC-3.11: **Run marker removed.** `conductor/.runs/<n>.json` is gone once finalization
      completes, so the track is not permanently seen as live (REQ-17).
- [ ] TC-3.12: **Resume works.** `POST .../resume` on the cancelled track returns it to
      `<same lane>:queue`, and a worker then claims and starts it again (AC-7).
- [ ] TC-3.13: **Conversation reply abort.** A live `local-fs-answer` run is aborted —
      expected: no `**Lane**`/`**Lane Status**` write at all, `**Waiting for reply**: no`,
      and across several subsequent poll cycles the worker does **not** dispatch another
      reply for that track (AC-8, REQ-16).
- [ ] TC-3.14: **Manager pseudo-track abort.** Same as TC-3.13 for
      `conductor/tracks/manager/` — expected: no attempt to parse `manager` as a track
      number, no lane write (REQ-7).
- [ ] TC-3.15: **Signal recorded.** A signalled exit's `lane_action_result` names the
      signal rather than reading `error (code null)` (REQ-11).

### Phase 4 — UI (`TurnStatusBar.test.jsx`, `ChatView.test.jsx`)

- [ ] TC-4.1: With `canAbort` true, a Stop control renders — expected: present and enabled
      (REQ-18).
- [ ] TC-4.2: With `canAbort` true and `turn` null/inactive — expected: the bar renders
      anyway, so a just-started or non-claude run is still stoppable (REQ-18). This is the
      regression guard on the existing `if (!turn) return null`.
- [ ] TC-4.3: With `canAbort` false and no turn data — expected: nothing renders, preserving
      REQ-24's "no empty chrome" behaviour from track 10069.
- [ ] TC-4.4: Clicking Stop — expected: `onAbort` fires exactly once, and the control shows
      "Stopping…" and is disabled while in flight (REQ-20).
- [ ] TC-4.5: The endpoint returns `409` — expected: the UI says nothing is running; the
      control does not read as an error (REQ-20, AC-9).
- [ ] TC-4.6: The endpoint returns `500` — expected: the server's own message is surfaced,
      not swallowed, and the control returns to idle so a retry is possible (REQ-20).
- [ ] TC-4.7: `ChatView` with a live worker target — expected: Stop renders, and clicking it
      POSTs to `/api/projects/<id>/tracks/<num>/abort` (REQ-19).
- [ ] TC-4.8: `ChatView` with the **manager** target live — expected: Stop renders and POSTs
      to `.../tracks/manager/abort` (REQ-21, AC-11).
- [ ] TC-4.9: `ChatView` derives liveness solely from `resolveTargetRunLiveness` — asserted
      by driving the component through that function's inputs only, with no second source
      (REQ-19).

### Phase 5 — regression

- [ ] TC-5.1: `track-10020-run-marker*.test.mjs` — expected: unchanged pass. The marker
      gained optional fields; nothing may regress.
- [ ] TC-5.2: `track-10065-*.test.mjs` — expected: unchanged pass. Phase 3 edits the same
      exit handler that owns the finalizing-marker lifecycle.
- [ ] TC-5.3: `track-1102-f21-*.test.mjs` — expected: unchanged pass. `endedMidWork` and
      `abortedByUser` are adjacent branches with a defined precedence.
- [ ] TC-5.4: `track-10055-*.test.mjs` — expected: unchanged pass. Abort reuses the park
      path those tests own.
- [ ] TC-5.5: `track-10046-*.test.mjs` — expected: unchanged pass. Conversation-run write
      scope must still forbid lane writes on the abort path.
- [ ] TC-5.6: Full `conductor/tests/*.test.mjs` and `cd ui && npm test` — expected: no new
      failures against the pre-change baseline, which is recorded before Phase 1 starts.

### Real-product check (not a unit test)

- [ ] TC-6.1: With the API server and UI **restarted** (neither hot-reloads), start a real
      lane action on a scratch track, open the Chat surface, click Stop, and observe: the
      turn stops within seconds, the card moves to `<lane>:waiting` with the cancellation
      reason, and the Conversation tab shows the `⚠️` cancellation turn. Record a
      screenshot of before and after.

## Acceptance Criteria

- [ ] All Phase 1–5 test cases above pass, with output observed rather than inferred.
- [ ] AC-1 … AC-12 in `spec.md` each verified against real output.
- [ ] TC-6.1's real-product check performed and its observation recorded.
- [ ] No regression in `track-10020`, `track-10046`, `track-10055`, `track-10065` or
      `track-1102` suites.
- [ ] Stub scan (`grep -rniE "not yet implemented|TODO|FIXME|FFU|placeholder|stub"` over
      `conductor ui bin`) returns nothing inside any code path this track marks `[x]`.
