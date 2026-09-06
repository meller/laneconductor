# Tests: Track 10067 — Intelligent manager: an always-supervised, AI-capable health monitor with a watchable transcript

## Test Commands

```bash
# Pure-module + worker unit tests (node:test — spawns real processes, touches fs)
node --test conductor/tests/manager-sweep.test.mjs
node --test conductor/tests/manager-supervision.test.mjs
node --test conductor/tests/manager-escalation.test.mjs

# UI unit/integration (Vitest)
cd ui && npm test

# Full worker E2E suite (regression guard for phases 3-4)
node --test conductor/tests/local-fs-e2e.test.mjs
node --test conductor/tests/local-api-e2e.test.mjs
```

Live checks in Phase 7 are run by hand and their observed output recorded in
`conversation.md` — they cannot be asserted from a unit test, which is the whole reason
they are listed separately.

## Test Cases

### Phase 1 — Supervision of the manager

- [ ] TC-1.1: `laneconductor-manager.service` parses under `systemd-analyze verify` —
      expected: no errors, `Restart=always` present.
- [ ] TC-1.2: `StartLimitIntervalSec` / `StartLimitBurst` are in `[Unit]`, not `[Service]` —
      expected: a grep assertion fails the test if they drift into `[Service]`, the exact
      silent-disable bug the worker unit documents.
- [ ] TC-1.3: `lc worker install-service --manager` on a host where `hasSystemdUser()` is
      stubbed false — expected: explanatory message, non-zero exit, no unit file written.
- [ ] TC-1.4: `lc worker install-service --manager` on a systemd host — expected: unit file
      present at `~/.config/systemd/user/`, service enabled and active.
- [ ] TC-1.5: `lc worker status --manager` with the unit active — expected: output states the
      manager is supervised. With no unit installed — expected: states unsupervised.
- [ ] TC-1.6 (live, Phase 7): `systemctl --user kill -s SIGKILL laneconductor-manager.service`
      — expected: a new manager PID within `RestartSec` + the lock stale window. Record the
      before/after PIDs.

### Phase 2 — Layer-1 checks (pure module, injected facts)

- [ ] TC-2.1: `stale-main-mode-lock` with a lock naming a dead PID on this host — expected:
      one finding, `remedy: 'remove-dead-lock'`.
- [ ] TC-2.2: Same lock naming a **live** PID, age under the stale window — expected: no
      finding. This is the false-positive case that matters most; a wrong remedy here would
      break a healthy run.
- [ ] TC-2.3: Lock naming a live PID but past the stale window — expected: finding with
      `remedy: null` (escalate), not auto-removal.
- [ ] TC-2.4: Lock recorded on a **different machine** — expected: no PID-liveness claim is
      made, matching the existing `isSameMachine` guard.
- [ ] TC-2.5: `stale-git-lock` for two tracks, one dead-PID one live — expected: exactly one
      finding, subject is the dead one's track number.
- [ ] TC-2.6: `worker-heartbeat-silent` for a worker last seen past the threshold — expected:
      finding. Under the threshold — expected: none.
- [ ] TC-2.7: `dispatch-no-run-marker` for a `claimed` dispatch past grace with no marker —
      expected: finding. Same dispatch with a live marker — expected: none. Same dispatch
      inside grace — expected: none.
- [ ] TC-2.8: `duplicate-worker-identity` with two `ps` rows for one identity — expected:
      finding naming both PIDs. One row — expected: none.
- [ ] TC-2.9: `board-fs-mismatch` where the DB says `queue` and `index.md` says `running` —
      expected: finding. Where the DB lane is a legal `on_success` destination of the
      dispatched action — expected: **none** (the normal post-run shape, per the transition
      check `orphaned-dispatch.mjs` already documents).
- [ ] TC-2.10: `board-fs-mismatch` resolves the track folder via `resolveTrackFolder` —
      expected: with a duplicate `NNN-slug` beside a real `INITIALS-NNN-slug`, the check reads
      the registered folder, not the duplicate (track 10063's bug class).
- [ ] TC-2.11: Fingerprint stability — the same underlying condition observed twice produces
      the identical fingerprint string; two different subjects produce different ones.
- [ ] TC-2.12: Project resolution (D6) for a track-scoped finding — expected: the
      `project_id` of the checkout the lock/dispatch was read from.
- [ ] TC-2.13: Project resolution for a leaked worker process whose cwd is inside a known
      project — expected: attributed to that project, not marked host-scoped (AC-13).
- [ ] TC-2.14: Project resolution for a process whose cwd is deleted or outside every known
      project — expected: explicitly marked host-scoped, **not** dropped and not given a
      guessed project (REQ-20).
- [ ] TC-2.15: A registered worker with a `project_id` on its row — expected: that value is
      used without needing the cwd read at all.

### Phase 3 — Sweep loop

- [ ] TC-3.1: Missing `manager.supervision` config — expected: `mode` resolves to `report`,
      interval to 30000.
- [ ] TC-3.2: `LC_MANAGER_SWEEP_MS` set — expected: it overrides the config value.
- [ ] TC-3.3: The sweep interval does not run in a non-manager worker — expected: zero sweeps
      after several intervals with `--manager` absent.
- [ ] TC-3.4: `mode: report` with a planted dead-PID lock — expected: the finding is reported
      and the lock file **still exists** afterwards (AC-10).
- [ ] TC-3.5: `mode: remediate`, same lock — expected: removed within one interval, with a log
      line naming the dead PID it observed.
- [ ] TC-3.6: One check throwing — expected: the other checks in the same tick still produce
      findings, and the interval fires again next cycle (REQ-9).
- [ ] TC-3.7: Sweep against a mock collector that returns an error — expected: the tick is
      skipped with a warning, no crash, no remedy attempted on partial data.

### Phase 4 — Supervision pseudo-track

- [ ] TC-4.1: First sweep with no `conductor/tracks/manager/` in a supervised project —
      expected: created with `index.md` and `conversation.md`.
- [ ] TC-4.1b: Sweep with the manager's serving root not being a project checkout —
      expected: no pseudo-track created there (D6).
- [ ] TC-4.1c: A host-scoped finding — expected: written to the manager's log and worker
      row, and **no** comment written to any project's supervision thread (AC-14).
- [ ] TC-4.2: A finding is written as a `> **system**:` comment — expected: it matches the
      conversation parser's required format (a malformed comment syncs silently to nothing,
      which is exactly the failure this asserts against).
- [ ] TC-4.3: The same finding across five consecutive sweeps — expected: one comment, not
      five.
- [ ] TC-4.4: After the pseudo-track exists, regenerate `tracks.md` — expected: byte-identical
      to before; `manager` never appears (AC-12).
- [ ] TC-4.5: `lc track-dir manager` — expected: non-zero exit, nothing on stdout.
- [ ] TC-4.6: Auto-launch loop with the pseudo-track present and a queue-like marker in its
      `index.md` — expected: never claimed.
- [ ] TC-4.7: `GET /api/projects/:id/tracks/manager/transcript` with a
      `sweep-manager-<ts>.log` present — expected: parsed events returned, not a 404 or a
      numeric-parse error.
- [ ] TC-4.8: `GET /api/projects/:id/tracks/manager/comments` with findings already in
      `conductor/tracks/manager/conversation.md` — expected: those turns returned in the shape
      `useTrackComments` renders. **Fails before the change**: the route calls `getTrackId()`,
      which returns null for a track with no DB row, so it 404s (AC-16).
- [ ] TC-4.9: `POST /api/projects/:id/tracks/manager/comments` with a body — expected: a
      `> **human**: <body>` turn appended to that file in the required parser format, and
      `SELECT id FROM tracks WHERE track_number = 'manager'` still returns no row (AC-17).
      Note the pre-existing folder probe searches for a directory starting `manager-`, which
      never matches a folder named exactly `manager` — a test that only asserts a 201 would
      pass while nothing was written.
- [ ] TC-4.10: `syncConversation` invoked on `conductor/tracks/manager/conversation.md` —
      expected: skipped, zero collector POSTs. **The naive assertion is wrong here**:
      `extractTrackNumber` returns the string `'manager'`, not null, so without the explicit
      skip the function proceeds and posts. Assert on POST count, not on an early return
      (AC-18).
- [ ] TC-4.11: The reserved pseudo-track name — expected: `/\d+/.test(name)` is false
      (REQ-21). Guards a rename to `manager-2` or similar, which `isTrackDirName` would
      accept and the auto-launch loop would then scan.

### Phase 5 — UI

- [ ] TC-5.1: `resolveWorkerChatTarget({ type: 'manager', ... })` — expected: a target for the
      supervision track. Currently returns `null`, so this test fails before the change.
- [ ] TC-5.1b: The same manager resolved with two different `fallbackProjectId` values —
      expected: two different targets, one per project, since a manager's own `project_id`
      and `last_track_project_id` are both null (AC-15).
- [ ] TC-5.2: A manager mid-escalation on a real track — expected: the target prefers that
      track's number over `manager`.
- [ ] TC-5.3: `WorkerChatPanel` rendered for a manager — expected: composer enabled, no
      manager-specific empty state.
- [ ] TC-5.4: Typing and submitting in that composer — expected: a POST to the comments
      endpoint for the resolved target.
- [ ] TC-5.5: Existing `WorkerChatPanel.test.jsx` manager assertions — expected: updated, and
      the suite green afterwards. A skipped test does not count.
- [ ] TC-5.6: Findings render distinctly from AI turns — expected: distinguishable by test id
      or role, not by styling alone.
- [ ] TC-5.7: `WorkerChatPanel` for a manager against a supervision thread containing
      findings — expected: those findings are listed. This is the end-to-end proof that
      Task 5.2 and Task 4.5 are wired to each other; with the composer enabled but no
      adapter, the panel renders empty and this test is what catches it.

### Phase 6 — Layer-2 escalation

- [ ] TC-6.1: Budget gate at `max_concurrent_escalations: 1` with one in flight — expected:
      the second finding does not dispatch.
- [ ] TC-6.2: A finding re-observed inside `escalation_cooldown_ms` — expected: no second
      dispatch (AC-9).
- [ ] TC-6.3: Five escalatable findings in an hour with a ceiling of four — expected: exactly
      four dispatches.
- [ ] TC-6.4: `mode: report` with an escalatable finding — expected: zero dispatches (AC-10).
- [ ] TC-6.5: The built prompt — expected: contains the finding, its evidence, the allowlist,
      and the propose-don't-execute instruction (REQ-11).
- [ ] TC-6.6: A project-scoped finding with no track — expected: dispatched against that
      project's `manager` pseudo-track. A track-scoped finding — expected: dispatched against
      that track's number.
- [ ] TC-6.6b: A host-scoped finding (D6 step 3) — expected: zero dispatches, and a report
      in the manager's log (REQ-10).
- [ ] TC-6.7: A session concluding with a non-allowlisted remedy — expected: a proposal
      comment plus `**Waiting for reply**: yes`, and nothing executed (AC-11).
- [ ] TC-6.8: A concluded escalation — expected: exactly one `> **system**:` comment whose
      first body character is `✅`, `⚠️` or `❌` (REQ-13).

### Phase 7 — Real-product verification (manual, evidence recorded)

- [ ] TC-7.1: Manager SIGKILL-and-recover, PIDs recorded (AC-1).
- [ ] TC-7.2: Planted dead-PID lock reported in `report`, cleared after flipping to
      `remediate`, both observed in the live log (AC-4).
- [ ] TC-7.3: Supervised worker SIGKILLed — finding raised, worker returns via systemd, and
      the manager does **not** restart it a second time (AC-6).
- [ ] TC-7.4: Manager chat panel opened in the running UI against a live manager — transcript
      visible, message accepted (AC-7, AC-8). API and worker restarted first; neither
      hot-reloads, and testing against a stale process is a false pass.

## Acceptance Criteria

- [ ] All unit tests above pass, none skipped
- [ ] `cd ui && npm test` green, including the updated `WorkerChatPanel` manager cases
- [ ] `node --test conductor/tests/local-fs-e2e.test.mjs` and `local-api-e2e.test.mjs` still
      green — no regression from the new interval or the pseudo-track
- [ ] Every AC-1..AC-18 in `spec.md` observed and its evidence recorded in `conversation.md`
- [ ] No stub scan hits (`not yet implemented` / `TODO` / `FIXME` / `FFU`) in any code path
      whose `plan.md` task is marked `[x]`
