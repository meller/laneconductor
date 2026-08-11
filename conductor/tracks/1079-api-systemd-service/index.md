# Track 1079: Run the Collector API as a systemd --user service

**Lane**: done
**Lane Status**: success
**Progress**: 100%
**Phase**: Implementation complete
**Type**: dev
**Summary**: The Collector API was dying silently roughly every hour because it lived inside the launching terminal's `vte-spawn-*.scope` cgroup — `detached`/`setsid`/`unref()` escape the shell's process group…
