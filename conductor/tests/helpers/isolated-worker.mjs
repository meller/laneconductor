// conductor/tests/helpers/isolated-worker.mjs
// Track 10045 Phase 3 (REQ-1, REQ-5, REQ-6, REQ-10): the single sanctioned
// way for a test to get an isolated sandbox and spawn the real worker
// against it.
//
// Every worker-spawning test file should route through this instead of
// hand-rolling `spawn('node', [join(__dirname's-ROOT, 'conductor/laneconductor.sync.mjs')])`
// — that hand-rolled shape, with a sandbox living INSIDE the repo, is
// exactly the mechanism that caused the incident this track exists to fix
// (see conductor/tracks/AM-10045-e2e-tests-leak-real-worker-from-worktree/spec.md).
//
// Two independent safety properties, both structural rather than
// opt-in-remembered:
//   - makeSandbox() always lives OUTSIDE the repo working tree AND is its
//     own git repo, so resolvePrimaryRepoRoot() (the function whose
//     escape mechanism Phase 1 reproduced) always resolves it to itself —
//     nothing to chdir out of, regardless of which directory the calling
//     test FILE physically sits in.
//   - startIsolatedWorker() always sets LC_ASSERT_SERVING_ROOT to the
//     sandbox (Phase 2's net) and defaults collectors to a port that
//     provably refuses, so even a hypothetical future escape mechanism
//     this file doesn't anticipate fails loudly instead of silently
//     reaching a real system.

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn, execFileSync, execSync } from 'node:child_process';
import { createServer } from 'node:http';

const __dirname = dirname(fileURLToPath(import.meta.url));

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Sandbox lifecycle (Task 3.1, 3.4) ───────────────────────────────────────

/**
 * Creates a disposable sandbox: `mkdtemp` under `os.tmpdir()`, then
 * `git init` — never inside this repo's working tree (REQ-10). Also stops
 * `.test-tmp-*` directories from dirtying the checkout and blocking
 * `**Workspace**: main` lane actions, which is a real, previously
 * observed side effect of the old in-repo sandbox shape.
 *
 * @param {string} [name] - used only in the temp dir's prefix, for
 *   readability when several sandboxes exist at once during a debugging
 *   session
 * @returns {string} absolute path to the sandbox
 */
export function makeSandbox(name = 'sandbox') {
  const root = mkdtempSync(join(tmpdir(), `lc-${name}-`));
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root });
  return root;
}

/** Idempotent — safe to call more than once on the same path. */
export function cleanupSandbox(sandbox) {
  if (sandbox && existsSync(sandbox)) rmSync(sandbox, { recursive: true, force: true });
}

// ── Worker script resolution (Task 3.2) ─────────────────────────────────────

let cachedRepoRoot = null;

/**
 * Resolves the real worker script from an EXPLICIT repo root, never
 * `__dirname` of whatever test file happens to be calling this — that
 * incidental resolution is the root cause this whole track exists to fix.
 * `LC_TEST_REPO_ROOT` lets a caller override for exotic layouts (e.g. a
 * suite that wants to exercise a genuinely different checkout);
 * otherwise derived from git relative to THIS helper file's own location
 * and normalized through `resolvePrimaryRepoRoot`, so the result is
 * deliberate and independent of the calling test's own `cwd`/`__dirname`.
 */
async function resolveRepoRoot() {
  if (process.env.LC_TEST_REPO_ROOT) return process.env.LC_TEST_REPO_ROOT;
  if (cachedRepoRoot) return cachedRepoRoot;
  const { resolvePrimaryRepoRoot } = await import(join(__dirname, '../../services/worktree-merge.mjs'));
  const toplevel = execSync('git rev-parse --show-toplevel', { cwd: __dirname, encoding: 'utf8' }).trim();
  cachedRepoRoot = resolvePrimaryRepoRoot(toplevel);
  return cachedRepoRoot;
}

// ── Refusing collector port (REQ-4 default) ─────────────────────────────────

/**
 * Opens then immediately closes an ephemeral server, returning a port
 * nothing is listening on — guarantees ECONNREFUSED for any request made
 * against it for the practical lifetime of a test.
 */
async function getRefusingPort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
  });
}

function ensureSandboxConfig(sandbox, collectorPort) {
  if (existsSync(join(sandbox, '.laneconductor.json'))) return;
  writeFileSync(join(sandbox, '.laneconductor.json'), JSON.stringify({
    mode: 'local-api',
    project: { name: 'isolated-test', repo_path: sandbox, primary: { cli: 'mock', model: 'mock' } },
    collectors: [{ url: `http://127.0.0.1:${collectorPort}`, token: null }],
  }, null, 2));
  mkdirSync(join(sandbox, 'conductor/tracks'), { recursive: true });
}

// ── Spawn + teardown (Task 3.2, 3.3) ─────────────────────────────────────────

/**
 * Spawns the real worker script against an isolated sandbox.
 *
 * @param {object} opts
 * @param {string} opts.sandbox - from makeSandbox()
 * @param {string[]} [opts.args] - extra CLI args (e.g. '--sync-only')
 * @param {object} [opts.env] - extra env vars, merged over the defaults
 *   (own keys win over the helper's own defaults, so a caller CAN override
 *   LC_ASSERT_SERVING_ROOT itself if a test deliberately wants to exercise
 *   Phase 2's guard — see track-10045-assert-serving-root.test.mjs for
 *   that direct case; this helper's own default is what every OTHER
 *   suite gets for free)
 * @param {number} [opts.collectorPort] - a real mock-collector port to
 *   point at instead of the default refusing one
 * @returns {{ proc: import('child_process').ChildProcess, getOutput: () => string,
 *   waitForServingRoot: (timeoutMs?: number) => Promise<string> }}
 */
export async function startIsolatedWorker({ sandbox, args = [], env = {}, collectorPort } = {}) {
  const repoRoot = await resolveRepoRoot();
  const workerScript = join(repoRoot, 'conductor/laneconductor.sync.mjs');

  const port = collectorPort ?? await getRefusingPort();
  ensureSandboxConfig(sandbox, port);

  const proc = spawn('node', [workerScript, ...args], {
    cwd: sandbox,
    env: {
      ...process.env,
      LC_SKIP_WORKER_LOCK: '1',
      LC_ASSERT_SERVING_ROOT: sandbox,
      // Track 10066: the worker's auto-launch loop defaults to a 5s tick in
      // production; every suite that spawns the real worker through this
      // helper gets a fast 500ms tick instead, so a multi-lane-transition
      // assertion doesn't have to wait out several real seconds per step.
      // A caller's own `env` (spread below) still wins over this default.
      LC_AUTO_LAUNCH_INTERVAL_MS: '500',
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let out = '';
  const provenanceListeners = [];
  proc.stdout.on('data', d => { out += d.toString(); provenanceListeners.forEach(fn => fn()); });
  proc.stderr.on('data', d => { out += d.toString(); provenanceListeners.forEach(fn => fn()); });

  function waitForServingRoot(timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      const tryMatch = () => {
        const m = out.match(/\[LaneConductor\].*Serving from ([^\s(]+)/);
        if (m) { cleanup(); resolve(m[1]); }
      };
      const onExit = (code) => { cleanup(); reject(new Error(`worker exited (code ${code}) before provenance. Output:\n${out}`)); };
      const timer = setTimeout(() => { cleanup(); reject(new Error(`timeout waiting for provenance. Output so far:\n${out}`)); }, timeoutMs);
      function cleanup() {
        clearTimeout(timer);
        const idx = provenanceListeners.indexOf(tryMatch);
        if (idx !== -1) provenanceListeners.splice(idx, 1);
        proc.off('exit', onExit);
      }
      provenanceListeners.push(tryMatch);
      proc.on('exit', onExit);
      tryMatch();
    });
  }

  return { proc, getOutput: () => out, waitForServingRoot };
}

/**
 * Bounded SIGTERM -> SIGKILL escalation that CONFIRMS death (`kill(pid, 0)`
 * polling), not merely that a signal was sent (REQ-6, AC-7). Safe to call
 * on an already-exited process.
 */
export async function stopWorker(worker, { termMs = 3000, killMs = 2000 } = {}) {
  const proc = worker?.proc ?? worker; // accept either the object startIsolatedWorker returns, or a raw ChildProcess
  if (!proc || proc.exitCode !== null || proc.signalCode !== null) return; // already exited
  proc.kill('SIGTERM');
  const termDeadline = Date.now() + termMs;
  while (Date.now() < termDeadline) {
    try { process.kill(proc.pid, 0); } catch { return; } // ESRCH -> already dead
    await sleep(100);
  }
  try { process.kill(proc.pid, 'SIGKILL'); } catch { return; } // already gone between checks
  // SIGKILL is asynchronous too -- the OS needs a moment to actually reap
  // the process. Confirm it, don't just fire-and-return (found live: an
  // earlier version of this function returned immediately after sending
  // SIGKILL, so a caller's very next liveness check could still see the
  // process as alive).
  const killDeadline = Date.now() + killMs;
  while (Date.now() < killDeadline) {
    try { process.kill(proc.pid, 0); } catch { return; }
    await sleep(50);
  }
}
