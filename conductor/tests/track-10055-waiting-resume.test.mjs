#!/usr/bin/env node
// conductor/tests/track-10055-waiting-resume.test.mjs
// Track 10055 Phase 2 + Phase 3, against a REAL spawned worker.
//
// The claims under test are all about what the exit handler does with a run
// that stopped on purpose, and none of them can be proven by unit-testing the
// pure pieces:
//
//   - an agent writing `**Lane Status**: waiting` on `implement` parks the
//     track at implement:waiting instead of advancing it to review:queue
//     (before this track, the marker was only read on the `done` lane, so the
//     normal success transition applied and the pause was erased);
//   - a run that ends on a genuine blocking question parks too, instead of
//     landing at `<lane>:success` — a resting state nothing polls, wearing a
//     green tick;
//   - a parked track is not claimed again on the next cycle by anything;
//   - resuming it (status back to queue) is enough for a worker to pick it up.
//
// Run: node --test conductor/tests/track-10055-waiting-resume.test.mjs

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const MOCK_CLI = join(__dirname, 'mock-cli.mjs');
const TMP = join(ROOT, '.test-tmp-track-10055-waiting');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function readIndex(tracksDir, trackNum) {
  const dirs = readdirSync(tracksDir).filter(d => new RegExp(`(^|-)${trackNum}(-|$)`).test(d));
  if (!dirs.length) return null;
  const p = join(tracksDir, dirs[0], 'index.md');
  return existsSync(p) ? readFileSync(p, 'utf8') : null;
}
function indexPathFor(tracksDir, trackNum) {
  const dir = readdirSync(tracksDir).find(d => new RegExp(`(^|-)${trackNum}(-|$)`).test(d));
  return dir ? join(tracksDir, dir, 'index.md') : null;
}
const getLane = c => c?.match(/\*\*Lane\*\*:\s*([^\n]+)/i)?.[1]?.trim() ?? null;
const getLaneStatus = c => c?.match(/\*\*Lane Status\*\*:\s*([^\n]+)/i)?.[1]?.trim() ?? null;
const getWaitingReason = c => c?.match(/\*\*Waiting Reason\*\*:\s*([^\n]+)/i)?.[1]?.trim() ?? null;

async function poll(fn, { timeout = 15000, interval = 250, label = '' } = {}) {
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
  execSync('git init -q', { cwd: TMP });
  execSync('git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init', { cwd: TMP });

  writeFileSync(join(TMP, '.laneconductor.json'), JSON.stringify({
    mode: 'local-fs',
    project: { name: 'test-project', id: 1, repo_path: TMP, primary: { cli: 'mock', model: 'mock' } },
    collectors: [],
    ui: { port: 8090 },
  }, null, 2));
  writeFileSync(join(TMP, '.gitignore'), '.worktrees/\n');
  mkdirSync(join(TMP, 'conductor/tracks'), { recursive: true });
  writeFileSync(join(TMP, 'conductor/tracks/.gitkeep'), '');

  // Mirrors the real conductor/workflow.json: implement advances to
  // review:queue on success. That transition is precisely what a park has to
  // suppress — a track that stopped to ask a question has not finished
  // implementing.
  writeFileSync(join(TMP, 'conductor/workflow.json'), JSON.stringify({
    global: { total_parallel_limit: 3 },
    defaults: { parallel_limit: 1, max_retries: 1 },
    lanes: {
      plan: { parallel_limit: 1, max_retries: 1, primary_model: 'mock', on_success: 'plan:success', on_failure: 'backlog' },
      implement: { parallel_limit: 2, max_retries: 3, primary_model: 'mock', on_success: 'review:queue', on_failure: 'implement:failure' },
      review: { parallel_limit: 1, max_retries: 1, primary_model: 'mock', on_success: 'quality-gate:queue', on_failure: 'implement:queue' },
      'quality-gate': { parallel_limit: 1, max_retries: 1, primary_model: 'mock', on_success: 'done:queue', on_failure: 'plan:queue' },
      done: { parallel_limit: 1, max_retries: 1, primary_model: 'mock', on_failure: 'done:failure' },
    },
  }, null, 2));

  execSync('git add -A', { cwd: TMP });
  execSync('git -c user.email=t@t -c user.name=t commit -q -m setup', { cwd: TMP });
}

function createTrack(tracksDir, num, { lane, status = 'queue', workspace = 'main' } = {}) {
  const dir = join(tracksDir, `${num}-test-track-${num}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.md'), [
    `# Track ${num}: Test Track ${num}`,
    '',
    `**Lane**: ${lane}`,
    `**Lane Status**: ${status}`,
    '**Progress**: 40%',
    // workspace: main keeps these tests off the worktree machinery, which is
    // orthogonal to what they're proving and much slower.
    `**Workspace**: ${workspace}`,
    '**Auto Run**: yes',
    '',
    '## Problem',
    'Test problem.',
    '',
    '## Solution',
    'Test solution.',
  ].join('\n'));
  return dir;
}

function startWorker(env = {}) {
  const worker = spawn('node', [join(ROOT, 'conductor/laneconductor.sync.mjs')], {
    cwd: TMP,
    env: { ...process.env, LC_MOCK_CLI: `node ${MOCK_CLI}`, MOCK_CLI_DELAY_MS: '300', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  worker.stdout.on('data', d => process.stdout.write(`[worker] ${d}`));
  worker.stderr.on('data', d => process.stderr.write(`[worker] ${d}`));
  return worker;
}

// Waits for the EXIT HANDLER to have finished, then returns the final file.
//
// The wait keys on `**Last Run**`, which only the exit handler ever writes.
// Polling the status instead is a real race, not a theoretical one: mock-cli's
// own MOCK_CLI_WRITE_LANE_STATUS write lands seconds before the worker's exit
// handler runs, so a status-based poll routinely returns the agent's
// intermediate file and the assertions then grade the wrong snapshot — which
// is exactly how an earlier version of this file "passed" TC-14 while the
// handler was in fact still about to overwrite the value under test.
async function runToCompletion(tracksDir, num, env) {
  const worker = startWorker(env);
  try {
    return await poll(() => {
      const c = readIndex(tracksDir, num);
      return c && /\*\*Last Run\*\*:/i.test(c) ? c : null;
    }, { label: `track ${num}: exit handler finished`, timeout: 25000 });
  } finally {
    worker.kill('SIGTERM');
    await sleep(500);
  }
}

describe('Track 10055: a lane action can park on any lane', () => {
  after(() => rmSync(TMP, { recursive: true, force: true }));

  it('TC-9: an implement run that writes **Lane Status**: waiting parks at implement:waiting — it does NOT advance to review:queue', async () => {
    setupProject();
    const tracksDir = join(TMP, 'conductor/tracks');
    createTrack(tracksDir, '801', { lane: 'implement' });

    const final = await runToCompletion(tracksDir, '801', {
      MOCK_CLI_EXIT_CODE: '0',
      MOCK_CLI_WRITE_LANE_STATUS: 'waiting',
    });

    assert.equal(getLane(final), 'implement', 'a park stays in the lane the action ran in');
    assert.equal(getLaneStatus(final), 'waiting');
  });

  it('TC-10: the same holds on plan, review and quality-gate', async () => {
    for (const [num, lane] of [['811', 'plan'], ['812', 'review'], ['813', 'quality-gate']]) {
      setupProject();
      const tracksDir = join(TMP, 'conductor/tracks');
      createTrack(tracksDir, num, { lane });

      const final = await runToCompletion(tracksDir, num, {
        MOCK_CLI_EXIT_CODE: '0',
        MOCK_CLI_WRITE_LANE_STATUS: 'waiting',
      });

      assert.equal(getLane(final), lane, `${lane}: park must stay in lane`);
      assert.equal(getLaneStatus(final), 'waiting', `${lane}: park must be waiting`);
    }
  });

  it('TC-12: a run that ends on a blocking question parks instead of landing at <lane>:success', async () => {
    setupProject();
    const tracksDir = join(TMP, 'conductor/tracks');
    createTrack(tracksDir, '802', { lane: 'implement' });

    const final = await runToCompletion(tracksDir, '802', {
      MOCK_CLI_EXIT_CODE: '0',
      MOCK_CLI_EMIT_BLOCKED_SUMMARY: 'Should I apply migrations/0042.sql to the live DB?',
    });

    assert.equal(getLaneStatus(final), 'waiting',
      'a clean exit on an unanswered question is not a success — before this track it landed at implement:success');
    assert.equal(getLane(final), 'implement');
    assert.match(final, /\*\*Waiting for reply\*\*:\s*yes/i,
      'the conversation channel stays open so a reply alone can resume it');
    assert.match(getWaitingReason(final) || '', /migrations\/0042\.sql/,
      'REQ-3: the question becomes the reason, so the card says what it needs');
  });

  it('TC-15: a park with no agent-written reason still gets one', async () => {
    setupProject();
    const tracksDir = join(TMP, 'conductor/tracks');
    createTrack(tracksDir, '803', { lane: 'implement' });

    const final = await runToCompletion(tracksDir, '803', {
      MOCK_CLI_EXIT_CODE: '0',
      MOCK_CLI_WRITE_LANE_STATUS: 'waiting',
    });

    assert.equal(getLaneStatus(final), 'waiting');
    const reason = getWaitingReason(final);
    assert.ok(reason && reason.length > 0, 'a park must never surface with no explanation at all');
  });

  it('TC-14: a FAILED run with a leftover waiting marker is not treated as a park', async () => {
    setupProject();
    const tracksDir = join(TMP, 'conductor/tracks');
    createTrack(tracksDir, '804', { lane: 'implement' });

    const final = await runToCompletion(tracksDir, '804', {
      MOCK_CLI_EXIT_CODE: '1',
      MOCK_CLI_WRITE_LANE_STATUS: 'waiting',
    });

    assert.notEqual(getLaneStatus(final), 'waiting',
      'only a clean exit can park — otherwise a crash mid-write would masquerade as a deliberate pause');
  });

  it('TC-11: done:waiting still works exactly as before (track 10035 regression)', async () => {
    setupProject();
    const tracksDir = join(TMP, 'conductor/tracks');
    createTrack(tracksDir, '805', { lane: 'done' });

    const final = await runToCompletion(tracksDir, '805', {
      MOCK_CLI_EXIT_CODE: '0',
      MOCK_CLI_WRITE_LANE_STATUS: 'waiting',
    });

    assert.equal(getLane(final), 'done');
    assert.equal(getLaneStatus(final), 'waiting');
  });

  it('TC-9b: a normal successful implement run still advances to review:queue', async () => {
    setupProject();
    const tracksDir = join(TMP, 'conductor/tracks');
    createTrack(tracksDir, '806', { lane: 'implement' });

    const final = await runToCompletion(tracksDir, '806', { MOCK_CLI_EXIT_CODE: '0' });

    assert.equal(getLane(final), 'review', 'the ordinary transition must be untouched by the park machinery');
    assert.equal(getLaneStatus(final), 'queue');
    assert.equal(getWaitingReason(final), null, 'a non-parked outcome carries no reason');
  });
});

describe('Track 10055: a parked track stays parked until a human resumes it', () => {
  after(() => rmSync(TMP, { recursive: true, force: true }));

  it('TC-18: nothing claims an implement:waiting track — the worker leaves it alone across cycles', async () => {
    setupProject();
    const tracksDir = join(TMP, 'conductor/tracks');
    createTrack(tracksDir, '821', { lane: 'implement', status: 'waiting' });
    createTrack(tracksDir, '822', { lane: 'review', status: 'waiting' });
    createTrack(tracksDir, '823', { lane: 'done', status: 'waiting' });
    createTrack(tracksDir, '824', { lane: 'implement', status: 'queue' });

    const worker = startWorker({ MOCK_CLI_EXIT_CODE: '0' });
    try {
      // The queued one proves the worker is genuinely awake and claiming —
      // without it, "nothing moved" could just mean the worker never started.
      await poll(() => {
        const s = getLaneStatus(readIndex(tracksDir, '824'));
        return (s === 'running' || s === 'queue') && getLane(readIndex(tracksDir, '824')) === 'review' ? true
          : (getLane(readIndex(tracksDir, '824')) === 'review' ? true : null);
      }, { label: 'queued track 824 was claimed and advanced', timeout: 20000 });

      for (const num of ['821', '822', '823']) {
        const c = readIndex(tracksDir, num);
        assert.equal(getLaneStatus(c), 'waiting', `track ${num} must still be parked`);
      }
    } finally {
      worker.kill('SIGTERM');
      await sleep(500);
    }
  });

  it('TC-23: flipping a parked track back to queue is enough for a worker to pick it up', async () => {
    setupProject();
    const tracksDir = join(TMP, 'conductor/tracks');
    createTrack(tracksDir, '831', { lane: 'implement', status: 'waiting' });
    const p = indexPathFor(tracksDir, '831');
    writeFileSync(p, writeReason(readFileSync(p, 'utf8'), 'Needs prod DB approval'), 'utf8');

    const worker = startWorker({ MOCK_CLI_EXIT_CODE: '0' });
    try {
      await sleep(3000);
      assert.equal(getLaneStatus(readIndex(tracksDir, '831')), 'waiting', 'still parked before the resume');

      // What POST .../resume does, reduced to its filesystem effect.
      const resumed = readFileSync(p, 'utf8')
        .replace(/\*\*Lane Status\*\*:\s*[^\n]+/i, '**Lane Status**: queue')
        .replace(/^[ \t]*\*\*Waiting Reason\*\*:[^\n]*\n?/im, '');
      writeFileSync(p, resumed, 'utf8');

      const after = await poll(() => {
        const c = readIndex(tracksDir, '831');
        return getLane(c) === 'review' ? c : null;
      }, { label: 'resumed track 831 is claimed and run', timeout: 20000 });

      assert.equal(getLane(after), 'review', 'the resumed run completed and advanced normally');
      assert.equal(getWaitingReason(after), null, 'the reason does not survive the resume');
    } finally {
      worker.kill('SIGTERM');
      await sleep(500);
    }
  });
});

function writeReason(content, reason) {
  return `${content.trimEnd()}\n**Waiting Reason**: ${reason}\n`;
}
