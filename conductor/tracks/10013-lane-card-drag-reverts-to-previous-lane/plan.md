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
