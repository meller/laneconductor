#!/usr/bin/env node
// conductor/tests/track-10069-manager-chat-plumbing.test.mjs
// Track 10069 Phase 4 (REQ-28, D8): autoLaunchLocalFs must admit the
// reserved manager pseudo-track (conductor/tracks/manager/, 10067
// REQ-14/REQ-21) into its dirs scan ONLY when **Waiting for reply**: yes is
// set, dispatch it via the exact conversation-reply mechanics a numbered
// track's own waitingForReply branch uses, and — the more important half —
// leave it completely untouched (no dispatch, no claim, no run marker) when
// that marker is absent. Every case runs against a fixture `manager/`
// folder in an isolated sandbox, so this is testable before track 10067
// merges (REQ-31).
//
// Real worker process (LC_MOCK_CLI), same isolated-sandbox helper every
// other local-fs E2E suite in this repo uses (conductor/tests/local-fs-
// e2e.test.mjs, track-1087-worker-chat-dispatch.test.mjs).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeSandbox, cleanupSandbox, startIsolatedWorker, stopWorker } from './helpers/isolated-worker.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MOCK_CLI = join(__dirname, 'mock-cli.mjs');

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
  const sandbox = makeSandbox('10069-manager-chat');
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

function seedManagerPseudoTrack(tracksDir, { waitingForReply, answered = false } = {}) {
  const dir = join(tracksDir, 'manager');
  mkdirSync(dir, { recursive: true });
  const indexLines = ['# Manager supervision', ''];
  if (waitingForReply !== undefined) indexLines.push(`**Waiting for reply**: ${waitingForReply ? 'yes' : 'no'}`);
  writeFileSync(join(dir, 'index.md'), indexLines.join('\n'), 'utf8');

  const conv = answered
    ? '# Conversation: manager\n\n> **human**: is anything stuck?\n\n> **claude**: nothing stuck.\n'
    : '# Conversation: manager\n\n> **human**: is anything stuck?\n';
  writeFileSync(join(dir, 'conversation.md'), conv, 'utf8');
  return dir;
}

function startWorker(sandbox, env = {}) {
  return startIsolatedWorker({
    sandbox,
    env: { LC_MOCK_CLI: `node ${MOCK_CLI}`, MOCK_CLI_DELAY_MS: '200', ...env },
  });
}

describe('Manager pseudo-track reply dispatch (TC-4.6, TC-4.7, TC-4.9)', () => {
  it('TC-4.6: with the marker set and a genuine unanswered question, the worker dispatches a conversation-reply run', async () => {
    const sandbox = setupProject();
    const tracksDir = join(sandbox, 'conductor/tracks');
    seedManagerPseudoTrack(tracksDir, { waitingForReply: true, answered: false });

    const worker = await startWorker(sandbox);
    try {
      await poll(() => {
        const logsDir = join(sandbox, 'conductor', 'logs');
        if (!existsSync(logsDir)) return null;
        const hit = readdirSync(logsDir).find(f => /^local-fs-answer-manager-\d+\.log$/.test(f));
        return hit ? true : null;
      }, { label: 'local-fs-answer log for manager pseudo-track' });

      // No lane transition is ever written — the pseudo-track has no
      // **Lane** marker to begin with, and none should have been added.
      const index = readFileSync(join(tracksDir, 'manager', 'index.md'), 'utf8');
      assert.doesNotMatch(index, /\*\*Lane\*\*:/);
    } finally {
      await stopWorker(worker);
      cleanupSandbox(sandbox);
    }
  });

  it('TC-4.7 (the negative, and the more important half): with the marker absent, the pseudo-track is never dispatched, however long the loop runs', async () => {
    const sandbox = setupProject();
    const tracksDir = join(sandbox, 'conductor/tracks');
    seedManagerPseudoTrack(tracksDir, { waitingForReply: false, answered: false });

    const worker = await startWorker(sandbox);
    try {
      // Give the worker several full poll cycles to prove absence, not just
      // check once immediately after start.
      await sleep(2500);
      const logsDir = join(sandbox, 'conductor', 'logs');
      const dispatched = existsSync(logsDir)
        && readdirSync(logsDir).some(f => /^local-fs-answer-manager-\d+\.log$/.test(f));
      assert.equal(dispatched, false, 'the pseudo-track must not be dispatched when **Waiting for reply** is absent');
      assert.equal(existsSync(join(sandbox, 'conductor', '.runs', 'manager.json')), false, 'no run marker should ever be written for it');
    } finally {
      await stopWorker(worker);
      cleanupSandbox(sandbox);
    }
  });

  it('with no **Waiting for reply** marker at all (not even "no"), the pseudo-track is still never dispatched', async () => {
    const sandbox = setupProject();
    const tracksDir = join(sandbox, 'conductor/tracks');
    seedManagerPseudoTrack(tracksDir, { waitingForReply: undefined, answered: false });

    const worker = await startWorker(sandbox);
    try {
      await sleep(2000);
      const logsDir = join(sandbox, 'conductor', 'logs');
      const dispatched = existsSync(logsDir)
        && readdirSync(logsDir).some(f => /^local-fs-answer-manager-\d+\.log$/.test(f));
      assert.equal(dispatched, false);
    } finally {
      await stopWorker(worker);
      cleanupSandbox(sandbox);
    }
  });

  it('TC-4.9: the pseudo-track never produces a scaffolded duplicate folder (resolveTrackFolder guard)', async () => {
    const sandbox = setupProject();
    const tracksDir = join(sandbox, 'conductor/tracks');
    seedManagerPseudoTrack(tracksDir, { waitingForReply: true, answered: false });

    const worker = await startWorker(sandbox);
    try {
      await poll(() => {
        const logsDir = join(sandbox, 'conductor', 'logs');
        if (!existsSync(logsDir)) return null;
        const hit = readdirSync(logsDir).find(f => /^local-fs-answer-manager-\d+\.log$/.test(f));
        return hit ? true : null;
      }, { label: 'manager dispatch to have run' });

      await sleep(500);
      const trackDirs = readdirSync(tracksDir);
      assert.deepEqual(trackDirs.sort(), ['manager'], `expected only the manager folder, got: ${trackDirs.join(', ')}`);
    } finally {
      await stopWorker(worker);
      cleanupSandbox(sandbox);
    }
  });
});
