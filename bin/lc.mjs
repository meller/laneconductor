#!/usr/bin/env node

import { readFileSync, existsSync, writeFileSync, openSync, unlinkSync, readdirSync, mkdirSync, appendFileSync, realpathSync, rmSync, statSync } from 'fs';
import { join, dirname, resolve, basename } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';
import { spawn, spawnSync, execSync } from 'child_process';
import { createInterface } from 'readline';

import { Lanes, LaneActionStatus, LaneAliases, ActionStatusAliases } from '../conductor/constants.mjs';
import { PROVIDERS, PROVIDER_IDS, normalizeProviderId } from '../conductor/providers.mjs';
import { hasSystemdUser, writeUnit, startService, stopService, isServiceActive, getServicePid, enableLinger } from './systemd-user.mjs';
import { runDeploy } from '../conductor/deploy-runner.mjs';
import { createBuildArtifact, getBuilds, getBuildById } from '../ui/server/build-manager.mjs';
import { auditWorktrees } from '../conductor/services/worktree-audit.mjs';
import { mergeWorktreeBranch, resolvePrimaryRepoRoot } from '../conductor/services/worktree-merge.mjs';
import { checkDivergence } from '../conductor/services/git-divergence.mjs';
import { getAuthorInfo } from '../conductor/services/author.mjs';

const __filename = realpathSync(fileURLToPath(import.meta.url));
const __dirname = dirname(__filename);
const packageJson = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf8'));

const VERSION = packageJson.version || '0.1.0';
const RC_FILE = join(homedir(), '.laneconductorrc');

// Resolve the token for a collector at index `idx`.
// Priority: GCP Secret Manager -> .env COLLECTOR_<idx>_TOKEN > inline token/machine_token
function getCollectorToken(cfg, idx, projectRoot) {
    const c = cfg.collectors?.[idx];
    if (!c) return null;
    
    // Remote secret resolution
    if (c.store_type === 'gcp-secret' && c.secret_name) {
        try {
            const { spawnSync } = require('child_process');
            const res = spawnSync('gcloud', ['secrets', 'versions', 'access', 'latest', '--secret', c.secret_name], { encoding: 'utf8' });
            if (res.status === 0 && res.stdout) {
                return res.stdout.trim();
            }
            console.warn(`[log-sync] ⚠️  GCP Secret fetch failed for ${c.secret_name}`);
        } catch (e) {}
    }

    // Try env file first
    const envPath = join(projectRoot, '.env');
    if (existsSync(envPath)) {
        const env = readFileSync(envPath, 'utf8');
        const m = env.match(new RegExp(`COLLECTOR_${idx}_TOKEN=([^\\n]+)`));
        if (m) return m[1].trim();
    }
    return c.token || c.machine_token || null;
}

function getInstallPath() {
    if (existsSync(RC_FILE)) {
        const skillPath = readFileSync(RC_FILE, 'utf8').trim();
        // skillPath is e.g. /path/to/laneconductor/.claude/skills/laneconductor
        // we need to reach the repo root where /ui lives.
        return resolve(skillPath, '../../..');
    }
    // Track 10019 (REQ-4 / S9): __dirname is this exact script FILE's
    // location — if it's being run as a linked worktree's own copy of
    // bin/lc.mjs (e.g. someone invokes `.worktrees/10019/bin/lc.mjs`
    // directly, or `/usr/local/bin/lc` was ever symlinked at a worktree's
    // copy — S8), this fallback would otherwise resolve `ui`, pidfiles and
    // logs to that worktree instead of the primary checkout no rc file
    // exists to override it. Route through resolvePrimaryRepoRoot() so a
    // worktree-resident invocation still lands on the primary; a
    // legitimate standalone clone (not inside any worktree) is unaffected
    // since resolvePrimaryRepoRoot() is a no-op there.
    const scriptRoot = resolve(__dirname, '..');
    try {
        return resolvePrimaryRepoRoot(scriptRoot);
    } catch {
        return scriptRoot; // not inside a git repo — nothing to correct
    }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/**
 * Track 1110 Phase 2: waits for `pid` to actually exit (process.kill(pid, 0)
 * throwing ESRCH), polling every `intervalMs` up to `timeoutMs`. Returns
 * true if the process is confirmed gone within the deadline, false if it's
 * still alive when the deadline passes.
 *
 * Exists because `process.kill(pid)` only delivers a signal — it returns
 * immediately regardless of whether or when the target actually exits.
 * `stop`/`restart` used to call it and then immediately delete the pidfile
 * and report success, which lied whenever the target's own shutdown
 * handling took any real time (laneconductor.sync.mjs's SIGTERM handler
 * awaits a network call with up to a 10s timeout) — the exact mechanism
 * behind a live duplicate-worker incident, see
 * conductor/tracks/1110-worker-separation-and-claim-race-safety/plan.md.
 */
async function waitForProcessExit(pid, timeoutMs, intervalMs = 100) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            process.kill(pid, 0);
        } catch (e) {
            return true; // ESRCH — process is gone
        }
        await sleep(intervalMs);
    }
    try {
        process.kill(pid, 0);
        return false; // still alive after the deadline
    } catch (e) {
        return true;
    }
}

/**
 * Track 1110 Phase 2: SIGTERM, then wait up to `gracefulTimeoutMs` for a
 * real exit; if the process is still alive after that, escalate to
 * SIGKILL (uncatchable — bounds the worst case deterministically) and
 * wait briefly for that to take effect too. Returns once the process is
 * confirmed dead, or throws if even SIGKILL didn't work (should not
 * happen on any POSIX system barring a zombie/kernel-level oddity).
 *
 * gracefulTimeoutMs defaults to 12000 — slightly above
 * laneconductor.sync.mjs's own removeWorker() network-call timeout
 * (10000ms), so a normally-shutting-down worker is never killed out from
 * under its own graceful cleanup.
 */
async function stopAndConfirmDeath(pid, { gracefulTimeoutMs = 12000, killTimeoutMs = 3000 } = {}) {
    try {
        process.kill(pid, 'SIGTERM');
    } catch (e) {
        return; // already gone
    }
    if (await waitForProcessExit(pid, gracefulTimeoutMs)) return;

    console.log(`⚠️  Worker (PID: ${pid}) did not exit within ${gracefulTimeoutMs}ms of SIGTERM — sending SIGKILL`);
    try {
        process.kill(pid, 'SIGKILL');
    } catch (e) {
        return; // exited in the gap between the check and this call
    }
    if (await waitForProcessExit(pid, killTimeoutMs)) return;

    throw new Error(`PID ${pid} still alive ${killTimeoutMs}ms after SIGKILL — cannot confirm it stopped`);
}

function findProjectRoot(startDir = process.cwd()) {
    let curr = startDir;
    while (curr !== dirname(curr)) {
        if (existsSync(join(curr, 'conductor')) || existsSync(join(curr, '.laneconductor.json'))) {
            return curr;
        }
        curr = dirname(curr);
    }
    return null;
}

/**
 * Returns the PID recorded in pidFile if a live laneconductor.sync.mjs worker
 * still owns it, else null (cleaning up a stale pidfile as a side effect).
 * Guards against PID reuse: a dead worker's PID can be recycled by the OS for
 * an unrelated process, so a bare `process.kill(pid, 0)` liveness check alone
 * isn't enough — cross-check /proc/<pid>/cmdline on Linux where available.
 */
function getRunningWorkerPid(pidFile) {
    if (!existsSync(pidFile)) return null;
    const pid = parseInt(readFileSync(pidFile, 'utf8').trim(), 10);
    if (!pid || Number.isNaN(pid)) {
        try { unlinkSync(pidFile); } catch (e) { }
        return null;
    }
    let alive = false;
    try {
        process.kill(pid, 0);
        alive = true;
    } catch (e) {
        alive = false;
    }
    if (!alive) {
        try { unlinkSync(pidFile); } catch (e) { }
        return null;
    }
    const cmdlinePath = `/proc/${pid}/cmdline`;
    if (existsSync(cmdlinePath)) {
        try {
            const cmdline = readFileSync(cmdlinePath, 'utf8');
            if (!cmdline.includes('laneconductor.sync.mjs')) {
                // PID was reused by an unrelated process; the real worker is gone.
                try { unlinkSync(pidFile); } catch (e) { }
                return null;
            }
        } catch (e) {
            // /proc unreadable (permissions, race) — fall back to trusting the liveness check.
        }
    }
    return pid;
}

// Track 1084 Phase 0: --worker-number lets multiple worker processes run
// for the same project on the same machine (each with a stable identity
// that survives restarts — see conductor/laneconductor.sync.mjs). Defaults
// to 1, which keeps today's single-worker pidfile name (.sync.pid) for
// backward compatibility; only worker_number > 1 gets a distinct filename.
function resolveWorkerNumber(args) {
    const idx = args.indexOf('--worker-number');
    if (idx === -1) return 1;
    const n = parseInt(args[idx + 1], 10);
    return Number.isInteger(n) && n > 0 ? n : 1;
}

// Track 1109: forward --only-tracks / --once to the spawned sync worker.
// Deliberately does NOT validate — the worker owns that, so `lc worker start`
// and a directly invoked laneconductor.sync.mjs can never disagree about what
// counts as a legal scope.
function forwardClaimScopeFlags(args, syncArgs) {
    const idx = args.indexOf('--only-tracks');
    if (idx !== -1) syncArgs.push('--only-tracks', args[idx + 1] ?? '');
    if (args.includes('--once')) syncArgs.push('--once');
    return syncArgs;
}

function getPidFilePath(projectRoot, workerNumber) {
    const filename = workerNumber === 1 ? '.sync.pid' : `.sync-${workerNumber}.pid`;
    return join(projectRoot, 'conductor', filename);
}

// Track 1091 Phase 2: a manager worker is a machine-level singleton, not
// scoped to any one project — its pidfile lives in a global location
// (unlike getPidFilePath's per-project one) so "is one already running"
// can be checked regardless of which project directory `lc worker start
// --manager` happens to be invoked from.
function getManagerPidFilePath() {
    const dir = join(homedir(), '.laneconductor');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    return join(dir, 'manager.pid');
}

// Track 1091 Phase 2 Task 4 (spec.md REQ-2b): where a manager worker
// creates brand-new projects (git clone target / from-scratch scaffold) —
// laneconductor.sync.mjs reads this same file directly at manager-worker
// startup, matching this codebase's existing pattern for global config
// (~/.laneconductorrc, ~/.laneconductor-auth.json) rather than threading
// it through as a spawn arg/env var.
function getManagerConfigPath() {
    const dir = join(homedir(), '.laneconductor');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    return join(dir, 'manager-config.json');
}

function readManagerConfig() {
    const path = getManagerConfigPath();
    if (!existsSync(path)) return {};
    try { return JSON.parse(readFileSync(path, 'utf8')); }
    catch { return {}; }
}

function writeManagerConfig(config) {
    writeFileSync(getManagerConfigPath(), JSON.stringify(config, null, 2) + '\n');
}

/**
 * Resolves the heartbeat worker's entry script: prefers a per-project copy at
 * <projectRoot>/conductor/laneconductor.sync.mjs, falling back to the canonical
 * copy in this LaneConductor installation. Returns { syncScript } on success, or
 * { error } with the same message shape callers have historically printed.
 * Shared by `start` and `restart` so the two can't silently drift apart again —
 * `restart` previously skipped the canonical fallback entirely and crashed for
 * any project relying on it (Track 1074).
 */
function resolveSyncScript(projectRoot) {
    const local = join(projectRoot, 'conductor', 'laneconductor.sync.mjs');
    if (existsSync(local)) return { syncScript: local };

    const installPath = getInstallPath();
    const canonical = join(installPath, 'conductor', 'laneconductor.sync.mjs');
    if (existsSync(canonical)) return { syncScript: canonical };

    return { error: `❌ Error: Heartbeat worker script not found at ${local} or ${canonical}` };
}

/**
 * Runs a conversational LLM call (not a slash command), streams output to terminal,
 * and returns the full response text. Used for brainstorm loops.
 * @param {object} cfg - Project config from .laneconductor.json
 * @param {string} prompt - The full prompt to send
 * @returns {Promise<string>} - Full LLM response text
 */
async function callLLMConversational(cfg, prompt) {
    const agent = cfg.project?.primary;
    const cli = agent?.cli || 'claude';
    const model = agent?.model;

    let cmd, cmdArgs;
    if (cli === 'gemini') {
        // Track 1077 Phase 4: gemini-cli is retired — route through agy
        // (Antigravity), the only Gemini access path that still works.
        cmd = 'agy';
        cmdArgs = ['--dangerously-skip-permissions', '-p', prompt];
        if (model) cmdArgs.push('--model', model);
    } else if (cli === 'antigravity' || cli === 'agy') {
        cmd = 'agy';
        cmdArgs = ['--dangerously-skip-permissions', '-p', prompt];
        if (model) cmdArgs.push('--model', model);
    } else {
        cmd = 'claude';
        cmdArgs = ['--dangerously-skip-permissions', '-p', prompt];
        if (model) cmdArgs.push('--model', model);
    }

    return new Promise((resolve) => {
        const proc = spawn(cmd, cmdArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
        let output = '';
        proc.stdout.on('data', (d) => { const t = d.toString(); process.stdout.write(t); output += t; });
        proc.stderr.on('data', (d) => process.stderr.write(d));
        proc.on('close', () => resolve(output));
    });
}

/**
 * Runs the AI agent for a specific command/track.
 * @param {object} cfg - Project configuration from .laneconductor.json
 * @param {string} slashCmd - The /laneconductor command to run (e.g., "/laneconductor setup scaffold")
 * @param {string} trackNum - Optional track number
 * @param {string} lane - Optional lane for logging/status updates
 * @returns {Promise<number>} - Exit code
 */
async function runAIAgent(cfg, slashCmd, trackNum = null, lane = null) {
    const projectRoot = cfg.project.repo_path || process.cwd();
    
    // Identify available agents (primary and optional secondary)
    const agents = [];
    if (cfg.project?.primary?.cli) agents.push({ ...cfg.project.primary, type: 'primary' });
    if (cfg.project?.secondary?.cli) agents.push({ ...cfg.project.secondary, type: 'secondary' });

    if (agents.length === 0) {
        console.error('❌ No primary agent configured in .laneconductor.json');
        return 1;
    }

    const skillPath = join(projectRoot, '.claude/skills/laneconductor/SKILL.md');
    let skillContent = '';
    try {
        if (existsSync(skillPath)) {
            skillContent = readFileSync(skillPath, 'utf8');
        }
    } catch (e) {
        console.warn(`[scaffold] Could not read skill definition at ${skillPath}`);
    }

    const skillContext = skillContent 
        ? `Use the following /laneconductor skill definition to handle the request: \n\n${skillContent}\n\nCommand to execute: `
        : `Use the /laneconductor skill. `;

    let exitCode = 0;
    let finalStatus = 'failure';
    let lastErrorLog = '';

    for (let i = 0; i < agents.length; i++) {
        const agent = agents[i];
        const cli = agent.cli || 'claude';
        const model = agent.model;

        let cmd, cmdArgs;
        if (cli === 'claude') {
            cmd = 'claude';
            cmdArgs = ['--dangerously-skip-permissions', '-p', slashCmd];
            if (model) cmdArgs.push('--model', model);
        } else if (cli === 'gemini') {
            // Track 1077 Phase 4: gemini-cli is retired — route through agy
            // (Antigravity), the only Gemini access path that still works.
            cmd = 'agy';
            cmdArgs = ['--dangerously-skip-permissions', '-p', `${skillContext}${slashCmd}`];
            if (model) cmdArgs.push('--model', model);
        } else if (cli === 'antigravity' || cli === 'agy') {
            cmd = 'agy';
            cmdArgs = ['--dangerously-skip-permissions', '-p', `${skillContext}${slashCmd}`];
            if (model) cmdArgs.push('--model', model);
        } else {
            cmd = cli;
            cmdArgs = ['-p', `${skillContext}${slashCmd}`];
            if (model) cmdArgs.push('--model', model);
        }

        const logsDir = join(projectRoot, 'conductor', 'logs');
        if (!existsSync(logsDir)) mkdirSync(logsDir, { recursive: true });
        const logPath = join(logsDir, `run-${lane || 'agent'}-${trackNum || 'global'}-${Date.now()}.log`);
        const logFd = openSync(logPath, 'a');

        console.log(`🚀 Running AI agent (${agent.type}): ${cli}${model ? ` (${model})` : ''}...`);
        if (trackNum) console.log(`   Track: ${trackNum} | Command: ${slashCmd}`);
        else console.log(`   Command: ${slashCmd}`);
        console.log(`   Log: ${logPath}\n`);

        const proc = spawn(cmd, cmdArgs, { stdio: ['inherit', 'pipe', 'pipe'], cwd: projectRoot });
        
        let output = '';
        let lastSyncTime = Date.now();

        const syncLogTail = async (isFinal = false) => {
            if (trackNum && cfg.mode !== 'local-fs') {
                const logTail = output.split('\n').slice(-100).join('\n');
                const collectors = (cfg.collectors || []).filter(c => c.enabled !== false);
                await Promise.allSettled(collectors.map((collector) => {
                    const idx = cfg.collectors.indexOf(collector);
                    if (!collector?.url) return;
                    const url = new URL(`${collector.url}/track/${trackNum}/action`);
                    if (cfg.project?.id) url.searchParams.set('project_id', cfg.project.id);
                    const token = getCollectorToken(cfg, idx, projectRoot);
                    return fetch(url.toString(), {
                        method: 'PATCH',
                        headers: {
                            'Content-Type': 'application/json',
                            ...(token ? { 'Authorization': `Bearer ${token}` } : {})
                        },
                        body: JSON.stringify({
                            lane_action_status: isFinal ? (exitCode === 0 ? 'success' : 'failure') : 'running',
                            last_log_tail: logTail,
                        })
                    }).catch(e => console.warn(`[log-sync] Could not push to collector[${idx}]: ${e.message}`));
                }));
            }
        };

        const logInterval = setInterval(() => {
            if (Date.now() - lastSyncTime > 5000) {
                syncLogTail();
                lastSyncTime = Date.now();
            }
        }, 5000);

        proc.stdout.on('data', chunk => { 
            process.stdout.write(chunk); 
            appendFileSync(logPath, chunk);
            output += chunk.toString();
        });
        proc.stderr.on('data', chunk => { 
            process.stderr.write(chunk); 
            appendFileSync(logPath, chunk);
            output += chunk.toString();
        });

        exitCode = await new Promise(resolve => proc.on('close', resolve));
        clearInterval(logInterval);
        await syncLogTail(true);
        lastErrorLog = output;

        if (exitCode === 0) {
            finalStatus = 'success';
            // Update metadata if it's a track run
            if (trackNum) {
                try {
                    const tracksDir = join(projectRoot, 'conductor', 'tracks');
                    const trackDir = readdirSync(tracksDir).find(d => d.startsWith(`${trackNum}-`));
                    if (trackDir) {
                        const indexPath = join(tracksDir, trackDir, 'index.md');
                        if (existsSync(indexPath)) {
                            let content = readFileSync(indexPath, 'utf8');
                            const runBy = `${cli}${model ? '/' + model : ''} (${agent.type})`;
                            if (content.match(/\*\*Last Run\*\*:\s*[^\n]+/i)) {
                                content = content.replace(/\*\*Last Run\*\*:\s*[^\n]+/i, `**Last Run**: ${runBy}`);
                            } else if (content.match(/\*\*Last Run By\*\*:\s*[^\n]+/i)) {
                                content = content.replace(/\*\*Last Run By\*\*:\s*[^\n]+/i, `**Last Run**: ${runBy}`);
                            } else {
                                content = content.replace(/(\*\*Progress\*\*:\s*[^\n]+)/i, `$1\n**Last Run**: ${runBy}`);
                            }
                            writeFileSync(indexPath, content, 'utf8');
                        }
                    }
                } catch (e) {
                    console.warn(`[metadata] Failed to update Last Run: ${e.message}`);
                }
            }
            break;
        } else {
            // Check if failure looks like a rate limit / exhaustion
            const isExhausted = output.includes('hit your limit') || 
                               output.includes('exhausted your capacity') || 
                               output.includes('429') || 
                               output.includes('resets');
            
            if (isExhausted && i < agents.length - 1) {
                console.log(`\n⚠️  ${agent.type.toUpperCase()} agent (${cli}) capacity exhausted. Falling back to next agent...\n`);
                continue;
            } else if (i < agents.length - 1) {
                console.log(`\n⚠️  ${agent.type.toUpperCase()} agent (${cli}) failed with exit code ${exitCode}. Trying next agent anyway...\n`);
                continue;
            }
        }
    }

    return exitCode;
}

// Helper: Check if a JIRA project exists
async function jiraProjectExists(domain, email, token, projectKey) {
  try {
    const auth = Buffer.from(`${email}:${token}`).toString('base64');
    const url = `https://${domain}/rest/api/3/project/${projectKey}`;
    const response = await fetch(url, {
      headers: { Authorization: `Basic ${auth}` },
      signal: AbortSignal.timeout(10000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

// Helper: Create a JIRA project
async function createJiraProject(domain, email, token, projectKey, projectName) {
  try {
    const auth = Buffer.from(`${email}:${token}`).toString('base64');
    const url = `https://${domain}/rest/api/3/projects`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        key: projectKey,
        name: projectName || projectKey,
        projectTypeKey: 'software',
        isPrivate: false,
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`❌ Failed to create JIRA project: ${response.status}`);
      return false;
    }

    console.log(`✅ Created JIRA project: ${projectKey}`);
    return true;
  } catch (err) {
    console.error(`❌ Error creating JIRA project: ${err.message}`);
    return false;
  }
}

// Helper: Resolve JIRA token
function resolveJiraToken(tokenEnv, token, tokenSecret, tokenStore) {
  if (tokenEnv && process.env[tokenEnv]) {
    return process.env[tokenEnv];
  }
  if (tokenStore === 'gcp-secret' && tokenSecret) {
    try {
      return execSync(`gcloud secrets versions access latest --secret="${tokenSecret}"`, { encoding: 'utf8' }).trim();
    } catch {
      return null;
    }
  }
  return token || null;
}

// Helper: Validate JIRA statuses (from jira-collector logic)
async function validateJiraStatusesInCli(domain, email, token, projectKey) {
  try {
    const auth = Buffer.from(`${email}:${token}`).toString('base64');
    const url = `https://${domain}/rest/api/3/project/${projectKey}/statuses`;

    let response = await fetch(url, {
      headers: { Authorization: `Basic ${auth}` },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      url = `https://${domain}/rest/api/3/statuses`;
      response = await fetch(url, {
        headers: { Authorization: `Basic ${auth}` },
        signal: AbortSignal.timeout(10000),
      });
    }

    if (!response.ok) return { allExist: false, missing: [] };

    const data = await response.json();
    const statuses = new Set();

    if (Array.isArray(data)) {
      for (const item of data) {
        if (item.name) statuses.add(item.name);
        if (item.statuses && Array.isArray(item.statuses)) {
          for (const status of item.statuses) {
            if (status.name) statuses.add(status.name);
          }
        }
      }
    } else if (data && typeof data === 'object') {
      if (Array.isArray(data.issueTypes)) {
        for (const issueType of data.issueTypes) {
          if (issueType.statuses && Array.isArray(issueType.statuses)) {
            for (const status of issueType.statuses) {
              if (status.name) statuses.add(status.name);
            }
          }
        }
      }
    }

    const requiredStatuses = ['Backlog', 'To Do', 'In Progress', 'In Review', 'Testing', 'Done'];
    const existingLower = Array.from(statuses).map(s => s.toLowerCase());
    const missing = requiredStatuses.filter(s => !existingLower.includes(s.toLowerCase()));

    return { allExist: missing.length === 0, missing, existing: Array.from(statuses) };
  } catch (err) {
    return { allExist: false, missing: [], error: err.message };
  }
}

const args = process.argv.slice(2);
const command = args[0];

if (!command || command === '--help' || command === '-h' || command === 'help') {
    console.log(`
LaneConductor CLI (lc) v${VERSION}

Usage:
  lc <command> [arguments]

Shared Infrastructure  (run once per machine — from anywhere)
  api [start|stop]     Manage the shared Collector API at :8091
  ui [start|stop]      Manage the shared Vite dashboard at :8090

Project Setup  (run once per project — from project root)
  setup                Initialize LaneConductor in the current project
  setup-deploy         Guided deployment setup (writes deployment-stack.md + deploy.json)

Worker  (per session — run from project root)
  worker run <track>   Run a worker scoped to one track, in the foreground, and exit
                       when it's done. This is normally what you want — unlike
                       "start", it cannot claim any other queued track.
                       Example: lc worker run 1100
  start                Start the heartbeat sync worker
                       Two worker modes — MANUAL (syncs + does what you
                       explicitly ask from the UI) vs AUTOMATIC (also
                       picks up queued work by itself):
                       Options:
                         --manager                      Start as machine-level global manager worker
                         --projects-dir <path>          (With --manager) Directory where projects are cloned
                         --sync-and-work                AUTOMATIC mode: also poll database queue
                                                        (default is MANUAL / --sync-only)
                         --worker-number <N>            Start multiple workers for a project (default: 1)
                         --only-tracks <n,n>            Claim ONLY these tracks. Without it an
                                                        AUTOMATIC worker claims anything queued.
                         --once                         Exit when the --only-tracks work is done
                                                        (requires --only-tracks)
                         --cli <id>                     Run this one worker on a different provider
                                                        than project.primary (claude/gemini/copilot/
                                                        antigravity/other) — doesn't change the default
                         --model <id>                   Model to pair with --cli
  stop                 Stop the heartbeat sync worker
                       Options:
                         --manager                      Stop the global manager worker
                         --worker-number <N>            Stop specific project worker
  restart              Restart the heartbeat sync worker
                       Options:
                         --manager                      Restart the global manager worker
                         --sync-and-work                AUTOMATIC mode: also poll database queue
                         --worker-number <N>            Restart specific project worker
  worker [run|start|stop|restart|status|logs|sync]
                       Manage the sync worker (supports options above)
  status               Show track status for the current project
                       Options:
                         --manager                      Check global manager worker status
                         --worker-number <N>            Check status of a specific worker

Track Management  (per project)
  new [name] [desc]    Create a new track
  update-track [id] [msg] Add work/bug/feature to track and return to backlog
  report-bug [desc]    Smart bug intake (creates or updates bug track)
  feature-request [desc] Smart feature intake (creates or updates feature track)
  brainstorm [id]      Start a brainstorm dialogue for a track via conversation.md
  comment [id] [msg]   Post a comment to a track
  move [id] [l:s]      Move track to lane:status
  pulse [id] [s] [%]   Pulse track status and progress
  show [id]            Show track details (plan, spec, logs)
  logs [id|worker|worker-run [id]] Show logs for a track or the worker
  delete [id]          Permanently delete a track

Track Transitions
  plan [id] [--run]          Move to plan lane (--run: execute immediately in foreground)
  implement [id] [--run]     Move to implement lane (--run: execute immediately in foreground)
  review [id] [--run]        Move to review lane (--run: execute immediately in foreground)
  quality-gate [id] [--run]  Move to quality-gate lane (--run: execute immediately in foreground)
  backlog [id], done [id], rerun [id]

Configuration  (per project)
  config [set ...]     Manage project configuration (or show if no args)
  config mode [mode] [--url <url>] [--key <key>] [--store-type <type>] [--secret-name <name>]
                       Switch mode (local-fs, local-api, remote-api, multi-api)
  config visibility [private|team|public] Set worker visibility level
  workflow [set ...]   Manage workflow configuration (or show if no args)
  add-target --url <url> [--key <key>] [--store-type <type>] [--secret-name <name>] [--type local|remote]
                       Add a new collector target
  add-target-mapping [--type jira] [--project-key <key>] --lane <lc_lane> --target "<status>"
                       Add a 1:1 status mapping for a collector (e.g., Jira)
  remove-target <url>  Remove a configured collector target
  enable-target <url>  Enable sync for a specific target
  disable-target <url> Disable sync for a specific target
  list-targets         List all configured collector targets and their sync status
  project [show|set]   Manage project settings (or show summary if no args)
  doc set SECTION VAL  Update conductor/product.md, tech-stack.md, etc.
  verify-isolation     Check if worker environment is correctly sandboxed

Deployment  (per project)
  build                Generate a new release build artifact with AI change summary
  builds               List generated build artifacts in conductor/builds/
  deploy [env]         Execute deployment for a specific environment (prod/staging/preview)
  remote-sync          Bidirectional sync between API and local files (newer wins)
  init-summary         Regenerate conductor/tracks.md
  verify               Run project verification checks

Global configuration: ${RC_FILE}
Installation path: ${getInstallPath()}
  `);
    process.exit(0);
}

if (command === 'version' || command === '--version' || command === '-v') {
    console.log(`lc v${VERSION}`);
    process.exit(0);
}

const projectRoot = findProjectRoot();

function setNestedKey(obj, keyPath, value) {
    const keys = keyPath.split('.');
    let curr = obj;
    for (let i = 0; i < keys.length - 1; i++) {
        const k = keys[i];
        if (!curr[k]) curr[k] = {};
        curr = curr[k];
    }
    curr[keys[keys.length - 1]] = value;
}

function updateDocSection(file, section, value) {
    if (!existsSync(file)) return false;
    let content = readFileSync(file, 'utf8');
    const sectionH = '## ' + section;
    const lines = content.split('\n');
    const idx = lines.findIndex(l => l.trim().toLowerCase() === sectionH.toLowerCase());
    if (idx === -1) {
        content = content.trim() + '\n\n' + sectionH + '\n' + value + '\n';
    } else {
        let end = lines.findIndex((l, i) => i > idx && l.startsWith('## '));
        if (end === -1) end = lines.length;
        lines.splice(idx + 1, end - idx - 1, value);
        content = lines.join('\n');
    }
    writeFileSync(file, content);
    return true;
}

if (command === 'setup') {
    const rl = createInterface({
        input: process.stdin,
        output: process.stdout
    });

    const question = (query) => new Promise((resolve) => rl.question(query, resolve));

    async function runSetup() {
        console.log('\n🛠️  LaneConductor Project Setup');
        console.log('==============================\n');

        let projectName = basename(process.cwd());
        let gitRemote = null;

        // Detect project name from package.json
        if (existsSync('package.json')) {
            try {
                const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
                if (pkg.name) projectName = pkg.name;
            } catch (e) { }
        }

        // Detect git remote
        try {
            const gitRes = spawnSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8' });
            if (gitRes.status === 0) gitRemote = gitRes.stdout.trim();
        } catch (e) { }

        const name = await question(`Project name [${projectName}]: `) || projectName;
        const remoteUrl = await question(`Git remote URL [${gitRemote || 'none'}]: `) || gitRemote;

        console.log(`\n📂 Creating conductor/ directory structure...`);
        if (!existsSync('conductor')) mkdirSync('conductor', { recursive: true });
        if (!existsSync('conductor/tracks')) mkdirSync('conductor/tracks', { recursive: true });
        if (!existsSync('conductor/code_styleguides')) mkdirSync('conductor/code_styleguides', { recursive: true });

        // Copy canonical files
        const installPath = getInstallPath();
        const filesToCopy = [
            ['conductor/workflow.json', 'conductor/workflow.json'],
            ['workflow.md', 'workflow.md']
        ];

        for (const [src, dest] of filesToCopy) {
            const srcPath = join(installPath, src);
            if (existsSync(srcPath) && !existsSync(dest)) {
                console.log(`📄 Copying ${src}...`);
                writeFileSync(dest, readFileSync(srcPath));
            }
        }

        console.log('\n📊 Infrastructure & Mode Setup');
        const modeChoice = await question(`
How will this worker operate?
  [1] local-fs    — no DB, no API; pure filesystem (offline, CI, testing)
  [2] local-api   — local Postgres + local Collector + Vite UI (recommended)
  [3] remote-api  — remote Collector (laneconductor.io or self-hosted)
Choice [2]: `) || '2';

        const modeMap = { '1': 'local-fs', '2': 'local-api', '3': 'remote-api' };
        const mode = modeMap[modeChoice] || 'local-api';

        let dbConfig = { host: 'localhost', port: 5432, name: 'laneconductor', user: 'postgres', password: '' };
        if (mode === 'local-api') {
            // Check DB reachability before asking for credentials
            const { default: net } = await import('net');
            const pgReachable = await new Promise(resolve => {
                const sock = new net.Socket();
                sock.setTimeout(2000);
                sock.connect(dbConfig.port, dbConfig.host, () => { sock.destroy(); resolve(true); });
                sock.on('error', () => resolve(false));
                sock.on('timeout', () => { sock.destroy(); resolve(false); });
            });

            if (!pgReachable) {
                console.log(`\n⚠️  Cannot reach Postgres at ${dbConfig.host}:${dbConfig.port}`);
                const dbChoice = await question(`
How would you like to set up the database?
  [1] Start Docker container (recommended — requires Docker)
  [2] I have Postgres — let me configure the connection
Choice [1]: `) || '1';

                if (dbChoice === '1') {
                    console.log('📦 Starting Postgres via Docker...');
                    const dockerRun = spawnSync('docker', [
                        'run', '-d', '--name', 'laneconductor-pg',
                        '-e', 'POSTGRES_USER=postgres',
                        '-e', 'POSTGRES_PASSWORD=postgres',
                        '-e', 'POSTGRES_DB=laneconductor',
                        '-p', '5432:5432',
                        '--restart', 'unless-stopped',
                        'postgres:16'
                    ], { stdio: 'inherit' });

                    if (dockerRun.status !== 0) {
                        // Container may already exist — try starting it
                        spawnSync('docker', ['start', 'laneconductor-pg'], { stdio: 'inherit' });
                    }

                    process.stdout.write('⏳ Waiting for Postgres');
                    for (let i = 0; i < 30; i++) {
                        await sleep(1000);
                        const ready = spawnSync('docker', ['exec', 'laneconductor-pg', 'pg_isready', '-U', 'postgres'], { stdio: 'pipe' });
                        if (ready.status === 0) break;
                        process.stdout.write('.');
                    }
                    console.log('\n✅ Postgres ready');
                }
            }

            console.log('\n️  Database Configuration');
            dbConfig.host = await question(`DB Host [${dbConfig.host}]: `) || dbConfig.host;
            dbConfig.port = parseInt(await question(`DB Port [${dbConfig.port}]: `) || dbConfig.port);
            dbConfig.name = await question(`DB Name [${dbConfig.name}]: `) || dbConfig.name;
            dbConfig.user = await question(`DB User [${dbConfig.user}]: `) || dbConfig.user;
            dbConfig.password = await question(`DB Password (hidden): `, { hideEchoBack: true }) || '';
        }

        console.log('\n🛰️  Collector Configuration');
        const syncChoice = await question(`
Where should tracks be synced?
  [1] Local Only
  [2] LC Cloud Only
  [3] Both Local & Cloud
Choice [1]: `) || '1';

        let collectors = [];
        if (syncChoice === '1' || syncChoice === '3') collectors.push({ url: 'http://localhost:8091', token: null });

        let cloudToken = null;
        let remoteApiKey = null;
        if (syncChoice === '2' || syncChoice === '3') {
            collectors.push({ url: 'https://api.laneconductor.com', token: null });
            cloudToken = await question('Enter LC Cloud Token (API Key): ');
            remoteApiKey = cloudToken;
        }

        // Prompt for API key if remote-api is selected (and not already prompted in syncChoice)
        if (mode === 'remote-api' && !remoteApiKey) {
            console.log('\n🔐 Remote API Configuration');
            remoteApiKey = await question('Enter Remote API Key (lc_xxx...): ');
            if (!remoteApiKey) {
                console.warn('⚠️  Warning: No API key provided. Remote sync may fail.');
            }
        }

        console.log('\n🤖 Agent Configuration');
        // Menu is built from PROVIDER_IDS (+ a trailing "other") so a new
        // registry entry automatically appears here — no more hand-edited
        // 4-line menu that silently drifts from the registry.
        const agentMap = {};
        const agentMenuLines = PROVIDER_IDS.map((id, i) => {
            const num = String(i + 1);
            agentMap[num] = id;
            const provider = PROVIDERS[id];
            const alias = provider.aliases?.[0] ? ` (${provider.aliases[0]})` : '';
            const note = provider.retired ? ' (retired — use antigravity)' : (id === 'claude' ? '  (recommended)' : '');
            return `  [${num}] ${id}${alias}${note}`;
        });
        const otherNum = String(PROVIDER_IDS.length + 1);
        agentMap[otherNum] = 'other';
        agentMenuLines.push(`  [${otherNum}] other`);
        const agentMenu = agentMenuLines.join('\n');

        const agentChoice = await question(`
Primary AI agent:
${agentMenu}
Choice [1]: `) || '1';
        const primaryCli = normalizeProviderId(agentMap[agentChoice] || 'claude');
        if (PROVIDERS[primaryCli]?.retired) {
            console.warn(`⚠️  ${PROVIDERS[primaryCli].retiredMessage}`);
            console.warn(`   Continuing with ${primaryCli}; switch later with: lc config project.primary.cli antigravity`);
        }
        const primaryModel = await question(`Primary model [default]: `) || null;

        const secondaryYN = await question(`Add a secondary (fallback) agent? (y/n) [y]: `);
        let secondary = null;
        if (secondaryYN.toLowerCase() !== 'n') {
            const defaultSecCli = primaryCli === 'claude' ? 'antigravity' : 'claude';
            const defaultSecNum = Object.keys(agentMap).find(k => agentMap[k] === defaultSecCli) || '1';
            const secChoice = await question(`
Secondary AI agent:
${agentMenu}
Choice [${defaultSecNum}]: `) || defaultSecNum;
            const secCli = normalizeProviderId(agentMap[secChoice] || defaultSecCli);
            if (PROVIDERS[secCli]?.retired) {
                console.warn(`⚠️  ${PROVIDERS[secCli].retiredMessage}`);
                console.warn(`   Continuing with ${secCli}; switch later with: lc config project.secondary.cli antigravity`);
            }
            const secModel = await question(`Secondary model [default]: `) || null;
            secondary = { cli: secCli, model: secModel || null };
        }

        console.log('\n⚙️  Project Settings');
        const qgYN = await question(`Enable Quality Gate lane? (y/n) [y]: `);
        const createQualityGate = qgYN.toLowerCase() !== 'n';

        const devCmd = await question(`Dev server command (optional, e.g. "npm run dev"): `) || null;
        const devUrl = devCmd ? (await question(`Dev server URL [http://localhost:3000]: `) || 'http://localhost:3000') : null;

        const config = {
            mode,
            project: {
                name,
                id: null,
                git_remote: remoteUrl,
                repo_path: process.cwd(),
                create_quality_gate: createQualityGate,
                primary: { cli: primaryCli, model: primaryModel || null },
                secondary,
                dev: devCmd ? { command: devCmd, url: devUrl } : undefined
            },
            collectors
        };

        if (mode === 'local-api') {
            config.db = { ...dbConfig };
            delete config.db.password; // Store password only in .env
        }

        writeFileSync('.laneconductor.json', JSON.stringify(config, null, 2) + '\n');
        console.log('✅ .laneconductor.json created');

        // Create skill symlink so the AI agent can find the skill
        console.log('🔗 Symlinking LaneConductor skill...');
        try {
            const skillDir = existsSync(RC_FILE) ? readFileSync(RC_FILE, 'utf8').trim() : join(getInstallPath(), '.claude/skills/laneconductor');
            const targetDir = '.claude/skills';
            if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true });
            const targetPath = join(targetDir, 'laneconductor');
            
            if (existsSync(targetPath)) unlinkSync(targetPath);
            spawnSync('ln', ['-sf', skillDir, targetPath]);
            console.log(`✅ Skill symlinked → ${targetPath}`);
        } catch (e) {
            console.warn(`⚠️  Could not symlink skill: ${e.message}`);
        }

        // Create Antigravity workspace skill symlink so Antigravity agent can use custom skills
        console.log('🔗 Symlinking Antigravity workspace skill...');
        try {
            const skillDir = existsSync(RC_FILE) ? readFileSync(RC_FILE, 'utf8').trim() : join(getInstallPath(), '.claude/skills/laneconductor');
            const targetDir = '.agents/skills';
            if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true });
            const targetPath = join(targetDir, 'laneconductor');
            
            if (existsSync(targetPath)) {
                try { unlinkSync(targetPath); } catch (ex) {}
            }
            spawnSync('ln', ['-sf', skillDir, targetPath]);
            console.log(`✅ Antigravity workspace skill symlinked → ${targetPath}`);
        } catch (e) {
            console.warn(`⚠️  Could not symlink Antigravity skill: ${e.message}`);
        }

        // Create Antigravity rule symlink so Antigravity agent can use LaneConductor rules
        console.log('🔗 Symlinking Antigravity workspace rule...');
        try {
            const ruleSrc = join(getInstallPath(), '.agents/rules/laneconductor.md');
            const targetDir = '.agents/rules';
            if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true });
            const targetPath = join(targetDir, 'laneconductor.md');
            
            if (existsSync(targetPath)) {
                try { unlinkSync(targetPath); } catch (ex) {}
            }
            spawnSync('ln', ['-sf', ruleSrc, targetPath]);
            console.log(`✅ Antigravity workspace rule symlinked → ${targetPath}`);
        } catch (e) {
            console.warn(`⚠️  Could not symlink Antigravity rule: ${e.message}`);
        }


        // Update .env
        let envContent = '';
        if (existsSync('.env')) envContent = readFileSync('.env', 'utf8');

        if (dbConfig.password) {
            if (envContent.includes('DB_PASSWORD=')) {
                envContent = envContent.replace(/DB_PASSWORD=.*/, `DB_PASSWORD=${dbConfig.password}`);
            } else {
                envContent += `\nDB_PASSWORD=${dbConfig.password}\n`;
            }
        }
        if (cloudToken || remoteApiKey) {
            const token = cloudToken || remoteApiKey;
            const cloudIdx = collectors.findIndex(c => c.url.includes('laneconductor.com') || c.url.includes('api.laneconductor.com'));
            if (cloudIdx !== -1) {
                const key = `COLLECTOR_${cloudIdx}_TOKEN`;
                if (envContent.includes(`${key}=`)) {
                    envContent = envContent.replace(new RegExp(`${key}=.*`), `${key}=${token}`);
                } else {
                    envContent += `\n${key}=${token}\n`;
                }
            }
        }
        if (remoteApiKey && !cloudToken && mode === 'remote-api') {
            // Store remote API key for remote-api mode
            const remoteIdx = collectors.findIndex(c => !c.url.includes('localhost') && !c.url.includes('127.0.0.1'));
            if (remoteIdx !== -1) {
                const key = `COLLECTOR_${remoteIdx}_TOKEN`;
                if (envContent.includes(`${key}=`)) {
                    envContent = envContent.replace(new RegExp(`${key}=.*`), `${key}=${remoteApiKey}`);
                } else {
                    envContent += `\n${key}=${remoteApiKey}\n`;
                }
            }
        }
        if (envContent.trim()) writeFileSync('.env', envContent.trim() + '\n');

        if (!existsSync('.gitignore')) {
            writeFileSync('.gitignore', '.env\n.laneconductor.json\n');
        } else {
            const gitignore = readFileSync('.gitignore', 'utf8');
            if (!gitignore.includes('.env')) appendFileSync('.gitignore', '\n.env\n');
            if (!gitignore.includes('.laneconductor.json')) appendFileSync('.gitignore', '.laneconductor.json\n');
        }

        // Register project in DB for local-api mode
        if (mode === 'local-api') {
            try {
                const { createRequire } = await import('module');
                const require = createRequire(import.meta.url);
                const pg = require('pg');
                const pool = new pg.Pool({
                    host: dbConfig.host,
                    port: dbConfig.port,
                    database: dbConfig.name,
                    user: dbConfig.user,
                    password: dbConfig.password,
                });
                const result = await pool.query(
                    `INSERT INTO projects (name, repo_path, mode, git_remote, primary_cli, primary_model, secondary_cli, secondary_model, create_quality_gate, dev_command, dev_url)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                     ON CONFLICT (repo_path) DO UPDATE SET
                       name = EXCLUDED.name,
                       mode = EXCLUDED.mode,
                       git_remote = EXCLUDED.git_remote,
                       primary_cli = EXCLUDED.primary_cli,
                       primary_model = EXCLUDED.primary_model,
                       secondary_cli = EXCLUDED.secondary_cli,
                       secondary_model = EXCLUDED.secondary_model,
                       create_quality_gate = EXCLUDED.create_quality_gate,
                       dev_command = EXCLUDED.dev_command,
                       dev_url = EXCLUDED.dev_url
                     RETURNING id`,
                    [
                        name, process.cwd(), mode, remoteUrl,
                        primaryCli, primaryModel || null,
                        secondary?.cli || null, secondary?.model || null,
                        createQualityGate, devCmd, devUrl
                    ]
                );
                const projectId = result.rows[0]?.id;
                if (projectId) {
                    config.project.id = projectId;
                    writeFileSync('.laneconductor.json', JSON.stringify(config, null, 2) + '\n');
                    console.log(`✅ Project registered in DB (id: ${projectId})`);
                }
                await pool.end();
            } catch (e) {
                console.log(`⚠️  DB registration failed: ${e.message}`);
                console.log(`   Verify your DB settings and run "lc setup" again, or "lc start" later.`);
            }
        }

        console.log('\n✨ Manual setup complete!');

        // ── Scaffold Brainstorm Loop ────────────────────────────────────────
        console.log('\n📦 Scanning project to prepare scaffolding context...\n');

        // Quick project scan — no AI needed
        const scanSnippets = [];

        if (existsSync('package.json')) {
            try {
                const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
                const deps = Object.keys({ ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) }).join(', ');
                scanSnippets.push(`package.json: name="${pkg.name}", description="${pkg.description || ''}", deps: ${deps.slice(0, 400)}`);
            } catch {}
        }
        for (const f of ['README.md', 'readme.md']) {
            if (existsSync(f)) {
                scanSnippets.push(`README (first 600 chars): ${readFileSync(f, 'utf8').slice(0, 600)}`);
                break;
            }
        }
        const frameworkSignals = ['next.config.js', 'next.config.ts', 'nuxt.config.ts', 'vite.config.ts', 'svelte.config.js', 'astro.config.mjs', 'angular.json', 'Cargo.toml', 'go.mod', 'pyproject.toml', 'requirements.txt', 'setup.py'].filter(f => existsSync(f));
        if (frameworkSignals.length) scanSnippets.push(`Framework signals: ${frameworkSignals.join(', ')}`);

        const testSignals = ['jest.config.js', 'jest.config.ts', 'vitest.config.ts', 'pytest.ini', 'tests/', 'test/', '__tests__/'].filter(f => existsSync(f));
        if (testSignals.length) scanSnippets.push(`Test setup: ${testSignals.join(', ')}`);

        const ciSignals = ['.github/workflows', '.gitlab-ci.yml', '.circleci/config.yml', 'Jenkinsfile'].filter(f => existsSync(f));
        if (ciSignals.length) scanSnippets.push(`CI: ${ciSignals.join(', ')}`);

        const hasExistingCode = frameworkSignals.length > 0 || existsSync('src') || existsSync('app') || existsSync('lib');
        console.log(`   Project: ${name}${hasExistingCode ? ' (existing codebase detected)' : ' (new project)'}`);
        if (frameworkSignals.length) console.log(`   ✅ ${frameworkSignals.join(', ')}`);
        if (testSignals.length) console.log(`   ✅ Tests: ${testSignals.join(', ')}`);
        if (ciSignals.length) console.log(`   ✅ CI: ${ciSignals.join(', ')}`);

        // Brainstorm loop for scaffold
        const scaffoldHistory = [];

        const buildScaffoldPrompt = (userMessage) => {
            const ctx = `You are helping set up a LaneConductor project context. You need to understand the project well enough to generate these files:
- conductor/product.md        (what the product does, who uses it, key features)
- conductor/tech-stack.md     (languages, frameworks, databases, infra)
- conductor/workflow.md       (how development works — commits, branches, reviews, testing)
- conductor/product-guidelines.md  (brand, style, UX principles)
- conductor/kpis.md           (north-star metrics — 2-3 measurable targets with time horizons)

Project: ${name}
Git remote: ${remoteUrl || 'none'}
Has existing code: ${hasExistingCode}

Scan findings:
${scanSnippets.join('\n')}

Your job:
1. Propose what the content of each context file should be based on what you can infer
2. Ask about anything you can't infer (one question at a time)
3. Always ask: "What does success look like? What are your 2-3 north-star metrics and rough targets?" (e.g. "500 signups by Q2", "1000 DAUs", "HN front page")
4. When you have enough to generate all 5 files, end with:
   "✅ Ready to generate context files."

Keep responses concise. If the project has existing code, infer as much as possible before asking.`;

            const history = scaffoldHistory.map(m =>
                `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`
            ).join('\n\n');

            return history
                ? `${ctx}\n\n--- Conversation ---\n${history}\n\nUser: ${userMessage}`
                : `${ctx}\n\nUser: ${userMessage}`;
        };

        const initialMsg = hasExistingCode
            ? `I have an existing codebase. Based on the scan above, what can you infer about this project, and what questions do you have before generating the context files?`
            : `This is a new project called "${name}". Please ask me what you need to know to generate the context files.`;

        console.log('\n🤖 Analysing project...\n');
        let scaffoldLLMResponse = await callLLMConversational(config, buildScaffoldPrompt(initialMsg));
        scaffoldHistory.push({ role: 'user', content: initialMsg });
        scaffoldHistory.push({ role: 'assistant', content: scaffoldLLMResponse });

        while (true) {
            console.log('\n─────────────────────────────────────────────────────');
            const next = (await question('   [Enter] Generate context files   [r] Refine   [q] Skip\n   > ')).trim();

            if (!next || next.toLowerCase() === 'g') break;
            if (next.toLowerCase() === 'q') {
                console.log('   Skipping scaffold — run "/laneconductor setup scaffold" manually in your AI editor.');
                rl.close();
                process.exit(0);
            }
            const refinement = next.toLowerCase() === 'r'
                ? (await question('   Your answer or change > ')).trim()
                : next;

            if (!refinement) break;
            scaffoldHistory.push({ role: 'user', content: refinement });
            console.log('\n🤖 Thinking...\n');
            scaffoldLLMResponse = await callLLMConversational(config, buildScaffoldPrompt(refinement));
            scaffoldHistory.push({ role: 'assistant', content: scaffoldLLMResponse });
        }

        // Write scaffold context and run generation
        const scaffoldContext = {
            project: { name, git_remote: remoteUrl, has_existing_code: hasExistingCode },
            scan: scanSnippets,
            brainstorm_summary: scaffoldHistory.map(m => `${m.role}: ${m.content}`).join('\n\n'),
        };
        if (!existsSync('conductor')) mkdirSync('conductor', { recursive: true });
        const scaffoldContextPath = 'conductor/.setup-scaffold-context.json';
        writeFileSync(scaffoldContextPath, JSON.stringify(scaffoldContext, null, 2));

        console.log('\n🤖 Generating context files...\n');
        const exitCode = await runAIAgent(config, '/laneconductor setup scaffold generate');

        try { unlinkSync(scaffoldContextPath); } catch {}

        if (exitCode === 0) {
            console.log('\n✅ Setup and Scaffolding complete!');
        } else {
            console.log('\n⚠️  AI Scaffolding failed or was interrupted.');
            console.log('   Run "/laneconductor setup scaffold" manually in your AI editor.');
        }

        console.log('\nNext steps:');
        console.log('  1. Run "lc ui start" to open the shared Kanban dashboard (once per machine).');
        console.log('  2. Run "lc start" to begin the project heartbeat worker.');
        console.log('  3. Create your first track with "lc new".');

        const deployYN = await question(`\nWould you like to configure the deployment stack now? (lc setup-deploy) (y/n) [n]: `);
        if (deployYN.toLowerCase() === 'y') {
            rl.close();
            // setup-deploy has its own rl2 instance
            spawnSync(process.execPath, [process.argv[1], 'setup-deploy'], { stdio: 'inherit' });
        } else {
            rl.close();
        }
    }

    runSetup();
} else if (command === 'setup-deploy') {
    if (!projectRoot) {
        console.error('❌ Error: No LaneConductor project found in this directory or parents.');
        process.exit(1);
    }

    const cfgPath = join(projectRoot, '.laneconductor.json');
    if (!existsSync(cfgPath)) {
        console.error('❌ Error: No .laneconductor.json found. Run "lc setup" first.');
        process.exit(1);
    }
    const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));

    const rl2 = createInterface({ input: process.stdin, output: process.stdout });
    const ask = (prompt) => new Promise(resolve => rl2.question(prompt, resolve));

    // ── Phase 1: Scan ──────────────────────────────────────────────────────
    console.log('\n🔍 Scanning project for deployment signals...\n');
    const scanTargets = [
        { path: 'deploy.sh',                  label: 'deploy.sh' },
        { path: 'infra/deploy.sh',             label: 'infra/deploy.sh' },
        { path: 'Dockerfile',                  label: 'Dockerfile' },
        { path: 'firebase.json',               label: 'firebase.json (Firebase Hosting)' },
        { path: 'vercel.json',                 label: 'vercel.json (Vercel)' },
        { path: '.github/workflows',           label: '.github/workflows/ (CI/CD)' },
        { path: 'terraform',                   label: 'terraform/ (IaC)' },
        { path: 'infra',                       label: 'infra/ (infra scripts)' },
        { path: 'Makefile',                    label: 'Makefile' },
        { path: 'serverless.yml',              label: 'serverless.yml (AWS Serverless)' },
        { path: 'fly.toml',                    label: 'fly.toml (Fly.io)' },
    ];
    const found = scanTargets.filter(t => existsSync(join(projectRoot, t.path)));
    if (found.length > 0) {
        found.forEach(t => console.log(`   ✅ ${t.label}`));
    } else {
        console.log('   (no existing deployment files found — starting fresh)');
    }

    // ── Phase 2: Infer defaults ────────────────────────────────────────────
    const has = (p) => found.some(t => t.path === p);
    const defaultFrontend = has('firebase.json') ? 'Firebase Hosting' : has('vercel.json') ? 'Vercel' : 'none';
    const defaultBackend  = has('Dockerfile') ? 'GCP Cloud Run' : has('serverless.yml') ? 'AWS Lambda' : has('fly.toml') ? 'Fly.io' : 'none';
    const existingDeployScript = has('infra/deploy.sh') ? 'bash infra/deploy.sh' : has('deploy.sh') ? 'bash deploy.sh' : null;

    // ── Phase 3: Q&A ──────────────────────────────────────────────────────
    console.log('\n🧩 Let\'s configure your deployment stack.\n');
    console.log('   (Press Enter to accept the default shown in brackets)\n');

    const frontend = (await ask(`   Frontend     [${defaultFrontend}]: `)).trim() || defaultFrontend;
    const backend  = (await ask(`   Backend      [${defaultBackend}]: `)).trim()  || defaultBackend;
    const db       = (await ask(`   Database     [Cloud SQL]: `)).trim() || 'Cloud SQL';
    const secrets  = (await ask(`   Secrets      [GCP Secret Manager]: `)).trim() || 'GCP Secret Manager';

    const envInput = (await ask('\n   Environments (comma-separated) [prod,staging]: ')).trim() || 'prod,staging';
    const environments = envInput.split(',').map(e => e.trim()).filter(Boolean);

    let deployCmd = existingDeployScript;
    if (existingDeployScript) {
        const useExisting = (await ask(`\n   Deploy script found: "${existingDeployScript} <env>"  Use it? [Y/n]: `)).trim();
        if (useExisting.toLowerCase() === 'n') {
            deployCmd = (await ask('   Custom deploy command (env appended): ')).trim() || existingDeployScript;
        }
    } else {
        const customCmd = (await ask('\n   Deploy command (leave blank to let AI generate): ')).trim();
        if (customCmd) deployCmd = customCmd;
    }

    const hasGHActions = has('.github/workflows');
    let wantCICD;
    if (hasGHActions) {
        const keep = (await ask('\n   GitHub Actions workflow already exists. Keep CI/CD? [Y/n]: ')).trim();
        wantCICD = keep.toLowerCase() !== 'n';
    } else {
        const add = (await ask('\n   Set up GitHub Actions CI/CD pipeline? [y/N]: ')).trim();
        wantCICD = add.toLowerCase() === 'y';
    }

    // ── Phase 4: Credential verification ──────────────────────────────────
    console.log('\n🔒 Verifying credentials...\n');
    const credResults = {};

    const needsGCP = [frontend, backend, secrets].some(v => v.toLowerCase().includes('gcp') || v.toLowerCase().includes('firebase') || v.toLowerCase().includes('cloud run') || v.toLowerCase().includes('cloud sql'));
    const needsFirebase = frontend.toLowerCase().includes('firebase');
    const needsAWS = [frontend, backend, secrets].some(v => v.toLowerCase().includes('aws') || v.toLowerCase().includes('lambda'));
    const needsVercel = [frontend, backend].some(v => v.toLowerCase().includes('vercel'));
    const needsSupabase = [db, secrets].some(v => v.toLowerCase().includes('supabase'));

    if (needsGCP) {
        const r = spawnSync('gcloud', ['auth', 'list', '--format=value(account)', '--filter=status=ACTIVE'], { encoding: 'utf8' });
        const account = r.status === 0 && r.stdout.trim() ? r.stdout.trim().split('\n')[0] : null;
        credResults.gcp = account ? `verified (${account})` : 'NOT CONFIGURED';
        console.log(`   GCP ADC      → ${account ? '✅ ' + account : '❌ run: gcloud auth application-default login'}`);
    }
    if (needsFirebase) {
        const r = spawnSync('firebase', ['projects:list', '--json'], { encoding: 'utf8' });
        credResults.firebase = r.status === 0 ? 'verified' : 'NOT CONFIGURED';
        console.log(`   Firebase CLI → ${r.status === 0 ? '✅ verified' : '❌ run: firebase login'}`);
    }
    if (needsAWS) {
        const r = spawnSync('aws', ['sts', 'get-caller-identity', '--output', 'text'], { encoding: 'utf8' });
        credResults.aws = r.status === 0 ? `verified (${r.stdout.trim().split('\t')[1] || 'ok'})` : 'NOT CONFIGURED';
        console.log(`   AWS          → ${r.status === 0 ? '✅ ' + credResults.aws : '❌ run: aws configure'}`);
    }
    if (needsVercel) {
        const r = spawnSync('vercel', ['whoami'], { encoding: 'utf8' });
        credResults.vercel = r.status === 0 ? `verified (${r.stdout.trim()})` : 'NOT CONFIGURED';
        console.log(`   Vercel CLI   → ${r.status === 0 ? '✅ ' + r.stdout.trim() : '❌ run: vercel login'}`);
    }
    if (needsSupabase) {
        const r = spawnSync('supabase', ['projects', 'list'], { encoding: 'utf8' });
        credResults.supabase = r.status === 0 ? 'verified' : 'NOT CONFIGURED';
        console.log(`   Supabase CLI → ${r.status === 0 ? '✅ verified' : '❌ run: supabase login'}`);
    }

    // ── Phase 5: Brainstorm loop — LLM advises, user refines until ready ──
    const conversationHistory = [];
    let finalComponents = { frontend, backend, db, secrets };
    let finalDeployCmd = deployCmd;
    let finalEnvironments = environments;
    let finalWantCICD = wantCICD;

    const buildBrainstormPrompt = (userMessage) => {
        const systemCtx = `You are a deployment configuration assistant helping a developer finalize their deployment stack for a software project.

Project scan found: ${found.map(t => t.label).join(', ') || 'no existing deploy files'}.

Current configuration being discussed:
- Frontend:     ${finalComponents.frontend}
- Backend:      ${finalComponents.backend}
- Database:     ${finalComponents.db}
- Secrets:      ${finalComponents.secrets}
- Environments: ${finalEnvironments.join(', ')}
- Deploy cmd:   ${finalDeployCmd || '(to be generated)'}
- CI/CD:        ${finalWantCICD ? 'yes' : 'no'}
- Credentials:  ${JSON.stringify(credResults)}

Your job:
1. Answer any questions embedded in the user's input (e.g. "can I use X with Y?")
2. Clarify or recommend a better approach if something is unclear or unusual
3. Make sure to ask about IaC (infrastructure as code): does the user use Terraform, a plain deploy script, or nothing? If a deploy script was found, confirm whether it's sufficient or if IaC is wanted.
4. Propose a clear final configuration summary at the end
5. Keep it concise — bullet points preferred

CRITICAL RULES:
- When you say "✅ Configuration looks good. Ready to generate files." — STOP. Do not add any follow-up questions or options after that line. The user will press Enter to proceed.
- Focus ONLY on what is needed for LOCAL deployment (the user will run "lc deploy" locally). Do NOT suggest setting up CI/CD, Terraform, or remote pipelines unless the user explicitly asks.
- The goal is to document the EXISTING deployment setup, not to design a new one.

If the configuration looks complete and sensible, end your message with EXACTLY this line and nothing else after it:
"✅ Configuration looks good. Ready to generate files."

If something needs clarification, ask ONE question.`;

        const history = conversationHistory.map(m =>
            `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`
        ).join('\n\n');

        return history
            ? `${systemCtx}\n\n--- Conversation so far ---\n${history}\n\nUser: ${userMessage}`
            : `${systemCtx}\n\nUser: ${userMessage}`;
    };

    // First brainstorm call — summarize what we collected and ask AI to advise
    const initialSummary = `Here's what I've configured so far:
- Frontend: ${frontend}
- Backend: ${backend}
- Database: ${db}
- Secrets: ${secrets}
- Environments: ${environments.join(', ')}
- Deploy command: ${deployCmd || 'not set'}
- CI/CD: ${wantCICD ? 'yes' : 'no'}

Goal: document this as a LOCAL deployment setup so "lc deploy prod" runs the deploy script locally. No CI/CD unless I asked for it.

Please review this, answer any questions (some fields may contain questions rather than clean values), ask about IaC if relevant, and propose the final configuration.`;

    console.log('\n🤖 Consulting AI...\n');
    let llmResponse = await callLLMConversational(cfg, buildBrainstormPrompt(initialSummary));
    conversationHistory.push({ role: 'user', content: initialSummary });
    conversationHistory.push({ role: 'assistant', content: llmResponse });

    // Brainstorm loop
    while (true) {
        console.log('\n─────────────────────────────────────────────────────');
        const next = (await ask('   [Enter] Generate files   [r] Refine   [q] Quit\n   > ')).trim();

        if (!next || next.toLowerCase() === 'g') {
            break; // proceed to generate
        }
        if (next.toLowerCase() === 'q') {
            console.log('   Cancelled.');
            rl2.close();
            process.exit(0);
        }
        // Any other input = refine
        const refinement = next.startsWith('r') && next.length === 1
            ? (await ask('   What would you like to change or ask? > ')).trim()
            : next;

        if (!refinement) break;

        conversationHistory.push({ role: 'user', content: refinement });
        console.log('\n🤖 Thinking...\n');
        llmResponse = await callLLMConversational(cfg, buildBrainstormPrompt(refinement));
        conversationHistory.push({ role: 'assistant', content: llmResponse });
    }

    // ── Phase 6: Write context and generate files ─────────────────────────
    const filesToCreate = ['conductor/deployment-stack.md', 'conductor/deploy.json', '.env.example'];
    if (finalWantCICD && !hasGHActions) filesToCreate.push('.github/workflows/deploy.yml');

    rl2.close();

    const setupContext = {
        components: finalComponents,
        environments: finalEnvironments,
        deploy_command: finalDeployCmd,
        cicd: finalWantCICD,
        credentials: credResults,
        existing_signals: found.map(t => t.label),
        files_to_create: filesToCreate,
        brainstorm_summary: conversationHistory.map(m => `${m.role}: ${m.content}`).join('\n\n'),
    };

    const conductorDir = join(projectRoot, 'conductor');
    if (!existsSync(conductorDir)) mkdirSync(conductorDir, { recursive: true });
    const contextPath = join(conductorDir, '.setup-deploy-context.json');
    writeFileSync(contextPath, JSON.stringify(setupContext, null, 2));

    console.log('\n🤖 Generating deployment files...\n');
    const exitCode = await runAIAgent(cfg, '/laneconductor setup-deploy generate');

    try { unlinkSync(contextPath); } catch {}
    process.exit(exitCode || 0);
} else if (command === 'deploy') {
    if (!projectRoot) {
        console.error('❌ Error: No LaneConductor project found in this directory or parents.');
        process.exit(1);
    }

    const env = args[1] && !args[1].startsWith('-') ? args[1] : 'prod';
    const buildIdx = args.indexOf('--build') !== -1 ? args.indexOf('--build') : args.indexOf('-b');
    const buildId = buildIdx !== -1 && args[buildIdx + 1] ? args[buildIdx + 1] : null;

    let extraEnv = {};
    if (buildId) {
        const build = getBuildById(projectRoot, buildId);
        if (!build) {
            console.error(`❌ Error: Build artifact '${buildId}' not found in conductor/builds/`);
            process.exit(1);
        }
        extraEnv = {
            CONDUCTOR_BUILD_ID: build.id,
            CONDUCTOR_BUILD_COMMIT: build.git?.commit || '',
            CONDUCTOR_BUILD_TRACKS: (build.tracks || []).join(',')
        };
        console.log(`📦 Attached Build Artifact: ${build.id} (${build.git?.shortCommit || 'unknown'})`);
    }

    (async () => {
        const result = await runDeploy(projectRoot, env, { echo: true, extraEnv });
        if (!result.ok) {
            console.error(`❌ Error: ${result.error || `Deployment stopped at step: ${result.failedStep}`}`);
            if (result.logFile) console.log(`   Logs: ${result.logFile}`);
            process.exit(result.exitCode ?? 1);
        }
        console.log(`   Logs: ${result.logFile}`);
        process.exit(0);
    })();
} else if (command === 'build') {
    if (!projectRoot) {
        console.error('❌ Error: No LaneConductor project found in this directory or parents.');
        process.exit(1);
    }
    try {
        console.log('📦 Generating release build artifact...');
        const build = createBuildArtifact(projectRoot, { createdBy: process.env.USER || 'cli' });
        console.log(`\n✅ Build artifact created successfully: ${build.id}`);
        console.log(`   Git Commit: ${build.git.shortCommit} (${build.git.branch})`);
        console.log(`   Tracks included: ${build.tracks.length ? build.tracks.join(', ') : 'none'}`);
        console.log(`   Location: conductor/builds/${build.id}.json\n`);
    } catch (err) {
        console.error(`❌ Error creating build: ${err.message}`);
        process.exit(1);
    }
} else if (command === 'builds') {
    if (!projectRoot) {
        console.error('❌ Error: No LaneConductor project found in this directory or parents.');
        process.exit(1);
    }
    const builds = getBuilds(projectRoot);
    if (builds.length === 0) {
        console.log('No build artifacts found in conductor/builds/. Run "lc build" to create one.');
    } else {
        console.log(`\n📦 Build Artifacts (${builds.length}):\n`);
        for (const b of builds) {
            console.log(`  • ${b.id} — ${b.createdAt} [git: ${b.git.shortCommit} @ ${b.git.branch}] (${b.tracks.length} tracks)`);
        }
        console.log('');
    }
} else if (command === 'start') {
    if (!projectRoot) {
        console.error('❌ Error: No LaneConductor project found in this directory or parents.');
        console.error('   Run "lc setup" to initialize a project.');
        process.exit(1);
    }

    // F17 (track 1102): findProjectRoot() walks up from cwd looking for a
    // conductor/ dir — a linked worktree satisfies that just as well as
    // the primary checkout, so `lc worker start` run from inside one spawns
    // a worker pointed at THAT worktree's own (possibly very stale) copy of
    // laneconductor.sync.mjs, with its pidfile/logfile scattered there too.
    // Confirmed live: a worker spawned this way was still running its
    // worktree's pre-fix code hours later, silently recreating the exact
    // nested-worktree bug fixed earlier the same day. Every artifact this
    // command creates (pidfile, logfile, the spawned process's own cwd, the
    // script it runs) must agree on ONE root regardless of where `lc` was
    // invoked from — same fix pattern as createWorktree/removeWorktree.
    const workerRoot = resolvePrimaryRepoRoot(projectRoot);

    // Track 1091 Phase 2: --manager is a machine-level singleton — checked
    // against a global pidfile, not the per-project/per-worker-number one
    // below, and --worker-number is meaningless for it (there's only ever
    // one manager per machine), so it's deliberately not read in this branch.
    const isManager = args.includes('--manager');

    const workerNumber = isManager ? 1 : resolveWorkerNumber(args);
    const pidFile = isManager ? getManagerPidFilePath() : getPidFilePath(workerRoot, workerNumber);
    const logFile = isManager
        ? join(workerRoot, 'conductor', '.manager.log')
        : join(workerRoot, 'conductor', workerNumber === 1 ? '.sync.log' : `.sync-${workerNumber}.log`);

    const existingPid = getRunningWorkerPid(pidFile);
    if (existingPid) {
        if (isManager) {
            console.log(`❌ Manager worker already running on this machine (PID: ${existingPid}).`);
            console.log(`   Use "lc worker stop --manager" first if you want to replace it.`);
            process.exit(1);
        }
        console.log(`⚠️  Worker #${workerNumber} already running for this project (PID: ${existingPid}).`);
        console.log(`   Use "lc restart${workerNumber === 1 ? '' : ' --worker-number ' + workerNumber}" to replace it, or "lc stop" then "lc start".`);
        process.exit(0);
    }

    // Track 1091 Phase 2 Task 4 (spec.md REQ-2b): --projects-dir persists
    // across restarts so it only needs to be passed once; passing it again
    // updates the stored value. laneconductor.sync.mjs reads this same file
    // directly when it actually needs it (Phase 3, resolving a git-clone
    // target for create-project).
    if (isManager) {
        const projectsDirIdx = args.indexOf('--projects-dir');
        const managerConfig = readManagerConfig();
        if (projectsDirIdx !== -1) {
            managerConfig.projectsDir = args[projectsDirIdx + 1];
            writeManagerConfig(managerConfig);
            console.log(`📁 Manager projects directory set to: ${managerConfig.projectsDir}`);
        } else if (managerConfig.projectsDir) {
            console.log(`📁 Manager projects directory (from previous run): ${managerConfig.projectsDir}`);
        } else {
            console.log(`⚠️  No projects directory configured — a create-project dispatch cloning a git repo will fail until you run "lc worker start --manager --projects-dir <path>". Registering an existing local path (repo_source.type: 'path') is unaffected.`);
        }
    }

    const { syncScript, error } = resolveSyncScript(workerRoot);
    if (error) {
        console.error(error);
        process.exit(1);
    }

    const isSyncAndWork = args.includes('--sync-and-work') || args.includes('sync-and-work') || args.includes('sync_and_work');
    console.log(`🚀 Starting LaneConductor heartbeat worker${isManager ? ' [MANAGER]' : ''}${isSyncAndWork ? ' (AUTOMATIC / sync-and-work mode)' : ' (MANUAL / sync-only mode)'}${!isManager && workerNumber !== 1 ? ` [worker #${workerNumber}]` : ''}...`);

    const logFd = openSync(logFile, 'a');
    const syncArgs = [syncScript];
    if (!isSyncAndWork) syncArgs.push('--sync-only');
    if (isManager) {
        syncArgs.push('--manager');
    } else if (workerNumber !== 1) {
        syncArgs.push('--worker-number', String(workerNumber));
    }
    // Track 1109: forward the claim scope. Validation (empty list, missing
    // value, --sync-only conflict) lives in the worker so `lc` and a directly
    // invoked sync.mjs can't disagree about what is legal.
    forwardClaimScopeFlags(args, syncArgs);

    // Track 10011: --cli/--model let this one worker instance run a
    // different provider than project.primary — sync.mjs applies these
    // in-memory only, it never rewrites .laneconductor.json.
    const cliFlagIdx = args.indexOf('--cli');
    if (cliFlagIdx !== -1 && args[cliFlagIdx + 1]) {
        syncArgs.push('--cli', normalizeProviderId(args[cliFlagIdx + 1]));
    }
    const modelFlagIdx = args.indexOf('--model');
    if (modelFlagIdx !== -1 && args[modelFlagIdx + 1]) {
        syncArgs.push('--model', args[modelFlagIdx + 1]);
    }

    const worker = spawn('node', syncArgs, {
        cwd: workerRoot,
        detached: true,
        stdio: ['ignore', logFd, logFd]
    });
    worker.unref();

    // Track 1110 Phase 2 Task 7: `lc start` spawns detached and can't hold
    // a lock itself (see worker-lock.mjs's own comment for why the lock
    // lives in the long-running child, not here) — but it CAN give fast,
    // honest feedback by briefly checking whether the child actually took
    // hold. If another live instance already has this identity's lock, the
    // child exits almost immediately (worker-lock.mjs's own check, near
    // the top of laneconductor.sync.mjs's startup) rather than running —
    // without this check, `lc start` would report success and write a
    // pidfile for a process that's already dead.
    await sleep(750);
    const stillAlive = (() => { try { process.kill(worker.pid, 0); return true; } catch (e) { return false; } })();
    if (!stillAlive) {
        console.log(`❌ Worker failed to start — another live instance already holds this identity's lock (see conductor/${isManager ? '.manager.log' : (workerNumber === 1 ? '.sync.log' : `.sync-${workerNumber}.log`)} for details).`);
        process.exit(1);
    }

    writeFileSync(pidFile, worker.pid.toString());
    console.log(`✅ Worker started (PID: ${worker.pid})`);

    // Track 1075: best-effort — a worker that can't ship logs to the viewer
    // should still start. The log viewer is a LaneConductor-wide singleton
    // (see `lc logs`), so this is safe to call from every project's worker.
    try { spawnSync('node', [__filename, 'logs', 'start'], { stdio: 'ignore' }); } catch (e) { }

    process.exit(0);
} else if (command === 'stop') {
    if (!projectRoot) {
        console.error('❌ Error: No LaneConductor project found in this directory or parents.');
        process.exit(1);
    }

    // F17 (track 1102): must agree with `start`/`restart` on where the
    // pidfile lives, or `lc stop` run from a linked worktree silently
    // looks in the wrong place and reports "no heartbeat running" for a
    // worker that's very much alive.
    const workerRoot = resolvePrimaryRepoRoot(projectRoot);
    const isManager = args.includes('--manager');
    const workerNumber = isManager ? 1 : resolveWorkerNumber(args);
    const pidFile = isManager ? getManagerPidFilePath() : getPidFilePath(workerRoot, workerNumber);
    if (!existsSync(pidFile)) {
        console.log(`⚠️  No heartbeat running (no ${pidFile.split('/').pop()} found)`);
        process.exit(0);
    }

    const pid = readFileSync(pidFile, 'utf8').trim();
    try {
        // Track 1110 Phase 2: must not report success (or delete the
        // pidfile) until the process is actually confirmed dead — the old
        // fire-and-forget `process.kill(pid)` + immediate unlink let a
        // worker still mid-shutdown look "stopped" to a subsequent
        // `lc start`, which then spawned a duplicate.
        await stopAndConfirmDeath(pid);
        if (existsSync(pidFile)) unlinkSync(pidFile);
        console.log(`✅ Worker stopped (PID: ${pid})`);
    } catch (e) {
        console.log(`⚠️  Worker (PID: ${pid}) was not running or could not be stopped: ${e.message}`);
        if (existsSync(pidFile)) unlinkSync(pidFile);
    }
    process.exit(0);
} else if (command === 'restart') {
    if (!projectRoot) {
        console.error('❌ Error: No LaneConductor project found in this directory or parents.');
        process.exit(1);
    }
    // F17 (track 1102): same fix as `start` — resolve the primary checkout
    // once, use it for every artifact this command touches, regardless of
    // which directory (possibly a linked worktree) `lc` was invoked from.
    const workerRoot = resolvePrimaryRepoRoot(projectRoot);
    const isManager = args.includes('--manager');
    const workerNumber = isManager ? 1 : resolveWorkerNumber(args);
    const pidFile = isManager ? getManagerPidFilePath() : getPidFilePath(workerRoot, workerNumber);
    const logFile = isManager
        ? join(workerRoot, 'conductor', '.manager.log')
        : join(workerRoot, 'conductor', workerNumber === 1 ? '.sync.log' : `.sync-${workerNumber}.log`);
    const isSyncAndWork = args.includes('--sync-and-work') || args.includes('sync-and-work') || args.includes('sync_and_work');

    // Resolve the entry script BEFORE touching the running worker — killing it
    // and then failing to spawn a replacement leaves the project with no
    // worker at all, which is strictly worse than refusing to restart
    // (Track 1074: this used to hardcode the per-project path with no
    // canonical fallback, so it always crashed here for projects without a
    // local sync-script copy).
    const { syncScript, error } = resolveSyncScript(workerRoot);
    if (error) {
        console.error(error);
        process.exit(1);
    }

    if (isManager) {
        const projectsDirIdx = args.indexOf('--projects-dir');
        const managerConfig = readManagerConfig();
        if (projectsDirIdx !== -1) {
            managerConfig.projectsDir = args[projectsDirIdx + 1];
            writeManagerConfig(managerConfig);
            console.log(`📁 Manager projects directory set to: ${managerConfig.projectsDir}`);
        } else if (managerConfig.projectsDir) {
            console.log(`📁 Manager projects directory (from previous run): ${managerConfig.projectsDir}`);
        }
    }

    console.log(`🚀 Restarting LaneConductor heartbeat worker${isManager ? ' [MANAGER]' : ''}${isSyncAndWork ? ' (AUTOMATIC / sync-and-work mode)' : ' (MANUAL / sync-only mode)'}${!isManager && workerNumber !== 1 ? ` [worker #${workerNumber}]` : ''}...`);

    if (existsSync(pidFile)) {
        const pid = readFileSync(pidFile, 'utf8').trim();
        // Track 1110 Phase 2: same fix as `stop` — must confirm the old
        // process actually died before spawning its replacement, or the
        // two can briefly coexist sharing one identity.
        try { await stopAndConfirmDeath(pid); } catch (e) { console.log(`⚠️  ${e.message}`); }
        unlinkSync(pidFile);
    }
    // Same as 'start' logic
    const logFd = openSync(logFile, 'a');
    const syncArgs = [syncScript];
    if (!isSyncAndWork) syncArgs.push('--sync-only');
    if (isManager) {
        syncArgs.push('--manager');
    } else if (workerNumber !== 1) {
        syncArgs.push('--worker-number', String(workerNumber));
    }
    // Track 1109: forward the claim scope. Validation (empty list, missing
    // value, --sync-only conflict) lives in the worker so `lc` and a directly
    // invoked sync.mjs can't disagree about what is legal.
    forwardClaimScopeFlags(args, syncArgs);
    const worker = spawn('node', syncArgs, { cwd: workerRoot, detached: true, stdio: ['ignore', logFd, logFd] });
    writeFileSync(pidFile, worker.pid.toString());
    worker.unref();
    console.log(`✅ Worker restarted (PID: ${worker.pid})`);

    try { spawnSync('node', [__filename, 'logs', 'start'], { stdio: 'ignore' }); } catch (e) { }

    process.exit(0);
} else if (command === 'worker') {
    const sub = args[1] || 'status';
    // Forward any flags after the subcommand (e.g. --worker-number, --sync-and-work)
    // through to the underlying legacy command — this used to silently drop them.
    const subArgs = args.slice(2);
    // Track 1091 Phase 2: these used to always process.exit(0) regardless of
    // the forwarded child's actual result — a real, pre-existing bug (found
    // while verifying --manager's "already running" rejection, Task 2:
    // the child correctly exits 1, but the wrapper reported success anyway).
    // Propagate the real exit code for every forwarded subcommand, not just
    // the one this track happened to need.
    if (sub === 'start') { const r = spawnSync('node', [__filename, 'start', ...subArgs], { stdio: 'inherit' }); process.exit(r.status ?? 0); }
    if (sub === 'stop') { const r = spawnSync('node', [__filename, 'stop', ...subArgs], { stdio: 'inherit' }); process.exit(r.status ?? 0); }
    if (sub === 'restart') { const r = spawnSync('node', [__filename, 'restart', ...subArgs], { stdio: 'inherit' }); process.exit(r.status ?? 0); }
    if (sub === 'logs') { const r = spawnSync('node', [__filename, 'logs', 'worker', ...subArgs], { stdio: 'inherit' }); process.exit(r.status ?? 0); }
    if (sub === 'sync') { const r = spawnSync('node', [__filename, 'remote-sync'], { stdio: 'inherit' }); process.exit(r.status ?? 0); }
    // Track 1109 Phase 4: `lc worker run <track>` — the normal way to run a
    // worker. Deliberately a thin wrapper over the scoped path rather than a
    // second implementation, so there is one execution path to reason about.
    // Runs in the FOREGROUND (unlike `start`, which detaches): the point is
    // to watch one track run and get its exit code.
    if (sub === 'run') {
        if (!projectRoot) { console.error('❌ Not inside a LaneConductor project.'); process.exit(1); }
        const tracks = subArgs.filter(a => !a.startsWith('--'));
        if (tracks.length === 0) {
            console.error('Usage: lc worker run <track> [<track> ...]\n\nRuns a worker scoped to those tracks in the foreground and exits when they are done.');
            process.exit(2);
        }
        // F17 (track 1102): same fix as start/restart/stop.
        const workerRoot = resolvePrimaryRepoRoot(projectRoot);
        const { syncScript, error } = resolveSyncScript(workerRoot);
        if (error) { console.error(error); process.exit(1); }
        const runArgs = [syncScript, '--only-tracks', tracks.join(','), '--once'];
        const workerNumber = resolveWorkerNumber(subArgs);
        // Reuse a stable identity — a fresh worker_number each run would mint
        // a new workers row, miss its track_sessions row, and silently
        // cold-start the agent context every time (track 1086 / 1084 Phase 0).
        if (workerNumber !== 1) runArgs.push('--worker-number', String(workerNumber));
        console.log(`🚀 Running worker scoped to track(s) ${tracks.join(', ')} — will exit when done.`);
        const r = spawnSync('node', runArgs, { cwd: workerRoot, stdio: 'inherit' });
        process.exit(r.status ?? 0);
    }
    if (sub === 'status') {
        if (!projectRoot) { process.exit(1); }
        // F17 (track 1102): must agree with start/restart/stop on where the
        // pidfile lives, or this misreports a live worker as stopped when
        // run from inside a linked worktree.
        const workerRoot = resolvePrimaryRepoRoot(projectRoot);
        const isManager = subArgs.includes('--manager');
        const workerNumber = isManager ? 1 : resolveWorkerNumber(subArgs);
        const pidFile = isManager ? getManagerPidFilePath() : getPidFilePath(workerRoot, workerNumber);
        let running = false;
        let pid = null;
        if (existsSync(pidFile)) {
            pid = readFileSync(pidFile, 'utf8').trim();
            try { process.kill(pid, 0); running = true; } catch (e) { unlinkSync(pidFile); }
        }
        console.log(`\n👷 Worker Status${isManager ? ' [MANAGER]' : (workerNumber !== 1 ? ` (#${workerNumber})` : '')}: ${running ? '✅ RUNNING' : '❌ STOPPED'}`);
        if (pid && running) console.log(`   PID: ${pid}`);
        // Track 1102 F6: MANUAL/AUTOMATIC is the user-facing vocabulary
        // (matches WorkersList.jsx in the UI); sync-only/sync+poll is the
        // on-the-wire mechanism name, unchanged. Reflects `worker.mode` from
        // .laneconductor.json — the CONFIGURED default, same fallback the
        // sync worker itself uses (getWorkerModeConfig() in
        // laneconductor.sync.mjs: unset → 'sync+poll'). A running process
        // started with an explicit --sync-and-work/--sync-only override can
        // differ from this at runtime; this is a best-effort display, not a
        // live query of the process's own resolved mode.
        if (!isManager) {
            try {
                const modeCfg = JSON.parse(readFileSync(join(workerRoot, '.laneconductor.json'), 'utf8'));
                const configuredMode = modeCfg.worker?.mode === 'sync-only' ? 'sync-only' : 'sync+poll';
                const label = configuredMode === 'sync-only' ? 'MANUAL' : 'AUTOMATIC';
                console.log(`   Mode: ${label} (${configuredMode})`);
            } catch (e) { /* best-effort display only */ }
        }
        const relativeLog = isManager
            ? 'conductor/.manager.log'
            : (workerNumber === 1 ? 'conductor/.sync.log' : `conductor/.sync-${workerNumber}.log`);
        console.log(`   Log: ${relativeLog}\n`);
        process.exit(0);
    }
    console.error(`❌ Unknown worker command: ${sub}`);
    process.exit(1);
} else if (command === 'api') {
    const subCommand = args[1] || 'start';
    const installPath = getInstallPath();
    const uiDir = join(installPath, 'ui');
    const apiPidFile = join(uiDir, '.api.pid');
    const apiLogFile = join(uiDir, '.api.log');
    // Track 1079: a bare detached spawn stays in whatever cgroup the launching
    // shell is in (e.g. a terminal's vte-spawn-*.scope) — detached/setsid/unref
    // only escapes the shell's process group, not the cgroup. If that cgroup is
    // ever reaped, the child dies with an untraceable SIGKILL. Prefer a real
    // systemd --user service when available; fall back to the old spawn path
    // on macOS / non-systemd Linux.
    const useSystemd = hasSystemdUser();

    if (subCommand === 'start') {
        if (useSystemd) {
            if (isServiceActive()) {
                console.log(`✅ API already running (systemd, PID: ${getServicePid()}) → http://localhost:8091`);
                process.exit(0);
            }
            console.log('🚀 Starting LaneConductor API (systemd --user)...');
            writeUnit(installPath);
            startService();
            const pid = getServicePid();
            if (pid) writeFileSync(apiPidFile, pid.toString());
            if (!enableLinger()) {
                console.log('⚠️  Could not enable linger (loginctl) — service will stop once you fully log out. Run `loginctl enable-linger $USER` manually to fix.');
            }
            console.log(`✅ API started (systemd, PID: ${pid}) → http://localhost:8091`);
            try { spawnSync('node', [__filename, 'logs', 'start'], { stdio: 'ignore' }); } catch (e) { }
            process.exit(0);
        }

        if (existsSync(apiPidFile)) {
            const pid = readFileSync(apiPidFile, 'utf8').trim();
            try {
                process.kill(pid, 0);
                console.log(`✅ API already running (PID: ${pid}) → http://localhost:8091`);
                process.exit(0);
            } catch (e) { /* stale */ }
        }
        console.log('🚀 Starting LaneConductor API...');
        const logFd = openSync(apiLogFile, 'a');
        const api = spawn('node', ['server/index.mjs'], { cwd: uiDir, detached: true, stdio: ['ignore', logFd, logFd] });
        writeFileSync(apiPidFile, api.pid.toString());
        api.unref();
        console.log(`✅ API started (PID: ${api.pid}) → http://localhost:8091`);

        try { spawnSync('node', [__filename, 'logs', 'start'], { stdio: 'ignore' }); } catch (e) { }

        process.exit(0);
    } else if (subCommand === 'stop') {
        if (useSystemd && isServiceActive()) {
            stopService();
            console.log('✅ API stopped (systemd)');
            if (existsSync(apiPidFile)) unlinkSync(apiPidFile);
            process.exit(0);
        }
        if (existsSync(apiPidFile)) {
            const pid = readFileSync(apiPidFile, 'utf8').trim();
            try { process.kill(pid); console.log(`✅ API stopped (PID: ${pid})`); } catch (e) { }
            unlinkSync(apiPidFile);
        }
        process.exit(0);
    }
} else if (command === 'ui') {
    const subCommand = args[1] || 'start';
    const installPath = getInstallPath();
    const uiDir = join(installPath, 'ui');
    const pidFile = join(uiDir, '.ui.pid');
    const apiPidFile = join(uiDir, '.api.pid');

    if (subCommand === 'start') {
        // Start API first if not running
        let apiRunning = false;
        if (existsSync(apiPidFile)) {
            try { process.kill(readFileSync(apiPidFile, 'utf8').trim(), 0); apiRunning = true; } catch (e) { }
        }
        if (!apiRunning) {
            spawnSync('node', [__filename, 'api', 'start'], { stdio: 'inherit' });
        }

        // Start UI
        const uiLogFile = join(uiDir, '.ui.log');
        if (existsSync(pidFile)) {
            const pid = readFileSync(pidFile, 'utf8').trim();
            try {
                process.kill(pid, 0);
                console.log(`✅ UI already running (PID: ${pid}) → http://localhost:8090`);
                process.exit(0);
            } catch (e) { /* stale */ }
        }

        // Track 10019 (REQ-6): `uiDir` already resolves to the primary
        // checkout's `ui/` via getInstallPath()'s REQ-4 fix — verified
        // here rather than assumed, so a future incident's first question
        // ("which checkout is this actually serving?") has a real answer
        // instead of a hopeful comment.
        try {
            const isPrimary = resolvePrimaryRepoRoot(uiDir) === resolve(uiDir);
            console.log(isPrimary
                ? `🚀 Starting Vite UI from ${uiDir} (primary checkout)...`
                : `🚀 ⚠️  Starting Vite UI from ${uiDir} — this is NOT the primary checkout.`);
        } catch {
            console.log(`🚀 Starting Vite UI from ${uiDir}...`);
        }
        const logFd = openSync(uiLogFile, 'a');
        const ui = spawn('npx', ['vite'], {
            cwd: uiDir,
            detached: true,
            stdio: ['ignore', logFd, logFd]
        });

        writeFileSync(pidFile, ui.pid.toString());
        ui.unref();
        console.log(`✅ UI started (PID: ${ui.pid}) → http://localhost:8090`);
        process.exit(0);
    } else if (subCommand === 'stop') {
        // Stop UI
        if (existsSync(pidFile)) {
            const pid = readFileSync(pidFile, 'utf8').trim();
            try { process.kill(pid); console.log(`✅ UI stopped (PID: ${pid})`); } catch (e) { }
            unlinkSync(pidFile);
        }
        // Stop API too
        spawnSync('node', [__filename, 'api', 'stop'], { stdio: 'inherit' });
        process.exit(0);
    }
} else if (command === 'logs') {
    // Track 1075: standalone Pinorama log viewer for the worker + API's own
    // structured logs. Runs as a persistent `pinorama --server` instance
    // (not the documented pipe pattern) because both log sources are
    // detached background daemons, not a single foreground process — see
    // conductor/tracks/1075-pino-logging-worker-and-ui/spec.md. Deliberately
    // on a different port (6201) and storage path than any managed
    // project's own Pinorama (which defaults to port 6200 and a shared
    // tmpdir file), so the two never collide.
    const subCommand = args[1] || 'start';
    const installPath = getInstallPath();
    const LOGS_PORT = process.env.LC_PINORAMA_PORT || '6201';
    const pidFile = join(installPath, '.logs.pid');
    const logFile = join(installPath, '.logs.log');
    const dbPath = join(installPath, '.pinorama.msp');

    if (subCommand === 'start') {
        if (existsSync(pidFile)) {
            const pid = readFileSync(pidFile, 'utf8').trim();
            try {
                process.kill(pid, 0);
                console.log(`✅ Log viewer already running (PID: ${pid}) → http://localhost:${LOGS_PORT}`);
                process.exit(0);
            } catch (e) { /* stale */ }
        }
        console.log('🚀 Starting LaneConductor log viewer...');
        const logFd = openSync(logFile, 'a');
        // Invoke the CLI's entry script directly with `node` rather than via
        // `npx pinorama` — npx (or pinorama-studio's own internals) forks a
        // wrapper whose PID doesn't match the actual listening process, so
        // `stop`'s `process.kill(pid)` killed the wrapper and left the real
        // server orphaned and still holding the port (found while verifying
        // this command). Spawning the script directly makes `viewer.pid` the
        // real, killable process.
        const pinoramaEntry = join(installPath, 'node_modules', 'pinorama-studio', 'cli.mjs');
        const viewer = spawn('node', [
            pinoramaEntry, '--server', '--port', LOGS_PORT,
            '--server-db-path', dbPath,
        ], {
            cwd: installPath,
            detached: true,
            stdio: ['ignore', logFd, logFd],
        });
        writeFileSync(pidFile, viewer.pid.toString());
        viewer.unref();
        console.log(`✅ Log viewer started (PID: ${viewer.pid}) → http://localhost:${LOGS_PORT}`);
        process.exit(0);
    } else if (subCommand === 'stop') {
        if (existsSync(pidFile)) {
            const pid = readFileSync(pidFile, 'utf8').trim();
            try { process.kill(pid); console.log(`✅ Log viewer stopped (PID: ${pid})`); } catch (e) { }
            unlinkSync(pidFile);
        } else {
            console.log('⚠️  No log viewer running (no .logs.pid found)');
        }
        process.exit(0);
    } else if (subCommand === 'status') {
        let running = false;
        let pid = null;
        if (existsSync(pidFile)) {
            pid = readFileSync(pidFile, 'utf8').trim();
            try { process.kill(pid, 0); running = true; } catch (e) { unlinkSync(pidFile); }
        }
        console.log(`\n📊 Log Viewer Status: ${running ? '✅ RUNNING' : '❌ STOPPED'}`);
        if (pid && running) console.log(`   PID: ${pid}`);
        console.log(`   URL: http://localhost:${LOGS_PORT}`);
        console.log(`   Log: ${logFile}\n`);
        process.exit(0);
    } else if (subCommand === 'open') {
        spawnSync('node', [__filename, 'logs', 'start'], { stdio: 'inherit' });
        const url = `http://localhost:${LOGS_PORT}`;
        const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
        try { spawnSync(opener, [url], { stdio: 'ignore' }); } catch (e) { }
        console.log(`📊 Dashboard: ${url}`);
        process.exit(0);
    } else {
        console.error(`❌ Unknown logs command: ${subCommand}`);
        console.error('   Usage: lc logs [start|stop|status|open]');
        process.exit(1);
    }
} else if (command === 'status') {
    if (!projectRoot) {
        console.error('❌ Error: No LaneConductor project found in this directory or parents.');
        process.exit(1);
    }

    const colors = { reset: '\x1b[0m', red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m', dim: '\x1b[2m', bold: '\x1b[1m' };

    const cfgPath = join(projectRoot, '.laneconductor.json');
    const cfg = existsSync(cfgPath) ? JSON.parse(readFileSync(cfgPath, 'utf8')) : {};
    const mode = cfg.mode || 'local-fs';

    if (mode === 'local-fs') {
        const tracksDir = join(projectRoot, 'conductor', 'tracks');
        if (!existsSync(tracksDir)) { console.log('No tracks found.'); process.exit(0); }

        const laneOrder = { 'implement': 1, 'review': 2, 'quality-gate': 3, 'plan': 4, 'backlog': 5, 'done': 6 };
        const getLanePrio = (l) => laneOrder[l.toLowerCase()] || 99;

        const getStatusLabel = (s, retries) => {
            s = (s || 'queue').toLowerCase();
            let label = 'WAIT';
            let color = colors.yellow;
            if (s === 'running') { label = 'RUN '; color = colors.cyan; }
            else if (s === 'failure') { label = 'FAIL'; color = colors.red; }
            else if (s === 'success' || s === 'done') { label = 'DONE'; color = colors.dim; }
            if (retries > 0 && s !== 'success') label += ' (' + retries + ')';
            return color + label.padEnd(8) + colors.reset;
        };

        const tracks = readdirSync(tracksDir).filter(d => /\d+/.test(d)).map(d => {
            const trackPath = join(tracksDir, d);
            const indexPath = join(trackPath, 'index.md');
            if (!existsSync(indexPath)) return null;
            const content = readFileSync(indexPath, 'utf8');
            const title = ((content.match(/^# ([^\n]+)/m) || [])[1] || d).trim();
            const lane = ((content.match(/\*\*Lane\*\*:\s*([^\n]+)/i) || [])[1] || '???').trim();
            const status = ((content.match(/\*\*Lane Status\*\*:\s*([^\n]+)/i) || [])[1] || 'queue').trim();
            const progressStr = ((content.match(/\*\*Progress\*\*:\s*(\d+)%/i) || [])[1] || '0').trim();
            const phase = ((content.match(/\*\*Phase\*\*:\s*([^\n]+)/i) || [])[1] || '').trim();
            const runBy = ((content.match(/\*\*Last Run By\*\*:\s*([^\n]+)/i) || [])[1] || '').trim();
            const retryPath = join(trackPath, '.retry-count');
            const retries = existsSync(retryPath) ? parseInt(readFileSync(retryPath, 'utf8')) : 0;
            // Handle both legacy (NNN-slug) and prefixed (AM-NNN-slug) folder names
            const idMatch = d.match(/^([A-Z]+-)?(\d+)/);
            const id = idMatch ? (idMatch[1] ? `${idMatch[1].slice(0, -1)}-${idMatch[2]}` : idMatch[2]) : d;
            const num = idMatch ? parseInt(idMatch[2], 10) : 0;
            return { id, num, lane, status, progress: parseInt(progressStr), title, phase, retries, runBy: runBy.includes('worker') ? 'W' : (runBy ? 'U' : '') };
        }).filter(t => t !== null);

        tracks.sort((a, b) => {
            const laneDiff = getLanePrio(a.lane) - getLanePrio(b.lane);
            if (laneDiff !== 0) return laneDiff;
            return b.progress - a.progress || a.num - b.num;
        });

        console.log('\n' + colors.bold + 'Track Status (' + mode + '):' + colors.reset);
        console.log('ID       LANE            STATUS    PROG   BY  PHASE/TITLE');
        console.log('-'.repeat(83));
        tracks.forEach(t => {
            const id = t.id.padEnd(8);
            const lane = t.lane.padEnd(15);
            const status = getStatusLabel(t.status, t.retries);
            const prog = (t.progress + '%').padEnd(6);
            const by = (t.runBy || '-').padEnd(3);
            const info = t.phase ? colors.dim + t.phase + ': ' + colors.reset + t.title : t.title;
            console.log(id + ' ' + lane + ' ' + status + ' ' + prog.padEnd(6) + ' ' + by.padEnd(3) + ' ' + info);
        });

        // Worker Health Check
        const pidFile = join(projectRoot, 'conductor', '.sync.pid');
        let running = false;
        if (existsSync(pidFile)) {
            try { process.kill(readFileSync(pidFile, 'utf8').trim(), 0); running = true; } catch (e) { }
        }
        console.log('\n   Worker Status : ' + (running ? colors.green + '✅ Running' : colors.red + '❌ Stopped') + colors.reset);
        console.log('   Active Targets: ' + (cfg.collectors || []).filter(c => c.enabled !== false).length + ' sites connected');

        console.log('');
        process.exit(0);
    } else {
        // Direct Postgres query for local-api mode
        const dbCfg = cfg.db || {};
        const dbHost = process.env.DB_HOST || dbCfg.host || 'localhost';
        const dbPort = process.env.DB_PORT || dbCfg.port || 5432;
        const dbName = process.env.DB_NAME || dbCfg.name || 'laneconductor';
        const dbUser = process.env.DB_USER || dbCfg.user || 'postgres';
        const dbPass = process.env.DB_PASSWORD || dbCfg.password || 'postgres';

        // Normalize path for matching in DB
        const normalizedRoot = projectRoot.replace(/\\/g, '\\\\');

        const sql = `
            SELECT t.track_number as id, t.lane_status as lane, t.lane_action_status as status, 
                   t.progress_percent as progress, t.title, t.current_phase as phase, t.last_updated_by as "runBy"
            FROM tracks t
            JOIN projects p ON p.id = t.project_id
            WHERE p.repo_path = '${normalizedRoot}' OR p.repo_path = '${projectRoot}'
            ORDER BY 
              CASE t.lane_status 
                WHEN 'implement' THEN 1 WHEN 'review' THEN 2 WHEN 'quality-gate' THEN 3 
                WHEN 'plan' THEN 4 WHEN 'backlog' THEN 5 WHEN 'done' THEN 6 ELSE 99 
              END,
              t.progress_percent DESC, t.track_number ASC;
        `;

        try {
            const psql = spawnSync('psql', [
                '-h', dbHost, '-p', dbPort, '-U', dbUser, '-d', dbName, '-t', '-A', '-F', '|', '-c', sql
            ], { env: { ...process.env, PGPASSWORD: dbPass } });

            if (psql.status === 0) {
                const rows = psql.stdout.toString().trim().split('\n').filter(Boolean);
                const tracks = rows.map(row => {
                    const [id, lane, status, progress, title, phase, runBy] = row.split('|');
                    return { id, lane, status, progress: parseInt(progress), title, phase, runBy: runBy === 'worker' ? 'W' : (runBy ? 'U' : '-') };
                });

                console.log('\n' + colors.bold + 'Track Status (' + mode + '):' + colors.reset);
                console.log('ID    LANE            STATUS    PROG   BY  PHASE/TITLE');
                console.log('-'.repeat(80));
                tracks.forEach(t => {
                    const statusLabel = t.status === 'running' ? colors.cyan + 'RUN ' : t.status === 'failure' ? colors.red + 'FAIL' : t.status === 'queue' ? colors.green + 'QUEUE' : t.status === 'success' ? colors.green + 'DONE ' : (t.status === 'waiting' || !t.status) ? colors.yellow + 'WAIT ' : colors.yellow + (t.status || '?').slice(0, 5).toUpperCase();
                    console.log(`${t.id.padEnd(5)} ${t.lane.padEnd(15)} ${statusLabel.padEnd(16)} ${t.progress}%`.padEnd(35) + ` ${t.runBy.padEnd(3)} ${t.phase ? colors.dim + t.phase + ': ' + colors.reset : ''}${t.title}`);
                });

                // Worker Health Check
                const pidFile = join(projectRoot, 'conductor', '.sync.pid');
                let running = false;
                if (existsSync(pidFile)) {
                    try { process.kill(readFileSync(pidFile, 'utf8').trim(), 0); running = true; } catch (e) { }
                }
                console.log('\n   Worker Status : ' + (running ? colors.green + '✅ Running' : colors.red + '❌ Stopped') + colors.reset);
                console.log('   Active Targets: ' + (cfg.collectors || []).filter(c => c.enabled !== false).length + ' sites connected');

                console.log('');
                process.exit(0);
            } else { throw new Error(psql.stderr.toString()); }
        } catch (err) {
            spawnSync('make', ['lc-status'], { stdio: 'inherit', cwd: projectRoot });
            process.exit(0);
        }
    }
} else if (command === 'new') {
    if (!projectRoot) { console.error('❌ Error: No Project Root found.'); process.exit(1); }

    // Collect all args after 'new' up to the first --flag.
    // Supports both:
    //   lc new "multi word title" "description"   (quoted, each is one arg)
    //   lc new [multi word title] [description]   (bracket notation, each word is a separate arg)
    const typeIdx = args.indexOf('--type');
    const rawPositional = typeIdx !== -1 ? args.slice(1, typeIdx) : args.slice(1);
    const rawStr = rawPositional.join(' ').trim();

    let name, desc;
    if (rawStr.startsWith('[')) {
        // Bracket notation: [title words] [description words]
        const bracketGroups = [];
        let remaining = rawStr;
        while (remaining.startsWith('[')) {
            const closeIdx = remaining.indexOf(']');
            if (closeIdx === -1) { bracketGroups.push(remaining.slice(1)); remaining = ''; break; }
            bracketGroups.push(remaining.slice(1, closeIdx).trim());
            remaining = remaining.slice(closeIdx + 1).trim();
        }
        name = bracketGroups[0] || '';
        desc = bracketGroups[1] || '';
    } else if (rawPositional.length <= 2) {
        // Legacy, unambiguous: title and (optional) description as separate quoted args.
        name = rawPositional[0] || '';
        desc = rawPositional[1] || '';
    } else {
        // More than 2 raw args with no bracket notation almost always means the title
        // was typed unquoted (each word became its own argv entry) — e.g.
        // `lc new Goal page doesnt reflect fink score` instead of
        // `lc new "Goal page doesnt reflect fink score"`. Silently taking just the
        // first word as the title and dumping the rest into the description produces
        // a garbled, hard-to-notice track (short slug, truncated summary). Treat the
        // whole phrase as the title instead, and warn so the mistake is visible.
        console.warn('⚠️  Multiple unquoted words detected — did you forget to quote the title?');
        console.warn('    Treating the full phrase as the title (no description).');
        console.warn('    For a title + description, use: lc new "Full Title" "Description"');
        name = rawStr;
        desc = '';
    }

    if (!name) { console.log('❌ Usage: lc new "Track name" "Description" [--type dev|marketing|sales|support|other] [--workspace main|branch]'); process.exit(1); }

    const VALID_TRACK_TYPES = ['dev', 'marketing', 'sales', 'support', 'other'];
    let trackType = typeIdx !== -1 ? args[typeIdx + 1] : 'dev';
    if (!VALID_TRACK_TYPES.includes(trackType)) {
        console.error(`❌ Invalid track type "${trackType}". Must be one of: ${VALID_TRACK_TYPES.join(', ')}`);
        process.exit(1);
    }

    // Track 1115 REQ-7: --workspace main|branch. Absent by default (not
    // defaulted to 'branch' here) — resolveWorkspaceMode() needs to know
    // "unset" is distinct from "explicitly branch" (D2).
    const VALID_WORKSPACE_MODES = ['main', 'branch'];
    const workspaceIdx = args.indexOf('--workspace');
    let workspaceMode = null;
    if (workspaceIdx !== -1) {
        workspaceMode = args[workspaceIdx + 1];
        if (!VALID_WORKSPACE_MODES.includes(workspaceMode)) {
            console.error(`❌ Invalid workspace mode "${workspaceMode}". Must be one of: ${VALID_WORKSPACE_MODES.join(', ')}`);
            process.exit(1);
        }
    }

    const queuePath = join(projectRoot, 'conductor', 'tracks', 'file_sync_queue.md');
    const tracksDir = join(projectRoot, 'conductor', 'tracks');
    if (!existsSync(tracksDir)) mkdirSync(tracksDir, { recursive: true });

    let queueContent = '';
    if (existsSync(queuePath)) queueContent = readFileSync(queuePath, 'utf8');
    const trackLines = queueContent.match(/### Track (\d+):/g) || [];
    const queueNums = trackLines.map(m => parseInt(m.match(/\d+/)[0]));

    // Prefix-agnostic number extraction: matches NNN in both legacy `NNN-slug` and new `AM-NNN-slug`
    const existingDirs = readdirSync(tracksDir).filter(d => /\d+/.test(d));
    const existingDirNumStrs = existingDirs.map(d => d.match(/(\d+)/)?.[1]).filter(Boolean);
    const dirNums = existingDirNumStrs.map(s => parseInt(s, 10));

    const allNums = [...queueNums, ...dirNums];
    const nextNum = allNums.length ? Math.max(...allNums) + 1 : 1000;
    // Preserve whatever zero-padding width the project's existing tracks already use
    // (e.g. 001-084 → width 3) instead of dropping it — a plain `${nextNum}` here
    // silently broke the documented NNN-slug convention once padding was in play
    // (produced "85-slug" instead of "085-slug"). Projects with no existing padded
    // tracks (or starting fresh at 1000) are left unpadded, matching prior behavior.
    const padWidth = existingDirNumStrs.length ? Math.max(...existingDirNumStrs.map(s => s.length)) : 0;
    const nextNumStr = String(nextNum).padStart(padWidth, '0');

    const author = getAuthorInfo();
    const displayId = `${author.initials}-${nextNumStr}`;

    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    const trackFolderName = `${displayId}-${slug}`;
    const trackPath = join(tracksDir, trackFolderName);

    if (!existsSync(trackPath)) mkdirSync(trackPath, { recursive: true });
    const indexPath = join(trackPath, 'index.md');
    const workspaceLine = workspaceMode ? `**Workspace**: ${workspaceMode}\n` : '';
    const indexContent = `# Track ${displayId}: ${name}\n\n**Lane**: plan\n**Lane Status**: queue\n**Progress**: 0%\n**Phase**: New\n**Type**: ${trackType}\n${workspaceLine}**Author**: ${author.initials}\n**Created By**: ${author.email}\n**Summary**: ${desc}\n`;
    writeFileSync(indexPath, indexContent);

    // Warn about missing skills for non-dev track types
    const SKILL_MAP = {
        marketing: ['social-content', 'copywriting', 'content-strategy', 'launch-strategy'],
        sales: ['sales-enablement', 'cold-email'],
    };
    if (SKILL_MAP[trackType]) {
        const skillsDir = join(projectRoot, '.claude', 'skills');
        for (const skill of SKILL_MAP[trackType]) {
            const skillPath = join(skillsDir, skill);
            if (!existsSync(skillPath)) {
                console.log(`⚠️  Track type '${trackType}' works best with [${skill}] — not found in .claude/skills/`);
            } else {
                console.log(`✅ ${skill} available`);
            }
        }
    }

    const now = new Date().toISOString();
    const queueEntry = `\n### Track ${nextNumStr}: ${name}\n**Status**: pending\n**Type**: track-create\n**Created**: ${now}\n**Title**: ${name}\n**Description**: ${desc || 'No description.'}\n**Metadata**: { "priority": "medium", "assignee": null }\n`;
    if (existsSync(queuePath)) {
        let existing = readFileSync(queuePath, 'utf8');
        existing = existing.replace(/^(## Config Sync Requests)/m, queueEntry + '$1');
        writeFileSync(queuePath, existing);
    } else {
        writeFileSync(queuePath, `# File Sync Queue\n\nLast processed: —\n\n## Track Creation Requests\n${queueEntry}\n## Config Sync Requests\n\n*No pending config sync requests.*\n\n## Completed Queue\n`);
    }
    console.log(`✅ Track ${nextNumStr} created in ${trackFolderName}`);
    process.exit(0);
} else if (command === 'measure') {
    if (!projectRoot) { console.error('❌ Error: No Project Root found.'); process.exit(1); }
    const trackNum = args[1];
    if (!trackNum) { console.log('❌ Usage: lc measure <track-number> [--dry-run]'); process.exit(1); }
    const { spawn } = await import('child_process');
    const measureScript = join(projectRoot, 'conductor', 'measure.mjs');
    const measureArgs = ['--track', trackNum, ...args.slice(2)];
    const child = spawn(process.execPath, [measureScript, ...measureArgs], { stdio: 'inherit' });
    child.on('exit', (code) => process.exit(code || 0));
} else if (command === 'check-skills') {
    if (!projectRoot) { console.error('❌ Error: No Project Root found.'); process.exit(1); }
    const trackNum = args[1];
    if (!trackNum) { console.log('❌ Usage: lc check-skills <track-number>'); process.exit(1); }
    const tracksDir = join(projectRoot, 'conductor', 'tracks');
    const trackDir = readdirSync(tracksDir).find(d => d.startsWith(`${trackNum}-`));
    if (!trackDir) { console.error(`❌ Track ${trackNum} not found`); process.exit(1); }
    const indexPath = join(tracksDir, trackDir, 'index.md');
    const indexContent = existsSync(indexPath) ? readFileSync(indexPath, 'utf8') : '';
    const typeMatch = indexContent.match(/\*\*Type\*\*:\s*([^\n]+)/i);
    const trackType = typeMatch ? typeMatch[1].trim().toLowerCase() : 'dev';
    const SKILL_MAP = {
        marketing: ['social-content', 'copywriting', 'content-strategy', 'launch-strategy'],
        sales: ['sales-enablement', 'cold-email'],
    };
    const skills = SKILL_MAP[trackType];
    if (!skills) { console.log(`ℹ️  Track type '${trackType}' has no skill recommendations`); process.exit(0); }
    const skillsDir = join(projectRoot, '.claude', 'skills');
    console.log(`\n📋 Skill check for Track ${trackNum} (type: ${trackType})\n`);
    for (const skill of skills) {
        const exists = existsSync(join(skillsDir, skill));
        console.log(`  ${exists ? '✅' : '⚠️ '} ${skill}${exists ? '' : ' — not found in .claude/skills/'}`);
    }
    console.log('');
    process.exit(0);
} else if (command === 'comment') {
    if (!projectRoot) { console.error('❌ Error: No Project Root found.'); process.exit(1); }
    const trackNum = args[1];
    const body = args[2];
    if (!trackNum || !body) { console.log('❌ Usage: lc comment [track-num] "message"'); process.exit(1); }

    const cfg = JSON.parse(readFileSync(join(projectRoot, '.laneconductor.json'), 'utf8'));
    if (cfg.mode === 'local-fs') {
        const tracksDir = join(projectRoot, 'conductor', 'tracks');
        const dir = readdirSync(tracksDir).find(d => d.startsWith(`${trackNum}-`));
        if (!dir) { console.error(`❌ Track ${trackNum} not found`); process.exit(1); }
        appendFileSync(join(tracksDir, dir, 'conversation.md'), `\n> **human**: ${body}\n`);

        const indexPath = join(tracksDir, dir, 'index.md');
        if (existsSync(indexPath)) {
            let content = readFileSync(indexPath, 'utf8');
            content = content.replace(/\*\*Lane Status\*\*:\s*[^\n]+/i, '**Lane Status**: queue');
            if (!content.includes('**Waiting for reply**:')) content = content.replace(/(\*\*Lane Status\*\*:\s*queue)/i, '$1\n**Waiting for reply**: yes');
            else content = content.replace(/\*\*Waiting for reply\*\*:\s*[^\n]+/i, '**Waiting for reply**: yes');
            writeFileSync(indexPath, content);
        }
        // Fan out to ALL *enabled* collectors
        const collectors = (cfg.collectors || []).filter(c => c.enabled !== false);
        await Promise.allSettled(collectors.map((collector) => {
            const idx = cfg.collectors.indexOf(collector);
            const url = new URL(`${collector.url}/track/${trackNum}/comment`);
            if (cfg.project?.id) url.searchParams.set('project_id', cfg.project.id);
            const token = getCollectorToken(cfg, idx, projectRoot);
            return fetch(url.toString(), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(token ? { 'Authorization': `Bearer ${token}` } : {})
                },
                body: JSON.stringify({ author: 'human', body })
            }).then(() => console.log(`✅ Comment posted to collector[${idx}]: ${collector.url}`))
              .catch(e => console.error(`❌ collector[${idx}] failed: ${e.message}`));
        }));
    }
    process.exit(0);
} else if (command === 'updateTrack' || command === 'update-track') {
    if (!projectRoot) { console.error('❌ Error: No Project Root found.'); process.exit(1); }
    const trackNum = args[1];
    const what = args[2];
    if (!trackNum || !what) { console.log('❌ Usage: lc update-track [track-num] "what needs to be updated"'); process.exit(1); }

    const tracksDir = join(projectRoot, 'conductor', 'tracks');
    const dir = readdirSync(tracksDir).find(d => d.startsWith(`${trackNum}-`));
    if (!dir) { console.error(`❌ Track ${trackNum} not found`); process.exit(1); }

    const trackPath = join(tracksDir, dir);
    const planPath = join(trackPath, 'plan.md');
    const indexPath = join(trackPath, 'index.md');

    // 1. Append work description to plan.md
    if (existsSync(planPath)) {
        let planContent = readFileSync(planPath, 'utf8');
        planContent += `\n\n## Update: Additional Work\n- [ ] ${what}\n`;
        writeFileSync(planPath, planContent);
        console.log(`✅ Appended task to plan.md for Track ${trackNum}`);
    } else {
        const planContent = `# Track ${trackNum}\n\n## Additional Work\n- [ ] ${what}\n`;
        writeFileSync(planPath, planContent);
        console.log(`✅ Created plan.md with task for Track ${trackNum}`);
    }

    // 2. Modify index.md to move it back to backlog
    if (existsSync(indexPath)) {
        let content = readFileSync(indexPath, 'utf8');
        
        if (content.match(/\*\*Lane\*\*:\s*[^\n]+/i)) {
            content = content.replace(/\*\*Lane\*\*:\s*[^\n]+/i, '**Lane**: backlog');
        } else if (content.match(/- \*\*Lane\*\*:\s*[^\n]+/i)) {
            content = content.replace(/- \*\*Lane\*\*:\s*[^\n]+/i, '- **Lane**: backlog');
        }
        
        if (content.match(/\*\*Lane Status\*\*:\s*[^\n]+/i)) {
            content = content.replace(/\*\*Lane Status\*\*:\s*[^\n]+/i, '**Lane Status**: queue');
        } else if (content.match(/\*\*Status\*\*:\s*[^\n]+/i)) {
            content = content.replace(/\*\*Status\*\*:\s*[^\n]+/i, '**Status**: backlog');
        } else if (content.match(/- \*\*Status\*\*:\s*[^\n]+/i)) {
            content = content.replace(/- \*\*Status\*\*:\s*[^\n]+/i, '- **Status**: backlog');
        }

        if (content.match(/\*\*Progress\*\*:\s*(\d+)%/i)) {
            content = content.replace(/\*\*Progress\*\*:\s*(\d+)%/i, '**Progress**: 0%');
        } else if (content.match(/- \*\*Progress\*\*:\s*(\d+)%/i)) {
            content = content.replace(/- \*\*Progress\*\*:\s*(\d+)%/i, '- **Progress**: 0%');
        }
        
        writeFileSync(indexPath, content);
        console.log(`✅ Moved Track ${trackNum} back to backlog (Progress: 0%)`);
    }
    process.exit(0);
} else if (command === 'reportaBug' || command === 'report-bug' || command === 'featureRequest' || command === 'feature-request') {
    if (!projectRoot) { console.error('❌ Error: No Project Root found.'); process.exit(1); }
    const desc = args.slice(1).join(' ');
    if (!desc) {
        console.log(`❌ Usage: lc ${command} "description of bug/feature"`);
        process.exit(1);
    }

    const isBug = command.toLowerCase().includes('bug');
    const typeLabel = isBug ? 'Bug' : 'Feature';
    const trackType = 'dev';

    // Check if the description references an existing track
    const trackRefMatch = desc.match(/(?:track\s+|#|#\s*)(\d{3,4})\b/i) || desc.match(/\b(\d{3,4})\b/);
    if (trackRefMatch) {
        const trackNum = trackRefMatch[1];
        const tracksDir = join(projectRoot, 'conductor', 'tracks');
        const dir = readdirSync(tracksDir).find(d => d.startsWith(`${trackNum}-`));
        if (dir) {
            console.log(`ℹ️  Referenced existing Track ${trackNum} in description. Appending to it...`);
            const trackPath = join(tracksDir, dir);
            const planPath = join(trackPath, 'plan.md');
            const indexPath = join(trackPath, 'index.md');

            if (existsSync(planPath)) {
                let planContent = readFileSync(planPath, 'utf8');
                planContent += `\n\n## Update: Reported ${typeLabel}\n- [ ] ${desc}\n`;
                writeFileSync(planPath, planContent);
            } else {
                writeFileSync(planPath, `# Track ${trackNum}\n\n## Reported ${typeLabel}\n- [ ] ${desc}\n`);
            }

            if (existsSync(indexPath)) {
                let content = readFileSync(indexPath, 'utf8');
                if (content.match(/\*\*Lane\*\*:\s*[^\n]+/i)) {
                    content = content.replace(/\*\*Lane\*\*:\s*[^\n]+/i, '**Lane**: backlog');
                } else if (content.match(/- \*\*Lane\*\*:\s*[^\n]+/i)) {
                    content = content.replace(/- \*\*Lane\*\*:\s*[^\n]+/i, '- **Lane**: backlog');
                }
                
                if (content.match(/\*\*Lane Status\*\*:\s*[^\n]+/i)) {
                    content = content.replace(/\*\*Lane Status\*\*:\s*[^\n]+/i, '**Lane Status**: queue');
                } else if (content.match(/\*\*Status\*\*:\s*[^\n]+/i)) {
                    content = content.replace(/\*\*Status\*\*:\s*[^\n]+/i, '**Status**: backlog');
                } else if (content.match(/- \*\*Status\*\*:\s*[^\n]+/i)) {
                    content = content.replace(/- \*\*Status\*\*:\s*[^\n]+/i, '- **Status**: backlog');
                }

                if (content.match(/\*\*Progress\*\*:\s*(\d+)%/i)) {
                    content = content.replace(/\*\*Progress\*\*:\s*(\d+)%/i, '**Progress**: 0%');
                } else if (content.match(/- \*\*Progress\*\*:\s*(\d+)%/i)) {
                    content = content.replace(/- \*\*Progress\*\*:\s*(\d+)%/i, '- **Progress**: 0%');
                }
                writeFileSync(indexPath, content);
            }
            console.log(`✅ Updated Track ${trackNum} with new ${typeLabel} description and moved to backlog.`);
            process.exit(0);
        }
    }

    const title = desc.split(/[.\n]/)[0].slice(0, 50).trim() || `New ${typeLabel}`;
    const name = `${typeLabel}: ${title}`;

    const queuePath = join(projectRoot, 'conductor', 'tracks', 'file_sync_queue.md');
    const tracksDir = join(projectRoot, 'conductor', 'tracks');
    if (!existsSync(tracksDir)) mkdirSync(tracksDir, { recursive: true });

    let queueContent = '';
    if (existsSync(queuePath)) queueContent = readFileSync(queuePath, 'utf8');
    const trackLines = queueContent.match(/### Track (\d+):/g) || [];
    const queueNums = trackLines.map(m => parseInt(m.match(/\d+/)[0]));

    const existingDirs = readdirSync(tracksDir).filter(d => /^\d+/.test(d));
    const existingDirNumStrs = existingDirs.map(d => d.match(/^(\d+)/)[1]);
    const dirNums = existingDirNumStrs.map(s => parseInt(s, 10));

    const allNums = [...queueNums, ...dirNums];
    const nextNum = allNums.length ? Math.max(...allNums) + 1 : 1000;
    // Preserve existing zero-padding width (see the `new` command's identical fix above).
    const padWidth = existingDirNumStrs.length ? Math.max(...existingDirNumStrs.map(s => s.length)) : 0;
    const nextNumStr = String(nextNum).padStart(padWidth, '0');

    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    const trackFolderName = `${nextNumStr}-${isBug ? 'bug' : 'feat'}-${slug}`;
    const trackPath = join(tracksDir, trackFolderName);

    if (!existsSync(trackPath)) mkdirSync(trackPath, { recursive: true });

    const indexPath = join(trackPath, 'index.md');
    const indexContent = `# Track ${nextNumStr}: ${name}\n\n**Lane**: backlog\n**Lane Status**: queue\n**Progress**: 0%\n**Phase**: New\n**Type**: ${trackType}\n**Summary**: ${desc}\n`;
    writeFileSync(indexPath, indexContent);

    const specPath = join(trackPath, 'spec.md');
    const specContent = `# Spec: ${name}\n\n## Problem Statement\n${desc}\n\n## Requirements\n- [ ] Address the reported ${typeLabel.toLowerCase()}.\n\n## Acceptance Criteria\n- [ ] Verification shows the request is satisfied.\n`;
    writeFileSync(specPath, specContent);

    const planPath = join(trackPath, 'plan.md');
    const planContent = `# Plan: Track ${nextNumStr} — ${name}\n\n## Phase 1: Execution\n- [ ] Implement and verify the ${typeLabel.toLowerCase()}.\n`;
    writeFileSync(planPath, planContent);

    const testPath = join(trackPath, 'test.md');
    const testContent = `# Tests: Track ${nextNumStr} — ${name}\n\n## Test Cases\n- [ ] Verify functionality works as expected.\n`;
    writeFileSync(testPath, testContent);

    const now = new Date().toISOString();
    const queueEntry = `\n### Track ${nextNumStr}: ${name}\n**Status**: pending\n**Type**: track-create\n**Created**: ${now}\n**Title**: ${name}\n**Description**: ${desc}\n**Metadata**: { "priority": "medium", "assignee": null }\n`;
    
    if (existsSync(queuePath)) {
        let existing = readFileSync(queuePath, 'utf8');
        existing = existing.replace(/^(## Config Sync Requests)/m, queueEntry + '$1');
        writeFileSync(queuePath, existing);
    } else {
        writeFileSync(queuePath, `# File Sync Queue\n\nLast processed: —\n\n## Track Creation Requests\n${queueEntry}\n## Config Sync Requests\n\n*No pending config sync requests.*\n\n## Completed Queue\n`);
    }

    console.log(`✅ Created new ${typeLabel} Track ${nextNumStr} in ${trackFolderName}`);
    process.exit(0);
} else if (command === 'brainstorm') {
    if (!projectRoot) { console.error('❌ Error: No Project Root found.'); process.exit(1); }
    const trackNum = args[1];
    if (!trackNum) { console.log('❌ Usage: lc brainstorm <track-number>'); process.exit(1); }

    const tracksDir = join(projectRoot, 'conductor', 'tracks');
    const dir = readdirSync(tracksDir).find(d => d.startsWith(`${trackNum}-`));
    if (!dir) { console.error(`❌ Track ${trackNum} not found`); process.exit(1); }

    const convPath = join(tracksDir, dir, 'conversation.md');
    const trigger = `\n> **system**: Brainstorm requested via CLI. Read all context files (product.md, tech-stack.md, spec.md, plan.md, test.md) and begin clarifying questions one at a time.\n`;
    appendFileSync(convPath, trigger);

    const indexPath = join(tracksDir, dir, 'index.md');
    if (existsSync(indexPath)) {
        let content = readFileSync(indexPath, 'utf8');
        if (!content.includes('**Waiting for reply**:')) content += '\n**Waiting for reply**: yes\n';
        else content = content.replace(/\*\*Waiting for reply\*\*:\s*[^\n]+/i, '**Waiting for reply**: yes');
        writeFileSync(indexPath, content);
    }
    console.log(`✅ Brainstorm started for Track ${trackNum}. Reply in conversation.md or the UI inbox.`);
    process.exit(0);
} else if (command === 'move' || ['plan', 'implement', 'review', 'quality-gate', 'backlog', 'done', 'pulse', 'rerun'].includes(command)) {
    if (!projectRoot) { console.error('❌ Error: No Project Root found.'); process.exit(1); }

    // Strip --run / -r flag before processing positional args
    const runFlag = args.includes('--run') || args.includes('-r');
    const filteredArgs = args.filter(a => a !== '--run' && a !== '-r');

    const trackNum = filteredArgs[1];
    let lane = command === 'move' || command === 'pulse' ? filteredArgs[2] : (command === 'rerun' ? null : command);
    let status = command === 'pulse' ? filteredArgs[2] : (filteredArgs[2] || 'queue');
    let prog = command === 'pulse' ? filteredArgs[3] : null;

    if (lane && lane.includes(':')) { [lane, status] = lane.split(':'); }

    const tracksDir = join(projectRoot, 'conductor', 'tracks');
    const dir = readdirSync(tracksDir).find(d => d.startsWith(`${trackNum}-`));
    if (!dir) { console.error(`❌ Track ${trackNum} not found`); process.exit(1); }

    const indexPath = join(tracksDir, dir, 'index.md');
    let content = readFileSync(indexPath, 'utf8');
    if (lane && command !== 'pulse') content = content.replace(/\*\*Lane\*\*:\s*[^\n]+/i, `**Lane**: ${lane}`);
    if (status) content = content.replace(/\*\*Lane Status\*\*:\s*[^\n]+/i, `**Lane Status**: ${status}`);
    if (prog) content = content.replace(/\*\*Progress\*\*:\s*\d+%/i, `**Progress**: ${prog}%`);

    if (command === 'rerun') {
        const retryPath = join(tracksDir, dir, '.retry-count');
        const retryLanePath = join(tracksDir, dir, '.retry-lane');
        if (existsSync(retryPath)) unlinkSync(retryPath);
        if (existsSync(retryLanePath)) unlinkSync(retryLanePath);

        const cfg = JSON.parse(readFileSync(join(projectRoot, '.laneconductor.json'), 'utf8'));
        if (cfg.mode !== 'local-fs') {
            // Fan out rerun comment to ALL *enabled* collectors
            const collectors = (cfg.collectors || []).filter(c => c.enabled !== false);
            await Promise.allSettled(collectors.map((collector) => {
                const idx = cfg.collectors.indexOf(collector);
                const url = new URL(`${collector.url}/track/${trackNum}/comment`);
                if (cfg.project?.id) url.searchParams.set('project_id', cfg.project.id);
                const token = getCollectorToken(cfg, idx, projectRoot);
                return fetch(url.toString(), {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
                    },
                    body: JSON.stringify({ author: 'human', body: 'Manual rerun (CLI)' })
                }).catch(() => {});
            }));
        }
        console.log(`♻️  Retries reset for track ${trackNum}`);
    }

    writeFileSync(indexPath, content);

    if (runFlag && lane && !['backlog', 'done', 'pulse'].includes(command)) {
        // --run: spawn the AI agent in the foreground immediately
        const cfgPath = join(projectRoot, '.laneconductor.json');
        if (!existsSync(cfgPath)) { console.error('❌ No .laneconductor.json found'); process.exit(1); }
        const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));

        // Identify available agents (primary and optional secondary)
        const agents = [];
        if (cfg.project?.primary?.cli) agents.push({ ...cfg.project.primary, type: 'primary' });
        if (cfg.project?.secondary?.cli) agents.push({ ...cfg.project.secondary, type: 'secondary' });

        if (agents.length === 0) {
            console.error('❌ No primary agent configured in .laneconductor.json');
            process.exit(1);
        }

        // Mark track as running before spawning
        const runningContent = content.replace(/\*\*Lane Status\*\*:\s*[^\n]+/i, '**Lane Status**: running');
        writeFileSync(indexPath, runningContent);

        const skillAction = lane === 'quality-gate' ? 'qualityGate' : lane;
        const slashCmd = `/laneconductor ${skillAction} ${trackNum}`;
        
        const exitCode = await runAIAgent(cfg, slashCmd, trackNum, lane);

        // Update final lane status based on results
        const finalContent = readFileSync(indexPath, 'utf8');
        const finalStatusToSet = (exitCode === 0) ? 'success' : 'failure';
        const finalContentWithStatus = finalContent.replace(/\*\*Lane Status\*\*:\s*[^\n]+/i, `**Lane Status**: ${finalStatusToSet}`);
        writeFileSync(indexPath, finalContentWithStatus);

        if (exitCode === 0) {
            console.log(`\n✅ Track ${trackNum} ${lane} completed successfully`);
        } else {
            console.log(`\n❌ Track ${trackNum} ${lane} failed after trying all agents (exit code: ${exitCode})`);
        }
        process.exit(exitCode || 0);

    }

    console.log(`✅ Track ${trackNum} updated`);
    process.exit(0);
} else if (command === 'workflow') {
    if (!projectRoot) { process.exit(1); }
    let wfPath = join(projectRoot, 'conductor', 'workflow.json');
    if (!existsSync(wfPath)) {
        const installPath = getInstallPath();
        const canonical = join(installPath, 'conductor', 'workflow.json');
        if (existsSync(canonical)) {
            wfPath = canonical;
            console.log(`ℹ️  Using global workflow from ${wfPath}`);
        } else {
            console.error(`❌ Error: Workflow configuration not found at ${wfPath} or ${canonical}`);
            process.exit(1);
        }
    }
    const wf = JSON.parse(readFileSync(wfPath, 'utf8'));
    if (args[1] === 'set') {
        if (!wfPath.includes(projectRoot)) {
            console.error('❌ Error: Cannot modify global workflow. Create a local conductor/workflow.json first.');
            process.exit(1);
        }
        const [lane, key, val] = [args[2], args[3], args[4]];
        if (lane === 'global') wf.global[key] = val;
        else if (wf.lanes[lane]) wf.lanes[lane][key] = val;
        else if (lane === 'defaults') wf.defaults[key] = val;
        writeFileSync(wfPath, JSON.stringify(wf, null, 2) + '\n');
        console.log(`✅ Workflow updated: ${lane}.${key} = ${val}`);
        process.exit(0);
    } else {
        console.log('-'.repeat(77));
        for (const [lane, cfg] of Object.entries(wf.lanes || {})) {
            console.log(col(lane, 15) + col(cfg.parallel_limit ?? d.parallel_limit ?? 1, 9) + col(cfg.max_retries ?? d.max_retries ?? 1, 9) + col(cfg.on_success ?? '(stay)', 22) + col(cfg.on_failure ?? '(stay)', 22));
        }
        console.log('');
    }
    process.exit(0);
} else if (command === 'config' || command === 'project') {
    if (!projectRoot) { process.exit(1); }
    const cfgPath = join(projectRoot, '.laneconductor.json');
    const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
    if (args[1] === 'set') {
        setNestedKey(command === 'config' ? cfg : cfg.project, args[2], args[3]);
        writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
        console.log(`✅ ${command} updated`);
    } else if (args[1] === 'mode') {
        const newMode = args[2];
        if (!newMode) {
            console.log(`Current Mode: ${cfg.mode || 'local-fs'}`);
            console.log(`Available Modes: local-fs, local-api, remote-api, multi-api`);
            process.exit(0);
        }
        if (!['local-fs', 'local-api', 'remote-api', 'multi-api'].includes(newMode)) {
            console.error('❌ Error: Invalid mode. Choose: local-fs, local-api, remote-api, multi-api');
            process.exit(1);
        }
        cfg.mode = newMode;
        if (newMode === 'local-api' && (!cfg.collectors || cfg.collectors.length === 0)) {
            cfg.collectors = [{ url: 'http://localhost:8091', token: null }];
        } else if (newMode === 'remote-api') {
            // Parse flags
            const flagUrl       = args.find((a, i) => (args[i - 1] === '--url'))  || args[args.indexOf('--url')  + 1];
            const flagKey       = args.find((a, i) => (args[i - 1] === '--key'))  || args[args.indexOf('--key')  + 1];
            const flagStore     = args.find((a, i) => (args[i - 1] === '--store-type')) || args[args.indexOf('--store-type') + 1];
            const flagSecret    = args.find((a, i) => (args[i - 1] === '--secret-name')) || args[args.indexOf('--secret-name') + 1];
            
            const parsedUrl     = args.includes('--url') ? args[args.indexOf('--url') + 1] : null;
            const parsedKey     = args.includes('--key') ? args[args.indexOf('--key') + 1] : null;
            const parsedStore   = args.includes('--store-type') ? args[args.indexOf('--store-type') + 1] : null;
            const parsedSecret  = args.includes('--secret-name') ? args[args.indexOf('--secret-name') + 1] : null;

            const hasRemote = cfg.collectors?.some(c => !c.url.includes('localhost') && !c.url.includes('127.0.0.1'));

            if (parsedUrl) {
                // Non-interactive path — flags provided
                // APPEND to collectors (don't replace existing ones)
                if (!cfg.collectors) cfg.collectors = [];
                const alreadyExists = cfg.collectors.some(c => c.url === parsedUrl);
                
                const newConfig = { url: parsedUrl, token: null };
                if (parsedStore) newConfig.store_type = parsedStore;
                if (parsedSecret) newConfig.secret_name = parsedSecret;

                if (!alreadyExists) {
                    cfg.collectors.push(newConfig);
                } else {
                    const existingIdx = cfg.collectors.findIndex(c => c.url === parsedUrl);
                    cfg.collectors[existingIdx] = { ...cfg.collectors[existingIdx], ...newConfig };
                    console.log(`ℹ️  Target ${parsedUrl} updated in collectors list.`);
                }
                writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');

                if (parsedKey && parsedStore !== 'gcp-secret') {
                    const newIdx = cfg.collectors.findIndex(c => c.url === parsedUrl);
                    let envContent = existsSync(join(projectRoot, '.env')) ? readFileSync(join(projectRoot, '.env'), 'utf8') : '';
                    const envKey = `COLLECTOR_${newIdx}_TOKEN`;
                    if (envContent.includes(`${envKey}=`)) {
                        envContent = envContent.replace(new RegExp(`${envKey}=.*`), `${envKey}=${parsedKey}`);
                    } else {
                        envContent += `\n${envKey}=${parsedKey}\n`;
                    }
                    writeFileSync(join(projectRoot, '.env'), envContent.trim() + '\n');
                    console.log(`✅ Mode switched to ${newMode}`);
                    console.log(`   URL : ${parsedUrl}`);
                    console.log(`   Key : ${parsedKey.slice(0, 16)}…  (saved to .env as ${envKey})`);
                } else if (parsedStore === 'gcp-secret' && parsedSecret) {
                    console.log(`✅ Mode switched to ${newMode}`);
                    console.log(`   URL : ${parsedUrl}`);
                    console.log(`   Auth: GCP Secret Manager (${parsedSecret})`);
                } else {
                    console.log(`✅ Mode switched to ${newMode}`);
                    console.log(`   URL : ${parsedUrl}`);
                    console.log(`   ⚠️  No --key or --store-type provided.`);
                }
            } else if (!hasRemote) {
                // Interactive fallback — no flags and no existing remote
                const rl = createInterface({ input: process.stdin, output: process.stdout });
                const question = (query) => new Promise((resolve) => rl.question(query, resolve));
                (async () => {
                    const remoteUrl = await question('Remote Collector URL (e.g., https://app.laneconductor.com): ');
                    const apiKey = await question('Remote API Key (lc_xxx...): ');

                    cfg.collectors = [{ url: remoteUrl, token: null }];
                    writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');

                    let envContent = existsSync(join(projectRoot, '.env')) ? readFileSync(join(projectRoot, '.env'), 'utf8') : '';
                    if (apiKey) {
                        if (envContent.includes('COLLECTOR_0_TOKEN=')) {
                            envContent = envContent.replace(/COLLECTOR_0_TOKEN=.*/, `COLLECTOR_0_TOKEN=${apiKey}`);
                        } else {
                            envContent += `\nCOLLECTOR_0_TOKEN=${apiKey}\n`;
                        }
                        writeFileSync(join(projectRoot, '.env'), envContent.trim() + '\n');
                    }

                    console.log(`✅ Mode switched to ${newMode}`);
                    rl.close();
                    process.exit(0);
                })();
            } else {
                // Already have a remote collector — just toggle the mode
                writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
                console.log(`✅ Mode switched to ${newMode}`);
            }
        } else {
            writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
            console.log(`✅ Mode switched to ${newMode}`);
        }
    } else if (args[1] === 'visibility') {
        const visibility = args[2];
        if (!['private', 'team', 'public'].includes(visibility)) {
            console.error('❌ Error: Invalid visibility. Choose: private, team, public');
            process.exit(1);
        }
        if (!cfg.worker) cfg.worker = {};
        cfg.worker.visibility = visibility;
        writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
        console.log(`✅ Worker visibility set to ${visibility}`);
    } else if (command === 'project' && args[1] === 'show') {
        ['conductor/product.md', 'conductor/tech-stack.md', 'workflow.md'].forEach(f => {
            if (existsSync(join(projectRoot, f))) console.log(`\n--- ${f} ---\n`, readFileSync(join(projectRoot, f), 'utf8').slice(0, 200) + '...');
        });
    } else {
        console.log(`\n--- .laneconductor.json ---\n`, JSON.stringify(cfg, null, 2));
    }
    process.exit(0);

} else if (command === 'add-target-mapping') {
    if (!projectRoot) {
        console.error('❌ No LaneConductor project found.');
        process.exit(1);
    }
    const cfgPath = join(projectRoot, '.laneconductor.json');
    const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));

    const targetType = args.includes('--type') ? args[args.indexOf('--type') + 1] : 'jira';
    const projKey = args.includes('--project-key') ? args[args.indexOf('--project-key') + 1] : null;
    const laneMatch = args.includes('--lane') ? args[args.indexOf('--lane') + 1] : null;
    const targetMatch = args.includes('--target') ? args[args.indexOf('--target') + 1] : null;

    if (!laneMatch || !targetMatch) {
        console.error('❌ Usage: lc add-target-mapping [--type jira] [--project-key <key>] --lane <lc_lane> --target "<target_status>"');
        console.error('   Example: lc add-target-mapping --lane implement --target "In Progress"');
        process.exit(1);
    }

    if (!cfg.collectors || cfg.collectors.length === 0) {
        console.error('❌ No collectors found. Run lc add-target first.');
        process.exit(1);
    }

    const collectors = cfg.collectors.filter(c => c.type === targetType && (!projKey || c.project_key === projKey));
    
    if (collectors.length === 0) {
        console.error(`❌ No ${targetType} collector found matching criteria.`);
        process.exit(1);
    }
    if (collectors.length > 1) {
        console.error(`❌ Multiple ${targetType} collectors found. Please specify --project-key.`);
        process.exit(1);
    }

    const collector = collectors[0];
    if (!collector.target_mapping) collector.target_mapping = {};

    // 1:1 Mapping Validation
    // Remove any existing mappings that use the same lane or the same target
    for (const key of Object.keys(collector.target_mapping)) {
        if (key === laneMatch || collector.target_mapping[key] === targetMatch) {
            delete collector.target_mapping[key];
        }
    }

    collector.target_mapping[laneMatch] = targetMatch;

    writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
    console.log(`✅ Mapping added: ${laneMatch} <-> "${targetMatch}"`);
    process.exit(0);

} else if (command === 'add-target') {
    // lc add-target --url <url> --key <key>
    // lc add-target --type jira --domain <domain> --email <email> --project-key <key> [--token-env <env>]
    // Adds a new collector target and triggers an initial bidirectional sync.
    if (!projectRoot) {
        console.error('❌ No LaneConductor project found.');
        process.exit(1);
    }
    const cfgPath = join(projectRoot, '.laneconductor.json');
    const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));

    const targetType   = args.includes('--type') ? args[args.indexOf('--type') + 1] : null;

    // Handle Jira type
    if (targetType === 'jira') {
        const domain      = args.includes('--domain') ? args[args.indexOf('--domain') + 1] : null;
        const email       = args.includes('--email') ? args[args.indexOf('--email') + 1] : null;
        const projKey     = args.includes('--project-key') ? args[args.indexOf('--project-key') + 1] : null;
        const tokenEnv    = args.includes('--token-env') ? args[args.indexOf('--token-env') + 1] : null;
        const token       = args.includes('--token') ? args[args.indexOf('--token') + 1] : null;
        const tokenSecret = args.includes('--token-secret-name') ? args[args.indexOf('--token-secret-name') + 1] : null;
        const tokenStore  = args.includes('--token-store-type') ? args[args.indexOf('--token-store-type') + 1] : (tokenSecret ? 'gcp-secret' : null);

        if (!domain || !email || !projKey || (!tokenEnv && !token && !tokenSecret)) {
            console.error('❌ Usage: lc add-target --type jira --domain <domain> --email <email> --project-key <key>');
            console.error('         [--token-env <env> | --token <value> | --token-secret-name <name>]');
            process.exit(1);
        }

        if (!cfg.collectors) cfg.collectors = [];

        // Resolve token
        const resolvedToken = resolveJiraToken(tokenEnv, token, tokenSecret, tokenStore);
        if (!resolvedToken) {
            console.error(`❌ Could not resolve JIRA token`);
            process.exit(1);
        }

        // Check if project exists, create if not
        (async () => {
            console.log(`🔍 Checking JIRA project: ${projKey}...`);
            const exists = await jiraProjectExists(domain, email, resolvedToken, projKey);

            if (!exists) {
                console.log(`📁 Kanban space "${projKey}" does not exist. Please create manually.\n`);
                console.log(`📋 Instructions to create Jira Kanban space:\n`);
                console.log(`   1. Go to: https://${domain}/jira/software/c/projects/create`);
                console.log(`   2. Select "Kanban" template`);
                console.log(`   3. Configure the space:`);
                console.log(`      • Name: laneconductor`);
                console.log(`      • Key: ${projKey}`);
                console.log(`      • How it's managed: Team-managed`);
                console.log(`      • Access: Open`);
                console.log(`   4. Click "Create"`);
                console.log(`   5. Once created, add these status lanes to the board:\n`);
                console.log(`      LC Lane          →  Jira Status`);
                console.log(`      ──────────────────────────────`);
                console.log(`      backlog          →  Backlog`);
                console.log(`      queue/plan       →  To Do`);
                console.log(`      implement/running →  In Progress`);
                console.log(`      review           →  In Review`);
                console.log(`      quality-gate     →  Testing`);
                console.log(`      done/success     →  Done\n`);
                console.log(`   💡 Tip: Click the "+" button on the board to add status columns if needed.\n`);
                console.error(`❌ Please create the Kanban space and then run 'lc add-target' again.`);
                process.exit(1);
            } else {
                console.log(`✅ JIRA project ${projKey} exists`);
            }

            // Check if Jira collector already exists
            const existingIdx = cfg.collectors.findIndex(c => c.type === 'jira' && c.project_key === projKey);

            const newConfig = {
                type: 'jira',
                domain,
                email,
                project_key: projKey,
                token_env: tokenEnv || undefined,
                token: token || undefined,
                token_store_type: tokenStore || undefined,
                token_secret_name: tokenSecret || undefined
            };

            if (existingIdx !== -1) {
                cfg.collectors[existingIdx] = { ...cfg.collectors[existingIdx], ...newConfig };
                console.log(`ℹ️  Jira collector for ${projKey} updated.`);
            } else {
                cfg.collectors.push(newConfig);
                console.log(`✅ Jira collector added: ${projKey} @ ${domain}`);
            }

            writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');

            if (tokenEnv) {
                console.log(`   Auth: Environment variable ${tokenEnv}`);
                console.log(`   ⚠️  Make sure ${tokenEnv} is set: export ${tokenEnv}="your_jira_api_token"`);
            } else if (tokenStore === 'gcp-secret' && tokenSecret) {
                console.log(`   Auth: GCP Secret Manager (${tokenSecret})`);
                console.log(`   ⚠️  Make sure gcloud is configured and you have access to secret: ${tokenSecret}`);
            } else if (token) {
                console.log(`   Auth: Plain text token (⚠️  INSECURE - consider using GCP Secret Manager)`);
            }

            // Validate statuses and show guidance if needed
            const validation = await validateJiraStatusesInCli(domain, email, resolvedToken, projKey);
            if (!validation.allExist && validation.missing && validation.missing.length > 0) {
                const missingNames = validation.missing.map(s => `"${s}"`).join(', ');
                console.log(`\n⚠️  LaneConductor detected missing JIRA statuses: ${missingNames}`);
                console.log(`   Issues will sync using labels, but for proper board visualization:`);
                console.log(`\n   📋 Create these statuses in your JIRA workflow:`);
                console.log(`      1. Go to: https://${domain}/jira/software/projects/${projKey}/settings/workflows`);
                console.log(`      2. Click "Edit Workflow" on your active workflow`);
                console.log(`      3. Click "Add Status" for each missing status`);
                console.log(`      4. Save and publish the workflow`);
                console.log(`      5. Run: lc worker restart\n`);
            } else if (validation.allExist) {
                console.log(`\n✅ All JIRA statuses validated. Ready for lane-to-status transitions.`);
            }

            console.log(`✅ Jira integration ready! Worker will start syncing in 60 seconds.`);
            process.exit(0);
        })();
    } else {
        // Handle API/HTTP type (existing behavior)
        const targetUrl    = args.includes('--url') ? args[args.indexOf('--url') + 1] : null;
    const targetKey    = args.includes('--key') ? args[args.indexOf('--key') + 1] : null;
    const targetStore  = args.includes('--store-type') ? args[args.indexOf('--store-type') + 1] : null;
    const targetSecret = args.includes('--secret-name') ? args[args.indexOf('--secret-name') + 1] : null;
    const inferredType = targetUrl && (targetUrl.includes('localhost') || targetUrl.includes('127.0.0.1')) ? 'local' : 'remote';
    const resolvedType = targetType || inferredType;

    if (!targetUrl) {
        console.error('❌ Usage: lc add-target --url <url> [--key <lc_xxx...>] [--store-type <type>] [--secret-name <name>] [--type local|remote]');
        console.error('       or: lc add-target --type jira --domain <domain> --email <email> --project-key <key> [--token-env <env>]');
        process.exit(1);
    }

    if (!cfg.collectors) cfg.collectors = [];
    const alreadyExists = cfg.collectors.some(c => c.url === targetUrl);

    const newConfig = {
        url: targetUrl,
        enabled: true,
        type: resolvedType,
        token: null
    };
    if (targetStore) newConfig.store_type = targetStore;
    if (targetSecret) newConfig.secret_name = targetSecret;

    if (alreadyExists) {
        const existingIdx = cfg.collectors.findIndex(c => c.url === targetUrl);
        cfg.collectors[existingIdx] = { ...cfg.collectors[existingIdx], ...newConfig };
        console.log(`ℹ️  Target ${targetUrl} updated.`);
    } else {
        cfg.collectors.push(newConfig);
        console.log(`✅ Target added: ${targetUrl} (type: ${resolvedType})`);
    }

    writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');

    const newIdx = cfg.collectors.findIndex(c => c.url === targetUrl);

    if (targetKey && targetStore !== 'gcp-secret') {
        let envContent = existsSync(join(projectRoot, '.env')) ? readFileSync(join(projectRoot, '.env'), 'utf8') : '';
        const envKey = `COLLECTOR_${newIdx}_TOKEN`;
        if (envContent.includes(`${envKey}=`)) {
            envContent = envContent.replace(new RegExp(`${envKey}=.*`), `${envKey}=${targetKey}`);
        } else {
            envContent += `\n${envKey}=${targetKey}\n`;
        }
        writeFileSync(join(projectRoot, '.env'), envContent.trim() + '\n');
        console.log(`   Key saved to .env (COLLECTOR_${newIdx}_TOKEN)`);
    } else if (targetStore === 'gcp-secret' && targetSecret) {
        console.log(`   Auth: GCP Secret Manager (${targetSecret})`);
    }

    // Trigger initial bidirectional sync so the new target gets the current state
    console.log(`\n🔄 Running initial sync with new target...`);
    const syncScript = join(getInstallPath(), 'conductor', 'remote-sync.mjs');
    if (existsSync(syncScript)) {
        spawnSync(process.execPath, [syncScript], { stdio: 'inherit', cwd: projectRoot });
    } else {
        console.warn('   ⚠️  remote-sync.mjs not found — skipping initial sync.');
        console.log('   Run "lc remote-sync" manually to sync this project to the new target.');
    }

    process.exit(0);
    }
} else if (command === 'remove-target') {
    // lc remove-target <url>
    if (!projectRoot) {
        console.error('❌ No LaneConductor project found.');
        process.exit(1);
    }
    const cfgPath = join(projectRoot, '.laneconductor.json');
    const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));

    const targetUrl = args[1] === '--url' ? args[2] : (args[1] && !args[1].startsWith('--') ? args[1] : null);

    if (!targetUrl) {
        console.error('❌ Usage: lc remove-target <url>');
        process.exit(1);
    }

    if (!cfg.collectors) cfg.collectors = [];
    const existingIdx = cfg.collectors.findIndex(c => c.url === targetUrl);
    
    if (existingIdx === -1) {
        console.log(`ℹ️  Target ${targetUrl} not found in collectors.`);
        process.exit(0);
    }
    
    // Remember tokens to shift them successfully without losing credentials
    const envPath = join(projectRoot, '.env');
    let envLines = existsSync(envPath) ? readFileSync(envPath, 'utf8').split('\n') : [];
    
    const tokens = cfg.collectors.map((c, i) => {
        const m = envLines.find(l => l.startsWith(`COLLECTOR_${i}_TOKEN=`));
        return m ? m.split('=')[1] : null;
    });
    
    // Remove target
    cfg.collectors.splice(existingIdx, 1);
    tokens.splice(existingIdx, 1);
    
    writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
    
    // Rewrite env by omitting all old COLLECTOR_n_TOKEN lines and applying the shifted array
    envLines = envLines.filter(l => !l.startsWith('COLLECTOR_'));
    tokens.forEach((t, i) => {
        if (t) envLines.push(`COLLECTOR_${i}_TOKEN=${t}`);
    });
    
    const envText = envLines.join('\n');
    writeFileSync(envPath, envText + (envText.endsWith('\n') || envText.length === 0 ? '' : '\n'));
    
    console.log(`✅ Target removed: ${targetUrl}`);
    process.exit(0);
} else if (command === 'enable-target' || command === 'disable-target') {
    if (!projectRoot) { process.exit(1); }
    const cfgPath = join(projectRoot, '.laneconductor.json');
    const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));

    const targetUrl = args[1] === '--url' ? args[2] : (args[1] && !args[1].startsWith('--') ? args[1] : null);
    if (!targetUrl) {
        console.error(`❌ Usage: lc ${command} <url>`);
        process.exit(1);
    }

    const collector = (cfg.collectors || []).find(c => c.url === targetUrl);
    if (!collector) {
        console.error(`❌ Target ${targetUrl} not found.`);
        process.exit(1);
    }

    collector.enabled = (command === 'enable-target');
    writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
    console.log(`✅ Target ${targetUrl} is now ${collector.enabled ? 'ENABLED' : 'DISABLED'}`);
    process.exit(0);
} else if (command === 'list-targets') {
    if (!projectRoot) {
        console.error('❌ No LaneConductor project found in this directory or parents.');
        process.exit(1);
    }
    const cfgPath = join(projectRoot, '.laneconductor.json');
    const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));

    // Load tokens from .env
    let envContent = '';
    const envPath = join(projectRoot, '.env');
    if (existsSync(envPath)) envContent = readFileSync(envPath, 'utf8');
    const getEnvToken = (idx) => {
        const match = envContent.match(new RegExp(`COLLECTOR_${idx}_TOKEN=([^\n]+)`));
        return match ? match[1].trim() : null;
    };

    const mode = cfg.mode || 'local-fs';
    const collectors = cfg.collectors || [];

    console.log(`\n🎯 LaneConductor Targets  (${projectRoot})\n`);
    console.log(`   Mode : ${mode}`);
    console.log(`   Project : ${cfg.project?.name || '(unnamed)'} (id: ${cfg.project?.id || 'none'})\n`);

    if (collectors.length === 0) {
        console.log('   (no collectors configured — running in local-fs mode)');
    } else {
        collectors.forEach((c, i) => {
            const status = c.enabled !== false ? '✅' : '❌';

            // Handle Jira collectors separately
            if (c.type === 'jira') {
                let authDisplay = '';
                if (c.token_env) {
                    authDisplay = `🔑 Env var (${c.token_env})`;
                } else if (c.token_store_type === 'gcp-secret' && c.token_secret_name) {
                    authDisplay = `🔒 GCP Secret (${c.token_secret_name})`;
                } else if (c.token) {
                    authDisplay = `🔑 Inline token (⚠️  INSECURE)`;
                } else {
                    authDisplay = `⚠️  UNSECURED (No token provided)`;
                }

                console.log(`   [${i}] ${status} 🔗 jira   ${c.project_key} @ ${c.domain}`);
                console.log(`       Email: ${c.email}`);
                console.log(`       Auth: ${authDisplay}`);
                return;
            }

            // Handle HTTP/API collectors
            const envToken = getEnvToken(i);
            const inlineToken = c.token || c.machine_token;
            let authDisplay = '';

            if (c.store_type === 'gcp-secret') {
                authDisplay = `🔒 GCP Secret Manager (${c.secret_name})`;
            } else if (envToken) {
                authDisplay = `🔑 Token (from .env COLLECTOR_${i}_TOKEN) - ${envToken.slice(0, 16)}…`;
            } else if (inlineToken) {
                authDisplay = `🔑 Token (machine_token) - ${String(inlineToken).slice(0, 16)}…`;
            } else if (c.type === 'local' || c.url.includes('localhost') || c.url.includes('127.0.0.1')) {
                authDisplay = `🔓 None (local-api)`;
            } else {
                authDisplay = `⚠️  UNSECURED (No key provided)`;
            }

            const isLocal = c.type === 'local' || c.url.includes('localhost') || c.url.includes('127.0.0.1');
            const tag = isLocal ? '🏠 local ' : '☁️  remote';
            console.log(`   [${i}] ${status} ${tag}  ${c.url}`);
            console.log(`       Auth: ${authDisplay}`);
        });
    }
    console.log('');
    process.exit(0);
} else if (command === 'verify-isolation') {
    // Verify that the worker environment is correctly sandboxed
    if (!projectRoot) {
        console.error('❌ Error: No LaneConductor project found in this directory or parents.');
        process.exit(1);
    }

    const { resolve: pathResolve } = require('path');
    const projectRootResolved = resolve(projectRoot);
    const worktreeDir = resolve(projectRootResolved, '.git/worktrees');
    let passedTests = 0;
    let totalTests = 0;

    console.log('🔒 Verifying worker path isolation...\n');

    // Test 1: Check that .git/worktrees exists
    totalTests++;
    if (existsSync(worktreeDir)) {
        console.log('✅ Test 1: .git/worktrees directory exists');
        passedTests++;
    } else {
        console.log('❌ Test 1: .git/worktrees directory not found (expected at ' + worktreeDir + ')');
    }

    // Test 2: Check for path traversal attempts
    totalTests++;
    const testPaths = ['../../../etc/passwd', '../../.env', '../.env'];
    let pathTraversalRisk = false;
    for (const testPath of testPaths) {
        try {
            const fullPath = resolve(worktreeDir, testPath);
            if (!fullPath.startsWith(projectRootResolved)) {
                pathTraversalRisk = true;
                break;
            }
        } catch (e) {
            // realpath will fail on nonexistent paths, which is good
        }
    }
    if (!pathTraversalRisk) {
        console.log('✅ Test 2: Path traversal attempts are blocked');
        passedTests++;
    } else {
        console.log('❌ Test 2: Path traversal vulnerability detected');
    }

    // Test 3: Check for .laneconductor.json and .env existence (should exist in project root, not in worktrees)
    totalTests++;
    const configPath = resolve(projectRootResolved, '.laneconductor.json');
    const envPath = resolve(projectRootResolved, '.env');
    if (existsSync(configPath) && existsSync(envPath)) {
        console.log('✅ Test 3: Config files exist in project root (protected from worktrees)');
        passedTests++;
    } else {
        console.warn(`⚠️  Test 3: Missing config files (${!existsSync(configPath) ? '.laneconductor.json' : ''} ${!existsSync(envPath) ? '.env' : ''})`);
        if (!existsSync(configPath) || !existsSync(envPath)) passedTests++;
    }

    // Test 4: Verify .gitignore protects sensitive files
    totalTests++;
    const gitignorePath = resolve(projectRootResolved, '.gitignore');
    let gitignoreOk = true;
    if (existsSync(gitignorePath)) {
        const gitignore = readFileSync(gitignorePath, 'utf8');
        if (!gitignore.includes('.env')) {
            console.warn('⚠️  Warning: .env is not in .gitignore');
            gitignoreOk = false;
        }
    } else {
        console.warn('⚠️  Warning: .gitignore not found');
        gitignoreOk = false;
    }
    if (gitignoreOk) {
        console.log('✅ Test 4: Sensitive files are protected in .gitignore');
        passedTests++;
    } else {
        console.log('⚠️  Test 4: .gitignore may need updates');
    }

    console.log(`\n📊 Results: ${passedTests}/${totalTests} tests passed`);
    process.exit(passedTests === totalTests ? 0 : 1);
} else if (command === 'worktrees') {
    // Track 1112 Phase 2/4: local, zero-infrastructure worktree visibility
    // + manual merge. Deliberately reads git + `conductor/tracks/**/index.md`
    // directly — no API, no DB — so it works identically in every mode,
    // including local-fs (REQ-2/AC-3).
    if (!projectRoot) {
        console.error('❌ Error: No LaneConductor project found in this directory or parents.');
        process.exit(1);
    }

    let mainBranch = 'main';
    try {
        const remoteInfo = execSync('git remote show origin', { cwd: projectRoot, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
        const m = remoteInfo.match(/HEAD branch: (.*)/);
        if (m?.[1]) mainBranch = m[1].trim();
    } catch (e) {
        try {
            const branches = execSync('git branch -a', { cwd: projectRoot, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
            if (branches.includes('remotes/origin/master') && !branches.includes('remotes/origin/main')) mainBranch = 'master';
        } catch (e2) { /* fall back to 'main' */ }
    }

    const sub = args[1];

    if (sub === 'merge') {
        const trackNumber = args[2];
        if (!trackNumber) {
            console.error('Usage: lc worktrees merge <track-number> [--dry-run] [--force]');
            process.exit(2);
        }
        const dryRun = args.includes('--dry-run');
        const force = args.includes('--force');

        const rows = await auditWorktrees({ repoRoot: projectRoot, mainBranch });
        const row = rows.find(r => r.trackNumber === String(trackNumber));
        const isDoneSuccess = row?.lane === 'done' && row?.laneStatus === 'success';

        if (!row) {
            console.error(`❌ No unmerged track-${trackNumber} branch found (already merged, or never existed).`);
            process.exit(1);
        }
        if (!isDoneSuccess && !force) {
            console.error(`❌ Track ${trackNumber} is not at done:success (lane: ${row.lane ?? 'unknown'}, status: ${row.laneStatus ?? 'unknown'}) — refusing to merge. Pass --force to override.`);
            process.exit(1);
        }

        if (dryRun) {
            if (row.classification === 'conflicted') {
                console.log(`⚠️  track-${trackNumber} would CONFLICT merging into ${mainBranch}.`);
            } else {
                console.log(`✅ track-${trackNumber} would merge cleanly into ${mainBranch}.`);
            }
            process.exit(0);
        }

        const result = await mergeWorktreeBranch({ repoRoot: projectRoot, trackNumber: String(trackNumber), mainBranch });
        if (result.merged) {
            // mergeWorktreeBranch() already removed the original per-track
            // worktree itself (must happen before branch -d, not after —
            // see that function's doc comment for the real bug this fixed).
            console.log(`✅ Merged track-${trackNumber} into ${mainBranch} (${result.mergeCommit})`);
            process.exit(0);
        } else if (result.reason === 'conflict') {
            console.error(`❌ Merge conflict — the following paths conflict with ${mainBranch}:`);
            for (const p of result.conflictPaths || []) console.error(`   ${p}`);
            console.error(`Branch and worktree left intact for manual resolution.`);
            process.exit(1);
        } else {
            console.error(`❌ Branch track-${trackNumber} not found.`);
            process.exit(1);
        }
    }

    const asJson = args.includes('--json');
    const strandedOnly = args.includes('--stranded');

    let rows;
    try {
        rows = await auditWorktrees({ repoRoot: projectRoot, mainBranch });
    } catch (e) {
        console.error(`❌ Failed to audit worktrees: ${e.message}`);
        process.exit(1);
    }
    if (strandedOnly) rows = rows.filter(r => r.classification === 'stranded');

    if (asJson) {
        console.log(JSON.stringify(rows.map(r => ({
            track: r.trackNumber, title: r.title, lane: r.lane, lane_status: r.laneStatus,
            ahead: r.ahead, behind: r.behind, dirty: r.dirtyCount, class: r.classification,
        })), null, 2));
        process.exit(0);
    }

    if (rows.length === 0) {
        console.log('✅ No unmerged worktrees or branches — nothing to show.');
        process.exit(0);
    }

    const classIcon = { mergeable: '🟢', stranded: '🔴', conflicted: '🟠', open: '⚪', detached: '🟣' };
    console.log(`\n🌳 Worktrees (${rows.length}) — main: ${mainBranch}\n`);
    for (const r of rows) {
        const icon = classIcon[r.classification] || '•';
        const track = r.trackNumber ? `${r.trackNumber}` : '(no track)';
        const title = r.title ? ` ${r.title}` : (r.branch ? ` [${r.branch}]` : '');
        const lane = r.lane ? `${r.lane}:${r.laneStatus ?? '?'}` : '-';
        const ahead = r.ahead ?? '-';
        const behind = r.behind ?? '-';
        const dirty = r.dirtyCount ?? '-';
        console.log(`${icon} ${track}${title}`);
        console.log(`   class=${r.classification}  lane=${lane}  ahead=${ahead}  behind=${behind}  dirty=${dirty}  worktree=${r.hasWorktree ? 'yes' : 'no'}`);
    }

    // Open-worktree cap warning (non-blocking) — plan.md Phase 2: a nudge
    // when a project accumulates too many simultaneously-open tracks, named
    // and pointed at the oldest ones so a human can triage. Never blocks
    // creating a new worktree.
    const OPEN_WARN_THRESHOLD = 10;
    const openRows = rows.filter(r => r.classification === 'open' && r.trackNumber);
    if (openRows.length > OPEN_WARN_THRESHOLD) {
        const oldest = [...openRows].sort((a, b) => parseInt(a.trackNumber, 10) - parseInt(b.trackNumber, 10)).slice(0, 5);
        console.log(`\n⚠️  ${openRows.length} open worktrees (> ${OPEN_WARN_THRESHOLD}) — consider running review/quality-gate on the oldest to close some out:`);
        for (const r of oldest) console.log(`   ${r.trackNumber}${r.title ? ' — ' + r.title : ''} (${r.lane ?? 'unknown'}:${r.laneStatus ?? '?'})`);
    }

    // Track 1112 Phase 5 / REQ-9: out-of-band divergence report — a live
    // fetch on every invocation (this command is explicitly on-demand
    // inspection, unlike the worker's periodic background check).
    try {
        const divergence = await checkDivergence({ repoRoot: projectRoot, mainBranch });
        if (!divergence.fetchOk) {
            console.log(`\n⚠️  git-sync: fetch of origin/${mainBranch} failed — divergence unknown.`);
        } else if (divergence.behind > 0) {
            console.log(`\n🔀 git-sync: local ${mainBranch} is ${divergence.behind} commit(s) behind origin/${mainBranch}` +
                (divergence.ahead > 0 ? ` and ${divergence.ahead} ahead (diverged)` : '') +
                ` — fast-forward ${divergence.canFastForward ? 'available' : 'NOT available'}.`);
        }
    } catch (e) { /* best-effort — never block the worktree listing on a network hiccup */ }

    console.log('');
    process.exit(0);
} else if (command === 'doc') {
    if (!projectRoot) { process.exit(1); }
    const [type, section, val] = [args[2], args[3], args[4]];
    const file = type === 'product' ? 'conductor/product.md' : (type === 'tech' ? 'conductor/tech-stack.md' : 'workflow.md');
    if (updateDocSection(join(projectRoot, file), section, val)) console.log('✅ Doc updated');
    process.exit(0);
} else if (command === 'show' || command === 'logs') {
    if (!projectRoot) { process.exit(1); }
    const trackNum = args[1];
    if (command === 'logs' && trackNum === 'worker-run') {
        const optionalTrackId = args[2];
        const logsDir = join(projectRoot, 'conductor', 'logs');
        if (existsSync(logsDir)) {
            let files = readdirSync(logsDir).filter(f => f.endsWith('.log'));
            if (optionalTrackId) files = files.filter(f => f.includes(`-${optionalTrackId}-`));

            if (files.length > 0) {
                const latestFile = files
                    .map(f => ({ name: f, time: statSync(join(logsDir, f)).mtime.getTime() }))
                    .sort((a, b) => b.time - a.time)[0].name;
                console.log(`\n--- Most recent worker run${optionalTrackId ? ` for track ${optionalTrackId}` : ''}: ${latestFile} ---\n`);
                console.log(readFileSync(join(logsDir, latestFile), 'utf8').split('\n').slice(-100).join('\n'));
            } else {
                console.log(`No worker run logs found${optionalTrackId ? ` for track ${optionalTrackId}` : ''}.`);
            }
        } else {
            console.log('Logs directory not found at ' + logsDir);
        }
        process.exit(0);
    }
    if (command === 'logs' && trackNum === 'worker') {
        const isManager = args.includes('--manager');
        const workerNumber = isManager ? 1 : resolveWorkerNumber(args);
        const syncLog = isManager
            ? join(projectRoot, 'conductor', '.manager.log')
            : join(projectRoot, 'conductor', workerNumber === 1 ? '.sync.log' : `.sync-${workerNumber}.log`);
        if (existsSync(syncLog)) {
            console.log(readFileSync(syncLog, 'utf8').split('\n').slice(-50).join('\n'));
        } else {
            console.log('Sync log not found at ' + syncLog);
        }
        process.exit(0);
    }

    const tracksDir = join(projectRoot, 'conductor', 'tracks');
    const dir = readdirSync(tracksDir).find(d => d.startsWith(`${trackNum}-`));
    if (!dir) {
        // Fallback: try DB for local-api mode
        const cfg = JSON.parse(readFileSync(join(projectRoot, '.laneconductor.json'), 'utf8'));
        if (cfg.mode !== 'local-fs' && cfg.db) {
            const { host = 'localhost', port = 5432, name, user = 'postgres', password = 'postgres' } = cfg.db;
            const psql = spawnSync('psql', [
                '-h', host, '-p', String(port), '-U', user, '-d', name, '-t', '-A', '-F', '\x01', '-c',
                `SELECT title, lane_status, lane_action_status, progress_percent, index_content, plan_content, spec_content FROM tracks t JOIN projects p ON p.id = t.project_id WHERE p.repo_path = '${projectRoot}' AND t.track_number = '${trackNum}'`
            ], { env: { ...process.env, PGPASSWORD: password } });
            if (psql.status === 0) {
                const row = psql.stdout.toString().trim().split('\x01');
                if (row.length >= 4) {
                    const [title, lane, status, progress, indexContent, planContent, specContent] = row;
                    console.log(`\nTrack ${trackNum}: ${title}`);
                    console.log(`Lane: ${lane} | Status: ${status} | Progress: ${progress}%\n`);
                    if (indexContent && indexContent.trim()) { console.log('--- index.md ---\n' + indexContent); }
                    else { console.log(`# Track ${trackNum}: ${title}\n\n**Lane**: ${lane}\n**Lane Status**: ${status}\n**Progress**: ${progress}%`); }
                    if (planContent && planContent.trim()) { console.log('\n--- plan.md ---\n' + planContent); }
                    if (specContent && specContent.trim()) { console.log('\n--- spec.md ---\n' + specContent); }
                    console.log('\n(shown from DB — local folder not yet created)');
                    process.exit(0);
                }
            }
        }
        console.error(`Not found: no local folder for track ${trackNum}`);
        process.exit(1);
    }
    const trackPath = join(tracksDir, dir);

    if (command === 'show') {
        console.log(readFileSync(join(trackPath, 'index.md'), 'utf8'));
        if (existsSync(join(trackPath, 'plan.md'))) console.log(readFileSync(join(trackPath, 'plan.md'), 'utf8'));
    }
    if (existsSync(join(trackPath, 'last_run.log'))) {
        console.log('\n--- LOGS ---');
        console.log(readFileSync(join(trackPath, 'last_run.log'), 'utf8').split('\n').slice(-30).join('\n'));
    }
    process.exit(0);
} else if (command === 'verify' || command === 'quality-gate') {
    if (!projectRoot) { process.exit(1); }
    const script = join(projectRoot, command === 'verify' ? 'conductor/lc-verify.sh' : 'conductor/mock-quality-gate.sh');
    if (existsSync(script)) spawnSync('bash', [script], { stdio: 'inherit' });
    else console.log(`⚠️ ${script} not found`);
    process.exit(0);
} else if (command === 'remote-sync' || command === 'init-summary') {
    if (!projectRoot) { process.exit(1); }
    const script = join(getInstallPath(), 'conductor', command === 'remote-sync' ? 'remote-sync.mjs' : 'init-tracks-summary.mjs');
    spawnSync('node', [script], { stdio: 'inherit', cwd: projectRoot });
    process.exit(0);
} else if (command === 'delete' || command === 'remove') {
    if (!projectRoot) { console.error('❌ Error: No Project Root found.'); process.exit(1); }
    const trackNum = args[1];
    if (!trackNum) { console.log('❌ Usage: lc delete <track-number>'); process.exit(1); }

    const cfg = JSON.parse(readFileSync(join(projectRoot, '.laneconductor.json'), 'utf8'));
    const tracksDir = join(projectRoot, 'conductor', 'tracks');

    // Delete filesystem folder (all modes)
    if (existsSync(tracksDir)) {
        const dir = readdirSync(tracksDir).find(d => d.startsWith(`${trackNum}-`));
        if (dir) {
            rmSync(join(tracksDir, dir), { recursive: true, force: true });
            console.log(`🗑  Deleted folder: ${dir}`);
        }
    }

    // Delete from DB via API (local-api / remote-api)
    if (cfg.mode !== 'local-fs') {
        const collector = cfg.collectors?.[0];
        if (collector?.url && cfg.project?.id) {
            try {
                const headers = { 'Content-Type': 'application/json' };
                if (collector.machine_token) headers['x-machine-token'] = collector.machine_token;
                const r = await fetch(`${collector.url}/api/projects/${cfg.project.id}/tracks/${trackNum}`, { method: 'DELETE', headers });
                if (!r.ok) { const t = await r.text(); console.warn(`⚠️  API delete failed: ${t}`); }
                else { console.log(`🗑  Deleted from DB`); }
            } catch (e) { console.warn(`⚠️  API unreachable: ${e.message}`); }
        }
    }

    console.log(`✅ Track ${trackNum} deleted`);
    process.exit(0);
// 'install' command removed — chokidar/pg are deps of the laneconductor repo itself (covered by make install)
} else {
    console.log(`Unknown command: ${command}`);
    process.exit(1);
}
