#!/usr/bin/env node
// conductor/tests/track-1111-model-precedence.test.mjs
// Track 1111 Phase 1 (TC-1/TC-2/TC-2b) + Phase 3 (TC-5/TC-6):
//
// 1. Unit-level: resolveLaneCliAndModel (conductor/services/lane-model-resolver.mjs)
//    — the precedence rule itself, verified directly rather than only by
//    code reading.
// 2. E2E: a real worker process (local-fs mode), a substitute `claude`
//    binary on PATH that records the argv it was invoked with (instead of
//    LC_MOCK_CLI, which short-circuits buildCliArgs before model
//    resolution ever runs — see fake-claude-recorder.mjs for why). Proves
//    the actual `--model` flag reaching a real claude-shaped invocation
//    matches each lane's configured primary_model (REQ-2), that the
//    provider never changes (REQ-3), and that a manual per-worker
//    override only wins on a lane with no primary_model configured.
//
// Run: node --test conductor/tests/track-1111-model-precedence.test.mjs

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync, chmodSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { resolveLaneCliAndModel, stripLanePrimaryCli } from '../services/lane-model-resolver.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const FAKE_CLAUDE = join(__dirname, 'fake-claude-recorder.mjs');
const TMP = join(ROOT, '.test-tmp-1111-model-precedence');
const BIN = join(TMP, 'bin');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Unit tests: resolveLaneCliAndModel ───────────────────────────────────────

describe('resolveLaneCliAndModel (unit)', () => {
  it('a lane with primary_model wins over the project default', () => {
    const { model } = resolveLaneCliAndModel({
      laneConfig: { primary_model: 'claude-opus-5' },
      proj: { primary: { cli: 'claude', model: 'claude-sonnet-5' } },
    });
    assert.equal(model, 'claude-opus-5');
  });

  it('a lane with primary_model wins over a manual per-worker override', () => {
    // A manual "Change Model" override (track 1096) persists into
    // proj.primary.model — same field a plain project default would use,
    // so the precedence rule can't distinguish "override" from "default"
    // structurally. That's fine: REQ-2 only requires the LANE's model to
    // win either way, which this asserts.
    const { model } = resolveLaneCliAndModel({
      laneConfig: { primary_model: 'claude-opus-5' },
      proj: { primary: { cli: 'claude', model: 'claude-3-5-haiku' } }, // manual override in effect
    });
    assert.equal(model, 'claude-opus-5');
  });

  it('falls back to the project default/override when the lane has no primary_model', () => {
    const { model } = resolveLaneCliAndModel({
      laneConfig: {},
      proj: { primary: { cli: 'claude', model: 'claude-3-5-haiku' } }, // manual override in effect
    });
    assert.equal(model, 'claude-3-5-haiku');
  });

  it('cli always comes from the project, never from laneConfig (REQ-3)', () => {
    const { cli } = resolveLaneCliAndModel({
      laneConfig: { primary_cli: 'gemini', primary_model: 'claude-opus-5' }, // stray value, should be ignored
      proj: { primary: { cli: 'claude', model: 'claude-sonnet-5' } },
    });
    assert.equal(cli, 'claude');
  });

  // Track 1116 REQ-7: track-level tier
  it('TC-10: a track model wins over BOTH the lane primary_model and the project default', () => {
    const { model } = resolveLaneCliAndModel({
      track: { model: 'claude-opus-4-5' },
      laneConfig: { primary_model: 'claude-opus-5' },
      proj: { primary: { cli: 'claude', model: 'claude-sonnet-5' } },
    });
    assert.equal(model, 'claude-opus-4-5');
  });

  it('TC-11: with no track model, behaves exactly as before (lane ?? project) — no regression to 1111 precedence', () => {
    const withLane = resolveLaneCliAndModel({
      laneConfig: { primary_model: 'claude-opus-5' },
      proj: { primary: { cli: 'claude', model: 'claude-sonnet-5' } },
    });
    assert.equal(withLane.model, 'claude-opus-5');

    const withoutLane = resolveLaneCliAndModel({
      laneConfig: {},
      proj: { primary: { cli: 'claude', model: 'claude-3-5-haiku' } },
    });
    assert.equal(withoutLane.model, 'claude-3-5-haiku');

    // Omitting `track` entirely (as every pre-1116 call site does) must not throw.
    assert.doesNotThrow(() => resolveLaneCliAndModel({ laneConfig: {}, proj: {} }));
  });

  it('track.model set to undefined (no override) falls through to lane/project, same as omitting track', () => {
    const { model } = resolveLaneCliAndModel({
      track: { model: undefined },
      laneConfig: { primary_model: 'claude-opus-5' },
      proj: { primary: { cli: 'claude', model: 'claude-sonnet-5' } },
    });
    assert.equal(model, 'claude-opus-5');
  });

  it('a track model still cannot change the provider — cli stays project-fixed (REQ-7)', () => {
    const { cli } = resolveLaneCliAndModel({
      track: { model: 'claude-opus-4-5' },
      laneConfig: {},
      proj: { primary: { cli: 'claude', model: 'claude-sonnet-5' } },
    });
    assert.equal(cli, 'claude');
  });
});

describe('stripLanePrimaryCli (unit, TC-2b)', () => {
  it('warns and strips primary_cli from a lane config', () => {
    const warnings = [];
    const config = { lanes: { implement: { primary_cli: 'gemini', primary_model: 'x' } } };
    const result = stripLanePrimaryCli(config, msg => warnings.push(msg));
    assert.equal(warnings.length, 1, 'must warn exactly once');
    assert.match(warnings[0], /primary_cli/);
    assert.match(warnings[0], /implement/);
    assert.equal(result.lanes.implement.primary_cli, undefined, 'primary_cli must be stripped, not just warned about');
    assert.equal(result.lanes.implement.primary_model, 'x', 'primary_model must be left untouched');
  });

  it('is a no-op (no warning) when no lane has primary_cli', () => {
    const warnings = [];
    const config = { lanes: { implement: { primary_model: 'x' } } };
    stripLanePrimaryCli(config, msg => warnings.push(msg));
    assert.equal(warnings.length, 0);
  });
});

// ── E2E: real worker, substitute claude binary ────────────────────────────────

function setupProject({ manualModelOverride = null } = {}) {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
  mkdirSync(BIN, { recursive: true });

  // Substitute `claude` binary on PATH — a shell wrapper so it matches
  // exactly what spawn('claude', ...) looks up, running the recorder script.
  const wrapper = `#!/usr/bin/env bash\nexec node "${FAKE_CLAUDE}" "$@"\n`;
  const claudeBinPath = join(BIN, 'claude');
  writeFileSync(claudeBinPath, wrapper, 'utf8');
  chmodSync(claudeBinPath, 0o755);

  writeFileSync(join(TMP, '.laneconductor.json'), JSON.stringify({
    mode: 'local-fs',
    project: {
      name: 'test-project-1111', id: 1, repo_path: TMP,
      primary: { cli: 'claude', model: manualModelOverride },
    },
    collectors: [],
    ui: { port: 8090 },
  }, null, 2));

  mkdirSync(join(TMP, 'conductor/tracks'), { recursive: true });
  writeFileSync(join(TMP, 'conductor/workflow.json'), JSON.stringify({
    global: { total_parallel_limit: 4 },
    defaults: { parallel_limit: 1, max_retries: 1 },
    lanes: {
      plan:           { parallel_limit: 1, max_retries: 1, primary_model: 'claude-opus-5',   on_success: 'plan:success',        on_failure: 'backlog' },
      implement:      { parallel_limit: 1, max_retries: 1, primary_model: 'claude-sonnet-5', on_success: 'implement:success',   on_failure: 'implement:failure' },
      review:         { parallel_limit: 1, max_retries: 1, primary_model: 'claude-3-5-haiku', on_success: 'review:success',     on_failure: 'review:failure' },
      // Deliberately no primary_model on quality-gate — this is the "lane
      // has no configured model" fallback case (TC-6).
      'quality-gate': { parallel_limit: 1, max_retries: 1, on_success: 'quality-gate:success', on_failure: 'quality-gate:failure' },
    },
  }, null, 2));
}

function createTrack(tracksDir, num, lane, extraMarkers = []) {
  const dir = join(tracksDir, `${num}-test-track-${num}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.md'), [
    `# Track ${num}: Test Track ${num}`,
    '',
    `**Lane**: ${lane}`,
    '**Lane Status**: queue',
    '**Progress**: 0%',
    ...extraMarkers,
    '',
    '## Problem', 'Test problem.', '',
    '## Solution', 'Test solution.',
  ].join('\n'));
}

function startWorker(recordFile, env = {}) {
  const worker = spawn('node', [join(ROOT, 'conductor/laneconductor.sync.mjs')], {
    cwd: TMP,
    env: {
      ...process.env,
      PATH: `${BIN}:${process.env.PATH}`,
      FAKE_CLAUDE_RECORD_FILE: recordFile,
      // This test's project.id (1) collides with whatever real project a
      // live dev-machine worker may already be running under — without
      // this, the spawned test worker refuses to start ("Another live
      // worker already holds this identity's lock"), same reasoning
      // track-1110/1091's E2E suites already skip it for.
      LC_SKIP_WORKER_LOCK: '1',
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  worker.stdout.on('data', d => process.stdout.write(`[worker] ${d}`));
  worker.stderr.on('data', d => process.stderr.write(`[worker] ${d}`));
  return worker;
}

function readRecords(recordFile) {
  if (!existsSync(recordFile)) return [];
  return readFileSync(recordFile, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
}

async function poll(fn, { timeout = 20000, interval = 300 } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = fn();
    if (result) return result;
    await sleep(interval);
  }
  throw new Error(`poll timeout (${timeout}ms)`);
}

describe('LaneConductor per-lane model dispatch (E2E, real worker + substitute claude binary)', () => {
  after(() => rmSync(TMP, { recursive: true, force: true }));

  it('TC-1/TC-2: each lane dispatches with its own configured --model, provider stays claude throughout', async () => {
    setupProject({ manualModelOverride: null });
    const tracksDir = join(TMP, 'conductor/tracks');
    createTrack(tracksDir, '1001', 'plan');
    createTrack(tracksDir, '1002', 'implement');
    createTrack(tracksDir, '1003', 'review');
    const recordFile = join(TMP, 'records-tc1.jsonl');

    const worker = startWorker(recordFile);
    try {
      await poll(() => readRecords(recordFile).length >= 3, { timeout: 25000 });
      const records = readRecords(recordFile);

      const byModel = Object.fromEntries(records.map(r => [r.model, r]));
      assert.equal(records.length, 3, `expected exactly 3 dispatch invocations, got ${records.length}`);
      assert.ok(Object.keys(byModel).includes('claude-opus-5'), 'plan lane must dispatch with claude-opus-5');
      assert.ok(Object.keys(byModel).includes('claude-sonnet-5'), 'implement lane must dispatch with claude-sonnet-5');
      assert.ok(Object.keys(byModel).includes('claude-3-5-haiku'), 'review lane must dispatch with claude-3-5-haiku');
    } finally {
      worker.kill('SIGTERM');
      await sleep(500);
    }
  });

  it('TC-5: lane WITH primary_model wins over an active manual override', async () => {
    setupProject({ manualModelOverride: 'claude-3-5-sonnet' }); // manual override active
    const tracksDir = join(TMP, 'conductor/tracks');
    createTrack(tracksDir, '2001', 'implement'); // implement lane has primary_model: claude-sonnet-5
    const recordFile = join(TMP, 'records-tc5.jsonl');

    const worker = startWorker(recordFile);
    try {
      await poll(() => readRecords(recordFile).length >= 1, { timeout: 20000 });
      const [record] = readRecords(recordFile);
      assert.equal(record.model, 'claude-sonnet-5', 'lane primary_model must win over the manual override');
    } finally {
      worker.kill('SIGTERM');
      await sleep(500);
    }
  });

  it('TC-6: lane with NO primary_model falls back to the active manual override', async () => {
    setupProject({ manualModelOverride: 'claude-3-5-sonnet' }); // manual override active
    const tracksDir = join(TMP, 'conductor/tracks');
    createTrack(tracksDir, '3001', 'quality-gate'); // quality-gate lane has no primary_model
    const recordFile = join(TMP, 'records-tc6.jsonl');

    const worker = startWorker(recordFile);
    try {
      await poll(() => readRecords(recordFile).length >= 1, { timeout: 20000 });
      const [record] = readRecords(recordFile);
      assert.equal(record.model, 'claude-3-5-sonnet', 'must fall back to the manual override when the lane has no primary_model');
    } finally {
      worker.kill('SIGTERM');
      await sleep(500);
    }
  });

  // Track 1116 REQ-7
  it('TC-12: a **Model** marker on the track reaches the spawn, beating the lane primary_model; a sibling track without the marker still uses the lane model', async () => {
    setupProject({ manualModelOverride: null });
    const tracksDir = join(TMP, 'conductor/tracks');
    // implement lane's primary_model is claude-sonnet-5 — the marker below must win.
    createTrack(tracksDir, '4001', 'implement', ['**Model**: claude-opus-4-5']);
    createTrack(tracksDir, '4002', 'implement'); // no marker — must use the lane's claude-sonnet-5
    const recordFile = join(TMP, 'records-tc12.jsonl');

    const worker = startWorker(recordFile);
    try {
      await poll(() => readRecords(recordFile).length >= 2, { timeout: 25000 });
      const records = readRecords(recordFile);
      const withMarker = records.find(r => r.model === 'claude-opus-4-5');
      const withoutMarker = records.find(r => r.model === 'claude-sonnet-5');
      assert.ok(withMarker, 'track with **Model** marker must dispatch with claude-opus-4-5');
      assert.ok(withoutMarker, 'sibling track without the marker must still dispatch with the lane model claude-sonnet-5');
    } finally {
      worker.kill('SIGTERM');
      await sleep(500);
    }
  });

  it('TC-13: a stray **Provider** marker on a track is stripped/warned, never changes the spawned CLI', async () => {
    setupProject({ manualModelOverride: null });
    const tracksDir = join(TMP, 'conductor/tracks');
    createTrack(tracksDir, '5001', 'implement', ['**Model**: claude-opus-4-5', '**Provider**: gemini']);
    const recordFile = join(TMP, 'records-tc13.jsonl');

    // The logger (conductor/services/logger.mjs) writes to stdout, not
    // stderr — capture both to be safe against either.
    let output = '';
    const worker = startWorker(recordFile);
    worker.stdout.on('data', d => { output += d.toString(); });
    worker.stderr.on('data', d => { output += d.toString(); });
    try {
      await poll(() => readRecords(recordFile).length >= 1, { timeout: 20000 });
      const [record] = readRecords(recordFile);
      // The fake-claude-recorder is invoked as 'claude' regardless — what
      // matters is the model still reflects the (honored) **Model** marker,
      // proving the stray provider marker had no effect on dispatch at all.
      assert.equal(record.model, 'claude-opus-4-5', 'Model marker still applies even with a stray Provider marker present');
      await poll(() => output.length > 0, { timeout: 5000 }).catch(() => {});
      assert.match(output, /track index\.md has a \*\*Provider\*\* marker/i, 'must warn about the stray Provider marker');
    } finally {
      worker.kill('SIGTERM');
      await sleep(500);
    }
  });
});
