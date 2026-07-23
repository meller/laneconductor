/**
 * Track 1079: run the Collector API as a `systemd --user` service instead of a
 * bare detached `spawn`. A detached/setsid/unref'd child only escapes the
 * launching shell's process group — it stays in whatever cgroup that shell is
 * in (e.g. a terminal's `vte-spawn-*.scope`), so if that cgroup ever gets
 * reaped, the child dies with an untraceable SIGKILL regardless of
 * detachment. A systemd --user unit lives under `user@<uid>.service` instead,
 * fully independent of any terminal.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { execFileSync } from 'child_process';

const SERVICE_NAME = 'laneconductor-api.service';
const UNIT_DIR = join(homedir(), '.config', 'systemd', 'user');
const UNIT_PATH = join(UNIT_DIR, SERVICE_NAME);

function run(cmd, args) {
    return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

/**
 * True only when we're on Linux, `systemctl` is on PATH, and the user's
 * systemd --user bus is actually reachable (not just installed — e.g. some
 * containers have the binary but no running --user instance).
 */
export function hasSystemdUser() {
    if (process.platform !== 'linux') return false;
    try {
        run('systemctl', ['--user', 'status']);
        return true;
    } catch (e) {
        // `systemctl --user status` exits non-zero even when healthy (no
        // single "default" unit), but throws ENOENT/ECONNREFUSED-style errors
        // when systemd or the user bus truly isn't there. Distinguish via
        // whether systemctl produced any output at all.
        return Boolean(e.stdout && e.stdout.length > 0);
    }
}

function renderUnit(installPath, nodeBin) {
    const uiDir = join(installPath, 'ui');
    const logFile = join(uiDir, '.api.log');
    return `[Unit]
Description=LaneConductor Collector API (Track 1079)
After=network.target

[Service]
Type=simple
ExecStart=${nodeBin} ${join(uiDir, 'server', 'index.mjs')}
WorkingDirectory=${uiDir}
Restart=on-failure
RestartSec=2
StandardOutput=append:${logFile}
StandardError=append:${logFile}

[Install]
WantedBy=default.target
`;
}

/**
 * Writes the unit file if missing or stale, reloads the daemon when it
 * changes. Returns true if a reload happened.
 */
export function writeUnit(installPath, nodeBin = process.execPath) {
    mkdirSync(UNIT_DIR, { recursive: true });
    const rendered = renderUnit(installPath, nodeBin);
    const existing = existsSync(UNIT_PATH) ? readFileSync(UNIT_PATH, 'utf8') : null;
    if (existing === rendered) return false;
    writeFileSync(UNIT_PATH, rendered);
    run('systemctl', ['--user', 'daemon-reload']);
    return true;
}

export function startService() {
    run('systemctl', ['--user', 'enable', '--now', SERVICE_NAME]);
}

export function stopService() {
    run('systemctl', ['--user', 'stop', SERVICE_NAME]);
}

export function isServiceActive() {
    try {
        return run('systemctl', ['--user', 'is-active', SERVICE_NAME]).trim() === 'active';
    } catch (e) {
        return false;
    }
}

/** Returns the current MainPID, or null if not running. */
export function getServicePid() {
    try {
        const out = run('systemctl', ['--user', 'show', SERVICE_NAME, '-p', 'MainPID']);
        const pid = Number(out.trim().split('=')[1]);
        return pid > 0 ? pid : null;
    } catch (e) {
        return null;
    }
}

/**
 * Best-effort: lets the service keep running with no active login session.
 * Not fatal if it fails (e.g. no polkit permission) — the service still runs
 * fine for the lifetime of any active session either way.
 */
export function enableLinger() {
    try {
        const user = process.env.USER || run('whoami', []).trim();
        run('loginctl', ['enable-linger', user]);
        return true;
    } catch (e) {
        return false;
    }
}
