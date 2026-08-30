# Spec: Fix stale tracks-metadata cache in resolveTrackFolder

## Problem Statement

`conductor/laneconductor.sync.mjs`:

```js
let tracksMetadata = null;                                   // :1295

function loadTracksMetadata() { ... }                        // :1297

function getTrackMetadata(trackNumber) {                     // :1324
  if (!tracksMetadata) tracksMetadata = loadTracksMetadata();
  const meta = tracksMetadata.tracks?.[trackNumber] || tracksMetadata[trackNumber];
  return meta || null;
}
```

`getTrackMetadata` only ever populates the cache when it is still `null`.
A worker that was already running when a new track's row was first written
to `conductor/tracks-metadata.json` (by `lc new`, by another worker, or by
`resolveTrackFolder`'s own quarantine branch) can return `null` forever for
that track, even though the file on disk is correct.

`resolveTrackFolder()` (`:1379`) depends on this for its fallback path (no
legacy-pattern folder match → check registered `folder_path`). Since track
10023, new folders are named `INITIALS-<n>-slug`, which **structurally can
never** match the bare `${trackNumber}-` prefix scan — so for every modern
track, the metadata fallback is the *only* path that can resolve the folder.
When the cache is stale, `resolveTrackFolder` returns `null`, and each
caller's own silent fallback kicks in — each one different, each one wrong
in a different way:

- The `/laneconductor implement` skill, told "no folder found," scaffolds a
  fresh one using the legacy `<n>-slug` convention — a duplicate of the real
  `INITIALS-<n>-slug` folder.
- `readTrackMergeMode()` (`:3888`) does `if (!trackDir) return 'pr';` —
  silently treating a `direct`-mode track as `pr`-mode.
- Any other caller with a `null`-folder fallback is equally exposed; these
  two are just the ones caught live.

**Confirmed live** on track 10035 (2026-08-27), all three traced to the same
worker process (`670203`, alive ~7 hours, started before track 10035
existed): a duplicate `conductor/tracks/10035-*` folder during implement, PR
#19 opened despite `**Merge Mode**: direct`, and (as a second-order effect) a
`git merge` left stuck mid-conflict.

## Root Cause

> **Corrected during planning (2026-08-30).** The original draft of this spec
> claimed *"No invalidation path exists for `tracksMetadata`"* and *"Nothing
> ever sets it back to `null` or re-reads the file."* **That is factually
> wrong**, and the correction matters because it changes what the fix has to
> guarantee. A reload *does* exist — it is just incidental and conditionally
> gated, which is a different (and harder to spot) defect than "absent."

`tracksMetadata` **is** reassigned, at `laneconductor.sync.mjs:7437`, inside
the API-mode branch of the 5-second auto-launch interval (`:7418`, `}, 5000`
at `:7486`):

```js
setInterval(async () => {
  if (syncOnly) return;                                   // :7419  gate 1
  ...
  const globalLimit = workflowConfig?.global?.total_parallel_limit ?? 3;
  if (runningPids.size >= globalLimit) return;            // :7425  gate 2
  if (getIsLocalFs()) { await autoLaunchLocalFs(...); return; }  // :7427 gate 3
  try {
    await pullWorkflow();                                 //        gate 4 (throws → catch)
    workflowConfig = loadWorkflowConfig();
    tracksMetadata = loadTracksMetadata();                // :7437  the only reload
```

So the cache is refreshed **only** for a worker that is simultaneously: not
`sync-only`, not `local-fs`, below its parallel limit, and whose
`pullWorkflow()` call succeeded. Any of these four skips the reload
entirely and indefinitely:

| # | Gate | Who it strands |
|---|------|----------------|
| 1 | `syncOnly` (`:7419`) | every `--sync-only` worker — **never** reloads, for its whole life |
| 2 | `runningPids.size >= globalLimit` (`:7425`) | any worker at capacity — i.e. precisely a *busy* long-lived worker |
| 3 | `getIsLocalFs()` (`:7427`) | every `local-fs` worker (`autoLaunchLocalFs` returns first) |
| 4 | `pullWorkflow()` throwing | any worker during a collector outage |

Even when none of the four apply, the refresh is **interval-driven, not
event-driven**: consumers that run on their *own* schedule read whatever the
last auto-launch cycle happened to leave behind. `readTrackMergeMode`'s only
caller is `reconcileWorktrees()` (`:3982`) — a separate reconciler loop
(`:4165`), not the quality-gate exit the original draft named. It can observe
a stale cache even in an otherwise-healthy API-mode worker.

Compare `workflowConfig`, which has this solved properly — an event-driven
watch with no gating at all:

```js
// conductor/laneconductor.sync.mjs:2587-2588
watch('conductor/workflow.json', { ignoreInitial: true })
  .on('change', () => { workflowConfig = loadWorkflowConfig(); console.log('[config] workflow.json reloaded'); });
```

`conductor/tracks-metadata.json` has no equivalent watch anywhere in the file
(the watch block at `:2563-2600` covers `conductor/tracks`,
`code_styleguides`, the context docs, `workflow.json`, `file_sync_queue.md`,
and `.laneconductor.json` — not this file).

### Secondary hazard the watch introduces (must be handled, not discovered later)

`loadTracksMetadata()` swallows a parse failure and returns a **valid-looking
empty default**:

```js
} catch (err) {
  console.warn('[metadata] Failed to load metadata:', err.message);
}
return { format: '1.0', last_checked: ..., tracks: {} };   // :1307-1312
```

That return value is indistinguishable from a legitimately empty file. And
`saveTracksMetadata()` (`:1315`) writes with a plain `writeFileSync` — no
temp-file-plus-rename — so a reader *can* observe a half-written file. Today
that is mostly harmless because reloads are rare. **The moment we add a
watch, it stops being harmless**: chokidar fires on every write (including
the worker's own `updateTrackMetadata` writes), and a single mid-write
`JSON.parse` failure would replace a *good* cache with the empty default,
making every track unresolvable — converting an occasional staleness bug into
a reproducible total-blindness bug. The watch must therefore refuse to
install a failed parse, and the write should be made atomic.

## Solution

Add an event-driven watch/reload for `tracks-metadata.json`, alongside the
existing `workflow.json` watch, that **only** installs a successfully-parsed
result:

```js
watch('conductor/tracks-metadata.json', { ignoreInitial: true })
  .on('change', () => {
    const next = loadTracksMetadataStrict();   // null on parse failure
    if (!next) return;                         // keep the last good cache
    tracksMetadata = next;
    console.log('[config] tracks-metadata.json reloaded');
  });
```

This subsumes all four gates in the table above: refresh no longer depends on
worker mode, capacity, or collector reachability. The existing reload at
`:7437` is left in place — it becomes redundant but is idempotent and
harmless, and removing it is unnecessary churn in a hot path.

## Requirements

- REQ-1: `conductor/tracks-metadata.json` gets a chokidar watch that
  reassigns `tracksMetadata` on change, mirroring `workflow.json`'s pattern
  (`watch(...).on('change', ...)`, `{ ignoreInitial: true }`) and placed
  alongside it in the same config-watch block (`~:2587`).
- REQ-2: `getTrackMetadata()`/`resolveTrackFolder()` need no changes to their
  lookup logic — the fix is in keeping the cache fresh.
- REQ-3: No behavior change for a worker that never sees the file change.
- REQ-4: **A failed parse must never clobber a good cache.** The watch
  handler distinguishes "parsed successfully" from
  "`loadTracksMetadata()` fell back to its empty default," and on failure
  leaves `tracksMetadata` untouched and logs a warning. Introduced by, and
  specific to, adding the watch — see the secondary-hazard section above.
- REQ-5: `saveTracksMetadata()` writes atomically (write temp in the same
  directory, then `renameSync` over the target) so a watcher can never
  observe a half-written file in the first place. REQ-4 is the safety net;
  this removes the main cause.
- REQ-6: The reload is not gated on `syncOnly`, `getIsLocalFs()`,
  `runningPids.size`, or collector reachability — explicitly verifying the
  four gates that made the existing `:7437` reload insufficient.

## Acceptance Criteria

- [ ] AC-1: A worker process that calls `getTrackMetadata('N')` before track
      `N`'s entry exists in `tracks-metadata.json`, then observes the file
      gain that entry (written by a separate process, simulating `lc new`
      running elsewhere), resolves it on the next call — no restart required.
- [ ] AC-2: `resolveTrackFolder()` against the same scenario returns the real
      `INITIALS-N-slug` folder instead of `null`.
- [ ] AC-3: A **`--sync-only`** worker (gate 1 — the one the `:7437` reload
      can never serve) also picks up the change. This is the criterion that
      proves the fix is the watch and not the pre-existing interval reload.
- [ ] AC-4: Writing malformed JSON to `tracks-metadata.json` leaves the
      previously-good cache intact — the track that resolved before the bad
      write still resolves after it, and the worker does not crash. (REQ-4)
- [ ] AC-5: Existing `conductor/tests/` suites touching
      `resolveTrackFolder`/`getTrackMetadata` — at minimum
      `track-1119-resolve-track-folder-quarantine.test.mjs` and
      `track-1112-worktree-audit.test.mjs` — stay green.

## Implementation Notes / Constraints

**These functions are not importable.** `laneconductor.sync.mjs` has exactly
one export (`normalizeAuthorForComment`, `:1262`); `loadTracksMetadata`,
`getTrackMetadata`, and `resolveTrackFolder` are all module-private, and
importing the module executes the entire worker (top-level `await
upsertWorker()`, `setInterval`s, chokidar watches). A unit test that imports
and calls `getTrackMetadata('N')` directly **cannot be written** without
first refactoring these into a separate module — which is out of scope here.

The tests must therefore follow the existing precedent in this repo: spawn a
**real worker process** against a throwaway repo fixture (plus
`mock-collector.mjs` where API mode is needed) and assert on externally
observable behavior. See
`conductor/tests/track-1119-resolve-track-folder-quarantine.test.mjs`, which
tests `resolveTrackFolder` this exact way.

## Out of Scope

- Extracting metadata/folder-resolution into an importable module so it can
  be unit-tested directly. Worth doing, but it is a refactor with its own
  blast radius, not part of this fix.
- Removing the now-redundant `:7437` reload.
- Auditing every other caller of `resolveTrackFolder` for its own
  fallback-on-null behavior (the `readTrackMergeMode`/scaffold cases were bad
  ones; this track fixes the shared root cause, not each caller's individual
  fallback choice).
- The interrupted-`ai-resolve-conflict`-leaves-a-stuck-merge problem — a
  separate, second-order failure mode (a worker restart mid-session).
