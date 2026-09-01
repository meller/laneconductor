# Tests: Track AM-10039 — Cloud Workers — Managed Agents Sessions as Workers (rev. 2)

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
`conductor/tests/mock-collector.mjs`: a mock Managed-Agents sessions API (create/events/status
endpoints with scriptable state transitions, including budget-reached) and a mock GitHub API
(PR state, contents API, merge endpoint).

## Test Cases

### Phase 1: claude.ai/code spike (COMPLETE — closed with verdict NO-GO)
- [x] TC-1..4: resolved by the spike — the live exercise was structurally blocked (no headless
      invocation path), which IS the recorded result; GO/NO-GO comment posted, pivot decided.
      Superseded by Phase 1b below. (Original cases preserved in git history.)

### Phase 1b: Managed Agents live spike (manual evidence, not automated)
- [ ] TC-5: `ant`-applied agent + environment YAML produce usable ids — expected: recorded in
      conductor/cloud/ + conversation.md.
- [ ] TC-6: Real session with mounted scratch repo runs a trivial change — expected: skill
      auto-discovery observed, commit+push lands on GitHub, branch visible, PR opened; session
      id + trace URL + PR URL recorded in conversation.md.
- [ ] TC-7: Vault credential — expected: push succeeds while the GitHub token never appears in
      any session transcript/event text.
- [ ] TC-8: Budget cap — expected: a tiny-budget session reaches `budget_reached` (not a
      generic error); behavior recorded.
- [ ] TC-9: Session resume — expected: a second event to the same session retains context;
      `cache_read_input_tokens > 0` observed in usage events; idle-lifetime finding recorded
      and D-8 decision (track↔session vs per-lane-action) written into spec.md.
- [ ] TC-10: GO/NO-GO comment exists in conversation.md — explicit GO before Phase 2+ work, or
      NO-GO + Waiting for reply: yes.

### Phase 2: Executor seam (track-10039-executor-seam.test.mjs)
- [ ] TC-11: `LocalCliExecutor.run` on a fake CLI script — expected: same outcome fields the
      spawnCli path produced (exit-code mapping, log path, retry accounting hooks).
- [ ] TC-12: All four call sites resolve their executor through the seam — expected: no direct
      `spawnCli`/bespoke `spawn` invocation remains outside `LocalCliExecutor` (grep-based
      assertion acceptable).
- [ ] TC-13: Parity — full existing suite + both E2E suites green after the refactor —
      expected: zero behavioral diff for machine workers.

### Phase 3: Credentials & preflight (track-10039-cloud-preflight.test.mjs)
- [ ] TC-14: Preflight with all four checks passing (mocked externals) — expected: ok=true.
- [ ] TC-15..18: Each check failing alone (no/expired profile AND no WIF; Managed Agents beta
      unreachable; no GitHub remote; GitHub token can't see repo) — expected: ok=false with
      that check's reason and non-empty fix-it guidance; worker registration refused.
- [ ] TC-19: Validation is live, not presence-only — expected: syntactically valid but
      rejected credentials fail (mock endpoints return 401/403).
- [ ] TC-20: No credential material in `.laneconductor.json` or any git-tracked file after
      setup — expected: grep across tracked files finds nothing. Additionally: a configured
      ANTHROPIC_API_KEY is rejected with the keyless-policy message, never used.
- [ ] TC-21: Migration applies + idempotent; `runtime` defaults to `machine` for existing rows.

### Phase 4: Cloud executor + implement lane (track-10039-cloud-executor.test.mjs)
- [ ] TC-22: Dispatch implement via `CloudSessionExecutor` against the mock sessions API —
      expected: session created with repo mount + budget on first use, resumed on second
      dispatch (per D-8 decision); track records `cloud_session_id`/`cloud_session_url`.
- [ ] TC-23: Mock session transitions running → idle with a PR — expected: dispatcher detects
      the PR via mock GitHub API (no local `gh`), track advances per workflow.json.
- [ ] TC-24: Mock session error — expected: existing retry logic engages; retry count
      increments exactly as machine-worker failures do.
- [ ] TC-25: Mock session hits budget — expected: distinct budget-reached state on the track
      (AC-8), not error/retry churn.
- [ ] TC-26: UI worker/track payloads expose runtime, session URL, and usage — expected: API
      responses contain the fields the Kanban chip, deep link, and cost display need.
- [ ] TC-27 (manual, AC-2/AC-3): one real E2E on the scratch repo — expected: real PR opened
      from a real session; trace link works while running; evidence in conversation.md.

### Phase 5: All lanes + merge/conflicts
- [ ] TC-28: plan-lane cloud flow (mock) — expected: dispatcher reads updated lane marker via
      mock contents API and advances the DB lane.
- [ ] TC-29: review/quality-gate cloud flow (mock) — expected: verdict from branch-committed
      files drives PASS/FAIL transitions per workflow.json.
- [ ] TC-30: Clean PR merge — expected: merged via mock GitHub merge endpoint; no local git
      invoked (assert no child git process).
- [ ] TC-31: CONFLICTING PR — expected: conflict-resolution turn sent to the session; after
      mock resolution push, PR mergeable → merged (AC-4 shape).
- [ ] TC-32: Mid-run freshness poll — expected: branch index.md changes reflected in DB within
      one reconcile interval; GitHub API call count bounded per cycle.

### Phase 6: Dispatcher-only mode (track-10039-dispatcher-mode.test.mjs)
- [ ] TC-33: Worker started with `--dispatcher` in an empty directory (no conductor/, no git) —
      expected: starts clean; no chokidar watchers, no worktree/lock paths created.
- [ ] TC-34: Full lifecycle plan → implement → PR → merged against mock sessions + mock GitHub
      + real Collector/DB — expected: lanes advance correctly with zero filesystem writes
      outside logs (AC-5).
- [ ] TC-35: Revoked Anthropic identity mid-flight (expired profile/broken WIF) — expected:
      permanent-failure classification; track
      reaches `failure` with exactly ONE ❌ comment within N cycles; no requeue loop (AC-6).
- [ ] TC-36: Transient session error — expected: classified transient, normal retry path, no
      escalation.
- [ ] TC-37: Stuck cloud run (session never terminal, no event progress) — expected:
      resetStuckActions-equivalent recovery fires on session-signal timeout.

### Phase 7: Docs
- [ ] TC-38: Doc drafts posted for human review before commit (guardrail followed) — expected:
      conversation.md shows the review request preceding the doc commit; README/wiki carries
      the "LaneConductor vs. raw Managed Agents" section.

## Acceptance Criteria (mirrors spec.md rev. 2)
- [ ] AC-1 preflight accept/reject with guidance (TC-14..18)
- [ ] AC-2 real Managed Agents session → real PR, evidence recorded (TC-27)
- [ ] AC-3 live status + working trace deep link (TC-26/27)
- [ ] AC-4 conflicted PR resolved via session turn (TC-31)
- [ ] AC-5 dispatcher-only full lifecycle, no checkout (TC-33/34)
- [ ] AC-6 permanent failure escalates once, no loop (TC-35)
- [ ] AC-7 machine-worker parity: entire pre-existing suite green (TC-13)
- [ ] AC-8 budget-reached is a distinct, visible outcome (TC-8/25)
