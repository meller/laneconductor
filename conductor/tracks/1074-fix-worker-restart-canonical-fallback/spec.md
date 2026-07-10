# Spec: Fix `lc worker restart` missing canonical sync-script fallback

## Problem Statement

`bin/lc.mjs`'s `restart` command resolves the heartbeat worker's entry script with a single
hardcoded path (`<projectRoot>/conductor/laneconductor.sync.mjs`) and no fallback to the
canonical, installed copy (`<installPath>/conductor/laneconductor.sync.mjs`). `start` has this
fallback; `restart` does not. Since current-generation projects (post the "no local copy needed"
change) never have a local copy, `restart` always crashes for them — after already killing the
running worker, leaving the project with **no worker running** until someone notices and runs
`lc worker start` manually.

## Requirements

- REQ-1: `restart` must resolve `syncScript` using the exact same local-then-canonical fallback
  logic as `start`.
- REQ-2: The resolution logic must be extracted into a single shared function (e.g.
  `resolveSyncScript(projectRoot)`) used by both `start` and `restart`, so this bug class (two
  copies of the same path-resolution logic silently drifting apart) cannot recur. `start`'s
  current inline logic should be refactored to call the same helper.
- REQ-3: If neither the local nor canonical script exists, `restart` must fail the same way
  `start` does — print the same error and exit non-zero **before** killing the existing worker
  (killing-then-crashing is strictly worse than refusing to restart at all, since it leaves the
  project in a worse state than when the command was invoked).
- REQ-4: No behavior change for projects that *do* keep a local copy of the sync script (still
  prefer the local copy over canonical, matching `start`'s existing precedence).

## Acceptance Criteria

- [x] `lc worker restart` (and its `lc restart` alias/underlying command) succeeds in a project
      with no local `conductor/laneconductor.sync.mjs`, falling back to the canonical copy.
- [x] `lc worker restart` still succeeds in a project that *does* have a local copy, using the
      local copy (unchanged behavior).
- [x] If both paths are missing, `restart` exits with the same error message as `start`, and does
      **not** kill any currently-running worker process before failing.
- [x] `start` and `restart` share one resolution function — no duplicated path-fallback logic
      remains in `bin/lc.mjs`.
