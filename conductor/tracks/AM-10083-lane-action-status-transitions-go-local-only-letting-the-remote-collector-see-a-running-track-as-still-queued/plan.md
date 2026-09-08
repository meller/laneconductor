# Track AM-10083: Lane action status transitions go local-only

Six phases. Phase 1 reproduces all three root causes as failing tests before
anything is fixed. Phases 2-5 fix them in dependency order: the cloud upsert
first, because until it honours the payload no amount of fan-out changes what
the remote collector shows. Phase 6 closes out regressions and docs.

Read `spec.md` first — RC-1, RC-2, RC-3 and F-1 are named there and referred
to by those labels throughout.

---

## Phase 1: Reproduce all three root causes as failing tests

**Problem**: Every claim in `spec.md` was derived by reading code. None of it
is pinned by a test, so a fix could pass review while changing nothing a user
would notice — the exact failure mode this repo has been bitten by before.

**Solution**: Three tests that fail today for three different reasons, written
before any production change. Each must be run and each must be observed
failing, with the failure output recorded, before Phase 2 begins.

- [ ] Task 1.1: Multi-collector e2e (`conductor/tests/track-10083-status-fanout-e2e.test.mjs`).
      Start two `mock-target.mjs` instances, write a `.laneconductor.json`
      with both as collectors, start a real worker, dispatch a lane action,
      and assert both collectors' `/_state` report `lane_action_status:
      'running'` for the track. Follow the setup in
      `conductor/tests/track-10064-collector-retry-e2e.test.mjs` — it already
      does two-collector worker spawning correctly.
    - [ ] Confirm it fails today, and that it fails because the second
          collector never receives the write, not because of a setup error.
- [ ] Task 1.2: Cloud upsert contract test
      (`conductor/tests/track-10083-cloud-upsert-lane-action-status.test.mjs`).
      Drive `cloud/functions/index.js`'s `POST /track` against a test database
      or the existing harness used by the other cloud tests. Assert that an
      existing row at `queue` moves to `running` when the payload says
      `running`, and that an existing row at `running` moves to `queue` when
      the payload says `queue`.
    - [ ] Establish which harness the existing cloud tests use before writing
          this; if none exists, assert against the generated SQL rather than
          inventing a database fixture.
    - [ ] Confirm both assertions fail today.
- [ ] Task 1.3: Local/cloud parity assertion for this field, in the spirit of
      `conductor/tests/cloud-route-parity.test.mjs` — the two collectors must
      agree on what `POST /track` does with `lane_action_status`.
    - [ ] Confirm it fails today.

**Impact**: The bug is pinned. Nothing is fixed yet.

---

## Phase 2: Make the cloud collector honour `lane_action_status` on update (RC-2)

**Problem**: `cloud/functions/index.js`'s `ON CONFLICT` clause derives
`lane_action_status` from the row already in the database and ignores the
payload, so `running` can never arrive and a stale `running` can never clear.

**Solution**: Replace the derived `CASE` with the local collector's semantics —
the payload wins when it supplies a value, the lane-change reset applies when
it does not.

- [ ] Task 2.1: Justify removing the sticky `WHEN tracks.lane_action_status =
      'running' THEN 'running'` branch. `git log -S` shows it has been present
      since the repository's initial commit with no incident behind it, which
      is evidence but not proof. Check whether anything on the cloud side
      relies on `running` being unclearable by `POST /track` — in particular
      `POST /tracks/reset-stuck-actions` and the claim query — and record the
      answer in `conversation.md`.
- [ ] Task 2.2: Rewrite the clause so an explicit payload
      `lane_action_status` is applied, a lane change with no explicit status
      resets to `queue` and clears `lane_action_result`, and neither is
      touched when the payload omits the field. Mirror
      `ui/server/index.mjs`'s structure closely enough that the two read as
      the same rule.
- [ ] Task 2.3: Handle the `lane_status === null` case. Today the entire
      clause is dropped, so `lane_action_status` is unwritable on update. A
      payload that carries a status but no lane must still write the status.
- [ ] Task 2.4: Run Task 1.2's and Task 1.3's tests and confirm they now pass.
- [ ] Task 2.5: Deploy to the cloud function and confirm against the real
      remote collector that a status push lands. This is a deployed service;
      a green test against a local harness is not evidence the live endpoint
      changed.

**Impact**: `syncTrack()`'s existing fan-out starts working for this field.
On its own this already fixes both live symptoms, at file-watch latency.
Phase 3 is what makes it prompt.

---

## Phase 3: Fan out track-state writes to every collector (RC-1)

**Problem**: The dispatch loop's status writes address `primaryCollector()`
directly, so they are structurally local-only regardless of Phase 2.

**Solution**: Route the writes that carry track state through
`patchCollectors`, and leave the writes that address primary-only rows alone.

- [ ] Task 3.1: Add one helper — `patchTrackAction(trackNumber, fields)` —
      that wraps `patchCollectors('/track/:n/action', ...)`, so the decision
      of who receives a track-state write lives in one place instead of at
      eight call sites. It must preserve today's error handling: the caller
      keeps its own `.catch()`, and a primary failure still surfaces the same
      way it does now.
- [ ] Task 3.2: Convert the state-bearing sites to it. By current line number
      in `conductor/laneconductor.sync.mjs`: the `running` claim write
      (~9524), the revert on spawn failure (~9556), the run-completion write
      (~6611), the orphan-reconciliation write (~8779), the timeout-failure
      write (~5861), `patchTrackPrFields` (~4750), and the discard-to-backlog
      write (~9056).
    - [ ] Re-derive each line number before editing; they will have moved.
- [ ] Task 3.3: Deliberately leave primary-only, and add a short comment at
      each saying why (REQ-4): every `/worker-dispatch/:id` call,
      `/tracks/claim-queue`, `/file-sync/:id`, the pre-spawn-block endpoints,
      and `/track/:num/lock` and `/unlock`.
- [ ] Task 3.4: Leave the 5-second `last_log_tail` telemetry patch (~5876)
      primary-only. It is per-running-track high-frequency telemetry, not
      state, and fanning it out would put a request every five seconds per
      running track onto every remote collector for no correctness gain.
      Record that reasoning in a comment at the site.
- [ ] Task 3.5: Run Task 1.1's e2e and confirm it now passes.

**Impact**: A status transition reaches every collector within one HTTP round
trip of the local write, instead of waiting on a file-watch event.

---

## Phase 4: Give each collector a `project_id` that resolves on it (F-1, REQ-5)

**Problem**: `upsertWorker()` assigns `proj.id` from each collector's
`/project/ensure` in turn and rewrites `.laneconductor.json` each time, so one
id — whichever collector answered last — is sent to all of them. The cloud's
`checkProject` returns `403` for an id that does not resolve in its workspace,
so Phase 3's fan-out of `project_id`-bearing bodies depends on getting this
right.

**Solution**: Keep a per-collector project id in memory and substitute it at
send time.

- [ ] Task 4.1: Record `/project/ensure`'s answer per collector URL in a
      module-level map, alongside the existing per-collector token and health
      state.
- [ ] Task 4.2: Stop `upsertWorker()` from writing a non-primary collector's
      project id back into `.laneconductor.json`. Only the primary's id
      belongs in the shared config file.
- [ ] Task 4.3: Have `postToCollectors` and `patchCollectors` substitute the
      per-collector id into the body when the body carries `project_id`, so
      no call site has to think about it.
- [ ] Task 4.4: Fall back to the config's `project.id` for any collector that
      has not answered `/project/ensure` yet, so behaviour is unchanged for a
      single-collector project and for the first beat after start.
- [ ] Task 4.5: Verify the fix by pointing a test at two mock collectors that
      return different project ids and asserting each receives its own.
- [ ] Task 4.6: Check whether `myWorkerId` has the same last-writer-wins
      problem — it is assigned from each collector's `/worker/register`
      response in the same loop and then used against the primary. If it
      does, record it in `conversation.md` as a separate finding rather than
      widening this track.

**Impact**: Fan-out addresses the right project on every collector, and the
project config file stops being rewritten by a remote collector's answer.

---

## Phase 5: Mirror the claim, and refuse a conflicting spawn (RC-3, REQ-6)

**Problem**: `POST /tracks/claim-queue` is atomic per collector and is called
on the primary only, so the same track stays claimable everywhere else. Phases
2-4 narrow that window to one round trip but cannot close it.

**Solution**: Mirror the claim outward immediately, and cross-check before
spawning. The cross-check aborts only on a confirmed conflict; an unreachable
collector is not a conflict.

- [ ] Task 5.1: After the auto-launch loop wins a claim on the primary, fan
      `lane_action_status: 'running'` out to the other collectors, so the
      claim and its mirror are one step rather than two independent code
      paths.
- [ ] Task 5.2: Add a pre-spawn cross-collector check. `GET /track/:num` on
      each non-primary collector, with a short timeout; abort the spawn only
      when a collector reports the track running under a claimant that is not
      this worker.
- [ ] Task 5.3: Make every failure mode of that check non-blocking —
      unreachable, timed out, 403, unparseable, or a collector that does not
      report a claimant. Any of those proceeds with the spawn. A remote
      collector being down must never stop local work; that is the standing
      rule for non-primary collectors in `conductor/product.md`.
- [ ] Task 5.4: On a confirmed conflict, log it and post one `> **system**:`
      comment to the track's `conversation.md` naming the other claimant, so
      the abort is visible where a person is looking rather than only in the
      worker log.
- [ ] Task 5.5: Test the guard both ways — a conflicting collector aborts the
      spawn, and an unreachable collector does not.

**Impact**: The residual cross-collector double-dispatch race is detected and
refused rather than silently double-running. It is not eliminated; `spec.md`'s
Non-Goals say so plainly.

---

## Phase 6: Regressions, degraded-path verification, and docs

**Problem**: The failure this track fixes was invisible for as long as it
existed. The fix has to be verified against the real degraded path, not just
the happy one, and the documented model of who writes to the remote collector
is now wrong.

- [ ] Task 6.1: Run the full worker test suite and confirm nothing regressed,
      particularly the track 10064 collector-health and retry-buffer tests,
      which share the fan-out code this track edits.
- [ ] Task 6.2: Verify the degraded path end to end: take a mock collector
      offline for the duration of a lane action, confirm the run completes
      normally, confirm the worker card shows the degraded-sync badge, bring
      the collector back, and confirm the missed status writes are replayed
      by the retry buffer.
- [ ] Task 6.3: Check for orphaned worker processes before trusting any test
      result. `node --test` and `vitest` in this repo have both leaked real
      workers against the primary checkout; see `MEMORY.md`.
- [ ] Task 6.4: Update `conductor/product.md`'s "Who Owns Remote Sync"
      section. Its collector-0-vs-1..n description is still accurate, but it
      does not say that track-state transitions fan out while dispatch-row
      writes do not, and that distinction is now load-bearing.
- [ ] Task 6.5: File a follow-up track for F-3 — the cloud's `POST /track`
      also drops `waiting_for_reply`, `auto_run`, `merge_mode`,
      `workspace_mode`, `log_content`, `model_override`, and the KPI columns
      that the local collector persists. Reference it from `spec.md`'s
      Non-Goals once it has a number.
- [ ] Task 6.6: Confirm each acceptance criterion in `spec.md` against the
      real dashboard, and record what was observed. Reasoning that the code
      is correct does not satisfy these; they are written as things to look
      at for that reason.
