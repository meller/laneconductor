#!/usr/bin/env node
// conductor/tests/track-10060-escalation-e2e.test.mjs
// Track 10060 Phase 5 (TC-24, TC-25): the real worker process, a real dirty
// git checkout, and a collector whose prespawn-block endpoint is unavailable.
//
// This is the scenario the unit tests can only approximate: before this track,
// handlePreSpawnBlock hardcoded `countBefore = 0` whenever
// POST /track/:num/prespawn-block failed, which is what happens on any database
// where ui/server/migrations/013_track_10040_prespawn_block.sql was never
// applied (nothing applies those automatically). Escalation was then
// structurally unreachable: the track re-warned every cycle and never reached a
// terminal state. Track 10051 sat wedged at done:queue exactly this way.
//
// The mock target has no /prespawn-block route and answers 404, so the worker's
// `post()` throws — the same failure shape as a 500 from a real collector
// missing those columns. Everything else on the collector works normally, which
// is the point: only the counter backend is broken.
//
// Run: node --test conductor/tests/track-10060-escalation-e2e.test.mjs

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execSync } from 'node:child_process';
import { makeSandbox, cleanupSandbox, startIsolatedWorker, stopWorker } from './helpers/isolated-worker.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MOCK_CLI = join(__dirname, 'mock-cli.mjs');

// The helper resolves the worker script through resolvePrimaryRepoRoot(), which
// maps a worktree back to the primary checkout — so a run from inside a track's
// worktree would exercise MAIN's worker, not the code under test. Pin it to the
// checkout this test file physically lives in.
process.env.LC_TEST_REPO_ROOT ??= join(__dirname, '../..');
const TRACK_NUM = '19960';
const TRACK_DIR_NAME = `${TRACK_NUM}-escalation-e2e`;
const ESCALATE_AFTER = 5;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function poll(fn, { timeout = 40000, interval = 250, label = '' } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await fn();
    if (result) return result;
    await sleep(interval);
  }
  throw new Error(`poll timeout (${timeout}ms)${label ? ': ' + label : ''}`);
}

// mock-target.mjs is the renamed mock-collector.mjs (its own header still says
// so). It still prints MOCK_COLLECTOR_PORT= on startup.
function startMockTarget() {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [join(__dirname, 'mock-target.mjs')], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    proc.stdout.on('data', d => {
      out += d.toString();
      const m = out.match(/MOCK_COLLECTOR_PORT=(\d+)/);
      if (m) resolve({ proc, port: parseInt(m[1]) });
    });
    proc.on('error', reject);
    setTimeout(() => reject(new Error('mock-target startup timeout')), 5000);
  });
}

async function getState(port) { return (await fetch(`http://127.0.0.1:${port}/_state`)).json(); }

async function enqueueDispatch(port, entry) {
  const r = await fetch(`http://127.0.0.1:${port}/_enqueue-dispatch`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(entry),
  });
  return (await r.json()).id;
}

describe('Track 10060: a permanently-blocked main-mode merge escalates even with the counter backend down', () => {
  let sandbox, targetProc, targetPort, worker, indexPath, convPath;

  before(async () => {
    const t = await startMockTarget();
    targetProc = t.proc; targetPort = t.port;
    await fetch(`http://127.0.0.1:${targetPort}/_reset`, { method: 'POST' });

    sandbox = makeSandbox('10060-escalation');

    writeFileSync(join(sandbox, '.gitignore'), [
      '.conductor/', 'conductor/logs/', '*.log',
      'conductor/tracks-metadata.json',
      'conductor/tracks/**/conversation.md',
      'conductor/tracks/**/conversation.json',
      '.conv-cursor', '',
    ].join('\n'));
    writeFileSync(join(sandbox, '.laneconductor.json'), JSON.stringify({
      mode: 'local-api',
      project: { name: 'test-project', id: 1, repo_path: sandbox, primary: { cli: 'mock', model: 'mock' } },
      collectors: [{ url: `http://127.0.0.1:${targetPort}`, token: null }],
    }, null, 2));

    mkdirSync(join(sandbox, 'conductor/tracks'), { recursive: true });
    writeFileSync(join(sandbox, 'conductor/workflow.json'), JSON.stringify({
      global: { total_parallel_limit: 3 },
      defaults: { parallel_limit: 1, max_retries: 1, primary_model: 'mock' },
      lanes: { done: { parallel_limit: 1, max_retries: 1, on_failure: 'done:failure' } },
    }, null, 2));

    const trackDir = join(sandbox, 'conductor/tracks', TRACK_DIR_NAME);
    mkdirSync(trackDir, { recursive: true });
    indexPath = join(trackDir, 'index.md');
    convPath = join(trackDir, 'conversation.md');
    writeFileSync(indexPath, [
      `# Track ${TRACK_NUM}: Escalation E2E`,
      '',
      '**Lane**: done', // the done lane is forced to workspace: main (track 10035)
      '**Lane Status**: queue',
      '**Progress**: 100%',
      '**Merge Mode**: direct',
      '**Auto Run**: yes',
      '',
    ].join('\n'));
    writeFileSync(convPath, `# Conversation: Track ${TRACK_NUM}\n`);

    // A genuinely regenerable artifact, so the block also exercises Phase 4's
    // suggestion path. Committed clean first, then dirtied below.
    mkdirSync(join(sandbox, 'prisma'), { recursive: true });
    writeFileSync(join(sandbox, 'prisma/schema.sql'), '-- generated dump\n');
    writeFileSync(join(sandbox, 'README.md'), 'init\n');
    execSync('git add -A', { cwd: sandbox });
    execSync('git -c user.email=t@t -c user.name=t commit -q -m init', { cwd: sandbox });
    execSync('git branch -M main', { cwd: sandbox });

    worker = await startIsolatedWorker({
      sandbox,
      args: ['--sync-only'],
      collectorPort: targetPort,
      env: {
        LC_MOCK_CLI: `node ${MOCK_CLI}`,
        MOCK_CLI_DELAY_MS: '100',
        LC_DISPATCH_POLL_MS: '150',
        LC_PRESPAWN_BLOCK_ESCALATE_AFTER: String(ESCALATE_AFTER),
        // Keep the settle window short so five consecutive blocks take
        // seconds. Production defaults (5s / 30s) are untouched.
        LC_DIRTY_RETRY_INTERVAL_MS: '100',
        LC_DIRTY_RETRY_MAX_MS: '200',
      },
    });
  });

  after(async () => {
    await stopWorker(worker);
    targetProc?.kill();
    cleanupSandbox(sandbox);
  });

  it('TC-24: five consecutive blocks land done:failure with exactly one ⚠️ and one ❌', async () => {
    const state0 = await poll(async () => {
      const s = await getState(targetPort);
      return s.workers.length > 0 ? s : null;
    }, { label: 'worker registers' });
    const workerId = state0.workers[0].id;

    // Dirty the checkout with a tracked, non-exempt path. Every merge in the
    // project is now blocked — that is the condition under test.
    writeFileSync(join(sandbox, 'prisma/schema.sql'), '-- generated dump\n-- drifted\n');

    for (let attempt = 1; attempt <= ESCALATE_AFTER; attempt++) {
      const id = await enqueueDispatch(targetPort, { worker_id: workerId, action: 'merge', track_number: TRACK_NUM });
      await poll(async () => {
        const s = await getState(targetPort);
        const d = s.dispatch.find(e => e.id === id);
        return (d && d.status !== 'pending' && d.status !== 'claimed') ? d : null;
      }, { label: `block attempt ${attempt} resolves` });
    }

    const finalIndex = readFileSync(indexPath, 'utf8');
    assert.match(finalIndex, /\*\*Lane Status\*\*:\s*failure/i,
      `after ${ESCALATE_AFTER} consecutive blocks the track must reach done:failure, not retry forever. index.md was:\n${finalIndex}`);

    const conversation = readFileSync(convPath, 'utf8');
    const warns = (conversation.match(/⚠️/g) || []).length;
    const fails = (conversation.match(/❌/g) || []).length;
    assert.equal(warns, 1, `exactly one ⚠️ across the whole streak, got ${warns}:\n${conversation}`);
    assert.equal(fails, 1, `exactly one ❌ across the whole streak, got ${fails}:\n${conversation}`);

    // REQ-6: the comment must say integration is halted project-wide.
    assert.match(conversation, /every merge/i);
    // REQ-7: the regenerable artifact names how it is regenerated.
    assert.match(conversation, /node scripts\/atlas-prisma\.mjs/);
    // REQ-4: the counter-backend failure is its own greppable log condition.
    assert.match(worker.getOutput(), /prespawn-counter-backend-unavailable/);
    assert.match(worker.getOutput(), /013_track_10040_prespawn_block\.sql/);

    // Nothing was auto-committed on the way (REQ-8): the drift is still dirty.
    const porcelain = execSync('git status --porcelain', { cwd: sandbox, encoding: 'utf8' });
    assert.match(porcelain, /prisma\/schema\.sql/, 'a schema dump must never be committed unattended');
  });

  it('TC-25: a clean checkout spawns normally and clears the fallback counter', async () => {
    execSync('git checkout -- prisma/schema.sql', { cwd: sandbox });
    writeFileSync(indexPath, readFileSync(indexPath, 'utf8').replace(/\*\*Lane Status\*\*:\s*\S+/i, '**Lane Status**: queue'));

    const state = await getState(targetPort);
    const workerId = state.workers[0].id;
    const id = await enqueueDispatch(targetPort, { worker_id: workerId, action: 'merge', track_number: TRACK_NUM });
    await poll(async () => {
      const s = await getState(targetPort);
      const d = s.dispatch.find(e => e.id === id);
      return (d && d.status !== 'pending' && d.status !== 'claimed') ? d : null;
    }, { label: 'the unblocked merge dispatch resolves' });

    const countPath = join(sandbox, 'conductor/tracks', TRACK_DIR_NAME, '.prespawn-block-count');
    assert.equal(existsSync(countPath), false,
      'a spawn that got past both pre-spawn guards must clear the on-disk fallback counter (REQ-5)');
  });
});
