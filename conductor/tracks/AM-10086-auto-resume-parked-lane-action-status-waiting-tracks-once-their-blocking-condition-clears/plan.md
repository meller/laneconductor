# Track AM-10086: Auto-resume parked tracks once their blocking condition clears

## Phase 1: Pure decision module — `conductor/services/dependency-resume.mjs`

**Problem**: The eligibility rule (attribution + satisfaction + loop guard) is
the whole risk surface of this change, and it cannot be tested if it lives
inside `laneconductor.sync.mjs` — importing that file starts chokidar watchers
and `setInterval`s at module load.
**Solution**: An I/O-free module, same shape and style as
`conductor/services/waiting-state.mjs`. Every decision is a pure function over
`index.md` content plus a map of other tracks' states.

- [x] Task 1: `parseWaitingOnTracks(content)` — reads `**Waiting On Tracks**`,
      returns normalised bare track numbers (strip an `INITIALS-` prefix, strip
      leading zeros), `[]` when absent or empty.
- [x] Task 2: `writeWaitingOnTracks(content, nums)` / `clearWaitingOnTracks(content)`
      — sparse emission, update-in-place-or-append, mirroring
      `writeWaitingReason`/`clearWaitingReason`.
- [x] Task 3: `parseAutoResumedMarker(content)` / `writeAutoResumedMarker(content, deps)` /
      `clearAutoResumedMarker(content)` for `**Auto Resumed**: <ISO> deps=<n,n>`.
- [x] Task 4: `resolveBlockedDependencies({ content })` — the attribution rule.
      Returns `{ deps: string[], source: 'marker'|'inferred'|null }`.
        - `**Waiting On Tracks**` present → that set, `source: 'marker'`.
        - else `**Depends On**` present AND `**Waiting Reason**` text mentions at
          least one of those numbers → the intersection, `source: 'inferred'`.
        - else `{ deps: [], source: null }` — not attributable.
- [x] Task 5: `isDependencyShipped(num, stateByTrackNumber)` — true only for
      lane `done` AND lane action status `success`. An absent entry is false
      (REQ-7, fails closed).
- [x] Task 6: `decideAutoResume({ content, stateByTrackNumber })` →
      `{ resume: boolean, deps: string[], source, skipReason: string|null }`.
      `skipReason` is a short machine-ish string (`'not-waiting'`,
      `'no-attribution'`, `'unmet:1000'`, `'already-auto-resumed'`) so the
      reconciler can log *why* it declined without re-deriving it.
- [x] Task 7: Module header comment stating the `done:success`-not-`done`
      decision and why it deliberately diverges from `autoLaunchLocalFs`'s gate.

**Impact**: One testable place holds the entire "may this be resumed" rule.

## Phase 2: The reconciler — `reconcileParkedDependencyTracks()`

**Problem**: Nothing re-polls a parked track. A pass has to exist and run.
**Solution**: A new function in `conductor/laneconductor.sync.mjs`, registered
on the existing `RECONCILE_INTERVAL_MS` alongside `reconcileWorktrees()` and
`reconcilePrTracks()`, following those functions' established shape.

- [x] Task 1: Scan `join(process.cwd(), 'conductor', 'tracks')` (REQ-8 — primary
      checkout only), matching both `NNN-slug` and `INITIALS-NNN-slug` with the
      same `/^(?:[a-zA-Z0-9]+-)?(\d+)-/` pattern `reconcilePrTracks` uses. The
      legacy-only-pattern bug is a known live failure mode in this file; do not
      reintroduce it.
- [x] Task 2: Build `stateByTrackNumber` in one pass — `{ lane, laneActionStatus }`
      per track — so dependency lookup costs no extra directory scan.
- [x] Task 3: For each track at `**Lane Status**: waiting`, call
      `decideAutoResume()`. Log declines at debug/quiet level, never per-cycle
      noise for the common "not attributable" case.
- [x] Task 4: On `resume: true` — write `**Lane Status**: queue` via the existing
      module-level `writeIndexMarker()` (it already clears `**Waiting Reason**`
      when the new status is not `waiting`), then write the `**Auto Resumed**`
      marker.
- [x] Task 5: Fan out the state change with
      `patchTrackAction(trackNumber, { lane_action_status: 'queue', lane_action_result: null, waiting_reason: null })`,
      guarded by `getIsLocalFs()` exactly as `patchTrackPrFields` is.
- [x] Task 6: Append the audit comment to `conversation.md` in the required
      `> **system**: ...` format (REQ-5), naming the cleared dependencies and
      whether attribution came from the marker or was inferred.
- [x] Task 7: `console.log` one `[reconcile-parked]` line per resume.
- [x] Task 8: Register the `setInterval` next to the other two reconcilers, with
      a comment explaining it shares their cadence for the same reason (it walks
      the same directory).
- [x] Task 9: Verify by actually running it — start a worker against a scratch
      project with a parked track and a shipped dependency, and watch the track
      move to `queue` and get claimed. Not "the diff looks right".

**Impact**: A dependency-blocked park unblocks itself within one reconcile
cycle instead of waiting for a human to notice.

## Phase 3: Human resume clears the loop guard

**Problem**: REQ-6's `**Auto Resumed**` marker would otherwise persist forever,
permanently disqualifying a track from any future auto-resume even after a
human has taken over and the situation has changed.
**Solution**: Clear it wherever a track leaves `waiting` by a human's hand.

- [x] Task 1: `ui/server/index.mjs`'s `syncTrackToFile()` — clear the
      `**Auto Resumed**` marker under the same `clearingReason` condition that
      already removes `**Waiting Reason**`, and clear `**Waiting On Tracks**`
      there too (a park's dependency list is as stale as its reason once the
      park ends).
- [x] Task 2: Confirm the `POST /api/projects/:id/tracks/:num/resume` path
      reaches that clearing code (it already calls `syncTrackToFile` with
      `waiting_reason: null`), by running the endpoint against a real parked
      track and re-reading the file.
- [x] Task 3: Same clearing in the worker's own exit-handler write path, so a
      normal (non-parking) run outcome also retires both markers rather than
      leaving them on a running track.

**Impact**: The loop guard blocks repeat auto-resumes without becoming a
permanent disqualification.

## Phase 3b: Line-anchor the marker parsers (REQ-10)

**Problem**: Found live while planning this track, in this track's own
`index.md`. `parseDependsOn()` and `parseWaitingReason()` in
`conductor/laneconductor.sync.mjs` / `conductor/services/waiting-state.mjs` are
not line-anchored, so they match a marker name quoted anywhere in prose. This
track's `**Problem**` field quotes both while describing the incident, and
`parseDependsOn()` returned a phantom dependency no track can ever satisfy —
enough to gate this track out of auto-launch permanently. The prose has been
de-bolded as an immediate unblock; the parsers are still wrong.
**Solution**: Anchor them, the way `ui/server/index.mjs`'s `syncTrackToFile()`
already anchors its own marker regexes.

- [x] Task 1: Anchor `parseDependsOn()` to `/^\*\*Depends On\*\*:[ \t]*([^\n]+)/im`.
- [x] Task 2: Anchor `waiting-state.mjs`'s `MARKER_RE` (its `MARKER_LINE_RE` is
      already anchored — the pair currently disagrees about what a marker is).
- [x] Task 3: Audit the other `\*\*Marker\*\*:` parsers in `laneconductor.sync.mjs`
      for the same shape and anchor them; note any deliberately left unanchored
      and why.
- [x] Task 4: Anchor the two new parsers from Phase 1 from the start.
- [x] Task 5: Verify against this track's own pre-fix `index.md` prose (kept as
      a test fixture) that no phantom marker is parsed.

**Impact**: A marker means a marker, not a mention of one. Without this, the
feature's own attribution rule is decided partly by prose.

## Phase 4: Tests

**Problem**: The failure this fixes was invisible for hours in production; the
regression risk is a reconciler that resumes something it must not.
**Solution**: Pure unit coverage of the rule, plus one real-worker end-to-end
proof that the resume actually happens and is actually claimed.

- [x] Task 1: `conductor/tests/track-10086-dependency-resume.test.mjs` —
      `node:test` unit suite over the pure module. Covers AC-3, AC-4, AC-5,
      AC-8, AC-9 and every `skipReason` branch.
- [x] Task 2: `conductor/tests/track-10086-auto-resume-e2e.test.mjs` — spawns a
      real worker against a temp project (`LC_RECONCILE_INTERVAL_MS` shortened,
      the override that exists for exactly this) and asserts AC-1 and AC-2 by
      polling the filesystem.
- [x] Task 3: Assert AC-6 and AC-7 in the e2e test — the `**Waiting Reason**`
      line is gone and exactly one `> **system**:` comment was appended.
- [x] Task 3b: Cover REQ-10/AC-10 — a fixture `index.md` whose prose quotes both
      marker names parses as having neither.
- [x] Task 4: Run both suites and paste real output into `conversation.md`
      before marking this phase complete.
- [x] Task 5: Re-run the neighbouring suites that touch this machinery
      (`track-10055-waiting-resume`, `track-10055-waiting-any-lane`,
      `track-1119-phase3-depends-on`) to confirm no regression.

**Impact**: The rule is pinned, and the "must not resume" cases are pinned
harder than the "must resume" one.

## Phase 5: Documentation

**Problem**: `**Depends On**` is already undocumented in SKILL.md's marker
table; adding a second undocumented marker compounds that.
**Solution**: Document both, and the mechanism.

- [x] Task 1: Add `**Waiting On Tracks**` and the pre-existing `**Depends On**`
      to SKILL.md's marker table.
- [x] Task 2: Add a short note to the parking guidance telling an agent that
      parks on an unshipped track to write `**Waiting On Tracks**`, so its park
      is mechanically resumable rather than needing a human.
- [x] Task 3: Add a `conductor/product.md` paragraph next to the existing
      reconciler prose, stating what auto-resumes, what deliberately does not,
      and the `done:success`-not-`done` rule.
- [x] Task 4: Update `conductor/constants.mjs`'s `LaneActionStatus.WAITING`
      comment — it currently states that no worker will claim a parked track
      until a human resumes it, which this track makes conditionally untrue.
- [x] Task 5: Record the recommended follow-up track for
      `autoLaunchLocalFs`'s own gate (spec.md Out of Scope item 1).

**Impact**: The next agent that parks a track knows how to make the park
self-clearing.

## Test Verification Checklist

Before any phase is marked `[x]`, its verifying command has been run and its
real output read. A written-but-unexecuted test file is not verification.

## ✅ COMPLETE

## ✅ QUALITY PASSED
