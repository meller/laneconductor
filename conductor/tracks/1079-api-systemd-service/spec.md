# Spec: Collector API as a systemd --user service

## Problem Statement

`lc api start` (and `lc ui start`, which calls it) launches the Collector API as a
`spawn(..., { detached: true, stdio: [...] })` child, then calls `.unref()` and tracks it via a
PID file (`ui/.api.pid`). This makes the process independent of the *shell's* lifecycle
(survives the shell exiting, immune to `SIGHUP`), but it does **not** move the process out of
the cgroup its parent shell lives in — on this machine (and any systemd + GNOME Terminal / VTE
desktop), that's a per-terminal-tab `vte-spawn-<uuid>.scope`. Live forensics in this session
caught the API (and, separately, the Pinorama log-viewer daemon) dying with a silent,
untraceable `SIGKILL` at almost exactly one hour of uptime, with the process's cgroup rooted in
that VTE scope — consistent with the whole scope (and everything still inside it) being reaped
by systemd, independent of the API process's own health.

No amount of in-process signal handling (Track 1075's `SIGTERM`/`SIGINT`/`uncaughtException`
handlers) can catch this — a cgroup-wide `SIGKILL` is unstoppable by definition.

## Requirements

- REQ-1: On Linux hosts with `systemd --user` available, `lc api start` installs (if not
  already installed) and starts the API as a `systemd --user` service
  (`laneconductor-api.service`), rather than a bare detached `spawn`.
- REQ-2: The unit is generated dynamically (not a static file checked into the repo with a
  hardcoded path) so it works regardless of where LaneConductor is installed — same pattern as
  `getInstallPath()` already used elsewhere in `bin/lc.mjs`.
- REQ-3: The service has `Restart=on-failure` so a genuine crash (not this cgroup-reaping bug,
  an actual unhandled fault) self-heals without a human running `lc api start` again.
- REQ-4: `lc api start` best-effort enables lingering (`loginctl enable-linger $USER`) so the
  service keeps running even with no active login session. Failure to enable linger (e.g. no
  polkit permission) is a warning, not a hard failure — the service still runs fine while any
  session is active.
- REQ-5: `lc api stop` / `lc api status` work transparently against the systemd-managed process
  — existing callers (`lc ui start`, `lc ui stop`) don't need to change.
- REQ-6: On non-Linux platforms (macOS, or Linux without systemd/loginctl available — e.g. some
  containers/WSL1), fall back to exactly the existing `spawn` + PID-file behavior. No regression
  for those environments.
- REQ-7: `ui/.api.log` keeps working as today for anyone still tailing it — the service's
  stdout/stderr are additionally captured there (or clearly redirected to
  `journalctl --user -u laneconductor-api`, documented in the command's own output).

## Acceptance Criteria

- [ ] `lc api start` on this machine creates `~/.config/systemd/user/laneconductor-api.service`,
  runs `daemon-reload`, and the API is reachable at `http://localhost:8091/api/health`.
- [ ] The started API process's cgroup is under `user@<uid>.service` (systemd's own tree), NOT
  under any `vte-spawn-*.scope` / terminal-owned cgroup.
- [ ] Closing the terminal that ran `lc api start` does not affect the running service.
- [ ] `lc api stop` stops the systemd unit; `lc api start` afterward starts it again cleanly.
- [ ] `lc ui start` (which calls `lc api start` internally when the API isn't up) continues to
  work unchanged from the user's perspective.
- [ ] Killing the API process directly (`kill <pid>`) causes systemd to restart it automatically
  within a few seconds (proves `Restart=on-failure` is wired correctly) — verified live, not
  just by reading the unit file.
- [ ] On a simulated non-systemd path (temporarily force the fallback branch), `lc api start`
  still works via the original `spawn` + PID-file approach.

## Non-Goals

- Migrating the heartbeat worker (`conductor/laneconductor.sync.mjs`) to systemd — explicitly
  out of scope (see conversation.md).
- Windows support for this specific mechanism (systemd doesn't exist there; the project already
  documents Windows as "Skill-Only Mode" with no background worker).
