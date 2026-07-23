# Tests: Track 1079 — Collector API as a systemd --user service

## Test Commands
```bash
# Syntax check
node --check bin/lc.mjs
node --check ui/server/index.mjs

# Full restart cycle
node bin/lc.mjs api stop
node bin/lc.mjs api start
curl -sf http://localhost:8091/api/health

# Confirm it's really systemd-managed, not a bare spawn
systemctl --user status laneconductor-api.service
cat /proc/$(cat ui/.api.pid)/cgroup   # must show user@<uid>.service, not vte-spawn-*.scope
```

## Test Cases

### Feature: systemd unit install + start
- [ ] TC-1: `lc api start` on a machine with no existing unit creates
  `~/.config/systemd/user/laneconductor-api.service` — expected: file exists, `systemctl --user
  daemon-reload` ran without error.
- [ ] TC-2: After `lc api start`, `curl http://localhost:8091/api/health` returns 200 — expected:
  API reachable exactly as before.
- [ ] TC-3: The running process's `/proc/<pid>/cgroup` is rooted under `user@<uid>.service`, not
  under any `vte-spawn-*.scope` — expected: proves it's decoupled from the launching terminal.

### Feature: crash resilience
- [ ] TC-4: `kill -9 <api-pid>` while the service is running — expected: systemd restarts it
  within `RestartSec`, `curl /api/health` succeeds again within ~10s without any `lc` command
  being run.

### Feature: idempotent start/stop
- [ ] TC-5: `lc api stop` then `lc api start` twice in a row — expected: no errors, no duplicate
  units, final state is one healthy running instance.
- [ ] TC-6: `lc ui start` with the API not yet running — expected: still starts the API via the
  new path and reports success exactly as today's spawn-based flow did.

### Feature: non-systemd fallback
- [ ] TC-7: With systemd detection forced off (e.g. temporarily stub `hasSystemd()` to return
  false, or run on a platform where `systemctl` is absent) — expected: `lc api start` falls back
  to the original `spawn` + `.api.pid` behavior with no crash.

## Acceptance Criteria
- [ ] All test cases above pass
- [ ] No regression in `lc ui start` / `lc ui stop` behavior
- [ ] `ui/.api.log` still receives output (directly or the command tells the user where logs
  moved to)
