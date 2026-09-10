# Tests: Track AM-10086 — Auto-resume parked tracks once their blocking condition clears

## Test Commands

```bash
# Phase 1 + Phase 3 — pure decision module and marker clearing
node --test conductor/tests/track-10086-dependency-resume.test.mjs

# Phase 2 + Phase 4 — real spawned worker, real filesystem
node --test conductor/tests/track-10086-auto-resume-e2e.test.mjs

# Regression — the neighbouring machinery this touches
node --test conductor/tests/track-10055-waiting-resume.test.mjs
node --test conductor/tests/track-10055-waiting-any-lane.test.mjs
node --test conductor/tests/track-1119-phase3-depends-on.test.mjs

# Server-side marker clearing on human resume (Phase 3)
cd ui && npx vitest run
```

> After any `node --test` or full `vitest run`, check for leaked workers:
> `ps aux | grep laneconductor.sync.mjs` — both runners have leaked real worker
> processes against the primary checkout in this repo before.

## Test Cases

### Phase 1 — attribution (`resolveBlockedDependencies`)

- [x] TC-1.1: `**Waiting On Tracks**: 1000, 1002` present — expected: `deps
      ['1000','1002']`, `source: 'marker'`, regardless of `**Depends On**`.
- [x] TC-1.2: `**Waiting On Tracks**: AM-1000, 0999` — expected: normalised to
      `['1000','999']`.
- [x] TC-1.3: No `**Waiting On Tracks**`, `**Depends On**: 1000`, waiting reason
      `AM-1000 unmerged; awaiting merge order` — expected: `deps ['1000']`,
      `source: 'inferred'` (the live AM-1003 case).
- [x] TC-1.4: `**Depends On**: 1000, 1002`, reason mentions only 1000 —
      expected: `deps ['1000']` only; 1002 is not attributed.
- [x] TC-1.5: `**Depends On**: 1000`, reason `Needs approval to run the
      destructive 0042 migration on prod` — expected: `deps []`, `source: null`.
- [x] TC-1.6: No dependency markers at all — expected: `deps []`, `source: null`.
- [x] TC-1.7: Reason mentions `10001` while `**Depends On**` is `1000` —
      expected: not attributed (no substring false positive on track numbers).

### Phase 1 — satisfaction (`isDependencyShipped`)

- [x] TC-2.1: dependency at `done` / `success` — expected: true.
- [x] TC-2.2: dependency at `done` / `queue` — expected: false (unmerged).
- [x] TC-2.3: dependency at `done` / `waiting` — expected: false (PR open).
- [x] TC-2.4: dependency at `review` / `success` — expected: false.
- [x] TC-2.5: dependency absent from the state map — expected: false (AC-9,
      fails closed).

### Phase 1 — the decision (`decideAutoResume`)

- [x] TC-3.1: track not at `waiting` — expected: `resume false`, `skipReason
      'not-waiting'`.
- [x] TC-3.2: attributable, all deps shipped — expected: `resume true`.
- [x] TC-3.3: attributable, one dep unshipped — expected: `resume false`,
      `skipReason` naming the unmet track.
- [x] TC-3.4: not attributable — expected: `resume false`, `skipReason
      'no-attribution'` (AC-5).
- [x] TC-3.5: `**Auto Resumed**` already records the same dep set — expected:
      `resume false`, `skipReason 'already-auto-resumed'` (AC-8).
- [x] TC-3.6: `**Auto Resumed**` records a *different* dep set — expected:
      `resume true`.
- [x] TC-3.7: malformed `**Waiting On Tracks**` (`: , ,`) — expected: treated as
      absent, falls through to inference, never throws (REQ-7).

### Phase 2 — reconciler, real spawned worker

- [x] TC-4.1 (AC-1): parked `implement:waiting` track, `**Depends On**: 1000`,
      reason naming 1000, track 1000 at `done:success` — expected: within one
      reconcile cycle `**Lane Status**` becomes `queue`, then a worker claims and
      runs it.
- [x] TC-4.2 (AC-2): same setup, track 1000 at `done:queue` — expected: still
      `implement:waiting` after three reconcile cycles.
- [x] TC-4.3 (AC-6): after TC-4.1's resume — expected: no `**Waiting Reason**`
      line remains in `index.md`.
- [x] TC-4.4 (AC-7): after TC-4.1's resume — expected: exactly one new
      `> **system**:` line in `conversation.md`, naming track 1000.
- [x] TC-4.5: after TC-4.1's resume — expected: `**Auto Resumed**` marker
      present with `deps=1000`.
- [x] TC-4.6: `INITIALS-NNN-slug` folder naming — expected: reconciled
      identically to a legacy `NNN-slug` folder (the known live skip bug).
- [x] TC-4.7: an unreadable/absent `index.md` in the scan — expected: skipped,
      the pass continues, no crash.
- [x] TC-4.8: worker in `local-fs` mode — expected: the resume still happens on
      the filesystem, and no collector call is attempted.

### Phase 3 — human resume clears the markers

- [x] TC-5.1 (AC-8): `POST /api/projects/:id/tracks/:num/resume` on a track
      carrying `**Auto Resumed**` — expected: the marker is gone from `index.md`
      afterwards, along with `**Waiting Reason**` and `**Waiting On Tracks**`.
- [x] TC-5.2: a normal (non-parking) run outcome on a previously-parked track —
      expected: both markers retired, not left on a running track.
- [x] TC-5.3 (AC-6, local-api): after an auto-resume, the collector's `tracks`
      row shows `lane_action_status = 'queue'` and `waiting_reason` NULL.

### Phase 3b — line-anchored marker parsers (REQ-10 / AC-10)

- [x] TC-7.1: an `index.md` whose `**Problem**` prose contains the literal text
      `**Depends On**: 1000; AM-1000 merged to main` — expected: `parseDependsOn`
      returns `[]` (this track's own pre-fix file, kept as a fixture).
- [x] TC-7.2: the same fixture — expected: `parseWaitingReason` returns `null`.
- [x] TC-7.3: a real `**Depends On**: 1000, 1002` at line start — expected: still
      parsed as `['1000','1002']` (the anchoring must not break the real case).
- [x] TC-7.4: a marker preceded by leading whitespace — expected: parsed,
      matching `MARKER_LINE_RE`'s existing `^[ \t]*` tolerance.
- [x] TC-7.5: `resolveBlockedDependencies` on the TC-7.1 fixture — expected:
      `deps []`, `source: null`; the feature never attributes a park to prose.

### Regression

- [x] TC-6.1: `track-10055-waiting-resume` passes unchanged — a park for a
      human-judgment reason is still never claimed.
- [x] TC-6.2: `track-10055-waiting-any-lane` passes unchanged.
- [x] TC-6.3: `track-1119-phase3-depends-on` passes unchanged — the `queue`-lane
      dependency gate is untouched by this track.

## Acceptance Criteria

- [x] All unit tests pass, with real output recorded in `conversation.md`
- [x] The e2e suite passes against a genuinely spawned worker, not a mock
- [x] No regressions in the three neighbouring suites listed above
- [x] No leaked `laneconductor.sync.mjs` processes after the runs
- [x] AC-1 through AC-10 in `spec.md` each map to at least one passing case above
