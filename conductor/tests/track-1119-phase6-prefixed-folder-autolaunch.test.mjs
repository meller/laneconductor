#!/usr/bin/env node
// conductor/tests/track-1119-phase6-prefixed-folder-autolaunch.test.mjs
// Track AM-1119 Phase 6: regression guard for a real pre-existing bug found
// while writing this phase's E2E test — autoLaunchLocalFs's directory scan
// anchored its digit match to the start of the folder name (`/^\d+/`),
// silently excluding every `INITIALS-NNN-slug` folder (e.g.
// `AM-1000-app-skeleton` — this track's own Phase 3 generated tracks, and
// `lc new`'s own naming convention, bin/lc.mjs) from auto-launch entirely.
// Every other track-folder scan in this file already matches digits
// anywhere in the name (see "Protocol: Locating Tracks"); this one didn't.
//
// Uses the same real-worker-process harness as local-fs-e2e.test.mjs's own
// TC-9/TC-10 (the Auto Run gate's existing tests) but with a prefixed
// folder name, which those tests never happened to use.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const MOCK_CLI = join(__dirname, 'mock-cli.mjs');
const TMP = join(ROOT, '.test-tmp-track-1119-prefixed-autolaunch');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function readIndex(tracksDir, dirName) {
  const p = join(tracksDir, dirName, 'index.md');
  return existsSync(p) ? readFileSync(p, 'utf8') : null;
}

function getLaneStatus(content) {
  return content?.match(/\*\*Lane Status\*\*:\s*([^\n]+)/i)?.[1]?.trim() ?? null;
}

async function poll(fn, { timeout = 15000, interval = 300, label = '' } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = fn();
    if (result) return result;
    await sleep(interval);
  }
  throw new Error(`poll timeout (${timeout}ms)${label ? ': ' + label : ''}`);
}

function setupProject() {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
  writeFileSync(join(TMP, '.laneconductor.json'), JSON.stringify({
    mode: 'local-fs',
    project: { name: 'test-project', id: 1, repo_path: TMP, primary: { cli: 'mock', model: 'mock' } },
    collectors: [],
    ui: { port: 8090 },
  }, null, 2));
  mkdirSync(join(TMP, 'conductor/tracks'), { recursive: true });
  writeFileSync(join(TMP, 'conductor/workflow.json'), JSON.stringify({
    global: { total_parallel_limit: 3 },
    defaults: { parallel_limit: 3, max_retries: 1 },
    lanes: {
      plan: { parallel_limit: 3, max_retries: 1, auto_action: 'plan', on_success: 'plan:success', on_failure: 'backlog' },
    },
  }, null, 2));
}

function createPrefixedTrack(tracksDir, dirName, num) {
  const dir = join(tracksDir, dirName);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.md'), [
    `# Track AM-${num}: Test Track`,
    '',
    '**Lane**: plan',
    '**Lane Status**: queue',
    '**Progress**: 0%',
    '**Auto Run**: yes',
    '',
    '## Problem', 'Test problem.', '',
    '## Solution', 'Test solution.',
  ].join('\n'));
}

function startWorker(env = {}) {
  const worker = spawn('node', [join(ROOT, 'conductor/laneconductor.sync.mjs')], {
    cwd: TMP,
    env: { ...process.env, LC_MOCK_CLI: `node ${MOCK_CLI}`, MOCK_CLI_DELAY_MS: '200', LC_SKIP_CWD_NORMALIZATION: '1', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  worker.stdout.on('data', d => process.stdout.write(`[worker] ${d}`));
  worker.stderr.on('data', d => process.stderr.write(`[worker] ${d}`));
  return worker;
}

describe('Track AM-1119 Phase 6: autoLaunchLocalFs recognizes INITIALS-NNN-slug folders', () => {
  it('a track in an AM-1000-slug folder (not bare 1000-slug) is picked up and run', async () => {
    setupProject();
    const tracksDir = join(TMP, 'conductor/tracks');
    createPrefixedTrack(tracksDir, 'AM-1000-app-skeleton', '1000');

    const worker = startWorker({ MOCK_CLI_EXIT_CODE: '0', MOCK_CLI_DELAY_MS: '1500' });
    try {
      await poll(() => {
        const c = readIndex(tracksDir, 'AM-1000-app-skeleton');
        return getLaneStatus(c) === 'running' ? true : null;
      }, { label: 'prefixed-folder track picked up and running', timeout: 10000 });
    } finally {
      worker.kill('SIGTERM');
      await sleep(500);
    }
  });
});
