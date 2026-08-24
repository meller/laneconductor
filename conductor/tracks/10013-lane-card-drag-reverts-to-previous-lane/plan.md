# Track 10013: Lane card drag reverts to previous lane

## Phase 1: `parseStatus()` precedence fix ✅ COMPLETE

**Problem**: Track 10012 bounced back to `plan` within a few hundred ms of
being dragged to `implement` — reproduced live via direct API/DB calls,
caught in `conductor/.sync.log`: the same `POST /track` payload had
`lane_status: "plan"` while its own `index_content` field clearly showed
`**Lane**: implement`. Traced to `parseStatus()` in
`conductor/laneconductor.sync.mjs` checking `**Status**:` before `**Lane**:`.

**Solution**: Extracted `parseStatus()` into `conductor/services/parse-status.mjs`
(pure function, same pattern as `sync-timestamp-utils.mjs` and
`services/worktree-artifact-merge.mjs` — testable without the whole
sync-worker process's side effects). Reordered to check `**Lane**` first,
`**Status**` only as a fallback. Re-wired `laneconductor.sync.mjs` to call the
extracted version.

- [x] Task 1: Extract `parseStatus` to `conductor/services/parse-status.mjs`,
      fix marker precedence
- [x] Task 2: Regression tests in
      `conductor/tests/track-10012-parse-status-precedence.test.mjs` (4/4 —
      diverged markers prefer Lane, agreeing markers unaffected, Status-only
      fallback for fresh tracks, heuristic fallback when neither marker exists)
- [x] Task 3: Wire the extracted function back into `laneconductor.sync.mjs`
- [x] Task 4: Stripped 10012's own stale `**Status**` line directly (belt and
      suspenders — not required after the parser fix, but the file already
      had drifted markers)
- [x] Task 5: Restarted the sync workers to load the fix; verified live —
      dragged 10012 to `implement` via the API three times in a row, confirmed
      it held (`SELECT lane_status FROM tracks WHERE track_number='10012'`
      stayed `implement` across repeated checks), then confirmed the same in
      the actual browser board (card sitting in Implement, "Moved to
      implement" logged)

**Impact**: Any UI-created track with a diverged `**Status**`/`**Lane**` pair
no longer reverts on drag. CLI-scaffolded tracks were never affected (their
template has no `**Status**` marker at all).

## Phase 2: `useWebSocket` StrictMode zombie-reconnect fix ✅ COMPLETE

**Problem**: Found while verifying Phase 1 in the browser — the board got
stuck on "Connecting to LaneConductor DB…" after a sync-worker restart.
Console showed paired `[ws] Connecting…` / `Disconnected` / `Reconnecting in
1000ms…` / `Connected` cycling repeatedly, never settling.

**Root cause**: `ui/src/hooks/useWebSocket.js`'s cleanup function called
`socketRef.current.close()` without first detaching `onclose`/`onerror`.
React 18 StrictMode double-invokes the mount effect in dev (mount → cleanup →
mount, every page load) — the first, intentionally-discarded socket's
`onclose` still fired asynchronously, scheduled its own reconnect, and called
`setConnected()` out of band with the real (second) connection. That zombie
chain kept flipping `connected` forever. `ui/src/hooks/usePolling.js`'s
effect re-runs `fetchData()` (aborting whatever fetch was in flight) on every
`wsConnected` change — under the flapping, the tracks fetch could never
complete.

**Solution**: In the cleanup function, null out `onclose`/`onerror`/`onopen`/
`onmessage` before calling `.close()`, so the intentionally-discarded socket's
own close event can never be observed as a real disconnect.

- [x] Task 1: Fix `ui/src/hooks/useWebSocket.js`'s cleanup to detach handlers
      before closing
- [x] Task 2: Verified live — reloaded the board repeatedly; console shows
      the expected one-time StrictMode double-connect (`Connecting` ×2,
      `Connected` ×2 per load) with zero `Disconnected`/`Reconnecting` spam
      afterward, and the board renders tracks immediately on every reload

**Impact**: The board reliably finishes loading instead of intermittently
getting stuck, independent of how many concurrent sync workers are
heartbeating.

## Phase 3: `usePolling` abort/coalesce hardening + stuck-loading investigation ✅ COMPLETE (fix applied, root cause of remaining symptom identified as a test-harness artifact, not app code)

**Problem**: After Phase 2's fix, the board still occasionally got stuck on
"Connecting to LaneConductor DB…" on a fresh reload, even with a stable WS
connection (no more Disconnected/Reconnecting spam). `usePolling.js`'s
`fetchData()` aborted whatever fetch was already in flight every time a new
trigger arrived (WS message, poll interval, visibility change); with several
concurrent sync workers heartbeating (this repo runs 5 for project 1 alone,
plus other projects), triggers could arrive faster than any single fetch's
round trip, so every fetch got cancelled before finishing and `loading`
never cleared.

**Solution applied**: Replaced the cancel-and-restart pattern with
coalescing — if a fetch is already in flight, remember that another one is
wanted (`pendingRerunRef`) instead of aborting it; let the in-flight one run
to completion (so `loading` reliably clears after the first successful round
trip), then fire one trailing re-fetch afterward to pick up anything that
changed meanwhile. `ui/src/hooks/usePolling.js`.

**Investigation of the remaining "still sometimes stuck" symptom**: Isolated
by reverting the Phase 3 change via `git stash` and reloading — the
*original, unmodified* code got stuck identically, proving Phase 3's change
isn't the cause (restored it afterward; it's a real, independent
improvement, just not what was gating this symptom). Backend/proxy latency
ruled out (`curl`, including 4 concurrent requests replicating the browser's
`Promise.all` batch, consistently sub-500ms). Stale dev-server/HMR state
ruled out (full `make ui-restart` + hard-reload navigate, symptom persisted
identically). Stale browser-tab state ruled out (a brand-new tab, never
navigated before, showed the same symptom). Root cause found:
`document.hidden` reads `true` for every tab in this automated
browser-testing tool regardless of which tab is selected/fronted — the pane
apparently never composites as "visible" to the page's Visibility API in
this environment. `fetchData()`'s first line (`if (document.hidden) return;`)
is intentional, sensible behavior — skip polling a backgrounded tab — but it
means this specific automated tool can't reliably drive a full load through
`usePolling`. This is a characteristic of the test harness, not the app: a
real user's tab reports `hidden: false` while they're looking at it, and the
existing `visibilitychange` listener already re-fetches the moment a
real tab regains focus.

- [x] Task 1: Replace abort-and-restart with in-flight coalescing in
      `usePolling.js`'s `fetchData()`
- [x] Task 2: Isolate whether Phase 3's change caused the remaining stuck
      symptom — confirmed no (`git stash`/`git stash pop`, before/after
      comparison against a fresh `ui-restart`)
- [x] Task 3: Rule out backend/proxy latency, stale HMR, and stale tab state
      as causes of the remaining symptom
- [x] Task 4: Identify `document.hidden` as the actual gate — confirmed via
      direct `document.hidden`/`visibilityState`/`hasFocus()` reads in both
      the original tab and a freshly-created one, both `true` regardless of
      `tabs_select`

**Not done**: could not get a clean automated "loads within Ns" confirmation
through this browser tool given the `document.hidden` characteristic above —
Phase 1 and 2 were confirmed through non-visibility-dependent evidence (DB
state, WS console logs) instead. If this symptom is ever reported by a real
user with a genuinely focused tab, it needs fresh investigation — Phase 3's
coalescing fix is a real improvement but is not proven sufficient on its own
given the actual gating mechanism turned out to be `document.hidden`, not
fetch-abort races.

## Related tracks
- [1114](../1114-worktrees-panel-deep-link-autopilot-cleanup/index.md) —
  Phase 14 fixed a different but adjacent Lane/Lane-Status bug (the
  worktree→primary-checkout merge step excluding Lane fields during an
  in-progress run). That bug and this track's Phase 1 both manifest as "the
  board's lane doesn't reflect reality," but have unrelated root causes
  (merge-step field exclusion vs. marker-parsing precedence) and were found/
  fixed independently.

## ✅ REVIEWED

Diff (commit 820db6e) matches all three phases' descriptions. Regression
suite `conductor/tests/track-10012-parse-status-precedence.test.mjs` 4/4
pass. Frontend vitest suite 32/32 pass; 11 pre-existing server-side auth
test failures confirmed unrelated (files never touched by this diff). No
stubs or secrets introduced. See `conversation.md` for the full write-up.

## ✅ QUALITY PASSED

Full project quality-gate checklist re-run against this worktree: syntax,
critical files, config validation, command reachability, worker test suite
(218/227 pass — 9 known-unrelated failures), server vitest (263/274 —
known auth-suite failures), frontend vitest (32/32), build, security audit
(pre-existing devDependency findings only), stub scan (clean for this
diff's changed lines), Playwright fast tier (11 passed / 6 known-skipped /
0 failed), and a live browser check against the main checkout (which
already has this fix merged) confirming the WS StrictMode fix and board
load. See `conversation.md` for the full write-up.

## Phase 4: Stale in-flight run clobbers a human's manual lane move ✅ COMPLETE (prompt-level fix — see caveat below)

**Reported**: dragging track 8003 ("Concurrency A 1786523175558") to `done`
kept landing back in `plan`.

**Investigation**: Reproduced the exact drag via the same
`PATCH /api/projects/:id/tracks/:num` call the UI's confirm dialog makes —
it held perfectly stable (30s+, then 70s+) with no revert, both times.
Ruled out: a diverged `**Status**`/`**Lane**` pair (Phase 1's bug — this
track's markers agree), an active worktree/lock (none exists — the branch
was already deleted per track 1114's cleanup), and multiple duplicate
workers racing the claim (checked `track_locks`, `claimed_by` — clean).

While investigating, caught the track live in `lane_action_status: running`
with `worker_dispatch` showing an in-flight `plan` dispatch
(`dispatch-plan-8003-*.log`, a real 281KB CLI session) — this is what a
`Move this card to the Done lane` button click, or a same-target drag, would
have hit mid-run: `KanbanBoard.jsx`'s drop handler silently no-ops while
`lane_status === 'plan' && lane_action_status === 'running'` (by design —
see the comment at that check), so a drag attempted during that window
does nothing and the card just stays where it is, with zero feedback.

That alone explains a *blocked* drag, but not a *reverted* one — and
`conversation.md` had `> **system**: ✅ Plan complete — moved to plan:success.`
sitting right there. Root cause, confirmed by reading the skill protocol
directly (`.claude/skills/laneconductor/SKILL.md`): `/laneconductor plan`'s
step 7 (**Transition**) unconditionally writes `**Lane**` in `index.md` to
`workflow.json`'s `lanes.plan.on_success` value when the run finishes — with
no check for whether a human already moved the card to a different lane
while the run was still in progress. Symmetrically, `/laneconductor
implement`/`review`/`quality-gate`'s own Transition steps do the exact same
unconditional write. So the actual failure mode a user hits is a **race**,
not a permanent bug: drag to `done` while a `plan` run is still finishing →
the drag briefly succeeds → the already-in-flight run completes moments
later and blindly stamps `**Lane**: plan` back over it, per its own
(now-stale) instructions — the file has no way to know the human moved on
in the meantime. `reconcileActiveDispatch()`
(`conductor/laneconductor.sync.mjs`) only reports the dispatch's own
`worker_dispatch.status`; nothing in that path double-checks the track's
current lane before letting the file write stand, either.

**Fix applied**: added an explicit guard to all four Transition steps in
`.claude/skills/laneconductor/SKILL.md` (plan, implement, review,
quality-gate) — before writing the lane transition, re-read `index.md`'s
current `**Lane**` marker; if it no longer matches the lane this run itself
claimed at step 0, skip the overwrite entirely (leave `**Lane**`/`**Lane
Status**` untouched) and note in the completion comment that the lane had
already moved. The human's manual move always wins over a stale run's own
completion intent.

**Caveat — this is a prompt-level fix, not a code-level one**: the guard is
an instruction to the CLI agent, not a deterministic check enforced by
`laneconductor.sync.mjs` or the API. It should hold given the model follows
its own protocol (as it already does for the Claim step's parallel
requirement), but it isn't hard-guaranteed the way a server-side check
would be. If this is worth closing more tightly, `reconcileActiveDispatch()`
would be the natural place for a code-level backstop — before ever letting
a dispatch's file-based Lane transition reach the primary DB, compare it
against `tracks.last_updated_by`/timestamp to detect a human's more-recent
manual move and defer to it. Not done here — flagging it as a possible
Phase 5 rather than guessing at server-side locking semantics without a
second live reproduction to verify against.

**Not independently live-verified end to end**: verifying this fully needs
racing a real in-flight `plan` run against a manual drag and confirming the
guard fires — a multi-minute reproduction given the CLI run itself takes
that long, not run in this session. The root cause is solid (direct protocol
read + the exact `worker_dispatch`/`lane_action_status`/`conversation.md`
evidence above all point the same direction), and the fix directly addresses
it, but treat it as verified-by-inspection rather than verified-live like
Phases 1–3.

- [x] Task 1: Reproduce the reported drag via direct API call — held stable,
      ruling out Phase 1's bug and worktree/lock races for this specific track
- [x] Task 2: Catch the track in `lane_action_status: running` with a live
      `worker_dispatch` entry — confirms an in-flight run, not a permanent DB bug
- [x] Task 3: Read `.claude/skills/laneconductor/SKILL.md`'s Transition steps
      directly — confirmed all four (plan/implement/review/quality-gate)
      unconditionally overwrite `**Lane**` on completion with no check for an
      intervening human move
- [x] Task 4: Add a "re-read current Lane before overwriting" guard to all
      four Transition steps
- [ ] Task 5 (not done — proposed follow-up): a code-level backstop in
      `reconcileActiveDispatch()` so this isn't solely enforced by prompt
      compliance

## ✅ REVIEWED

Phase 5 (the code-level backstop for the human-lane-override race) reviewed
and passed. Full write-up, including a real bug found and fixed in the
guard's first version during this review (a same-lane echo sync was
clearing the guard flag within milliseconds — caught live against the real
API server, not just mocked tests), is in `conversation.md`. 7/7 new unit
tests pass; 301/312 full suite (11 pre-existing, unrelated auth failures);
live end-to-end reproduction of the 8003 race against a disposable scratch
track confirmed the fix holds.

## ✅ QUALITY PASSED

Full checklist re-run from scratch (all boxes were pre-ticked from a prior
track's run — ignored per the gate file's own warning, re-executed
personally). Syntax/config/critical-files clean. Worker tests 268/275,
server tests 301/312, frontend 60/60 — all failures pre-existing and
unrelated (verified via `git stash` where relevant). Build succeeds.
Playwright fast tier 11/11 (6 known skips), 0 failed, against a freshly
restarted API server. Beyond the suite: live-verified the actual 8003 race
end-to-end against the real running server on a disposable scratch track.
Full write-up in `conversation.md`.
