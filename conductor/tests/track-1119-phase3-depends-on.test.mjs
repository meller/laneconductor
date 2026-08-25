#!/usr/bin/env node
// conductor/tests/track-1119-phase3-depends-on.test.mjs
// Track AM-1119 Phase 3 (Task 2): the **Depends On** auto-launch gate.
// Real end-to-end proof (spawns the actual worker process, same pattern as
// local-fs-e2e.test.mjs) that a track naming an unmet dependency is left
// untouched by the auto-launch loop, and the same track runs once its
// dependency reaches `done` — this is what lets the wizard's generated
// "Deploy to <provider>" track safely wait for its sibling feature tracks
// (TC-9's dependency-ordering half; TC-9's DB-registration half is covered
// by track-1119-wizard-dispatch.test.mjs already exercising the real
// create-project → DB-registration path for non-dependent tracks).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const MOCK_CLI = join(__dirname, 'mock-cli.mjs');
const TMP = join(ROOT, '.test-tmp-track-1119-depends-on');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function readIndex(tracksDir, trackNum) {
  const dirs = readdirSync(tracksDir).filter(d => d.startsWith(`${trackNum}-`));
  if (!dirs.length) return null;
  const p = join(tracksDir, dirs[0], 'index.md');
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
    defaults: { parallel_limit: 3, max_retries: 1, primary_model: 'mock' },
    lanes: {
      implement: { parallel_limit: 3, max_retries: 1, auto_action: 'implement', on_success: 'implement:success', on_failure: 'implement:failure' },
    },
  }, null, 2));
}

function createTrack(tracksDir, num, { lane = 'implement', laneStatus = 'queue', dependsOn = null } = {}) {
  const dir = join(tracksDir, `${num}-test-track-${num}`);
  mkdirSync(dir, { recursive: true });
  const lines = [
    `# Track ${num}: Test Track ${num}`,
    '',
    `**Lane**: ${lane}`,
    `**Lane Status**: ${laneStatus}`,
    '**Progress**: 0%',
    '**Auto Run**: yes',
  ];
  if (dependsOn) lines.push(`**Depends On**: ${dependsOn}`);
  lines.push('', '## Problem', 'Test problem.', '', '## Solution', 'Test solution.');
  writeFileSync(join(dir, 'index.md'), lines.join('\n'));
}

function startWorker(env = {}) {
  const worker = spawn('node', [join(ROOT, 'conductor/laneconductor.sync.mjs')], {
    cwd: TMP,
    // LC_SKIP_CWD_NORMALIZATION: this sandbox (a non-git scratch dir nested
    // inside a linked worktree — see laneconductor.sync.mjs's comment right
    // above resolvePrimaryCwdDecision's call site) would otherwise be
    // redirected to the real enclosing primary checkout by track 1102's
    // REQ-1 safety net, which is exactly wrong for an isolated test sandbox
    // and briefly had this test connecting to a real live collector/DB.
    env: { ...process.env, LC_MOCK_CLI: `node ${MOCK_CLI}`, MOCK_CLI_DELAY_MS: '200', LC_SKIP_CWD_NORMALIZATION: '1', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  worker.stdout.on('data', d => process.stdout.write(`[worker] ${d}`));
  worker.stderr.on('data', d => process.stderr.write(`[worker] ${d}`));
  return worker;
}

describe('Track AM-1119 Phase 3: **Depends On** auto-launch gate', () => {
  it('a track depending on a not-yet-done track is left untouched by the auto-launch loop', async () => {
    setupProject();
    const tracksDir = join(TMP, 'conductor/tracks');
    createTrack(tracksDir, '701', { lane: 'implement', laneStatus: 'running' }); // dependency: not done
    createTrack(tracksDir, '702', { lane: 'implement', laneStatus: 'queue', dependsOn: '701' });

    const worker = startWorker({ MOCK_CLI_DELAY_MS: '200' });
    try {
      // No positive event to poll for (that's the point) — wait out a full
      // poll cycle plus margin, then assert nothing happened to 702.
      await sleep(6000);
      const content = readIndex(tracksDir, '702');
      assert.equal(getLaneStatus(content), 'queue', 'dependent track must stay queued — no CLI process should have spawned for it');
    } finally {
      worker.kill('SIGTERM');
      await sleep(500);
    }
  });

  it('the same track runs once its dependency reaches lane done', async () => {
    setupProject();
    const tracksDir = join(TMP, 'conductor/tracks');
    createTrack(tracksDir, '703', { lane: 'done', laneStatus: 'success' }); // dependency already done
    createTrack(tracksDir, '704', { lane: 'implement', laneStatus: 'queue', dependsOn: '703' });

    const worker = startWorker({ MOCK_CLI_EXIT_CODE: '0', MOCK_CLI_DELAY_MS: '1500' });
    try {
      await poll(() => {
        const c = readIndex(tracksDir, '704');
        return getLaneStatus(c) === 'running' ? true : null;
      }, { label: 'track 704 picked up and running once its dependency is done', timeout: 10000 });
    } finally {
      worker.kill('SIGTERM');
      await sleep(500);
    }
  });

  it('a track depending on a nonexistent track number is treated as unmet (fails closed)', async () => {
    setupProject();
    const tracksDir = join(TMP, 'conductor/tracks');
    createTrack(tracksDir, '705', { lane: 'implement', laneStatus: 'queue', dependsOn: '999' }); // 999 doesn't exist

    const worker = startWorker({ MOCK_CLI_DELAY_MS: '200' });
    try {
      await sleep(6000);
      const content = readIndex(tracksDir, '705');
      assert.equal(getLaneStatus(content), 'queue', 'a dependency on a nonexistent track must never be treated as satisfied');
    } finally {
      worker.kill('SIGTERM');
      await sleep(500);
    }
  });
});
