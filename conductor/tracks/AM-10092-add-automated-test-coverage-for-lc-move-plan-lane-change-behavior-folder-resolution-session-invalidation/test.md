# Tests: Track AM-10092 — `lc` move-family lane-change behavior

## Test Commands

```bash
# The new suite (primary deliverable)
node --test conductor/tests/track-10092-move-family-cli.test.mjs

# Regression check — the mock-collector change must not break existing consumers
node --test conductor/tests/local-api-e2e.test.mjs
node --test conductor/tests/track-1086-session-worker.test.mjs

# Neighbouring CLI resolver suites
node --test conductor/tests/track-10063-track-dir-cli.test.mjs
node --test conductor/tests/track-10040-track-dir-cli.test.mjs

# Orphan check — MANDATORY after every run (see .claude/MEMORY.md)
ps aux | grep -E 'mock-collector|laneconductor.sync.mjs' | grep -v grep
```

## Test Cases

### Phase 1: Mock collector delete log
- [ ] TC-0a: After a `DELETE /track/10092/session`, `GET /_state` returns a
      `sessionDeletes` array containing one entry with `track_number: "10092"` —
      expected: length 1, correct number.
- [ ] TC-0b: `local-api-e2e.test.mjs` and `track-1086-session-worker.test.mjs` still pass
      unchanged — expected: no failures, proving the addition is non-breaking.

### Phase 2: Folder resolution
- [ ] TC-1: Fixture has only `conductor/tracks/AM-10092-sample/`. Run `lc plan 10092` —
      expected: exit 0, that folder's `index.md` now reads `**Lane**: plan` /
      `**Lane Status**: queue`.
- [ ] TC-2: Same fixture, run `lc plan AM-10092` — expected: exit 0, same markers written,
      and stdout contains `Track 10092 updated` (bare number, not `AM-10092`).
- [ ] TC-3: Fixture has only legacy `conductor/tracks/10092-sample/`. Run `lc plan 10092` —
      expected: exit 0, markers written to that folder.
- [ ] TC-4: Fixture has `AM-10092-sample/` and `AM-110092-other/`, both starting at
      `**Lane**: done`. Run `lc move 10092 implement:queue` — expected: `AM-10092-sample`
      moved to `implement`; `AM-110092-other` still reads `**Lane**: done`, byte-identical
      to its original content.
- [ ] TC-4b: Fixture has **only** `AM-110092-other/`. Run `lc plan 10092` — expected:
      non-zero exit and `Track 10092 not found` on stderr (the substring must not be a
      false positive that silently writes to the wrong track).

### Phase 3: Session invalidation
- [ ] TC-5: Track at `**Lane**: done`, session seeded for `10092`. Run `lc plan 10092` —
      expected: exactly one `sessionDeletes` entry with `track_number: "10092"`, and
      `state.sessions["10092"]` is absent.
- [ ] TC-6: Same setup, run `lc plan AM-10092` — expected: the recorded delete's
      `track_number` is `"10092"`; no entry for `"AM-10092"` exists in `sessionDeletes`
      or survives in `state.sessions`.
- [ ] TC-7: Sessions seeded for `10092` and `10093`, both at `**Lane**: done`. Run
      `lc plan 10092` — expected: one delete total, `state.sessions["10093"]` still holds
      its seeded value.
- [ ] TC-8: Track already at `**Lane**: plan`. Run `lc plan 10092` — expected:
      `sessionDeletes` is empty, `state.sessions["10092"]` intact, and `**Lane Status**`
      updated to `queue`.
- [ ] TC-9: Track at `**Lane**: implement`, `**Progress**: 0%`. Run
      `lc pulse 10092 running 50` — expected: `sessionDeletes` empty, session intact,
      `**Lane**` still `implement`, `**Lane Status**: running`, `**Progress**: 50%`.
- [ ] TC-10: Track at `**Lane**: done`. Run `lc move 10092 implement:queue` — expected:
      one delete recorded, `**Lane**: implement`, `**Lane Status**: queue`.
- [ ] TC-11: Track at `**Lane**: plan`. Run `lc implement 10092` — expected: one delete
      recorded, `**Lane**: implement`, `**Lane Status**: queue` — identical behavior to
      the `plan` alias, proving the shared branch.

### Phase 4: Degraded paths
- [ ] TC-12: `.laneconductor.json` has `"mode": "local-fs"` plus a reachable collector.
      Run `lc plan 10092` from `**Lane**: done` — expected: exit 0, markers written,
      `sessionDeletes` empty (no HTTP call made at all).
- [ ] TC-13: Two mock collectors; `collectors[0]` has `"enabled": false`. Run
      `lc plan 10092` from `**Lane**: done` — expected: collector 0's `sessionDeletes` is
      empty, collector 1's has exactly one entry.
- [ ] TC-14: Single collector on a closed port (nothing listening). Run `lc plan 10092`
      from `**Lane**: done` — expected: exit 0, markers written, elapsed wall-clock under
      10s (best-effort invalidation never blocks the move).

### Regression-pinning verification (run once, during implementation)
- [ ] TC-R1: Temporarily restore the `readdirSync(...).find(d => d.startsWith(trackNum + '-'))`
      scan in `bin/lc.mjs` — expected: TC-1, TC-2 and TC-4 fail. Revert immediately; do not
      commit. Record the observed failure output in `conversation.md`.
- [ ] TC-R2: Temporarily delete the `if (lane && lane !== priorLane && command !== 'pulse')`
      invalidation block — expected: TC-5, TC-6, TC-7, TC-10 and TC-11 fail. Revert
      immediately; do not commit. Record the output in `conversation.md`.

## Acceptance Criteria
- [ ] All Phase 2–4 test cases pass from a clean checkout with no worker and no database
      running.
- [ ] TC-R1 and TC-R2 were actually executed and their failure output recorded — a test
      that passes against the broken code pins nothing.
- [ ] Existing session and CLI suites listed under Test Commands still pass.
- [ ] No orphaned `mock-collector` or `laneconductor.sync.mjs` process remains after the
      run.
- [ ] No production file outside `conductor/tests/` is modified on this track.
