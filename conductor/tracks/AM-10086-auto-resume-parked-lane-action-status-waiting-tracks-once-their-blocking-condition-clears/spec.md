# Spec: Auto-resume parked tracks whose dependency blocker has cleared

## Problem Statement

`<lane>:waiting` (Track 10055) means "this lane action stopped on purpose and
nothing will claim it until a human resumes it." That contract is correct for
a park that needs human judgment. It is wrong for a park whose blocking
condition is **mechanically verifiable** — because nothing in the system ever
re-checks it.

The dependency gate in `autoLaunchLocalFs` (`conductor/laneconductor.sync.mjs`,
Track AM-1119 Phase 3) only evaluates tracks whose `lane_action_status` is
`queue`. A track that already parked at `waiting` is never reconsidered by it,
so a `**Depends On**` blocker that later clears is never noticed.

Confirmed live (livingwork project): AM-1003 parked with
`**Waiting Reason**: AM-1000 unmerged; Phase 4 done; awaiting merge order` and
`**Depends On**: 1000`. AM-1000 merged to main shortly afterwards. AM-1003 sat
parked indefinitely. Unblocking it required a human to notice, investigate, and
call `POST /api/projects/:id/tracks/:num/resume` by hand. Also confirmed live:
posting a plain comment on a parked track does **not** resume it — only that
dedicated endpoint transitions `waiting` back to `queue`.

This is the same defect class as the PR reconciler fix
(`reconcilePrTracks`): a condition that resolves outside the system, that
nothing re-polls once the track stops being actively watched.

## Solution

A periodic reconciliation pass, `reconcileParkedDependencyTracks()`, running on
the existing `RECONCILE_INTERVAL_MS` cadence alongside `reconcileWorktrees()`
and `reconcilePrTracks()`. It scans tracks at `lane_action_status: waiting`,
and resumes one **only** when its park is attributable to named track
dependencies **and** every one of those dependencies has actually shipped.

Every other park — a genuine question, an approval request, a park with no
dependency attribution — is left exactly as it is. Fails closed by design.

## The eligibility rule (the core design decision)

The track's own open question was whether to special-case dependency parks or
handle parks generally. **Only dependency parks are auto-resumable.** A park
qualifies when all four hold:

1. `**Lane Status**: waiting`.
2. The park is **attributable** to a set of track numbers (see below).
3. Every attributed dependency has reached **`done` lane AND `success` lane
   action status**.
4. The track has not already been auto-resumed for this same dependency set
   (loop guard, see REQ-6).

### Attribution — two paths, one authoritative

- **Authoritative (new marker)**: `**Waiting On Tracks**: NNN[, NNN]`. Written
  by an agent that parks specifically because those tracks are not yet
  shipped. Unambiguous: this park's blocker *is* those tracks. When present, it
  alone decides attribution.
- **Inferred (covers existing live data)**: `**Depends On**` is present **and**
  the `**Waiting Reason**` text mentions at least one of those dependency
  numbers. This is what makes the live AM-1003 case work without retrofitting
  markers — its reason mentions "AM-1000" and its `**Depends On**` is `1000`.
  The attributed set is the intersection: only dependency numbers actually
  named in the reason.

A `**Depends On**` marker on its own is **not** attribution. A track can
legitimately depend on another track and be parked for a completely unrelated
reason (e.g. "needs approval to run the destructive 0042 migration"); resuming
that because an unrelated dependency shipped would be exactly the blind
auto-resume this track's description forbids.

### Why `done:success`, not just lane `done`

`autoLaunchLocalFs`'s existing gate treats lane `done` alone as satisfied. This
reconciler is deliberately stricter and requires `done:success`.

`done:queue` means "quality-gate passed, not merged yet" — Track 10035 made the
merge itself a done-lane action. The live blocker was literally *"AM-1000
unmerged"*. Resuming on `done:queue` would resume a track whose stated blocker
is still true; it would run, hit the same wall, and park again. That is a
resume loop, not a fix.

The divergence from the existing gate is intentional and documented at the call
site. Whether `autoLaunchLocalFs`'s own gate should be tightened the same way is
a real question but a **separate** one — see Out of Scope.

## Requirements

- **REQ-1**: A pure, I/O-free module `conductor/services/dependency-resume.mjs`
  holds every attribution and eligibility decision, so it is unit-testable
  without importing `laneconductor.sync.mjs` (which starts chokidar watchers and
  intervals at import time). Same pattern as `waiting-state.mjs`.
- **REQ-2**: New marker `**Waiting On Tracks**: NNN[, NNN]` — parsed,
  normalised (leading zeros and any `INITIALS-` prefix stripped), sparse-emitted
  (present only while it means something), and cleared whenever the track leaves
  `waiting`.
- **REQ-3**: `reconcileParkedDependencyTracks()` runs on
  `RECONCILE_INTERVAL_MS` (default 60s, `LC_RECONCILE_INTERVAL_MS` override) on
  every worker regardless of mode, including `local-fs`.
- **REQ-4**: On an eligible track the reconciler performs the full equivalent of
  the `/resume` endpoint: `**Lane Status**: queue` in the primary checkout's
  `index.md`, `**Waiting Reason**` removed, and — when not `local-fs` — a
  `patchTrackAction()` fan-out of
  `{ lane_action_status: 'queue', lane_action_result: null, waiting_reason: null }`
  so collector-0 and every non-primary collector converge on the same state.
- **REQ-5**: The resume is auditable: a `> **system**: ...` comment is appended
  to `conversation.md` naming the dependencies that cleared, and the worker logs
  one line under a `[reconcile-parked]` label.
- **REQ-6 (loop guard)**: The reconciler writes `**Auto Resumed**: <ISO>
  deps=<n,n>` on resume. It will not auto-resume a track again while that
  marker records the same dependency set. A track that parks a second time on
  the same already-satisfied dependencies needs a human — the blocker was not
  really the dependency. A human resume (`/resume`) clears the marker, so a
  genuinely new dependency set can be auto-resumed later.
- **REQ-7**: Fails closed everywhere. An unparseable marker, an unknown
  dependency track number, a dependency folder that no longer exists, or an
  unreadable `index.md` all mean "not eligible" — never "satisfied".
- **REQ-8 (single writer)**: The reconciler reads and writes only the primary
  checkout's `conductor/tracks/NNN-*/`, never a worktree copy. Same rule
  `reconcilePrTracks()` follows.
- **REQ-10 (found live while planning this track)**: Every marker parser this
  feature depends on must be **line-anchored** (`/^\*\*Marker\*\*:/m`), the way
  `ui/server/index.mjs`'s `syncTrackToFile()` already anchors its own. The
  existing `parseDependsOn()` and `parseWaitingReason()` are not, so they match
  a marker name quoted anywhere in prose. This track's own `index.md` reproduced
  it: its `**Problem**` field quotes both marker names while describing the
  incident, and `parseDependsOn()` returned a phantom dependency
  (`"1000; AM-1000 merged to main shortly after"`) that no track will ever
  satisfy — which would have gated this very track out of auto-launch forever.
  The prose in that file has been de-bolded as an immediate unblock; the
  parsers still need fixing, and this feature must not add a third unanchored
  one.

- **REQ-9**: Documented — the new marker lands in SKILL.md's marker table
  (alongside `**Depends On**`, which is currently undocumented there) and the
  mechanism is described in `conductor/product.md` next to the collector/
  reconciler prose.

## Acceptance Criteria

Each of these describes an observable outcome, not scaffolding.

- [ ] AC-1: A track parked at `implement:waiting` with `**Depends On**: 1000`
      and a waiting reason naming 1000, whose track 1000 is at `done:success`,
      is moved to `implement:queue` by a running worker with no human action,
      and a worker then claims and runs it.
- [ ] AC-2: The same track, while 1000 sits at `done:queue`, stays parked at
      `implement:waiting` across multiple reconcile cycles.
- [ ] AC-3: A track parked with `**Depends On**: 1000` whose waiting reason does
      **not** mention 1000 (an unrelated human-judgment park) stays parked even
      when 1000 reaches `done:success`.
- [ ] AC-4: A track parked with `**Waiting On Tracks**: 1000, 1002` resumes only
      once **both** 1000 and 1002 are at `done:success`, and stays parked while
      either is not.
- [ ] AC-5: A track parked with no `**Depends On**` and no
      `**Waiting On Tracks**` is never touched, whatever its waiting reason says.
- [ ] AC-6: On resume the track's `**Waiting Reason**` line is gone from
      `index.md`, and in `local-api` mode the collector's `tracks` row shows
      `lane_action_status = 'queue'` with `waiting_reason` NULL.
- [ ] AC-7: `conversation.md` gains exactly one `> **system**:` comment naming
      the dependencies that cleared.
- [ ] AC-8: A track that parks again on the same satisfied dependency set is not
      auto-resumed a second time; after a human `/resume`, the `**Auto Resumed**`
      marker is gone and a later different dependency set can auto-resume again.
- [ ] AC-10: An `index.md` whose `**Problem**` or `**Summary**` prose quotes
      `**Depends On**` or `**Waiting Reason**` yields no dependencies and no
      waiting reason — the parsers see only real, line-start markers.
- [ ] AC-9: A dependency track number that resolves to no track folder is
      treated as unmet — the parked track stays parked.

## Data Model Changes

None. No migration, no new column. `**Waiting On Tracks**` and
`**Auto Resumed**` are file markers only, deliberately not synced to the
`tracks` table: the reconciler that reads them runs on the worker, against the
filesystem, in every mode including `local-fs`. Adding columns would create a
second source of truth for a decision only the worker makes.

## Out of Scope (explicitly not deferred capability of this track)

These are separate concerns, not unfinished parts of this solution. Neither is
required for any acceptance criterion above.

1. **`autoLaunchLocalFs`'s own `done`-vs-`done:success` gate.** It currently
   treats lane `done` as dependency-satisfied, which has the same premature-run
   risk for a `queue` track that this spec rejects for a `waiting` track.
   Tightening it changes behaviour for every wizard-generated track set and
   deserves its own track. Recommend filing one.
2. **Non-dependency park reasons.** Approval requests, questions, and every
   other human-judgment park remain human-resumed by design.
3. **UI changes.** No new control or badge. The existing card state, waiting
   reason, and Conversation tab already show everything; the audit comment lands
   in the Inbox path that already exists.
4. **The cloud collector (`cloud/functions/index.js`).** The resume is performed
   by the worker and fanned out through the existing `patchTrackAction` path;
   no new cloud route is needed.
