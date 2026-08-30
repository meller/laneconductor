# Tests: Track AM-10040 — Manager Stuck-Track Healing

## Test Commands

```bash
# Pure-module unit tests (node:test, zero deps — the style used by
# workspace-mode / orphan-worker-detection / path-isolation)
node --test conductor/tests/track-10040-prespawn-block.test.mjs
node --test conductor/tests/track-10040-stuck-track-sweep.test.mjs
node --test conductor/tests/track-10040-dirty-path-heal.test.mjs
node --test conductor/tests/track-10040-orphan-worker-widened.test.mjs

# Worker E2E (spawns a real worker + mock collector, real filesystem)
node --test conductor/tests/track-10040-guard-block-escalation.test.mjs

# Concurrency-counter regression (existing auto-launch suite)
cd ui && npm test -- auto-launch

# Collector API (endpoints + inbox bucket), Vitest + supertest
cd ui && npm test -- track-10040

# Full suites before quality gate
node --test conductor/tests/*.test.mjs
cd ui && npm test
```

`LC_SKIP_GIT_LOCK=1` skips the git lock/worktree path in tests (existing convention).
`LC_PRESPAWN_BLOCK_ESCALATE_AFTER` lets a test escalate in 2 cycles instead of 5.

---

## Test Cases

### Phase 1 — Pre-spawn block counting and escalation

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

### Phase 2 — Quarantine slots, phantom markers, widened orphan reaping

**Concurrency counter (`ui/src/.../auto-launch` suite + fixture)**

- [ ] TC-24: **AC-2.** `conductor/tracks/` fixture containing `_duplicate-10036-slug/index.md` with
      `**Lane**: implement` / `**Lane Status**: running`, `parallel_limit: 2`, and one real track
      queued in `implement` — expected: the queued track **is** claimed. Before the fix this logs
      `Lane "implement" at limit 2 (Running: 3, Claimed: 0)`; that log line must not appear.
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
      Phase 1's counter with `kind: 'phantom-running'`
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

### Phase 3 — Known-safe auto-heal

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
- [ ] All Vitest suites pass (`cd ui && npm test`) — no regressions in auto-launch, inbox, or
      worktree suites
- [ ] AC-1 covered by TC-9; AC-2 by TC-24; AC-3 by TC-28; AC-4 by TC-35; AC-5 by TC-23;
      AC-6 by TC-10; AC-7 by TC-20; AC-8 by TC-11; AC-9 by TC-48/TC-49
- [ ] Real-product check (not unit-only): with a deliberately-dirty primary checkout, a real
      worker drives a real track to `failure` and the escalation is visible in the running UI's
      Inbox under "Needs your input" — screenshot or the real `/api/inbox` JSON recorded
- [ ] The worker process is restarted before any verification run (workers do not hot-reload;
      verifying against a pre-change process is a false pass)
- [ ] No regressions: a normal clean-checkout main-mode track still spawns with zero new comments
