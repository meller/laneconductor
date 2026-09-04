# Tests: Track TU-10060 — Main-mode dirty-checkout guard wedge

## Test Commands

```bash
# New tests for this track
node --test conductor/tests/track-10060-dirty-guard-exemptions.test.mjs
node --test conductor/tests/track-10060-prespawn-counter-fallback.test.mjs
node --test conductor/tests/track-10060-regenerable-artifact-heal.test.mjs

# Existing suites this track touches (must stay green)
node --test conductor/tests/track-10040-prespawn-block.test.mjs
node --test conductor/tests/track-10040-dirty-path-heal.test.mjs
node --test conductor/tests/track-1115-workspace-mode.test.mjs

# End-to-end escalation against the mock collector
node --test conductor/tests/local-api-e2e.test.mjs

# Full UI/server suite (regression check)
cd ui && npm test
```

## Test Cases

### Phase 1 — exemption boundary (`track-10060-dirty-guard-exemptions.test.mjs`)

- [x] TC-1: `findDisqualifyingDirtyPaths(['conductor/tracks/TU-10055-x/index.md'], 'conductor/tracks/TU-10060-y/')`
      — expected: `[]`. Another track's status marker never blocks a spawn.
- [x] TC-2: Same for that track's `plan.md`, `spec.md`, `test.md` in one
      call — expected: `[]`.
- [x] TC-3: `conductor/tracks/TU-10055-x/conversation.md` — expected: returned
      as disqualifying. A human can have real WIP there; this exclusion is
      deliberate and must not drift.
- [x] TC-4: A `--untracked-files=all` shaped list for a brand-new track
      folder (four separate `index/spec/plan/test.md` entries, not one
      directory entry) — expected: `[]`.
- [x] TC-5: `prisma/schema.sql` — expected: returned as disqualifying. The
      guard must still block on it; this track changes the messaging, not
      the classification.
- [x] TC-6: The track's own folder prefix still filters its own files —
      expected: `[]` for `conductor/tracks/TU-10060-y/conversation.md` when
      that is the own-folder prefix.

### Phase 2 — counter fallback (`track-10060-prespawn-counter-fallback.test.mjs`)

- [x] TC-7: Counter helper called five times with the same `kind` against a
      temp track folder — expected: `countBefore` returns 0,1,2,3,4 in order
      and `.prespawn-block-count` holds 5 afterwards.
- [x] TC-8: Counter helper called with `dirty-checkout` twice then
      `main-mode-lock` — expected: the third call returns `countBefore === 0`
      (cause change resets the streak) and `.prespawn-block-kind` reads
      `main-mode-lock`.
- [x] TC-9: `decidePreSpawnBlockOutcome` fed the fallback counts 0..4 —
      expected: `warn`, `silent`, `silent`, `silent`, `escalate`. Confirms
      exactly two comments across a five-block streak.
- [x] TC-10: Collector `POST /prespawn-block` stubbed to reject; track folder
      present — expected: `handlePreSpawnBlock` still escalates on the fifth
      consecutive block, and does **not** report `warn` five times.
- [x] TC-11: Collector stubbed to reject; `primaryTrackDirName` is null —
      expected: `countBefore === 0` (first-of-streak), no crash. There is
      nowhere safe to persist a count.
- [x] TC-12: Counter-backend failure emits a distinct warning naming
      `ui/server/migrations/013_track_10040_prespawn_block.sql` — expected:
      logged once at `countBefore === 0`, not on subsequent blocks in the
      same streak.
- [x] TC-13: After a streak reaches 3, a successful spawn resets both the API
      counter and `.prespawn-block-count` — expected: the next block reports
      `warn` (fresh streak), not `silent`.

### Phase 3 — block comment wording (`track-10040-prespawn-block.test.mjs`, updated)

- [x] TC-14: `formatBlockComment({action:'warn', kind:'dirty-checkout', reason})`
      — expected: first character is `⚠️`, body states main-mode lane actions
      including merges are halted project-wide, and echoes `reason`.
- [x] TC-15: `formatBlockComment({action:'escalate', kind:'dirty-checkout'})`
      — expected: first character is `❌`.
- [x] TC-16: `formatBlockComment({action:'silent', ...})` — expected: `null`.
- [x] TC-17: Wording for `main-mode-lock` and the reserved cloud kinds is
      unchanged from the current strings.

### Phase 4 — regenerable artifacts (`track-10060-regenerable-artifact-heal.test.mjs`)

- [x] TC-18: `classifyHealableDirtyPath({path:'prisma/schema.sql', porcelainStatus:'M', isGitIgnored:false})`
      — expected: `healable === false`, `suggestion` contains
      `node scripts/atlas-prisma.mjs`.
- [x] TC-19: Same for `cloud/schema.sql` — expected: same shape.
- [x] TC-20: `prisma/schema.sql` with `porcelainStatus:'??'` — expected: no
      suggestion. An untracked file of that name is not the drift case.
- [x] TC-21: An unrelated modified tracked file (`ui/src/App.jsx`, `M`) —
      expected: `healable === false`, no `suggestion`.
- [x] TC-22: The existing build-output case (`ui/node_modules`, `D`, ignored)
      — expected: unchanged, `healable === true` with a
      `git rm -r --cached` remedy.
- [x] TC-23: With `manager.auto_heal: true` and `prisma/schema.sql` the only
      disqualifying path — expected: nothing is committed and nothing is
      executed; the apply gate requires every path to be `healable`.

### Phase 5 — end to end

- [x] TC-24: Dirty the primary checkout with a tracked, non-exempt file,
      trigger five `done`-lane spawns with the prespawn-block endpoint
      returning 500 — expected: track lands `done:failure`, `conversation.md`
      gained exactly one `⚠️` and one `❌`.
- [x] TC-25: Clean the checkout, re-run — expected: the merge spawns normally
      and the counter is back at zero.
- [x] TC-26: Restart the worker before TC-24 and TC-25 — expected: the
      observed behaviour comes from the new code, not a stale process.

## Acceptance Criteria

- [x] All new and existing listed tests pass — 78/78 across the six suites
      listed above plus the new end-to-end one.
- [x] `cd ui && npm test` shows no regression — 11 failed files / 35 failed
      tests / 650 passed, byte-identical on the untouched primary checkout.
      All pre-existing and unrelated (auth, api-routes, WorkflowSettings).
- [x] Escalation is reachable with the counter backend unavailable (TC-10),
      confirmed again end to end through the real worker (TC-24).
- [x] The auto-apply boundary is unchanged (TC-22, TC-23), and TC-24 asserts
      the drifted dump is still uncommitted after five blocks.
- [x] The `index.md` exemption is pinned by test (TC-1..TC-4)

## Not run, and why

- `conductor/tests/local-api-e2e.test.mjs` (and ~48 other suites) reference
  `conductor/tests/mock-collector.mjs`, which track 10051 renamed to
  `mock-target.mjs` without updating its callers. Pre-existing breakage,
  outside this track's scope. The new end-to-end test therefore spawns
  `mock-target.mjs` directly rather than adding to that debt.
