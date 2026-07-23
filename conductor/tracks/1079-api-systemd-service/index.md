# Track 1079: Run the Collector API as a systemd --user service

**Lane**: review
**Lane Status**: queue
**Progress**: 100%
**Phase**: Implementation complete
**Type**: dev
**Summary**: The Collector API was dying silently roughly every hour because it lived inside the launching terminal's `vte-spawn-*.scope` cgroup — `detached`/`setsid`/`unref()` escape the shell's process group but not the cgroup, so a reaped scope kills everything still in it with an untraceable SIGKILL. Added `bin/systemd-user.mjs` and wired `lc api start`/`stop` to run it as a real `systemd --user` service (`Restart=on-failure`, linger enabled) on Linux, falling back to the original spawn behavior elsewhere. Verified live: correct cgroup (`user@<uid>.service`, not `vte-spawn-*`), `kill -9` auto-restarts in ~2-4s, idempotent start/stop, `lc ui start` unaffected, and the non-systemd fallback explicitly exercised (PATH stripped of `systemctl`) and confirmed working.
