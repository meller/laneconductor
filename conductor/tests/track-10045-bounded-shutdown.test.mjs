#!/usr/bin/env node
// conductor/tests/track-10045-bounded-shutdown.test.mjs
// Track 10045 Phase 4: proves the worker's own SIGTERM/SIGINT shutdown is
// bounded by an aggregate deadline (LC_SHUTDOWN_DEADLINE_MS), independent
// of how many collectors are configured or how slow/unreachable they are.
//
// NOTE: helper's default sandbox config is mode:'local-api' (see
// ensureSandboxConfig in helpers/isolated-worker.mjs) with one collector —
// removeWorker() short-circuits entirely under mode:'local-fs', so every
// case here needs the default local-api shape or its own explicit
// collectorPort so removeWorker() genuinely attempts de-registration.
//
// Uses LC_SHUTDOWN_DEADLINE_MS overrides to keep the suite fast — the
// production default (2000ms) is exercised in the "reachable collector"
// case, where nothing should ever get close to it.
//
// Run: node --test conductor/tests/track-10045-bounded-shutdown.test.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import {
  makeSandbox,
  cleanupSandbox,
  startIsolatedWorker,
  stopWorker,
} from './helpers/isolated-worker.mjs';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Accepts the TCP connection but never responds — the case a closed port
// does NOT exercise (that fails fast with ECONNREFUSED; this hangs until
// the client's own AbortController timeout, which is del()'s 10s).
function startHangingServer() {
  return new Promise((resolve) => {
    const srv = createServer(() => { /* deliberately never respond */ });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port }));
  });
}

// Responds normally to DELETE /worker, matching a real Collector's
// de-registration endpoint.
function startRespondingServer() {
  return new Promise((resolve) => {
    const srv = createServer((req, res) => {
      if (req.method === 'DELETE') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{}');
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port }));
  });
}

async function timeShutdown(worker, signal) {
  const start = Date.now();
  worker.proc.kill(signal);
  await new Promise(resolve => worker.proc.on('exit', resolve));
  return Date.now() - start;
}

describe('Track 10045 Phase 4: bounded worker shutdown', () => {
  it('TC-13: SIGTERM with a collector that accepts the connection then never responds — exits within the bounded deadline', async () => {
    const { srv, port } = await startHangingServer();
    const sandbox = makeSandbox('tc13');
    let worker;
    try {
      worker = await startIsolatedWorker({
        sandbox,
        args: ['--sync-only'],
        collectorPort: port,
        env: { LC_SHUTDOWN_DEADLINE_MS: '500' },
      });
      await worker.waitForServingRoot();
      await sleep(300); // let worker-registration actually start against the hanging server
      const elapsed = await timeShutdown(worker, 'SIGTERM');
      assert.ok(elapsed < 2000, `expected bounded shutdown well under del()'s 10s timeout, took ${elapsed}ms`);
      worker = null; // already exited, nothing for the finally block to kill
    } finally {
      if (worker) await stopWorker(worker);
      cleanupSandbox(sandbox);
      srv.close();
    }
  });

  it('TC-14: SIGTERM with two unreachable (hanging) collectors — bounded by the aggregate deadline, not N x per-collector timeout', async () => {
    const a = await startHangingServer();
    const b = await startHangingServer();
    const sandbox = makeSandbox('tc14');
    // startIsolatedWorker's collectorPort covers exactly one collector;
    // pre-writing the sandbox's own config (before startIsolatedWorker
    // runs, which only fills in a config if one doesn't already exist)
    // is how a test gets more than one.
    const { writeFileSync, mkdirSync } = await import('node:fs');
    const { join } = await import('node:path');
    writeFileSync(join(sandbox, '.laneconductor.json'), JSON.stringify({
      mode: 'local-api',
      project: { name: 'tc14', repo_path: sandbox, primary: { cli: 'mock', model: 'mock' } },
      collectors: [
        { url: `http://127.0.0.1:${a.port}`, token: null },
        { url: `http://127.0.0.1:${b.port}`, token: null },
      ],
    }, null, 2));
    mkdirSync(join(sandbox, 'conductor/tracks'), { recursive: true });
    let worker;
    try {
      worker = await startIsolatedWorker({
        sandbox,
        args: ['--sync-only'],
        env: { LC_SHUTDOWN_DEADLINE_MS: '500' },
      });
      await worker.waitForServingRoot();
      await sleep(300);
      const elapsed = await timeShutdown(worker, 'SIGTERM');
      // The old N x 10s shape would be >= 20000ms for two collectors;
      // bounded shutdown must stay near the single aggregate deadline
      // regardless of collector count.
      assert.ok(elapsed < 2000, `expected one aggregate deadline regardless of collector count, took ${elapsed}ms`);
      worker = null;
    } finally {
      if (worker) await stopWorker(worker);
      cleanupSandbox(sandbox);
      a.srv.close();
      b.srv.close();
    }
  });

  it('TC-15: SIGTERM with a reachable collector — de-registration still completes normally, no regression', async () => {
    const { srv, port } = await startRespondingServer();
    const sandbox = makeSandbox('tc15');
    let worker;
    let deleteReceived = false;
    srv.on('request', (req) => { if (req.method === 'DELETE') deleteReceived = true; });
    try {
      worker = await startIsolatedWorker({ sandbox, args: ['--sync-only'], collectorPort: port });
      await worker.waitForServingRoot();
      await sleep(300);
      const elapsed = await timeShutdown(worker, 'SIGTERM');
      assert.ok(elapsed < 2000, `reachable collector should not need anywhere near the shutdown deadline, took ${elapsed}ms`);
      assert.ok(deleteReceived, 'the worker must still actually attempt de-registration against a reachable collector');
      worker = null;
    } finally {
      if (worker) await stopWorker(worker);
      cleanupSandbox(sandbox);
      srv.close();
    }
  });

  it('TC-16: SIGINT — identical bounded behaviour to SIGTERM', async () => {
    const { srv, port } = await startHangingServer();
    const sandbox = makeSandbox('tc16');
    let worker;
    try {
      worker = await startIsolatedWorker({
        sandbox,
        args: ['--sync-only'],
        collectorPort: port,
        env: { LC_SHUTDOWN_DEADLINE_MS: '500' },
      });
      await worker.waitForServingRoot();
      await sleep(300);
      const elapsed = await timeShutdown(worker, 'SIGINT');
      assert.ok(elapsed < 2000, `SIGINT must be bounded identically to SIGTERM, took ${elapsed}ms`);
      worker = null;
    } finally {
      if (worker) await stopWorker(worker);
      cleanupSandbox(sandbox);
      srv.close();
    }
  });
});
