# Tests: Track 1074 — Fix `lc worker restart` canonical fallback

## Test Commands
```bash
node --check bin/lc.mjs

# In a project with no local conductor/laneconductor.sync.mjs (e.g. coachai):
lc worker stop 2>/dev/null; lc worker start
ps aux | grep laneconductor.sync   # confirm running
lc worker restart
sleep 3
ps aux | grep laneconductor.sync   # confirm a NEW pid is running, not crashed
tail -20 conductor/.sync.log       # confirm no MODULE_NOT_FOUND
```

## Test Cases

### Feature: `restart` resolves the sync script the same way `start` does
- [x] TC-1: Project with no local sync-script copy — `restart` succeeds, worker comes back up
      pointed at the canonical script. Verified live against `coachai` (PID 948328 running,
      cwd confirmed, `.sync.log` clean of crash traces).
- [x] TC-2: Project with a local sync-script copy — `restart` still uses the local copy
      (unchanged from current `start` behavior). Verified via isolated `resolveSyncScript()`
      call with a temporary local copy in place.
- [x] TC-3: Neither local nor canonical script exists — `restart` exits non-zero with an error,
      and does not kill a currently-running worker in the process. Verified by temporarily
      renaming the canonical script aside; running worker (PID 948328) confirmed still alive
      after the failed restart attempt; direct `node bin/lc.mjs restart` confirmed `EXIT=1`.
- [x] TC-4: `start` behavior is unchanged after refactoring it to use the shared helper (same
      error message, same fallback precedence) — confirmed via a normal `lc worker start`/
      `restart` cycle against `coachai` completing successfully throughout.

## Acceptance Criteria
- [x] `node --check bin/lc.mjs` clean.
- [x] All 4 test cases above pass via manual verification (no existing automated test suite
      covers `bin/lc.mjs`'s worker lifecycle commands as of this track).
