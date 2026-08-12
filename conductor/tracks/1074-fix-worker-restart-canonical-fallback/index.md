# Track 1074: Fix `lc worker restart` missing canonical sync-script fallback

**Lane**: review
**Lane Status**: running
**Progress**: 100%
**Phase**: Implementation complete
**Type**: dev
**Summary**: Fixed — extracted a shared `resolveSyncScript()` helper used by both `start` and `restart`; `restart` now resolves the script before touching the running worker, so a resolution failure no longer…

## Original Problem (fixed — see plan.md for verification)

## Problem

Found live in the `coachai` project: the worker had been silently failing to sync (collector API was down) for most of a session. After bringing the collector back up, `lc worker restart` was used to pick up the fix — it killed the existing worker, then crashed:

```
Error: Cannot find module '/home/meller/Code/coachai/conductor/laneconductor.sync.mjs'
```

Root cause: `bin/lc.mjs`'s `restart` command (~line 1372) builds `syncScript` with a single hardcoded path:

```js
const syncScript = join(projectRoot, 'conductor', 'laneconductor.sync.mjs');
```

`start` (~line 1306-1321) has the correct behavior — check the per-project path first, then fall back to the canonical installed copy via `getInstallPath()`:

```js
let syncScript = join(projectRoot, 'conductor', 'laneconductor.sync.mjs');
if (!existsSync(syncScript)) {
    const installPath = getInstallPath();
    const canonical = join(installPath, 'conductor', 'laneconductor.sync.mjs');
    if (existsSync(canonical)) {
        syncScript = canonical;
    } else {
        console.error(`❌ Error: Heartbeat worker script not found at ${syncScript} or ${canonical}`);
        process.exit(1);
    }
}
```

`restart` never got this fallback added, so any project that relies on the canonical-copy setup (the documented, current approach — see SKILL.md's "no local copy needed" note) breaks on restart specifically, even though `start` and `stop` work fine.

## Impact

Any project without a local `conductor/laneconductor.sync.mjs` (i.e. every project set up with the current SKILL.md flow) has a broken `lc worker restart` / `lc restart`: it silently kills the worker and never brings it back, with the failure only visible by tailing `conductor/.sync.log` — nothing surfaces to the terminal since `spawn` is detached.
