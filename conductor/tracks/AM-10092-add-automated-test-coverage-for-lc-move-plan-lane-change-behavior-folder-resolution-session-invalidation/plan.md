# Track AM-10092: Automated test coverage for `lc` move-family lane-change behavior

## Phase 1: Mock collector — record session deletes

**Problem**: `mock-collector.mjs`'s `DELETE /track/:num/session` handler deletes state but
leaves no trace. A test can then only assert "the session is gone", which cannot
distinguish *no call fired* (the correct outcome for a same-lane move) from *a call fired
against the wrong key* (e.g. an unnormalized `AM-10092`). The negative cases (REQ-8, REQ-9)
need the stronger assertion.

**Solution**: Append every accepted delete to a new `state.sessionDeletes` array
(`{ track_number, url, bearerToken }`), exposed by the existing `GET /_state`. Purely
additive — the handler's own deletion and `200 { ok: true }` response are unchanged.

- [ ] Task 1: Add `sessionDeletes: []` to the mock's `state` object, with a comment naming
      this track and why the log exists (distinguishing "no call" from "wrong key").
- [ ] Task 2: Push a record in the `DELETE /track/:num/session` handler before replying.
- [ ] Task 3: Clear `sessionDeletes` wherever the existing state-reset endpoint clears
      `state.sessions` (around mock-collector.mjs:483), so a reset is complete.
- [ ] Task 4: Run `node --test conductor/tests/local-api-e2e.test.mjs` and at least one
      other session-touching suite (`track-1086-session-worker.test.mjs`) to prove no
      existing consumer regressed.

**Impact**: One shared test fixture gains an exact call log. No production code touched.

## Phase 2: Test fixture + folder-resolution cases (REQ-1..REQ-4, REQ-16)

**Problem**: Nothing exercises `lc plan`/`lc move`'s folder resolution, so the
`startsWith`-scan regression could return unnoticed.

**Solution**: A `node --test` suite that builds a throwaway project under `os.tmpdir()` and
spawns the real `bin/lc.mjs` via `execFileSync`, following
`conductor/tests/track-10063-track-dir-cli.test.mjs`'s shape.

- [ ] Task 1: Create `conductor/tests/track-10092-move-family-cli.test.mjs` with a header
      comment stating the two live bugs, their fix commits (`ac5dd70a`, `47fa2c59`), and
      why the suite exists.
- [ ] Task 2: Write `makeProject({ collectors, mode, tracks })` — `mkdtempSync` under
      `tmpdir()`, `conductor/tracks/`, a `.laneconductor.json`, and one `index.md` per
      requested track. Explicitly under `tmpdir()`, never inside the repo (REQ-16).
- [ ] Task 3: Write `runLc(projectRoot, args)` returning `{ stdout, status }`, and
      `readMarkers(indexPath)` parsing `**Lane**` / `**Lane Status**` / `**Progress**`.
- [ ] Task 4: TC-1 — prefixed folder + bare-number invocation (REQ-1).
- [ ] Task 5: TC-2 — prefixed folder + prefixed-identifier invocation; assert stdout says
      the bare number (REQ-2).
- [ ] Task 6: TC-3 — legacy bare `NNN-slug` folder still resolves (REQ-3).
- [ ] Task 7: TC-4 — a `AM-110092-other` sibling is left untouched when moving `10092`
      (REQ-4).
- [ ] Task 8: Confirm each case fails against the pre-`ac5dd70a` `startsWith` scan — do
      this by temporarily patching the branch locally, running, then reverting. Record the
      observed failure output in `conversation.md`. Do **not** commit the revert.

**Impact**: The resolver swap is pinned; a future refactor that reintroduces a
legacy-only scan fails loudly.

## Phase 3: Session-invalidation cases (REQ-5..REQ-11)

**Problem**: The invalidation fix and every non-`plan` invocation form are untested.

**Solution**: Extend the suite with a mock collector started per-describe-block, seeding
sessions via `POST /track/:num/session` and asserting against `GET /_state`'s `sessions`
and Phase 1's `sessionDeletes`.

- [ ] Task 1: Add `startMockCollector()` / `getState(port)` helpers (copy the established
      shape from `chat-reply-conversation-md.test.mjs`), with an `after` hook that kills
      the process — no orphans.
- [ ] Task 2: TC-5 — `lc plan NNN` on a `done` track fires exactly one DELETE for `NNN`;
      that session is gone (REQ-5).
- [ ] Task 3: TC-6 — `lc plan AM-NNN` records a delete whose `track_number` is the bare
      `NNN`, never `AM-NNN` (REQ-6).
- [ ] Task 4: TC-7 — seed sessions for two tracks; moving one leaves the other's session
      intact and produces exactly one delete record (REQ-7).
- [ ] Task 5: TC-8 — `lc plan NNN` on a track already in `plan` records **zero** deletes;
      `**Lane Status**` still updates (REQ-8).
- [ ] Task 6: TC-9 — `lc pulse NNN running 50` records zero deletes, leaves `**Lane**`
      unchanged, sets `**Lane Status**: running` and `**Progress**: 50%` (REQ-9).
- [ ] Task 7: TC-10 — generic `lc move NNN implement:queue` writes both markers and fires
      the DELETE on a real lane change (REQ-10).
- [ ] Task 8: TC-11 — `lc implement NNN` behaves identically to the `plan` alias (REQ-11).
- [ ] Task 9: Confirm TC-5/TC-10/TC-11 fail with `47fa2c59`'s invalidation block
      temporarily removed; record the output in `conversation.md`; revert.

**Impact**: Both live bugs and every previously-unexercised invocation form are covered.

## Phase 4: Degraded-path cases (REQ-12..REQ-14)

**Problem**: The invalidation is deliberately best-effort. Nothing proves it stays
best-effort — a future change could make an unreachable collector abort the lane move.

**Solution**: Three cases over the same fixture helper.

- [ ] Task 1: TC-12 — `mode: "local-fs"` with a reachable collector configured: zero
      deletes recorded, index.md still written, exit 0 (REQ-12).
- [ ] Task 2: TC-13 — two mock collectors, the first `"enabled": false`: only the enabled
      one records a delete (REQ-13).
- [ ] Task 3: TC-14 — a single collector pointed at a closed port: exit 0, markers written,
      and the command returns promptly (assert a wall-clock bound generous enough not to
      be flaky, e.g. under 10s) (REQ-14).

**Impact**: The "a session-invalidation failure must never block the lane move itself"
guarantee written in the source comment becomes an executable assertion.

## Phase 5: Suite integration and verification

- [ ] Task 1: Run the full new suite: `node --test conductor/tests/track-10092-move-family-cli.test.mjs`.
- [ ] Task 2: Run the neighbouring CLI and session suites to check for interference:
      `node --test conductor/tests/track-10063-track-dir-cli.test.mjs conductor/tests/track-10040-track-dir-cli.test.mjs conductor/tests/local-api-e2e.test.mjs`.
- [ ] Task 3: Check for orphaned processes after the run —
      `ps aux | grep -E 'mock-collector|laneconductor.sync.mjs'` — and kill any leak found
      before reporting success. (See `.claude/MEMORY.md`: `node --test` has leaked real
      workers in this repo before.)
- [ ] Task 4: Confirm `/tmp` is clean — every `mkdtempSync` fixture removed in a `finally`
      or `after` hook.
- [ ] Task 5: Commit: `test(track-10092): cover lc move-family folder resolution and session invalidation`.
