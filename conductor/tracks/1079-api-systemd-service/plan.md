# Track 1079: Run the Collector API as a systemd --user service

## Phase 1: systemd helper module

**Problem**: `bin/lc.mjs`'s `api start`/`api stop` need a clean way to detect systemd
availability, generate the unit dynamically (correct install path baked in), and drive
`systemctl --user`/`loginctl` without scattering `execSync` calls through the command handler.

**Solution**: A small helper module, `bin/systemd-user.mjs`, exporting:
- `hasSystemdUser()` — true only on Linux, with `systemctl` on PATH, and a reachable
  `--user` bus (`systemctl --user status` doesn't error).
- `writeUnit(installPath)` — renders the unit file from a template (node binary path via
  `process.execPath`, `ExecStart`/`WorkingDirectory` from `installPath`), writes it to
  `~/.config/systemd/user/laneconductor-api.service` if content differs from what's already
  there, runs `daemon-reload` when it does.
- `startService()` / `stopService()` / `isServiceActive()` — thin wrappers over
  `systemctl --user start|stop|is-active laneconductor-api.service`.
- `enableLinger()` — best-effort `loginctl enable-linger $(whoami)`, swallow/report failure as a
  warning (not fatal).

- [x] Task 1: Create `bin/systemd-user.mjs` with the exports above
- [x] Task 2: Unit template: `Type=simple`, `ExecStart=<node> <installPath>/ui/server/index.mjs`,
  `WorkingDirectory=<installPath>/ui`, `Restart=on-failure`, `RestartSec=2`,
  `StandardOutput=append:<installPath>/ui/.api.log`,
  `StandardError=append:<installPath>/ui/.api.log` (keeps `ui/.api.log` working unchanged),
  `WantedBy=default.target`
- [x] Task 3: `node --check bin/systemd-user.mjs`

**Impact**: New module, no existing behavior touched yet.

## Phase 2: wire into `lc api start` / `lc api stop`

**Problem**: The `command === 'api'` block in `bin/lc.mjs` (around line 1456) always uses the raw
`spawn(..., detached: true)` path.

**Solution**: Branch on `hasSystemdUser()`:
- **start**: if systemd available → `writeUnit()` + `enableLinger()` (best-effort, log a
  one-line warning on failure, don't abort) + `startService()`; print
  `✅ API started (systemd) → http://localhost:8091`. Still write `ui/.api.pid` for
  backward-compat with anything reading it (resolve the real PID via `systemctl --user show
  laneconductor-api.service -p MainPID`). If systemd unavailable → existing `spawn` path,
  unchanged.
- **stop**: if the systemd unit exists and is active → `stopService()`. Else → existing
  PID-file `kill` path, unchanged.
- Existing "already running" check (`process.kill(pid, 0)` against `.api.pid`) keeps working
  either way, since the PID file is still populated.

- [x] Task 1: Add systemd branch to `subCommand === 'start'`
- [x] Task 2: Add systemd branch to `subCommand === 'stop'`
- [x] Task 3: `node --check bin/lc.mjs`

**Impact**: `lc api start`/`lc api stop` behavior changes only on systemd-capable Linux; other
platforms unaffected.

## Phase 3: live verification

**Problem**: This whole track exists because a *theory* about cgroups needs to survive contact
with the real system, not just look right on paper.

**Solution**: Actually run the new path end-to-end on this machine and check the specific claims
from spec.md's acceptance criteria — including the crash-resilience test, which is the one that
can't be faked by reading source.

- [x] Task 1: `lc api stop` (clear out the old spawn-based instance), `lc api start`, confirm
  `~/.config/systemd/user/laneconductor-api.service` exists and `curl
  http://localhost:8091/api/health` succeeds
- [x] Task 2: Confirm `/proc/<pid>/cgroup` is under `user@<uid>.service`, not `vte-spawn-*.scope`
- [x] Task 3: `kill -9 <pid>` and confirm systemd auto-restarts within a few seconds, API healthy
  again without running any `lc` command
- [x] Task 4: `lc ui start` end-to-end (API not running beforehand) still works
- [x] Task 5: Update `conductor/tracks/1079-api-systemd-service/conversation.md` with the actual
  verification output (pid/cgroup/restart timing) as evidence
- [x] Task 6 (bonus, not in original plan): verified the non-systemd fallback explicitly by
  stripping `systemctl` from `PATH` — confirmed it lands back in the old spawn + `vte-spawn-*.scope`
  behavior unchanged, proving REQ-6 rather than just asserting it

## ✅ COMPLETE

**Impact**: Confirms the fix actually holds, not just that the code compiles.
