#!/usr/bin/env node
// conductor/tests/track-10062-auth-required.test.mjs
//
// End-to-end regressions for the three defects in this track's spec: an
// expired `claude` CLI login (confirmed live 2026-09-04: "Failed to
// authenticate: OAuth session expired and could not be refreshed", exit 1)
// was previously indistinguishable from a genuine rate limit —
// (1) provider_status said 'exhausted' with a rolling, ever-advancing
// reset_at guess, (2) isProviderAvailable() re-marked the provider
// available every time that rolling stamp elapsed, burning a real dispatch
// attempt each cycle, and (3) the blocked dispatch's own result said only
// 'no provider available', naming neither cause nor remedy.
//
// Driven through a real worker process (local-api mode) + a substitute
// `claude` binary on PATH (fake-claude-auth.mjs) + the mock collector
// (mock-target.mjs) — never a real `claude` login, so results don't depend
// on the developer's own auth state. Explicit dispatch (_enqueue-dispatch)
// is used rather than the general queue: it exercises the exact same
// buildCliArgs()/checkClaudeCapacity()/isProviderAvailable() decision path
// this track changed, deterministically, one call at a time.
//
// Run: node --test conductor/tests/track-10062-auth-required.test.mjs

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const FAKE_CLAUDE = join(__dirname, 'fake-claude-auth.mjs');
// Suffixed with this process's own pid: two concurrent invocations of this
// file (e.g. a retried/orphaned run overlapping a fresh one) must never
// share one sandbox directory — confirmed live during this track's own
// development as a real ENOENT crash (one run's setupProject() deleting
// the directory out from under another run's still-live worker).
const TMP = join(ROOT, `.test-tmp-track-10062-auth-required-${process.pid}`);
const BIN = join(TMP, 'bin');

const OAUTH_EXPIRED_OUTPUT = 'Failed to authenticate: OAuth session expired and could not be refreshed';
const RATE_LIMITED_OUTPUT = "You've hit your limit · resets 3pm (Europe/Berlin)";

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function poll(fn, { timeout = 45000, interval = 300, label = '' } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await fn();
    if (result) return result;
    await sleep(interval);
  }
  throw new Error(`poll timeout (${timeout}ms)${label ? ': ' + label : ''}`);
}

function startMockCollector() {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [join(__dirname, 'mock-target.mjs')], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    proc.stdout.on('data', d => {
      out += d.toString();
      const m = out.match(/MOCK_COLLECTOR_PORT=(\d+)/);
      if (m) resolve({ proc, port: parseInt(m[1]) });
    });
    proc.stderr.on('data', d => process.stderr.write(`[mock-collector] ${d}`));
    proc.on('error', reject);
    setTimeout(() => reject(new Error('mock-collector startup timeout')), 5000);
  });
}

async function getState(port) {
  const r = await fetch(`http://127.0.0.1:${port}/_state`);
  return r.json();
}

async function resetState(port) {
  await fetch(`http://127.0.0.1:${port}/_reset`, { method: 'POST' });
}

// mock-target.mjs's nextWorkerId counter is NOT reset by /_reset (only on
// process start), so each test in this file registers under a different,
// incrementing worker id. Hardcoding one would silently orphan dispatch
// entries — the worker only fetches its OWN inbox (GET /worker/:id/dispatch).
async function waitForWorkerId(port) {
  return poll(async () => {
    const state = await getState(port);
    return state.workers.at(-1)?.id ?? null;
  }, { label: 'worker registration' });
}

async function enqueueDispatch(port, entry) {
  const r = await fetch(`http://127.0.0.1:${port}/_enqueue-dispatch`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(entry),
  });
  return (await r.json()).id;
}

function setControl(exitCode, output) {
  writeFileSync(join(TMP, 'claude-control.json'), JSON.stringify({ exitCode, output }));
}

function setupProject(collectorPort) {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
  mkdirSync(BIN, { recursive: true });

  // resolvePrimaryRepoRoot() (conductor/services/worktree-merge.mjs, used
  // by checkDispatchInbox's dispatch resolution) walks up via `git
  // rev-parse` regardless of LC_SKIP_CWD_NORMALIZATION, which only gates
  // the STARTUP chdir. This whole test suite runs from inside a git
  // worktree, so TMP being a plain non-git directory would make
  // resolvePrimaryRepoRoot resolve to the ENCLOSING worktree's own primary
  // checkout instead of TMP itself — confirmed live during this track's
  // own development (see the fix-up commit). Giving TMP its own git repo
  // makes git-dir === git-common-dir, so resolvePrimaryRepoRoot correctly
  // returns TMP unchanged.
  execFileSync('git', ['init', '-q'], { cwd: TMP });

  const wrapper = `#!/usr/bin/env bash\nexec node "${FAKE_CLAUDE}" "$@"\n`;
  const claudeBinPath = join(BIN, 'claude');
  writeFileSync(claudeBinPath, wrapper, 'utf8');
  execFileSync('chmod', ['755', claudeBinPath]);

  const collectorUrl = `http://127.0.0.1:${collectorPort}`;
  writeFileSync(join(TMP, '.laneconductor.json'), JSON.stringify({
    mode: 'local-api',
    project: { name: 'test-project-10062', id: 1, repo_path: TMP, primary: { cli: 'claude', model: 'default' } },
    collectors: [{ url: collectorUrl, token: null }],
    ui: { port: 8090 },
  }, null, 2));

  mkdirSync(join(TMP, 'conductor/tracks'), { recursive: true });
  writeFileSync(join(TMP, 'conductor/workflow.json'), JSON.stringify({
    global: { total_parallel_limit: 3 },
    defaults: { parallel_limit: 3, max_retries: 1 },
    lanes: { implement: { parallel_limit: 3, max_retries: 1 } },
  }, null, 2));

  const trackDir = join(TMP, 'conductor/tracks', '5001-test-track');
  mkdirSync(trackDir, { recursive: true });
  writeFileSync(join(trackDir, 'index.md'), [
    '# Track 5001: Test Track',
    '',
    '**Lane**: implement',
    '**Lane Status**: queue',
    '**Progress**: 0%',
  ].join('\n'));
  writeFileSync(join(trackDir, 'conversation.md'), '# Conversation: Track 5001\n');
}

function startWorker() {
  const worker = spawn('node', [join(ROOT, 'conductor/laneconductor.sync.mjs')], {
    cwd: TMP,
    // detached: true puts the worker in its own process group, so killing
    // that GROUP (see stopWorker below) also reaches grandchildren — the
    // `claude` probe/dispatch processes it spawns. Plain SIGTERM to the
    // worker alone left those orphaned, still running against TMP right as
    // the next test's setupProject() deleted it out from under them
    // ("the current working directory was deleted") — an intermittent,
    // confusing `probe_failed` a couple of tests later, confirmed live
    // during this track's own development.
    detached: true,
    env: {
      ...process.env,
      PATH: `${BIN}:${process.env.PATH}`,
      FAKE_CLAUDE_CONTROL_FILE: join(TMP, 'claude-control.json'),
      FAKE_CLAUDE_PROBE_LOG: join(TMP, 'probe-log.jsonl'),
      LC_SKIP_GIT_LOCK: '1',
      LC_SKIP_WORKER_LOCK: '1',
      // Track 10019 (REQ-1): without this, a worker launched with cwd set
      // to a sandbox nested inside a git worktree (true here — this test
      // suite runs from inside a worktree) gets its cwd normalized to the
      // PRIMARY checkout instead, and talks to the REAL local collector/DB
      // for the real project. Confirmed live during this track's own
      // development: omitting this flag corrupted the real project's
      // provider_status row and caused real lane-action churn until
      // manually fixed. Never omit this for a worker spawned with a
      // throwaway `cwd`.
      LC_SKIP_CWD_NORMALIZATION: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  worker.stdout.on('data', d => process.stdout.write(`[worker] ${d}`));
  worker.stderr.on('data', d => process.stderr.write(`[worker] ${d}`));
  return worker;
}

// Kills the worker's entire process group (negative pid) and waits for the
// worker's own 'exit' event — not a blind sleep — so the next test's
// setupProject() never races a still-alive grandchild.
function stopWorker(worker) {
  return new Promise(resolve => {
    if (worker.exitCode !== null || worker.signalCode !== null) return resolve();
    worker.once('exit', () => resolve());
    try { process.kill(-worker.pid, 'SIGTERM'); }
    catch { try { worker.kill('SIGTERM'); } catch { /* already dead */ } }
    setTimeout(() => {
      try { process.kill(-worker.pid, 'SIGKILL'); } catch { /* already dead */ }
      resolve();
    }, 3000);
  });
}

function probeCount() {
  const path = join(TMP, 'probe-log.jsonl');
  if (!existsSync(path)) return 0;
  return readFileSync(path, 'utf8').trim().split('\n').filter(Boolean)
    .map(l => JSON.parse(l)).filter(r => !r.isDispatch).length;
}

describe('Track 10062 E2E: expired CLI login vs genuine capacity exhaustion', () => {
  let collectorProc, collectorPort, worker;

  before(async () => {
    ({ proc: collectorProc, port: collectorPort } = await startMockCollector());
  });

  after(() => {
    collectorProc?.kill('SIGTERM');
    rmSync(TMP, { recursive: true, force: true });
  });

  it('TC-17/TC-18 (AC-3/AC-4): repeated dispatch attempts against a persistently expired login never get a reset_at and never get dispatched', async () => {
    await resetState(collectorPort);
    setupProject(collectorPort);
    setControl(1, OAUTH_EXPIRED_OUTPUT);
    worker = startWorker();
    const workerId = await waitForWorkerId(collectorPort);

    try {
      // Three separate explicit-dispatch cycles — each one re-runs
      // buildCliArgs()'s full availability decision from scratch.
      for (let i = 0; i < 3; i++) {
        const dispatchId = await enqueueDispatch(collectorPort, {
          worker_id: workerId, track_number: '5001', action: 'implement',
        });
        await poll(async () => {
          const state = await getState(collectorPort);
          const entry = state.dispatch.find(d => d.id === dispatchId);
          return entry?.status === 'failed' ? entry : null;
        }, { label: `dispatch cycle ${i}` });

        const state = await getState(collectorPort);
        const provider = state.providerStatus.claude;
        assert.ok(provider, `provider_status must have been posted by cycle ${i}`);
        assert.equal(provider.status, 'auth_required', `cycle ${i}: status must be auth_required, not exhausted`);
        assert.equal(provider.reset_at, null, `cycle ${i}: reset_at must stay null — this is the direct regression for the rolling 09:34→09:47 estimate`);

        const failedEntry = state.dispatch.find(d => d.track_number === '5001');
        assert.notEqual(failedEntry.result, 'no provider available');
        assert.match(failedEntry.result, /claude login/i);
      }

      // Throttle proof (capacity-probe-throttle.mjs): at least one real
      // probe must have happened (otherwise this test proves nothing), but
      // nowhere near one-per-cycle — the auto-launch loop's own 5s tick
      // also shares this cache, so an exact count is inherently racy
      // against wall-clock timing; capacity-probe-throttle.test.mjs proves
      // the throttle boundary exactly, unit-level.
      assert.ok(probeCount() >= 1, `expected at least one real probe, got ${probeCount()}`);
    } finally {
      await stopWorker(worker);
    }
  });

  it('TC-19 (AC-6): an explicit dispatch blocked by auth_required posts exactly one system comment naming the remedy', async () => {
    await resetState(collectorPort);
    setupProject(collectorPort);
    setControl(1, OAUTH_EXPIRED_OUTPUT);
    worker = startWorker();
    const workerId = await waitForWorkerId(collectorPort);

    try {
      const dispatchId = await enqueueDispatch(collectorPort, {
        worker_id: workerId, track_number: '5001', action: 'implement',
      });
      await poll(async () => {
        const state = await getState(collectorPort);
        return state.dispatch.find(d => d.id === dispatchId)?.status === 'failed';
      });

      const convPath = join(TMP, 'conductor/tracks/5001-test-track/conversation.md');
      const conv = readFileSync(convPath, 'utf8');
      const systemLines = conv.split('\n').filter(l => l.includes('> **system**:') && l.includes('⚠️'));
      assert.equal(systemLines.length, 1, `expected exactly one ⚠️ system comment, got ${systemLines.length}`);
      assert.match(systemLines[0], /claude login/i);
    } finally {
      await stopWorker(worker);
    }
  });

  it('TC-21 (AC-2): a genuine rate limit still produces exhausted with a parsed reset_at — no regression', async () => {
    await resetState(collectorPort);
    setupProject(collectorPort);
    setControl(1, RATE_LIMITED_OUTPUT);
    worker = startWorker();
    const workerId = await waitForWorkerId(collectorPort);

    try {
      const dispatchId = await enqueueDispatch(collectorPort, {
        worker_id: workerId, track_number: '5001', action: 'implement',
      });
      await poll(async () => {
        const state = await getState(collectorPort);
        return state.dispatch.find(d => d.id === dispatchId)?.status === 'failed';
      });

      const state = await getState(collectorPort);
      const provider = state.providerStatus.claude;
      assert.equal(provider.status, 'exhausted');
      assert.ok(provider.reset_at, 'exhausted must carry a parsed reset_at, unlike auth_required');
    } finally {
      await stopWorker(worker);
    }
  });

  it('TC-20 (AC-8): once the login is fixed, the next probe past the TTL returns ok and a dispatch proceeds — no worker restart', async () => {
    await resetState(collectorPort);
    setupProject(collectorPort);
    setControl(1, OAUTH_EXPIRED_OUTPUT);
    worker = startWorker();
    const workerId = await waitForWorkerId(collectorPort);

    try {
      // First: confirm it's genuinely blocked.
      const blockedId = await enqueueDispatch(collectorPort, {
        worker_id: workerId, track_number: '5001', action: 'implement',
      });
      await poll(async () => {
        const state = await getState(collectorPort);
        return state.dispatch.find(d => d.id === blockedId)?.status === 'failed';
      });
      let state = await getState(collectorPort);
      assert.equal(state.providerStatus.claude.status, 'auth_required');

      // Fix the login — same worker process, no restart, no cache flush.
      setControl(0, 'ok');

      // isProviderAvailable()'s own blocking-with-no-reset_at branch
      // (REQ-4/REQ-6) deliberately never re-probes by itself — that's what
      // stops the old "reset-time-passed" branch from optimistically
      // re-triggering a doomed dispatch every cycle. This track's
      // auto_run marker is also unset (default no, track 10017), so the
      // general auto-launch loop never calls buildCliArgs()/
      // checkClaudeCapacity() for this track at all. The ONLY thing that
      // ever re-probes is a real dispatch attempt — confirmed live during
      // this track's own development: waiting passively for an "ambient"
      // re-probe that never comes just times out. So: wait past the 60s
      // TTL deterministically, THEN make exactly one explicit dispatch —
      // that dispatch's own buildCliArgs() call is what performs the
      // genuine re-probe.
      await sleep(65000);

      const recoveredId = await enqueueDispatch(collectorPort, {
        worker_id: workerId, track_number: '5001', action: 'implement',
      });
      // checkClaudeCapacity()'s 'ok' branch deliberately never POSTs to
      // /provider-status (matching the pre-existing behaviour for a
      // healthy provider — only a blocking status is worth recording), so
      // there is no "status flips to ok" signal to poll for externally. A
      // block decision is synchronous-fast (well under a second); recovery
      // means the dispatch instead proceeds to a real, slower CLI
      // invocation. Give it a short window and confirm it was never
      // marked 'failed' with the auth reason — the direct, observable
      // proof AC-8 asks for ("a dispatch proceeds").
      await sleep(8000);
      const recoveredEntry = (await getState(collectorPort)).dispatch.find(d => d.id === recoveredId);
      assert.notEqual(recoveredEntry.status, 'failed',
        `expected recovery to let the dispatch proceed, but it was blocked: ${recoveredEntry.result}`);
    } finally {
      await stopWorker(worker);
    }
  });
});
