# Spec: Fix stale tracks-metadata cache in resolveTrackFolder

## Problem Statement

`conductor/laneconductor.sync.mjs`:

```js
let tracksMetadata = null;

function loadTracksMetadata() { ... }

function getTrackMetadata(trackNumber) {
  if (!tracksMetadata) tracksMetadata = loadTracksMetadata();
  const meta = tracksMetadata.tracks?.[trackNumber] || tracksMetadata[trackNumber];
  return meta || null;
}
```

`tracksMetadata` loads once, on the first call, for the lifetime of the
worker process. Nothing ever sets it back to `null` or re-reads the file
after that. A worker that was already running when a new track's row was
first written to `conductor/tracks-metadata.json` (by `lc new`, by another
worker, or by `resolveTrackFolder`'s own quarantine branch) never sees
that track at all — `getTrackMetadata(trackNumber)` returns `null`
forever, for that process, even though the file on disk is correct.

`resolveTrackFolder()` depends on this for its fallback path (no
legacy-pattern folder match → check registered `folder_path`). When the
cache is stale, `resolveTrackFolder` returns `null`, and every caller's
own silent fallback kicks in — each one different, each one wrong in a
different way:

- The `/laneconductor implement` skill, told "no folder found," scaffolds
  a fresh one using the legacy `<n>-slug` convention — a duplicate of the
  real `INITIALS-<n>-slug` folder.
- `readTrackMergeMode()` (`laneconductor.sync.mjs`, used at the
  quality-gate-exit lifecycle decision) does `if (!trackDir) return 'pr';`
  — silently treating a `direct`-mode track as `pr`-mode, opening a GitHub
  PR instead of merging locally.
- Any other caller with a `null`-folder fallback path is equally exposed;
  these two are just the ones caught live.

**Confirmed live** on track 10035 (2026-08-27), all three traced to the
same worker process (`670203`, alive ~7 hours, started before track
10035 existed): a duplicate `conductor/tracks/10035-*` folder during
implement, PR #19 opened despite `**Merge Mode**: direct`, and (as a
second-order effect of the confusion) a `git merge` left stuck mid-conflict
when the worker that started an `ai-resolve-conflict` session was itself
restarted before finishing. All required manual intervention to unwind.

## Root Cause

No invalidation path exists for `tracksMetadata`. Compare to
`workflowConfig`, which has exactly this problem solved already:

```js
// conductor/laneconductor.sync.mjs:2586-2588
watch('conductor/workflow.json', { ignoreInitial: true })
  .on('change', () => { workflowConfig = loadWorkflowConfig(); console.log('[config] workflow.json reloaded'); });
```

`conductor/tracks-metadata.json` has no equivalent watch anywhere in the
file.

## Solution

Add the same watch/reload pattern for `tracks-metadata.json`:

```js
watch('conductor/tracks-metadata.json', { ignoreInitial: true })
  .on('change', () => { tracksMetadata = loadTracksMetadata(); console.log('[config] tracks-metadata.json reloaded'); });
```

Placed alongside the existing `workflow.json` watch (both are
config-reload watches, not track-file watches). `tracksMetadata`'s
module-level `let` declaration already exists (`laneconductor.sync.mjs`,
near `loadTracksMetadata`/`getTrackMetadata`) — no new state needed, just
assignment.

## Requirements

- REQ-1: `conductor/tracks-metadata.json` gets a chokidar watch that
  reassigns `tracksMetadata` on change, mirroring `workflow.json`'s
  pattern exactly (same `watch(...).on('change', ...)` shape, same
  `{ ignoreInitial: true }` option).
- REQ-2: `getTrackMetadata()`/`resolveTrackFolder()` need no changes —
  the fix is purely in keeping the cache fresh, not in the lookup logic
  itself.
- REQ-3: No behavior change for a worker that never sees the file change
  (the common case) — this only affects workers whose cache would
  otherwise have gone stale.

## Acceptance Criteria

- [ ] AC-1: A worker process that calls `getTrackMetadata('N')` before
      track `N`'s entry exists in `tracks-metadata.json`, then observes
      the file gain that entry (written by a separate process, simulating
      `lc new` running elsewhere), correctly resolves it on the next call
      — no restart required.
- [ ] AC-2: `resolveTrackFolder()` against the same scenario returns the
      real `INITIALS-N-slug` folder instead of `null`.
- [ ] AC-3: Existing `tracks-metadata.json`-related tests (if any) and the
      full `conductor/tests/` suite relevant to `resolveTrackFolder`/
      `getTrackMetadata` stay green.

## Out of Scope

- Auditing every other caller of `resolveTrackFolder` for its own
  fallback-on-null behavior (the `readTrackMergeMode`/scaffold cases were
  bad ones; there may be others, but this track only fixes the shared
  root cause, not each caller's individual fallback choice).
- The interrupted-`ai-resolve-conflict`-leaves-a-stuck-merge problem is a
  separate, second-order failure mode (a worker restart mid-session) —
  worth its own track if it recurs, not folded in here.
