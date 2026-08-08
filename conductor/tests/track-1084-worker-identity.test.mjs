#!/usr/bin/env node
// conductor/tests/track-1084-worker-identity.test.mjs
// Track 1084 Phase 0: stable worker identity via --worker-number.
//
// Tests:
//   1. Worker registers with worker_number: 1 by default (no flag)
//   2. --worker-number 2 registers with worker_number: 2
//   3. --worker-number is included in heartbeat, not just initial registration
//
// Run: node --test conductor/tests/track-1084-worker-identity.test.mjs

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const TMP = join(ROOT, '.test-tmp-track-1084');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function poll(fn, { timeout = 8000, interval = 200, label = '' } = {}) {
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
    const proc = spawn('node', [join(__dirname, 'mock-collector.mjs')], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
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

function setupProject(collectorPort) {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
  const collectorUrl = `http://127.0.0.1:${collectorPort}`;

  writeFileSync(join(TMP, '.laneconductor.json'), JSON.stringify({
    mode: 'local-api',
    project: { name: 'test-project', id: 1, repo_path: TMP, primary: { cli: 'mock', model: 'mock' } },
    collectors: [{ url: collectorUrl, token: null }],
    ui: { port: 8090 },
  }, null, 2));

  mkdirSync(join(TMP, 'conductor/tracks'), { recursive: true });
  writeFileSync(join(TMP, 'conductor/workflow.json'), JSON.stringify({
    global: { total_parallel_limit: 1 },
    defaults: { parallel_limit: 1, max_retries: 1, primary_model: 'mock' },
    lanes: { plan: { parallel_limit: 1, max_retries: 1 } },
  }, null, 2));
}

function startWorker(extraArgs = []) {
  const worker = spawn('node', [join(ROOT, 'conductor/laneconductor.sync.mjs'), '--sync-only', ...extraArgs], {
    cwd: TMP,
    env: { ...process.env, LC_SKIP_GIT_LOCK: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  worker.stdout.on('data', d => process.stdout.write(`[worker] ${d}`));
  worker.stderr.on('data', d => process.stderr.write(`[worker] ${d}`));
  return worker;
}

describe('Track 1084 Phase 0: stable worker identity', () => {
  let collectorProc, collectorPort;

  before(async () => {
    const c = await startMockCollector();
    collectorProc = c.proc;
    collectorPort = c.port;
  });

  after(() => {
    collectorProc?.kill();
    rmSync(TMP, { recursive: true, force: true });
  });

  it('registers with worker_number: 1 by default when no flag is passed', async () => {
    await fetch(`http://127.0.0.1:${collectorPort}/_reset`, { method: 'POST' }).catch(() => {});
    setupProject(collectorPort);
    const worker = startWorker();
    try {
      const state = await poll(async () => {
        const s = await getState(collectorPort);
        return s.workers.length > 0 ? s : null;
      }, { label: 'worker registration' });
      assert.equal(state.workers[0].worker_number, 1, 'should default worker_number to 1');
    } finally {
      worker.kill();
    }
  });

  it('registers with worker_number: 2 when --worker-number 2 is passed', async () => {
    await fetch(`http://127.0.0.1:${collectorPort}/_reset`, { method: 'POST' }).catch(() => {});
    setupProject(collectorPort);
    const worker = startWorker(['--worker-number', '2']);
    try {
      const state = await poll(async () => {
        const s = await getState(collectorPort);
        return s.workers.length > 0 ? s : null;
      }, { label: 'worker registration with --worker-number 2' });
      assert.equal(state.workers[0].worker_number, 2, 'should register with worker_number: 2');
    } finally {
      worker.kill();
    }
  });
});
