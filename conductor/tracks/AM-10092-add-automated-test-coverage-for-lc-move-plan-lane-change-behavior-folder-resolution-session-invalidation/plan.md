# Track AM-10092: Automated test coverage for `lc` move-family lane-change behavior

## Phase 1: Mock collector — record session deletes (REQ-15)

**Problem**: `conductor/tests/mock-collector.mjs` already implements
`DELETE /track/:num/session` (clears `state.sessions[num]` and
`state.sessionsByToken[token][num]`), but records no history of the call — a test can only
assert "the session is now empty," which can't distinguish "no delete happened" from "a delete
happened against the wrong track number."

**Solution**: add a `state.sessionDeletes` array, push `{ track_number, bearerToken }` on every
`DELETE /track/:num/session`, reset it in `POST /_reset`, and expose it (it already is, since
`GET /_state` returns the whole `state` object). Purely additive — no existing response shape or
behavior changes.

- [ ] Add `sessionDeletes: []` to the mock's initial state object.
- [ ] Push an entry in the existing `DELETE /track/:num/session` handler, before or after the
      existing clear logic.
- [ ] Reset `state.sessionDeletes = []` in the `POST /_reset` handler alongside the other resets.
- [ ] Run `node --test conductor/tests/local-api-e2e.test.mjs` and
      `node --test conductor/tests/track-1086-session-worker.test.mjs` unmodified — TC-0b —
      confirm both still pass (proves the addition is non-breaking).

## Phase 2: New suite — folder resolution (REQ-1 through REQ-4)

**Problem/Solution**: see `spec.md`'s Folder resolution requirements — TC-1 through TC-4b in
`test.md`. One shared fixture-builder helper (project dir under `os.tmpdir()`, `.laneconductor.json`
in `local-api` mode pointed at a mock collector, a `conductor/tracks/AM-10092-sample/index.md`
starting at `**Lane**: done`), reused across phases 2-4.

- [ ] TC-1, TC-2: bare-number and prefixed-identifier resolution against the same
      `AM-10092-sample` folder.
- [ ] TC-3: legacy bare `10092-sample` folder still resolves.
- [ ] TC-4: a sibling folder containing the number as a substring (`AM-110092-other`) is left
      untouched, byte-identical, after moving `AM-10092-sample`.
- [ ] TC-4b: only the substring-colliding folder exists — `lc plan 10092` must fail loudly
      (`Track 10092 not found`, non-zero exit), never silently write to the wrong folder.

## Phase 3: New suite — session invalidation (REQ-5 through REQ-9)

- [ ] TC-5, TC-6: a real lane change (`done` → `plan`) deletes the seeded session, addressed by
      the bare track number regardless of which identifier form was typed.
- [ ] TC-7: an unrelated track's seeded session survives.
- [ ] TC-8: a same-lane status-only move issues zero deletes.
- [ ] TC-9: `lc pulse` issues zero deletes and never touches `**Lane**`.

## Phase 4: New suite — invocation-form coverage + degraded paths (REQ-10 through REQ-14)

- [ ] TC-10: generic `lc move <id> <lane>:<status>` form — both markers written, delete fires.
- [ ] TC-11: `lc implement <id>` alias — identical behavior to `plan`, proving the shared branch.
- [ ] TC-12: `mode: "local-fs"` — no HTTP call at all, move still succeeds.
- [ ] TC-13: a disabled sibling collector receives no delete; the enabled one does.
- [ ] TC-14: an unreachable collector (closed port) never blocks the move — best-effort,
      completes well under 10s.

## Phase 5: Regression-pinning verification (TC-R1, TC-R2 — run once, not committed)

- [ ] TC-R1: temporarily restore the pre-`ac5dd70a` `readdirSync(...).find(d =>
      d.startsWith(trackNum + '-'))` scan — confirm TC-1/TC-2/TC-4 fail. Revert immediately.
- [ ] TC-R2: temporarily delete the `47fa2c59` invalidation block — confirm TC-5/TC-6/TC-7/TC-10/TC-11
      fail. Revert immediately.
- [ ] Record both runs' actual failure output in `conversation.md` — this is what proves the
      suite pins the two real fixes rather than trivially passing regardless.

## Phase 6: Full verification

- [ ] `node --test conductor/tests/track-10092-move-family-cli.test.mjs` — all cases green.
- [ ] Full Test Commands list from `test.md` (existing session/CLI-resolver suites) still pass.
- [ ] `ps aux | grep -E 'mock-collector|laneconductor.sync.mjs'` clean after every run.
- [ ] `git status --porcelain` shows only files under `conductor/tests/` changed by this track.
