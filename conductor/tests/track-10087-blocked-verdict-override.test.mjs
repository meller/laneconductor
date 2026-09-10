#!/usr/bin/env node
// conductor/tests/track-10087-blocked-verdict-override.test.mjs
// Track AM-10087, against a REAL spawned worker.
//
// Reproduces the AM-1018 shape exactly: a review action whose own output
// already resolved a definitive, workflow.json-routable FAIL verdict, but
// whose turn ALSO triggered the harness's 'blocked' post_turn_summary
// annotation over an unrelated already-answered-by-policy question. Before
// this track, isBlockedTurn's park override discarded the review's own
// resolved outcome and parked the track at review:waiting indefinitely —
// invisible to the auto-launch queue scan despite Auto Run: yes.
//
// Run: node --test conductor/tests/track-10087-blocked-verdict-override.test.mjs

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const MOCK_CLI = join(__dirname, 'mock-cli.mjs');
const TMP = join(ROOT, '.test-tmp-track-10087-verdict');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function readIndex(tracksDir, trackNum) {
  const dirs = readdirSync(tracksDir).filter(d => new RegExp(`(^|-)${trackNum}(-|$)`).test(d));
  if (!dirs.length) return null;
  const p = join(tracksDir, dirs[0], 'index.md');
  return existsSync(p) ? readFileSync(p, 'utf8') : null;
}
function conversationFor(tracksDir, trackNum) {
  const dirs = readdirSync(tracksDir).filter(d => new RegExp(`(^|-)${trackNum}(-|$)`).test(d));
  if (!dirs.length) return null;
  const p = join(tracksDir, dirs[0], 'conversation.md');
  return existsSync(p) ? readFileSync(p, 'utf8') : null;
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

// Same shape as track-10055-waiting-resume.test.mjs's workflow.json fixture,
// except `reviewLane` can be overridden by TC-2d to reproduce a
// misconfigured project (a lane missing the on_success/on_failure the
// dispatched verdict direction needs).
function setupProject({ reviewLaneOverride = null } = {}) {
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

  const reviewLane = reviewLaneOverride || {
    parallel_limit: 1, max_retries: 1, primary_model: 'mock',
    on_success: 'quality-gate:queue', on_failure: 'implement:queue',
  };

  writeFileSync(join(TMP, 'conductor/workflow.json'), JSON.stringify({
    global: { total_parallel_limit: 3 },
    defaults: { parallel_limit: 1, max_retries: 1 },
    lanes: {
      plan: { parallel_limit: 1, max_retries: 1, primary_model: 'mock', on_success: 'plan:success', on_failure: 'backlog' },
      implement: { parallel_limit: 2, max_retries: 3, primary_model: 'mock', on_success: 'review:queue', on_failure: 'implement:failure' },
      review: reviewLane,
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

// Same rationale as track-10055-waiting-resume.test.mjs: key on **Last Run**,
// which only the exit handler ever writes, to avoid grading mock-cli's own
// intermediate self-report instead of the handler's final decision.
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

describe('Track AM-10087: a resolved verdict overrides the blocked-turn park', () => {
  after(() => rmSync(TMP, { recursive: true, force: true }));

  it('TC-2a (AM-1018 reproduction): blocked turn + Verdict: fail routes to review.on_failure, not review:waiting', async () => {
    setupProject();
    const tracksDir = join(TMP, 'conductor/tracks');
    createTrack(tracksDir, '901', { lane: 'review' });

    const final = await runToCompletion(tracksDir, '901', {
      MOCK_CLI_EXIT_CODE: '0',
      MOCK_CLI_EMIT_BLOCKED_SUMMARY: 'decide: fix before merge or defer to Phase 7?',
      MOCK_CLI_WRITE_VERDICT: 'fail',
    });

    assert.equal(getLane(final), 'implement', 'FAIL verdict must route to review.on_failure (implement), not stay parked on review');
    assert.equal(getLaneStatus(final), 'queue');
    assert.equal(getWaitingReason(final), null, 'a routed (non-parked) outcome carries no Waiting Reason');

    const conv = conversationFor(tracksDir, '901');
    assert.match(conv || '', /already resolved \*\*Verdict\*\*: fail/i,
      'REQ-7: the suppressed park must be visible in conversation.md');
  });

  it('TC-2b: blocked turn + Verdict: pass routes to review.on_success (quality-gate), not review:waiting', async () => {
    setupProject();
    const tracksDir = join(TMP, 'conductor/tracks');
    createTrack(tracksDir, '902', { lane: 'review' });

    const final = await runToCompletion(tracksDir, '902', {
      MOCK_CLI_EXIT_CODE: '0',
      MOCK_CLI_EMIT_BLOCKED_SUMMARY: 'should this wait for a follow-up track instead?',
      MOCK_CLI_WRITE_VERDICT: 'pass',
    });

    assert.equal(getLane(final), 'quality-gate');
    assert.equal(getLaneStatus(final), 'queue');
    assert.equal(getWaitingReason(final), null);

    const conv = conversationFor(tracksDir, '902');
    assert.match(conv || '', /already resolved \*\*Verdict\*\*: pass/i);
  });

  it('TC-2c (regression guard): a blocked turn with NO Verdict marker still parks at <lane>:waiting', async () => {
    setupProject();
    const tracksDir = join(TMP, 'conductor/tracks');
    createTrack(tracksDir, '903', { lane: 'review' });

    const final = await runToCompletion(tracksDir, '903', {
      MOCK_CLI_EXIT_CODE: '0',
      MOCK_CLI_EMIT_BLOCKED_SUMMARY: 'should I apply this destructive migration?',
    });

    assert.equal(getLane(final), 'review', 'no verdict — a genuine open question still parks in place');
    assert.equal(getLaneStatus(final), 'waiting');
    const reason = getWaitingReason(final);
    assert.ok(reason && reason.length > 0, 'a park always carries a reason');

    const conv = conversationFor(tracksDir, '903');
    assert.doesNotMatch(conv || '', /already resolved \*\*Verdict\*\*/i,
      'an ordinary park is not an override — no override comment should appear');
  });

  it('TC-2d (misconfigured fallback): Verdict: pass with no on_success defined falls back to parking, never guesses', async () => {
    // review lane deliberately has no on_success — only on_failure. A PASS
    // verdict here has no real transition to route to (REQ-5).
    setupProject({
      reviewLaneOverride: {
        parallel_limit: 1, max_retries: 1, primary_model: 'mock',
        on_failure: 'implement:queue',
      },
    });
    const tracksDir = join(TMP, 'conductor/tracks');
    createTrack(tracksDir, '904', { lane: 'review' });

    const final = await runToCompletion(tracksDir, '904', {
      MOCK_CLI_EXIT_CODE: '0',
      MOCK_CLI_EMIT_BLOCKED_SUMMARY: 'should this wait for a follow-up track instead?',
      MOCK_CLI_WRITE_VERDICT: 'pass',
    });

    assert.equal(getLane(final), 'review', 'unroutable verdict — falls back to parking in place');
    assert.equal(getLaneStatus(final), 'waiting');
    const reason = getWaitingReason(final);
    assert.ok(reason && reason.length > 0);

    const conv = conversationFor(tracksDir, '904');
    assert.doesNotMatch(conv || '', /already resolved \*\*Verdict\*\*/i,
      'a fallback-to-park is not an override — no override comment should appear');
  });

  it('TC-9b-equivalent: a normal (non-blocked) verdict write does not itself force any special routing', async () => {
    setupProject();
    const tracksDir = join(TMP, 'conductor/tracks');
    createTrack(tracksDir, '905', { lane: 'review' });

    const final = await runToCompletion(tracksDir, '905', {
      MOCK_CLI_EXIT_CODE: '0',
      MOCK_CLI_WRITE_VERDICT: 'fail',
    });

    // No blocked turn at all — the ordinary success transition (review has
    // no failure signal from isSuccess's point of view) applies unchanged,
    // proving the override only ever engages when isBlockedTurn is true.
    assert.equal(getLane(final), 'quality-gate', 'without a blocked turn, the ordinary on_success transition applies');
    assert.equal(getLaneStatus(final), 'queue');
  });
});
