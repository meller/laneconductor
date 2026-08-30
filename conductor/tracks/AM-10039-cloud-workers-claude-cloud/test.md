# Tests: Track AM-10039 — Cloud Workers — Claude Cloud Instances as Workers

## Test Commands

```bash
# Full existing suite (parity gate — must stay green every phase)
node --test conductor/tests/

# Existing E2E suites (REQ-9 / AC-7 parity)
node --test conductor/tests/local-fs-e2e.test.mjs
node --test conductor/tests/local-api-e2e.test.mjs

# New suites added by this track
node --test conductor/tests/track-10039-executor-seam.test.mjs
node --test conductor/tests/track-10039-cloud-preflight.test.mjs
node --test conductor/tests/track-10039-cloud-executor.test.mjs
node --test conductor/tests/track-10039-dispatcher-mode.test.mjs
```

Mock services follow the zero-dep Node `http` pattern of
`conductor/tests/mock-collector.mjs`: a mock cloud-session API (create/status endpoints with
scriptable state transitions) and a mock GitHub API (PR state, contents API, merge endpoint).

## Test Cases

### Phase 1: Feasibility spike (manual evidence, not automated)
- [ ] TC-1: Prototype driver launches a real cloud session on the scratch repo with a trivial
      prompt — expected: session reaches a terminal success state; branch/PR visible on GitHub.
- [ ] TC-2: `getSessionStatus` polled through the session's life — expected: observed state
      transitions recorded in conversation.md (launched → running → completed).
- [ ] TC-3: `getSessionUrl` — expected: URL opens the live session in a browser.
- [ ] TC-4: GO/NO-GO comment exists in conversation.md with findings — expected: explicit GO
      before any Phase 2+ work, or NO-GO + Waiting for reply: yes.

### Phase 2: Executor seam (track-10039-executor-seam.test.mjs)
- [ ] TC-5: `LocalCliExecutor.run` on a fake CLI script — expected: same outcome fields the
      spawnCli path produced (exit-code mapping, log path, retry accounting hooks).
- [ ] TC-6: All four call sites resolve their executor through the seam (unit: inspect wiring/
      spy) — expected: no direct `spawnCli`/bespoke `spawn` invocation remains outside
      `LocalCliExecutor` (grep-based assertion is acceptable).
- [ ] TC-7: Parity — full existing suite + both E2E suites green after the refactor —
      expected: zero behavioral diff for machine workers.

### Phase 3: Credentials & preflight (track-10039-cloud-preflight.test.mjs)
- [ ] TC-8: Preflight with all four checks passing (mocked externals) — expected: ok=true.
- [ ] TC-9..12: Each check failing alone (no credential / dead credential / no remote / GitHub
      App missing / no dispatcher GitHub token) — expected: ok=false with that check's reason
      and a non-empty fix-it guidance string; worker registration refused.
- [ ] TC-13: Credential validation is live, not presence-only — expected: a syntactically valid
      but rejected credential fails validation (mock endpoint returns 401).
- [ ] TC-14: No credential material appears in `.laneconductor.json` or any git-tracked file
      after setup — expected: grep across tracked files finds nothing.
- [ ] TC-15: Migration applies + is idempotent; `runtime` defaults to `machine` for all
      existing rows.

### Phase 4: Cloud executor + implement lane (track-10039-cloud-executor.test.mjs)
- [ ] TC-16: Dispatch implement to `CloudSessionExecutor` against the mock session API —
      expected: track records `cloud_session_id`/`cloud_session_url`; lane status running.
- [ ] TC-17: Mock session transitions running → completed with a PR — expected: dispatcher
      detects PR via mock GitHub API (no local `gh`), track advances per workflow.json.
- [ ] TC-18: Mock session fails — expected: existing retry logic engages; retry count
      increments exactly as machine-worker failures do.
- [ ] TC-19: UI worker/track payloads expose runtime + session URL — expected: API responses
      contain the fields the Kanban chip and deep link need.
- [ ] TC-20 (manual, AC-2/AC-3): one real E2E on the scratch repo — expected: real PR opened by
      the session; live deep link works while running; evidence (URLs) in conversation.md.

### Phase 5: All lanes + merge/conflicts
- [ ] TC-21: plan-lane cloud flow (mock) — expected: dispatcher reads updated lane marker via
      mock contents API and advances the DB lane.
- [ ] TC-22: review/quality-gate cloud flow (mock) — expected: verdict from branch-committed
      files drives PASS/FAIL transitions per workflow.json.
- [ ] TC-23: Clean PR merge — expected: merged via mock GitHub merge endpoint; no local git
      invoked (assert no child git process).
- [ ] TC-24: CONFLICTING PR — expected: merge-lane cloud session dispatched; after mock
      resolution push, PR mergeable → merged (AC-4 shape).
- [ ] TC-25: Mid-run freshness poll — expected: branch index.md changes reflected in DB within
      one reconcile interval; GitHub API call count bounded per cycle.

### Phase 6: Dispatcher-only mode (track-10039-dispatcher-mode.test.mjs)
- [ ] TC-26: Worker started with `--dispatcher` in an empty directory (no conductor/, no git) —
      expected: starts clean; no chokidar watchers, no worktree/lock paths created.
- [ ] TC-27: Full lifecycle plan → implement → PR → merged against mock session + mock GitHub +
      real Collector/DB — expected: lanes advance correctly with zero filesystem writes outside
      logs (AC-5).
- [ ] TC-28: Revoked credential mid-flight — expected: permanent-failure classification; track
      reaches `failure` with exactly ONE ❌ comment within N cycles; no requeue loop (AC-6).
- [ ] TC-29: Transient session error — expected: classified transient, normal retry path, no
      escalation.
- [ ] TC-30: Stuck cloud run (session never terminal, heartbeat stale) — expected:
      resetStuckActions-equivalent recovery fires on session-signal timeout.

### Phase 7: Docs
- [ ] TC-31: Doc drafts posted for human review before commit (guardrail followed) — expected:
      conversation.md shows the review request preceding the doc commit.

## Acceptance Criteria (mirrors spec.md)
- [ ] AC-1 preflight accept/reject with guidance (TC-8..12)
- [ ] AC-2 real cloud session → real PR, evidence recorded (TC-20)
- [ ] AC-3 live status + working deep link (TC-19/20)
- [ ] AC-4 conflicted PR resolved via cloud merge session (TC-24)
- [ ] AC-5 dispatcher-only full lifecycle, no checkout (TC-26/27)
- [ ] AC-6 permanent failure escalates once, no loop (TC-28)
- [ ] AC-7 machine-worker parity: entire pre-existing suite green (TC-7)
