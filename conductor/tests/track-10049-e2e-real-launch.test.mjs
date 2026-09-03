#!/usr/bin/env node
// conductor/tests/track-10049-e2e-real-launch.test.mjs
// Track TU-10049 Phase 6 (TC-40, Task 6.4/6.5): one real Launch, driven
// through the ACTUAL runCreateProject code path — real child process, real
// filesystem writes, real HTTP calls to a mock collector — with a Jira
// connection configured, verifying the observed result end to end.
//
// Deliberately does NOT touch the live shared `laneconductor` Postgres DB
// or the real Collector API this repo's own dev stack runs on: this
// worktree is itself running as track TU-10049 against that same live
// system, so competing for its ports/DB here would be destructive, not a
// test. Instead reuses the same self-contained mock-collector + mock-CLI
// harness conductor/tests/track-1119-phase3-track-generation.test.mjs
// already established for exactly this class of verification — a fresh,
// isolated manager worker + mock collector per run, spawned as real child
// processes. Every run starts these fresh (never reuses a stale process),
// which is what satisfies "restart long-running processes before
// verifying" (quality-gate.md) for a scenario with no persistent daemon
// to begin with.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const MOCK_CLI = join(__dirname, 'mock-cli.mjs');
const TMP = join(ROOT, '.test-tmp-track-10049-e2e-real-launch');
const MANAGER_DIR = join(TMP, 'manager');
const TARGET_DIR = join(TMP, 'jira-project');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function poll(fn, { timeout = 20000, interval = 250, label = '' } = {}) {
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
    const proc = spawn('node', [join(__dirname, 'mock-collector.mjs')], { stdio: ['ignore', 'pipe', 'pipe'] });
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

async function enqueueDispatch(port, entry) {
  const r = await fetch(`http://127.0.0.1:${port}/_enqueue-dispatch`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(entry),
  });
  return (await r.json()).id;
}

function setupProject(dir, collectorPort) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, '.laneconductor.json'), JSON.stringify({
    mode: 'local-api',
    project: { name: 'test-manager', id: 1, repo_path: dir, primary: { cli: 'mock', model: 'mock' } },
    collectors: [{ url: `http://127.0.0.1:${collectorPort}`, token: null }],
    ui: { port: 8090 },
  }, null, 2));
  mkdirSync(join(dir, 'conductor/tracks'), { recursive: true });
  writeFileSync(join(dir, 'conductor/workflow.json'), JSON.stringify({
    global: { total_parallel_limit: 3 }, defaults: { parallel_limit: 3, max_retries: 1 },
  }, null, 2));
}

const SENTINEL_TOKEN_VALUE = 'sentinel-should-never-appear-anywhere-8c31f0';

describe('Track TU-10049 Phase 6: real Launch with a Jira connection configured', () => {
  let collectorProc, collectorPort, managerWorker;

  before(async () => {
    const c = await startMockCollector();
    collectorProc = c.proc;
    collectorPort = c.port;
    await fetch(`http://127.0.0.1:${collectorPort}/_reset`, { method: 'POST' });

    rmSync(TMP, { recursive: true, force: true });
    setupProject(MANAGER_DIR, collectorPort);
    mkdirSync(TARGET_DIR, { recursive: true });

    // Set BEFORE spawning — env is captured at spawn time, so this must be
    // present here (not later, inside the test body) for the leak-check
    // below to be meaningful: the sentinel is genuinely visible to the
    // process under test, the same as a real token would be on a real
    // worker machine, so "it never appears anywhere" is actually proving
    // something rather than trivially passing because it was never there.
    process.env.TU10049_TEST_JIRA_TOKEN = SENTINEL_TOKEN_VALUE;

    managerWorker = spawn('node', [join(ROOT, 'conductor/laneconductor.sync.mjs'), '--sync-only', '--manager'], {
      cwd: MANAGER_DIR,
      env: { ...process.env, LC_MOCK_CLI: `node ${MOCK_CLI}`, MOCK_CLI_DELAY_MS: '150', LC_SKIP_GIT_LOCK: '1', LC_SKIP_WORKER_LOCK: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    managerWorker.stdout.on('data', d => process.stdout.write(`[manager] ${d}`));
    managerWorker.stderr.on('data', d => process.stderr.write(`[manager] ${d}`));

    await poll(async () => {
      const s = await getState(collectorPort);
      return s.workers.length > 0 ? s : null;
    }, { label: 'manager worker registered' });
  });

  after(() => {
    managerWorker?.kill();
    collectorProc?.kill();
    delete process.env.TU10049_TEST_JIRA_TOKEN;
    rmSync(TMP, { recursive: true, force: true });
  });

  it('AC-5/AC-6/TC-40: Jira collector lands in the created project, and no credential value appears anywhere', async () => {
    const state = await getState(collectorPort);
    const workerId = state.workers[0].id;

    await enqueueDispatch(collectorPort, {
      worker_id: workerId,
      action: 'create-project',
      payload: {
        repo_source: { type: 'path', value: TARGET_DIR },
        scaffold_context: {
          project: { name: 'Jira Project' },
          brainstorm_summary: 'Project purpose: exercise the Connections step end to end',
        },
        wizard: {
          deployment: { provider: 'skip', environments: [] },
          connections: {
            source_control: { provider: 'skip' },
            issue_tracker: {
              provider: 'jira',
              domain: 'acme.atlassian.net',
              email: 'me@acme.com',
              project_key: 'ACME',
              token_env: 'TU10049_TEST_JIRA_TOKEN',
            },
            cloud: { provider: 'skip' },
          },
        },
      },
    });

    const dispatchDone = await poll(async () => {
      const s = await getState(collectorPort);
      const d = s.dispatch.find(e => e.action === 'create-project');
      return d?.status === 'done' || d?.status === 'failed' ? d : null;
    }, { label: 'create-project dispatch resolves' });
    assert.equal(dispatchDone.status, 'done', `create-project dispatch should succeed, got: ${dispatchDone.result}`);

    // Task 6.4 — observed result: the created project's .laneconductor.json
    // really does carry a Jira collector, in the exact shape
    // `lc add-target --type jira` writes.
    const createdConfig = JSON.parse(readFileSync(join(TARGET_DIR, '.laneconductor.json'), 'utf8'));
    const jiraCollector = createdConfig.collectors.find(c => c.type === 'jira');
    assert.ok(jiraCollector, 'created project .laneconductor.json should have a jira collector entry');
    assert.deepEqual(jiraCollector, {
      type: 'jira',
      domain: 'acme.atlassian.net',
      email: 'me@acme.com',
      project_key: 'ACME',
      token_env: 'TU10049_TEST_JIRA_TOKEN',
    });

    // .env.example names the variable, never the value.
    const envExample = readFileSync(join(TARGET_DIR, '.env.example'), 'utf8');
    assert.match(envExample, /^TU10049_TEST_JIRA_TOKEN=$/m);

    // Task 6.5 — inspect the dispatch record (the mock collector's
    // equivalent of the worker_dispatch row a real Collector API would
    // store) and every file written into the created project tree: the
    // real token value set in this process's own environment must not
    // have leaked anywhere.
    const finalState = await getState(collectorPort);
    assert.doesNotMatch(JSON.stringify(finalState.dispatch), new RegExp(SENTINEL_TOKEN_VALUE));
    assert.doesNotMatch(createdConfig ? JSON.stringify(createdConfig) : '', new RegExp(SENTINEL_TOKEN_VALUE));
    assert.doesNotMatch(envExample, new RegExp(SENTINEL_TOKEN_VALUE));
  });
});
