#!/usr/bin/env node
// conductor/tests/track-10046-run-marker-defer.test.mjs
// Track AM-10046 Phase 3 (REQ-3, REQ-4): a conversation-reply dispatch
// (waitingForReply) bypasses the DB-claim/file-claim races deliberately —
// waitingForReply isn't queue-status-driven, so claim-queue's WHERE clause
// never matches it. That leaves nothing serializing a reply dispatch
// against a lane action already running on the same track — the
// precondition behind the six-flip **Lane** oscillation this track fixes
// (see spec.md). This suite drives the REAL worker (via the isolated-worker
// helper, never a hand-rolled sandbox) against a track with a live
// conductor/.runs/<track>.json marker and asserts the reply is deferred
// until the marker clears (AC-6).
//
// Run: node --test conductor/tests/track-10046-run-marker-defer.test.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { makeSandbox, cleanupSandbox, startIsolatedWorker, stopWorker } from './helpers/isolated-worker.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MOCK_CLI = join(__dirname, 'mock-cli.mjs');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function poll(fn, { timeout = 20000, interval = 300, label = '' } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = fn();
    if (result) return result;
    await sleep(interval);
  }
  throw new Error(`poll timeout (${timeout}ms)${label ? ': ' + label : ''}`);
}

function setupProject() {
  const sandbox = makeSandbox('run-marker-defer');
  writeFileSync(join(sandbox, '.laneconductor.json'), JSON.stringify({
    mode: 'local-fs',
    project: { name: 'test-project', id: 1, repo_path: sandbox, primary: { cli: 'mock', model: 'mock' } },
    collectors: [],
    ui: { port: 8090 },
  }, null, 2));
  mkdirSync(join(sandbox, 'conductor/tracks'), { recursive: true });
  writeFileSync(join(sandbox, 'conductor/workflow.json'), JSON.stringify({
    global: { total_parallel_limit: 3 },
    defaults: { parallel_limit: 1, max_retries: 1, primary_model: 'mock', on_success: null, on_failure: null },
    lanes: {
      implement: { parallel_limit: 1, max_retries: 1, auto_action: 'implement', on_success: 'review', on_failure: 'implement' },
    },
  }, null, 2));
  return sandbox;
}

function createReplyWaitingTrack(tracksDir, num) {
  const dir = join(tracksDir, `${num}-reply-defer-test`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.md'), [
    `# Track ${num}: Reply Defer Test`,
    '',
    '**Lane**: implement',
    '**Lane Status**: success',
    '**Progress**: 40%',
    '**Waiting for reply**: yes',
    '**Auto Run**: yes',
    '',
    '## Problem', 'Test problem.', '',
    '## Solution', 'Test solution.',
  ].join('\n'));
  writeFileSync(join(dir, 'conversation.md'), `> **human**: are you still there?\n`);
  return dir;
}

describe('Track AM-10046 Phase 3: conversation-reply dispatch defers to a live run marker', () => {
  it('TC-6/TC-7: reply is deferred while the marker is live, dispatched once it clears', { timeout: 60000 }, async () => {
    const sandbox = setupProject();
    const tracksDir = join(sandbox, 'conductor/tracks');
    createReplyWaitingTrack(tracksDir, '9046');

    // Plant a live run marker BEFORE the worker ever starts — a long-sleeping
    // child process this test controls, so isRunMarkerLive's pid+command
    // check finds a genuinely live match ('node' is a substring of the real
    // `ps` args for a `node -e ...` child).
    const runsDir = join(sandbox, 'conductor/.runs');
    mkdirSync(runsDir, { recursive: true });
    const holder = spawn('node', ['-e', 'setTimeout(() => {}, 120000)'], { stdio: 'ignore' });
    await sleep(200); // let the OS actually schedule it before we probe it via `ps`
    writeFileSync(join(runsDir, '9046.json'), JSON.stringify({
      pid: holder.pid, pgid: holder.pid, worker_pid: 0, track_number: '9046',
      dispatch_id: null, action: 'implement', command: 'node', started_at: new Date().toISOString(),
    }, null, 2));

    const argvLog = join(sandbox, 'mock-cli-argv.log');
    const { proc, getOutput } = await startIsolatedWorker({
      sandbox,
      env: { LC_MOCK_CLI: `node ${MOCK_CLI}`, MOCK_CLI_DELAY_MS: '200', MOCK_CLI_ARGV_LOG: argvLog },
    });

    try {
      // TC-6: across several 5s auto-launch cycles, the deferral log line
      // must appear and the mock CLI must never actually run for this track.
      await poll(() => getOutput().includes('deferring conversation-reply dispatch'), {
        timeout: 20000, label: 'deferral log line for track 9046',
      });
      assert.ok(!existsSync(argvLog), 'mock CLI must not have been invoked while the run marker is live');

      // Clear the marker (kill the holder + remove the file) — same as a
      // real spawnCli exit handler would on process exit.
      holder.kill();
      rmSync(join(runsDir, '9046.json'), { force: true });

      // TC-7: now the reply dispatches — the mock CLI actually runs.
      await poll(() => existsSync(argvLog), { timeout: 20000, label: 'mock CLI invocation for track 9046 after marker cleared' });
      const lines = readFileSync(argvLog, 'utf8').trim().split('\n').filter(Boolean);
      assert.ok(lines.length >= 1, 'expected at least one recorded invocation once the marker cleared');
    } finally {
      holder.kill();
      await stopWorker(proc);
      cleanupSandbox(sandbox);
    }
  });
});
