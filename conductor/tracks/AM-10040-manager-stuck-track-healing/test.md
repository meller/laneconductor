# Tests: Track AM-10040 — Manager Stuck-Track Healing

Test cases are grouped by the phase that introduces them, matching `plan.md`'s seven phases.
Numbering is stable across the replan: TC-1..TC-51 keep the meanings they had (they belong to
what are now Phases 5–7); TC-52..TC-85 are new, covering Findings 4–7.

## Test Commands

```bash
# Pure-module unit tests (node:test, zero deps — the style used by
# workspace-mode / orphan-worker-detection / path-isolation)
node --test conductor/tests/track-10040-lane-constants.test.mjs
node --test conductor/tests/track-10040-lane-regression-guard.test.mjs
node --test conductor/tests/track-10040-worker-code-staleness.test.mjs
node --test conductor/tests/track-10040-track-folder.test.mjs
node --test conductor/tests/track-10040-resting-state.test.mjs
node --test conductor/tests/track-10040-prespawn-block.test.mjs
node --test conductor/tests/track-10040-stuck-track-sweep.test.mjs
node --test conductor/tests/track-10040-orphan-worker-widened.test.mjs
node --test conductor/tests/track-10040-dirty-path-heal.test.mjs

# Worker E2E (spawns a real worker + mock collector, real filesystem)
node --test conductor/tests/track-10040-guard-block-escalation.test.mjs
node --test conductor/tests/track-10040-stale-write-containment.test.mjs

# CLI
node --test conductor/tests/track-10040-track-dir-cli.test.mjs

# Concurrency-counter regression (existing auto-launch suite)
cd ui && npm test -- auto-launch

# Collector API (endpoints, claim reasons, inbox bucket), Vitest + supertest
cd ui && npm test -- track-10040

# Full suites before quality gate
node --test conductor/tests/*.test.mjs
cd ui && npm test
```

`LC_SKIP_GIT_LOCK=1` skips the git lock/worktree path in tests (existing convention).
`LC_PRESPAWN_BLOCK_ESCALATE_AFTER` lets a test escalate in 2 cycles instead of 5.

---

## Phase 1 — One lane list, honest claim failures (REQ-13, REQ-14)

**Lane constants (`track-10040-lane-constants.test.mjs`)**

- [ ] TC-52: `CLAIMABLE_LANES` contains exactly `plan, implement, review, quality-gate, done` and
      **not** `backlog` — expected: exact set equality, so an accidental addition fails loudly
- [ ] TC-53: `MOVABLE_LANES` === `CLAIMABLE_LANES` + `backlog` — expected: the two sets are
      derived from one another, not independently listed
- [ ] TC-54: **AC-13.** Repo-wide grep finds no hardcoded lane list in a SQL or claim path —
      expected: zero matches for `IN ('plan'`, `IN('plan'`, and
      `['plan', 'implement', 'review'` outside `conductor/constants.mjs` and this test's own
      fixtures. Asserted by running the grep from the test, so it keeps holding.

**Claim + wake behavior (`ui/server/tests/track-10040-claim-reason.test.mjs`, real DB)**

- [ ] TC-55: **AC-12.** A track at `done:queue` — expected: `POST /tracks/claim-queue` returns it.
      Must fail against the pre-`bede5ab` filter (assert by running the same query with the old
      literal and confirming zero rows, so the test proves the regression it guards).
- [ ] TC-56: **AC-13, webhook half.** A human comment on a `done`-lane track via the comment
      webhook — expected: the track's `lane_action_status` becomes `queue`. This is the
      currently-broken behavior; the test must fail before the fix.
- [ ] TC-57: **AC-14.** Targeted claim of a track already at `lane_action_status: running` —
      expected: `{ tracks: [], reason: 'already_claimed' }`
- [ ] TC-58: **AC-14.** Targeted claim of a track at `backlog:queue` — expected:
      `reason: 'lane_not_claimable'`
- [ ] TC-59: **AC-14.** Targeted claim of a nonexistent track number — expected:
      `reason: 'no_candidates'`
- [ ] TC-60: **AC-14, D8.** Targeted claim of a queued, claimable track excluded by the
      visibility/`worker_permissions` filter — expected: `reason: 'not_permitted'`, **not**
      `no_candidates`. This is the case that would otherwise reproduce the original bug's shape.
- [ ] TC-61: A successful claim — expected: `reason` is `null` and `tracks.length === 1`
      (the field is additive and never misleading on success)
- [ ] TC-62: An **untargeted** claim returning zero rows — expected: no diagnostic query is issued
      (assert via query count/spy), and `reason` is null. Idle polling must stay one query.
- [ ] TC-63: Worker log on `lane_not_claimable` — expected: logged at **warn**, containing the
      verbatim reason, and **not** containing the string `lost the DB claim race`
- [ ] TC-64: Worker log when the collector returns no `reason` (older server) — expected: the
      neutral fallback message, never the old unverified assertion

## Phase 2 — Stale-process containment and detection (REQ-12, REQ-11)

**`conductor/services/lane-regression-guard.mjs` (pure)**

- [ ] TC-65: **AC-11 core.** `onDiskLane: 'done'`, `intendedLane: 'implement'`,
      `producedByThisRun: false` — expected: `blocked: true`. The exact live incident.
- [ ] TC-66: `onDiskLane: 'done'`, `intendedLane: 'implement'`, `producedByThisRun: true` —
      expected: still `blocked: true`. Nothing legitimately moves a track out of `done`; the
      producer flag does not unlock it.
- [ ] TC-67: `review` → `implement:queue` with `producedByThisRun: true` (the configured
      `review.on_failure`) — expected: `blocked: false`. A legitimate backwards transition.
- [ ] TC-68: `quality-gate` → `plan:queue` with `producedByThisRun: true` (configured
      `quality-gate.on_failure`) — expected: `blocked: false`
- [ ] TC-69: `review` → `implement:queue` with `producedByThisRun: false` — expected:
      `blocked: true`. Same transition, different author: only the run that failed may cause it.
- [ ] TC-70: Same-lane status churn (`implement:running` → `implement:success`,
      `implement:queue` → `implement:running`, `implement:running` → `implement:failure`) —
      expected: `blocked: false` for all three
- [ ] TC-71: Forward moves (`plan` → `implement`, `quality-gate` → `done`) — expected:
      `blocked: false`
- [ ] TC-72: Unknown lane name on either side — expected: fails closed (`blocked: true`) with a
      reason, never silently treated as rank 0

**Worker integration (`track-10040-stale-write-containment.test.mjs`)**

- [ ] TC-73: **AC-11.** Reproduce the live incident end to end: a track's `index.md` at
      `done:queue` on disk, and a worker exit-handler invocation carrying an in-memory view that
      says `implement:success` — expected: `index.md` still reads `done:queue` afterwards, a warn
      line names both states, and **no** comment is appended to `conversation.md`
- [ ] TC-74: The guard reads **fresh** from disk, not from content captured earlier in the run —
      expected: a file mutated after the run started is still respected (mutate the file
      mid-test, then trigger the write)
- [ ] TC-75: The DB→disk sync path is guarded too — a stale DB row saying `implement` against an
      on-disk `done` — expected: the file is not rewritten

**`conductor/services/worker-code-staleness.mjs` (pure)**

- [ ] TC-76: `workerSha` differs from `headSha`, and a commit since touched
      `conductor/laneconductor.sync.mjs` — expected: `severity: 'critical'`
- [ ] TC-77: `workerSha` differs, commits since touched only unrelated files (e.g. `ui/src/**`),
      `commitsBehind` under the threshold — expected: `severity: 'current'` or `'stale'`, never
      `'critical'`
- [ ] TC-78: `commitsBehind > maxCommitsBehind` with no dependency-file touches — expected:
      `severity: 'stale'`
- [ ] TC-79: `workerSha === headSha` — expected: `severity: 'current'`, `stale: false`
- [ ] TC-80: A touched file under `conductor/services/` — expected: `'critical'` (the module list
      covers the services dir, not just the main file)

**Registration (`ui/server/tests/track-10040-code-sha.test.mjs`)**

- [ ] TC-81: **AC-10.** Register a worker with a `code_sha`, advance the repo's `HEAD` by a commit
      touching `laneconductor.sync.mjs`, run the staleness check — expected: that worker is
      reported stale/`critical`. Driven against a **real** worker registration row and a real git
      fixture repo, not a fabricated row (AC-10 says so explicitly).
- [ ] TC-82: `code_sha` is not overwritten by a heartbeat — expected: after several heartbeats the
      stored value is still the boot-time SHA (spec D5)
- [ ] TC-83: **D5.** A manager worker registers with `project_id: null` — expected: `code_sha` is
      still recorded and compared against the *install dir's* HEAD, not a project repo. A worker
      whose managed project's repo has advanced but whose install dir has not is **not** flagged.

## Phase 3 — One folder resolver, skill included (REQ-15)

**`conductor/services/track-folder.mjs` (pure)**

- [ ] TC-84: `decideTrackFolder` with both `10040-slug` and `AM-10040-slug` present, metadata
      registering the prefixed one — expected: `folder: 'AM-10040-slug'`,
      `quarantine: ['10040-slug']`. Byte-identical to today's `resolveTrackFolder` behavior
      (track 1119's semantics).
- [ ] TC-85: Only `AM-10040-slug` present, no legacy match — expected: resolves via the registered
      metadata path, `quarantine: []`
- [ ] TC-86: Only `10040-slug` present, nothing registered — expected: resolves it,
      `quarantine: []` (the common legacy case, unchanged)
- [ ] TC-87: Multiple legacy matches — expected: canonical chosen, the rest listed for quarantine,
      `metadataUpdate` present
- [ ] TC-88: The function performs **no** I/O — expected: callable with a plain `dirNames` array
      and no filesystem at all (this is what makes a read-only consumer possible)

**`lc track-dir` (`track-10040-track-dir-cli.test.mjs`)**

- [ ] TC-89: Resolves a prefixed folder — expected: prints `conductor/tracks/AM-10040-slug`,
      exit 0
- [ ] TC-90: **Read-only guarantee.** Run against a fixture containing a duplicate that would
      normally be quarantined — expected: exit 0 with the canonical answer, and the directory
      listing is **byte-identical afterwards** (nothing renamed, `tracks-metadata.json` unchanged)
- [ ] TC-91: Unknown track number — expected: non-zero exit and a diagnostic on stderr, no output
      on stdout that a caller could mistake for a path
- [ ] TC-92: `--json` — expected: `{ folder, matches, registered }` parses and agrees with the
      plain-text form

**Skill-side duplication (`track-10040-skill-folder-scaffold.test.mjs`)**

- [ ] TC-93: **AC-15.** Drive the real implement skill path against a fixture that already has
      `AM-10040-slug/` — expected: exactly **one** folder for track 10040 exists afterwards, and
      no `10040-slug/` was created. Must fail against the current skill instructions.
- [ ] TC-94: Scaffolding for a genuinely-new number — expected: creates `INITIALS-NNN-slug`, never
      the bare `NNN-slug` legacy form
- [ ] TC-95: A folder exists under an unexpected third convention — expected: the session uses it
      and reports it; it does **not** scaffold a second folder (REQ-15: an existing folder under
      *any* convention makes scaffolding an error, not a fallback)

## Phase 4 — Invalid resting states (REQ-16, REQ-17)

**`conductor/services/resting-state.mjs` (pure)**

- [ ] TC-96: **AC-16, no-false-positive half.** `deriveValidRestingStates` against **this
      project's** real `workflow.json` (`plan.on_success: "plan:success"`) — expected:
      `plan:success` is **valid**. Zero false positives on planned tracks; this is the case a
      hardcoded list would get wrong.
- [ ] TC-97: **AC-16.** Same function against a workflow configuring
      `plan.on_success: "implement:queue"` — expected: `plan:success` is now **invalid**. Proves
      the set is derived, never hardcoded.
- [ ] TC-98: **AC-16.** `findInvalidRestingStates` over a seeded fixture containing 10038's shape
      (`implement:success`) and 1100's (`quality-gate:success`) — expected: both returned, each
      carrying the transition `workflow.json` says should have applied
      (`review:queue` and `done:queue` respectively)
- [ ] TC-99: `done:success`, `done:waiting`, and every `*:queue` / `*:running` / `*:failure` —
      expected: none flagged
- [ ] TC-100: `classifyRestingState` with inconsistent/absent completion markers — expected:
      `escalate`, not `reapply`. The default must be the conservative branch.
- [ ] TC-101: `classifyRestingState` with complete, consistent lane markers — expected: `reapply`
      with the configured transition
- [ ] TC-102: **AC-17.** `classifyMergedButNotDone` with `mergeCommitReachable: true` and
      `lane: 'implement'` — expected: invalid. 10038's exact shape (merged at `a897323`, markers
      reading `implement:success`).
- [ ] TC-103: **AC-17, D9.** The same input — expected: the classification is `escalate`, and no
      code path in the module can return a `reapply`/auto-forward action for it. Assert on the
      returned action set, so a later change that adds auto-repair fails this test.
- [ ] TC-104: `mergeCommitReachable: false`, `lane: 'implement'` — expected: valid (not every
      unmerged implement track is corrupt)
- [ ] TC-105: `mergeCommitReachable: true`, `lane: 'done'` — expected: valid (the normal shipped
      case)
- [ ] TC-106: Reachability probe is injected — expected: the module runs with a stub and touches
      no repo

**Idempotence (`track-10040-resting-state-idempotence.test.mjs`)**

- [ ] TC-107: **D10.** Run the resting-state check 10 consecutive times against an unchanging
      invalid track — expected: **exactly one** ⚠️ comment in `conversation.md`. This is the
      191-comment regression guard for the new detector; it must count from the real file.
- [ ] TC-108: A track that leaves and re-enters an invalid resting state — expected: a new comment
      is permitted for the new streak (suppression is per-streak, not permanent silence)

## Phase 5 — Pre-spawn block counting and escalation (REQ-1, 2, 3, 8, 9, 10)

**`conductor/services/prespawn-block.mjs` (pure, `track-10040-prespawn-block.test.mjs`)**

- [ ] TC-1: `decidePreSpawnBlockOutcome({ countBefore: 0, threshold: 5 })` — expected:
      `action: 'warn'` (first block of a streak posts the one ⚠️)
- [ ] TC-2: `countBefore: 1..3` with `threshold: 5` — expected: `action: 'silent'` for every one;
      no comment body produced. This is REQ-10 — the 191-comment spam dies here, not at the end.
- [ ] TC-3: `countBefore: 4, threshold: 5` — expected: `action: 'escalate'`
- [ ] TC-4: `countBefore: 9, threshold: 5` (counter somehow ran past the threshold) — expected:
      still `escalate`, never a second ⚠️
- [ ] TC-5: `formatBlockComment` for warn — expected: body's **first character** is `⚠️`; for
      escalate — first character is `❌`. Asserted on `body[0]`, since the Inbox's SQL matches
      `LIKE '❌%'` on exactly that.
- [ ] TC-6: escalate body names the disqualifying paths from `reason` verbatim — expected: a human
      reading the comment alone can identify the root cause without opening a log
- [ ] TC-7: `kind: 'expired-credentials'` (10039's reserved kind) with the same counts — expected:
      identical decisions as TC-1..TC-3. REQ-9: the logic is cause-generic; nothing branches on
      dirty-path shape.
- [ ] TC-8: unknown/absent `kind` — expected: throws or returns a rejected outcome, never silently
      counts an unclassified block

**Worker integration (`track-10040-guard-block-escalation.test.mjs`)**

- [ ] TC-9: **The 10036 regression (AC-1).** Fixture repo with a permanently-dirty checkout (a
      tracked-then-deleted `ui/node_modules`) and a track at `plan:queue`, `Auto Run: yes`. Run the
      auto-launch loop `threshold + 2` times — expected: `index.md` ends at
      `**Lane Status**: failure`, and the loop stops re-claiming it (no further block log lines
      after escalation).
- [ ] TC-10: **Comment count (AC-6).** Same fixture — expected: `conversation.md` contains
      **exactly 2** system comments across the whole streak: one starting `⚠️`, one starting `❌`.
      Counted by parsing the real file, not by calling `formatBlockComment`.
- [ ] TC-11: **Transient block does not escalate (AC-8).** Checkout dirty for cycle 1, clean from
      cycle 2 — expected: cycle 2 spawns normally, and the persisted count reads 0 afterwards.
- [ ] TC-12: Counter resets on success — a spawn that clears both guards zeroes the count even if
      the run itself later fails (blocks and run-failures are separate counters)
- [ ] TC-13: Counter resets on lane change — blocks accrued in `plan` do not carry into
      `implement` (mirrors the existing `.retry-lane` guard)
- [ ] TC-14: Counter resets on human intervention — a new `> **human**:` comment in
      `conversation.md` returns the count to 0 and re-enables claiming
- [ ] TC-15: Both throw sites are counted — the main-mode-*lock* block (`kind: 'main-mode-lock'`)
      escalates on the same threshold as the dirty-checkout one, not only the latter
- [ ] TC-16: `err.workspaceGuardBlocked` is still set on the thrown error (REQ-3 — the existing
      flag is read, not replaced by a parallel signal)
- [ ] TC-17: local-fs mode with no collector — expected: the count persists in
      `.prespawn-block-count` beside `index.md` and escalation still happens (no DB required)
- [ ] TC-17b: The escalating `failure` write goes **through** Phase 2's lane-regression guard —
      expected: a spy on the guard records the call, and the write still succeeds (a same-lane
      status change). Guards must not be bypassed by the code that most wants to write.

**Collector API (`ui/server/tests/track-10040-prespawn-block-api.test.mjs`)**

- [ ] TC-18: `POST /track/:num/prespawn-block` twice — expected: returns `count: 1` then `count: 2`,
      and the `tracks` row reflects `prespawn_block_kind` / `prespawn_block_reason` /
      `prespawn_blocked_at`
- [ ] TC-19: `POST /track/:num/prespawn-block/reset` — expected: count back to 0, kind/reason cleared
- [ ] TC-20: **AC-7 (10039's dependency).** After escalation, the count/kind/reason are readable
      from the DB with **no filesystem access at all** — expected: a dispatcher-only consumer can
      reconstruct the escalation state. Also asserts the state survives a worker restart.
- [ ] TC-21: Unknown track number — expected: a clean 404/`count: 0`, never a 500
- [ ] TC-22: Missing/invalid `collectorAuth` — expected: rejected like every sibling endpoint

**Inbox (`ui/server/tests/track-10040-inbox-escalation.test.mjs`, real DB)**

- [ ] TC-23: **AC-5.** Track whose latest comment is the `❌` escalation — expected: a real
      `GET /api/inbox` response puts it in bucket `needs_input`. Driven through the HTTP endpoint
      against a real DB (mirroring `track-10012-inbox-buckets.test.mjs`), not a unit assertion on
      the SQL `CASE`.

## Phase 6 — Quarantine slots, phantom markers, widened orphan reaping (REQ-4, 5, 6)

**Concurrency counter (`ui/src/.../auto-launch` suite + fixture)**

- [ ] TC-24: **AC-2.** `conductor/tracks/` fixture containing `_duplicate-10036-slug/index.md` with
      `**Lane**: implement` / `**Lane Status**: running`, `parallel_limit: 2`, and one real track
      queued in `implement` — expected: the queued track **is** claimed. Before the fix this logs
      `Lane "implement" at limit 2 (Running: 3, Claimed: 0)`; that log line must not appear.
      (Build the fixture — the live instance has since reverted to `queue`; see plan Phase 6
      Task 1.)
- [ ] TC-25: `_duplicate-*` folders are excluded from both scans — the `currentlyRunningPerLane`
      pre-pass and the claim loop — expected: neither counts them
- [ ] TC-26: `quarantineStaleFolder` on a folder whose `index.md` says `running` — expected: the
      renamed folder's marker reads `quarantined`, so no scan can resurrect the phantom
- [ ] TC-27: Quarantine is still non-destructive — expected: `plan.md`/`spec.md`/`conversation.md`
      content is byte-identical after the rename (the existing "nothing is deleted" guarantee)

**`conductor/services/stuck-track-sweep.mjs` (pure)**

- [ ] TC-28: **AC-3.** Track `running` on disk, no live pid, no run marker, no DB claim, older
      than grace — expected: classified `reconcile`
- [ ] TC-29: Track `running` with a **live** pid — expected: not returned (a genuinely running
      track is never touched)
- [ ] TC-30: Track `running` with a live run marker but no pid in the passed set (a *different*
      process spawned it) — expected: not returned
- [ ] TC-31: Track `running` with a live DB claim — expected: not returned
- [ ] TC-32: Track `running` for less than the grace window — expected: not returned (claim → lock
      → worktree → spawn legitimately takes seconds)
- [ ] TC-33: Repeat phantom (already reconciled once) — expected: classified `escalate`, feeding
      Phase 5's counter with `kind: 'phantom-running'`
- [ ] TC-34: Sweep is manager-only — expected: a non-manager worker never runs it

**Widened orphan detection (`track-10040-orphan-worker-widened.test.mjs`)**

- [ ] TC-35: **AC-4.** Registered worker, fresh heartbeat, cwd probe reports deleted — expected:
      reaped. This is Finding 3's live zombie (PID 1736711), invisible to today's rule.
- [ ] TC-36: Registered worker, cwd exists, heartbeat older than the stale threshold — expected:
      reaped
- [ ] TC-37: Registered worker, cwd exists, fresh heartbeat — expected: **not** reaped
- [ ] TC-38: Unregistered process older than grace — expected: still reaped (today's behavior
      unchanged — regression guard)
- [ ] TC-39: The manager's own pid, matching every reap condition — expected: never reaped
- [ ] TC-40: Any process younger than `graceMs` — expected: never reaped, on every branch
- [ ] TC-40b: A process that ignores `SIGTERM` — expected: `SIGKILL` follows after the grace
      period and the escalation is logged (two live zombies required this)

## Phase 7 — Known-safe auto-heal (REQ-7)

**`conductor/services/dirty-path-heal.mjs` (pure)**

- [ ] TC-41: `{ path: 'ui/node_modules', porcelainStatus: 'D', isGitIgnored: true }` — expected:
      `healable: true`, `remedy: 'git rm -r --cached ui/node_modules'`. The exact 10036 cause.
- [ ] TC-42: Same path, `isGitIgnored: false` — expected: `healable: false` (fails D3 condition b)
- [ ] TC-43: `{ path: 'src/index.js', porcelainStatus: 'D', isGitIgnored: true }` — expected:
      `healable: false` (fails condition c — not on the allowlist, even though ignored+deleted)
- [ ] TC-44: `{ path: 'ui/node_modules', porcelainStatus: 'M' }` and `'??'` — expected:
      `healable: false` for both (fails condition a — only deleted-from-worktree qualifies)
- [ ] TC-45: Every allowlist entry (`dist`, `build`, `out`, `.next`, `coverage`, `.venv`,
      `__pycache__`, `.turbo`) at a nested path — expected: healable under (a)+(b)
- [ ] TC-46: Path traversal / absolute path (`../../etc`, `/etc/passwd`) — expected:
      `healable: false`, never a remedy naming a path outside the repo
- [ ] TC-47: The emitted remedy is **only ever** `git rm -r --cached` — expected: no input in the
      whole suite produces a remedy containing `rm -rf`, a filesystem delete, or a content edit

**Heal application (integration)**

- [ ] TC-48: **AC-9, propose half.** `manager.auto_heal` unset, healable path present — expected:
      the ❌ comment contains `git rm -r --cached ui/node_modules`, and `git diff --cached` is
      empty (index verifiably untouched)
- [ ] TC-49: **AC-9, apply half.** `manager.auto_heal: true` — expected: the path ends untracked,
      `git status --porcelain` is clean, a `fix(manager): untrack ignored build output` commit
      exists, a ✅ comment names what was done, and the previously-stuck track spawns next cycle
- [ ] TC-50: Apply takes the global main-mode lock first — expected: with the lock already held by
      another session, the heal defers rather than writing concurrently
- [ ] TC-51: Non-healable dirty path with `auto_heal: true` — expected: escalates only, git index
      untouched (opt-in widens *nothing* about the safety boundary)

---

## Acceptance Criteria

- [ ] All unit tests pass (`node --test conductor/tests/*.test.mjs`)
- [ ] All Vitest suites pass (`cd ui && npm test`) — no regressions in auto-launch, inbox, claim,
      or worktree suites
- [ ] Every AC has at least one covering TC:
      AC-1→TC-9 · AC-2→TC-24 · AC-3→TC-28 · AC-4→TC-35 · AC-5→TC-23 · AC-6→TC-10 · AC-7→TC-20 ·
      AC-8→TC-11 · AC-9→TC-48/49 · AC-10→TC-81 · AC-11→TC-65/73 · AC-12→TC-55 · AC-13→TC-54/56 ·
      AC-14→TC-57..60 · AC-15→TC-93 · AC-16→TC-96/97/98 · AC-17→TC-102/103
- [ ] **Every test that guards a live bug fails before its fix.** TC-55, TC-56, TC-73, TC-93 and
      TC-98 all describe behavior that is broken right now — each must be demonstrated red first.
      A green-on-first-run test for a confirmed live defect is a test that is measuring the wrong
      thing.
- [ ] Real-product check (not unit-only): with a deliberately-dirty primary checkout, a real
      worker drives a real track to `failure` and the escalation is visible in the running UI's
      Inbox under "Needs your input" — screenshot or the real `/api/inbox` JSON recorded
- [ ] Real-product check for Phase 4: the three live stranded tracks (10038, 1100, 10039) are
      detected by a real run of the resting-state check against the real project
- [ ] **The worker process is restarted before any verification run.** Workers do not hot-reload;
      verifying against a pre-change process is a false pass. This is Finding 4 — a track whose
      own subject matter is stale processes must not be verified by one.
- [ ] No regressions: a normal clean-checkout main-mode track still spawns with zero new comments,
      and a normal `plan:success` track is not flagged by the resting-state check
