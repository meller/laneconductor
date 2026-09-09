#!/usr/bin/env node
// conductor/tests/track-10079-abort-manager-loop.test.mjs
// Track 10079 Phase 3, Task 3.7/REQ-22/REQ-23: aborting a live manager
// pseudo-track reply must not kill one CLI and silently start another —
// the exact re-launch failure the spec's "failure-semantics trap" already
// identifies for numbered tracks, reachable for the manager the moment a
// Stop button exists. See test.md TC-3.14..TC-3.17, and
// track-10069-manager-chat-plumbing.test.mjs's TC-4.7 pattern this follows.
//
// Run: env -u NODE_TEST_CONTEXT node --test conductor/tests/track-10079-abort-manager-loop.test.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeSandbox, cleanupSandbox, startIsolatedWorker, stopWorker } from './helpers/isolated-worker.mjs';
import { isPidAlive, readProcessCommand, runMarkerPath, parseRunMarker } from '../services/run-marker.mjs';
import { abortRun } from '../services/run-abort.mjs';
import { decideTrackFolder } from '../services/track-folder.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MOCK_CLI = join(__dirname, 'mock-cli.mjs');

// isolated-worker.mjs's resolveRepoRoot() deliberately normalizes THROUGH
// resolvePrimaryRepoRoot() to the primary checkout — the right default for
// every OTHER suite using this helper, but wrong here: this track's changes
// live only in this worktree, unmerged, so without this override the
// helper would spawn the PRIMARY checkout's (unpatched) sync.mjs and this
// suite would silently test the wrong code.
process.env.LC_TEST_REPO_ROOT = join(__dirname, '../..');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function poll(fn, { timeout = 10000, interval = 250, label = '' } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = fn();
    if (result) return result;
    await sleep(interval);
  }
  throw new Error(`poll timeout (${timeout}ms)${label ? ': ' + label : ''}`);
}

function setupProject() {
  const sandbox = makeSandbox('10079-abort-manager');
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
    lanes: {},
  }, null, 2));
  return sandbox;
}

function seedManagerPseudoTrack(tracksDir) {
  const dir = join(tracksDir, 'manager');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.md'), ['# Manager supervision', '', '**Waiting for reply**: yes'].join('\n'), 'utf8');
  writeFileSync(join(dir, 'conversation.md'), '# Conversation: manager\n\n> **human**: is anything stuck?\n', 'utf8');
  return dir;
}

function startWorker(sandbox, env = {}) {
  return startIsolatedWorker({
    sandbox,
    env: { LC_MOCK_CLI: `node ${MOCK_CLI}`, MOCK_CLI_DELAY_MS: '10000', ...env },
  });
}

function countManagerLogs(sandbox) {
  const logsDir = join(sandbox, 'conductor', 'logs');
  if (!existsSync(logsDir)) return 0;
  return readdirSync(logsDir).filter(f => /^local-fs-answer-manager-\d+\.log$/.test(f)).length;
}

describe('Track 10079: aborting a live manager pseudo-track reply does not loop', () => {
  it('TC-3.14/3.15/3.16 (AC-13, AC-14, REQ-22, REQ-23): abort stops it, is visible, writes no lane state, and is never re-dispatched', async () => {
    const sandbox = setupProject();
    const tracksDir = join(sandbox, 'conductor/tracks');
    seedManagerPseudoTrack(tracksDir);

    const worker = await startWorker(sandbox);
    try {
      const markerPath = runMarkerPath(sandbox, 'manager');
      const marker = await poll(() => existsSync(markerPath) ? parseRunMarker(readFileSync(markerPath, 'utf8')) : null,
        { label: 'manager reply run marker written' });
      assert.equal(countManagerLogs(sandbox), 1, 'exactly one dispatch so far');

      const result = await abortRun({
        primaryRoot: sandbox, trackNumber: 'manager', requestedBy: 'test-human',
        isPidAlive, readProcessCommand, kill: process.kill,
      });
      assert.equal(result.ok, true);
      assert.equal(result.signal, 'SIGINT');

      // TC-3.14: the group actually dies.
      await poll(() => {
        try { process.kill(-marker.pgid, 0); return null; } catch (e) { return e.code === 'ESRCH' ? true : null; }
      }, { label: 'manager process group gone' });

      await poll(() => existsSync(markerPath) ? null : true, { label: 'manager run marker removed' });

      // TC-3.15: cancellation is visible in the manager's own conversation.md.
      const conv = readFileSync(join(tracksDir, 'manager', 'conversation.md'), 'utf8');
      assert.match(conv, /> \*\*system\*\*: ⚠️ Turn cancelled by user/, `expected a cancellation comment, got:\n${conv}\n\nworker output:\n${worker.getOutput()}`);
      assert.doesNotMatch(conv, /Automation failed/);

      // TC-3.16: no lane state was written — the pseudo-track has none to
      // begin with, and REQ-22 must not have widened it into lane eligibility.
      const index = readFileSync(join(tracksDir, 'manager', 'index.md'), 'utf8');
      assert.doesNotMatch(index, /\*\*Lane\*\*:/);
      assert.doesNotMatch(index, /\*\*Lane Status\*\*:/);
      assert.match(index, /\*\*Waiting for reply\*\*:\s*no/i,
        'the cancellation comment itself is what answers the human turn — hasGenuineUnansweredHumanComment sees a system reply after it');

      // TC-3.14 (the more important half): across several more full
      // auto-launch cycles (500ms tick per the isolated-worker helper),
      // NO replacement reply is dispatched. This is the assertion that must
      // fail before Task 3.7's fix and pass after it.
      await sleep(3000);
      assert.equal(countManagerLogs(sandbox), 1, 'must still be exactly the ONE original dispatch — no re-dispatch loop');
      assert.equal(existsSync(markerPath), false, 'no new run should have started for the manager pseudo-track');
    } finally {
      await stopWorker(worker);
      cleanupSandbox(sandbox);
    }
  });
});

describe('Track 10079 TC-3.17: the resolver gap the manager guard works around', () => {
  it('decideTrackFolder alone (no manager special-case) cannot resolve the reserved "manager" folder', () => {
    // A unit-level tripwire: if a future change makes decideTrackFolder
    // itself handle "manager" directly, this starts failing, which is
    // exactly the signal that resolveTrackFolder's manager guard
    // (conductor/laneconductor.sync.mjs, track 10067) can be retired
    // deliberately instead of left as unnoticed dead code.
    const result = decideTrackFolder({
      dirNames: ['manager'], trackNumber: 'manager', registeredFolder: null, registeredExists: false,
    });
    assert.equal(result.folder, null);
  });
});
