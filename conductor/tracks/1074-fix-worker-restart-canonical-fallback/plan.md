# Track 1074: Fix `lc worker restart` missing canonical sync-script fallback

## Phase 1: Extract shared resolution helper

- [x] Added `resolveSyncScript(projectRoot)` near `getInstallPath()` in `bin/lc.mjs`: checks
      `<projectRoot>/conductor/laneconductor.sync.mjs` first, falls back to
      `<installPath>/conductor/laneconductor.sync.mjs`, returns `{ syncScript }` or
      `{ error }` with the same error-message shape `start` used to print inline.
- [x] Updated the `start` command to call this helper instead of its inline fallback logic —
      no behavior change, just de-duplication.

## Phase 2: Fix `restart`

- [x] Updated the `restart` command to call the same helper **before** killing the existing
      worker process (resolve script → validate it exists → kill old worker → spawn new
      one). On resolution failure, prints the error and exits non-zero without touching the
      running worker.

## Phase 3: Verify

- [x] Manual test in `coachai` (no local sync-script copy): `lc worker start` confirmed
      running (PID 792886 → later replaced), then `lc worker restart` — new PID (948328)
      running afterward, `conductor/.sync.log` shows no `MODULE_NOT_FOUND` crash. This is
      the exact scenario that crashed before the fix.
- [x] Manual test with a local copy present: temporarily copied
      `laneconductor.sync.mjs` into `coachai/conductor/`, called `resolveSyncScript()` in
      isolation, confirmed it returns the local path (not canonical) — precedence
      preserved. Temp file removed after.
- [x] Manual test of the failure path: temporarily renamed the canonical script aside
      (`laneconductor.sync.mjs.bak`), ran `lc worker restart` against `coachai` (which has
      no local copy either) — printed the "script not found" error, exited non-zero via the
      direct `node bin/lc.mjs restart` invocation (confirmed `EXIT=1`), and the
      previously-running worker (PID 948328) was still alive afterward, untouched. Restored
      the canonical script and confirmed a normal restart works again immediately after.

**Note found during verification, not part of this track's scope**: `lc worker restart`
(the `worker` subcommand wrapper) always calls `process.exit(0)` after `spawnSync`-ing the
direct command, regardless of the child's actual exit code — so `lc worker restart`'s own
shell exit code is always 0 even when it fails, though the error message is still printed
correctly. This is pre-existing behavior shared by all `lc worker *` subcommands
(start/stop/restart/logs/sync), not something introduced or fixed by this track. Worth a
follow-up track if exit-code propagation through the `worker` wrapper matters (e.g. for
scripting/CI use).

## ✅ COMPLETE
