# Track TU-10060: Main-mode dirty-checkout guard wedge

Investigation notes and the reasoning behind this scope live in `spec.md`.
Read Findings 1–5 there before starting any phase — Phase 1 exists partly to
stop a future run from "fixing" something that is already fixed.

## Phase 1: Lock in the already-correct exemption (regression only)

**Problem**: The reported root cause — the worker's own `index.md` marker
writes blocking the guard — is already exempted in
`conductor/services/workspace-mode.mjs:161`, and was before the incident.
There is no test asserting that specific class, so a future edit to
`isWorkerBookkeepingPath` could silently reintroduce the reported symptom.

**Solution**: Add a regression test that pins the exemption boundary, and
record the diagnosis so the misattribution is not repeated.

- [ ] Task 1: Add `conductor/tests/track-10060-dirty-guard-exemptions.test.mjs`
      asserting `findDisqualifyingDirtyPaths` exempts another track's
      `index.md`/`plan.md`/`spec.md`/`test.md` and does **not** exempt that
      track's `conversation.md` (REQ-1).
- [ ] Task 2: Assert the same for a `--untracked-files=all` shaped list, so
      the per-file expansion (`??` lines for a brand-new track folder) is
      covered alongside modified files.
- [ ] Task 3: Add a short comment block at the guard site
      (`conductor/laneconductor.sync.mjs:4790`) pointing at this track's
      spec Finding 1, so the next reader does not re-derive it.

**Impact**: No behaviour change. Makes the correct behaviour non-regressable
and stops the next investigation from starting over.

## Phase 2: Make escalation reachable when the counter backend is broken

**Problem** (spec Finding 3, the primary defect): when
`POST /track/:num/prespawn-block` fails, `handlePreSpawnBlock`
(`conductor/laneconductor.sync.mjs:4707`) sets `countBefore = 0` and treats
every block as first-of-streak. Escalation to `done:failure` becomes
structurally unreachable, so a permanently-wedged track retries and
re-comments indefinitely. The columns that endpoint writes come from
`ui/server/migrations/013_track_10040_prespawn_block.sql`, which has no
automatic runner, so this is reachable on any real deployment.

**Solution**: Fall back to the filesystem sibling counter the `local-fs` path
already implements, instead of guessing zero.

- [ ] Task 1: Extract the filesystem counter read/write from the `local-fs`
      branch of `handlePreSpawnBlock` into a small local helper taking
      `(tracksDir, trackDirName, kind)` and returning `countBefore`, so both
      branches use one implementation with identical cause-change reset
      semantics (REQ-3).
- [ ] Task 2: In the collector branch's `catch`, call that helper instead of
      assigning `countBefore = 0` (REQ-2). Preserve the existing behaviour
      when `primaryTrackDirName` is null — there is nowhere to persist a
      count, so first-of-streak remains the only safe answer there.
- [ ] Task 3: Emit a distinct one-per-streak warning on counter-backend
      failure naming the probable cause and the unapplied migration path
      (REQ-4). Gate it on `countBefore === 0` so a long streak does not
      re-log it every cycle.
- [ ] Task 4: Extend the two reset sites
      (`conductor/laneconductor.sync.mjs:4970` and `:5495`) so the API reset
      and the filesystem-sibling reset both always run, rather than the
      filesystem reset being `local-fs`-only (REQ-5). Without this a fallback
      count can outlive its block and escalate an unrelated later one.

**Impact**: A permanently-blocked main-mode track now reaches `done:failure`
after 5 consecutive blocks in every mode, producing exactly two comments
across the streak instead of one per cycle forever. Fixes Finding 5's
practical consequence without touching the auto-complete dispatch path.

## Phase 3: Make the block message say what is actually broken

**Problem** (spec Finding 4): the comment names a path and nothing else. It
reads as one track's housekeeping chore, when in fact the `done` lane is
`workspace: main`, so every merge in the project is halted until the path is
resolved. That framing is why the incident went unnoticed.

- [ ] Task 1: Change `formatBlockComment` in
      `conductor/services/prespawn-block.mjs` so a `dirty-checkout` block
      states the project-wide consequence — main-mode lane actions, including
      every merge, cannot start (REQ-6). Keep the leading `⚠️`/`❌` as the
      literal first character; the Inbox buckets match on it.
- [ ] Task 2: Keep `formatBlockComment` a pure function with no new inputs
      beyond the existing outcome object, so it stays unit-testable and the
      other block kinds' wording is untouched.
- [ ] Task 3: Update `conductor/tests/track-10040-prespawn-block.test.mjs`
      expectations for the new wording rather than adding a parallel test.

**Impact**: A human reading the Inbox learns that integration is stopped
project-wide, not that one card needs tidying.

## Phase 4: Suggestion-only classification for regenerable artifacts

**Problem** (spec Finding 2 and 4): `prisma/schema.sql` is a generated dump.
When it drifts it is tracked, modified, and not ignored, so
`classifyHealableDirtyPath` returns nothing at all and the operator gets no
guidance. It must not be auto-committed — a schema dump is exactly the kind
of thing a tool should not commit unattended.

- [ ] Task 1: Add a `REGENERABLE_ARTIFACTS` map in
      `conductor/services/dirty-path-heal.mjs` mapping `prisma/schema.sql`
      and `cloud/schema.sql` to `node scripts/atlas-prisma.mjs`.
- [ ] Task 2: Return a third classification shape for a modified, tracked
      path in that map: `{ healable: false, suggestion: <command>, reason }`
      (REQ-7). `healable` stays `false` so the `auto_heal` apply gate at
      `conductor/laneconductor.sync.mjs:4887` cannot pick it up (REQ-8) —
      that gate requires every disqualifying path to be `healable`.
- [ ] Task 3: Thread `suggestion` into the guard's existing `healSuggestion`
      string so it reaches the block comment, alongside (not replacing) the
      existing `remedy` suggestions.
- [ ] Task 4: Verify by inspection that no existing caller treats a truthy
      `suggestion` as permission to execute anything.

**Impact**: The operator sees why the artifact drifted and how to settle it,
while the auto-apply boundary stays exactly where it is.

## Phase 5: Verification

- [ ] Task 1: Run the full node:test suite for the touched modules
      (`conductor/tests/track-10040-prespawn-block.test.mjs`,
      `track-10040-dirty-path-heal.test.mjs`,
      `track-1115-workspace-mode.test.mjs`, and the new
      `track-10060-*.test.mjs`).
- [ ] Task 2: Run the escalation end to end against a real dirty checkout
      with the collector's prespawn-block endpoint stubbed to 500, confirming
      the fifth block lands `done:failure`. Use the existing mock collector
      (`conductor/tests/mock-collector.mjs`) rather than the live API.
- [ ] Task 3: Restart the worker before observing behaviour — it does not
      hot-reload, and this repo has produced false passes from verifying
      against a stale worker process.
- [ ] Task 4: Confirm no regression in `cd ui && npm test`.
