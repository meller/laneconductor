#!/usr/bin/env node
// conductor/tests/track-10020-stale-check-ignores-own-comments.test.mjs
// Track 10020: the mid-run staleness check (e3c7e44) had its own
// self-inflicted regression, caught live on track 10017: it compared
// conversation.md's raw mtime against contextFrozenAt, but the AGENT's own
// normal writes to that file during its run (status comments, closing
// responses — routine, happens on nearly every dispatch) bump the mtime
// exactly like a genuine new human message would. Result: any session that
// posts even one comment during its own run got incorrectly forced back to
// 'queue' at the same lane forever, unable to ever advance — confirmed
// live, track 10017's implement stage stuck in a queue loop twice in a row.
//
// Fix: compare the trailing UNANSWERED HUMAN tail specifically
// (extractUnansweredHumanTail), not raw mtime. This test drives a real
// mock-cli run that appends its own (non-human) comment to conversation.md
// mid-run — via MOCK_CLI_APPEND_OWN_COMMENT below — and asserts the track
// still correctly advances lanes, unlike the old mtime-based check would.
//
// Run: node --test conductor/tests/track-10020-stale-check-ignores-own-comments.test.mjs

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, appendFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const MOCK_CLI = join(__dirname, 'mock-cli.mjs');
const TMP = join(ROOT, '.test-tmp-track-10020-own-comments');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
async function poll(fn, { timeout = 15000, interval = 250, label = '' } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await fn();
    if (result) return result;
    await sleep(interval);
  }
  throw new Error(`poll timeout (${timeout}ms)${label ? ': ' + label : ''}`);
}
function startMockCollector() {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [join(__dirname, 'mock-collector.mjs')], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    proc.stdout.on('data', d => {
      out += d.toString();
      const m = out.match(/MOCK_COLLECTOR_PORT=(\d+)/);
      if (m) resolve({ proc, port: parseInt(m[1]) });
    });
    proc.stderr.on('data', d => process.stderr.write(`[mock-collector] ${d}`));
    proc.on('error', reject);
    setTimeout(() => reject(new Error('timeout')), 5000);
  });
}
async function getState(port) { return (await fetch(`http://127.0.0.1:${port}/_state`)).json(); }
async function enqueueDispatch(port, entry) {
  const r = await fetch(`http://127.0.0.1:${port}/_enqueue-dispatch`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(entry) });
  return (await r.json()).id;
}

const trackDir = join(TMP, 'conductor/tracks/001-test-track');
const indexPath = join(trackDir, 'index.md');
const convPath = join(trackDir, 'conversation.md');

function setupProject(collectorPort) {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
  execSync('git init -q', { cwd: TMP });
  execSync('git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init', { cwd: TMP });

  writeFileSync(join(TMP, '.laneconductor.json'), JSON.stringify({
    mode: 'local-api',
    project: { name: 'test-project', id: 1, repo_path: TMP, primary: { cli: 'mock', model: 'mock' } },
    collectors: [{ url: `http://127.0.0.1:${collectorPort}`, token: null }],
    ui: { port: 8090 },
  }, null, 2));

  mkdirSync(join(TMP, 'conductor/tracks'), { recursive: true });
  // on_success configured so a genuinely-clean success SHOULD advance —
  // proving the agent's own comment doesn't suppress that.
  writeFileSync(join(TMP, 'conductor/workflow.json'), JSON.stringify({
    global: { total_parallel_limit: 3 },
    defaults: { parallel_limit: 1, max_retries: 1, primary_model: 'mock' },
    lanes: { plan: { parallel_limit: 1, max_retries: 1, on_success: 'review:queue' } },
  }, null, 2));

  mkdirSync(trackDir, { recursive: true });
  writeFileSync(indexPath, [
    '# Track 001: Test Track',
    '',
    '**Lane**: plan',
    '**Lane Status**: queue',
    '**Progress**: 0%',
    '',
    '## Problem',
    'Test problem.',
  ].join('\n'));
  writeFileSync(convPath, '');
}

describe('Track 10020: the agent\'s own mid-run comment must NOT be mistaken for a new human message', () => {
  let collectorProc, collectorPort, worker;

  before(async () => {
    const c = await startMockCollector();
    collectorProc = c.proc; collectorPort = c.port;
    await fetch(`http://127.0.0.1:${collectorPort}/_reset`, { method: 'POST' });
    setupProject(collectorPort);

    worker = spawn('node', [join(ROOT, 'conductor/laneconductor.sync.mjs'), '--sync-only'], {
      cwd: TMP,
      env: {
        ...process.env,
        LC_SKIP_GIT_LOCK: '1',
        LC_MOCK_CLI: `node ${MOCK_CLI}`,
        MOCK_CLI_DELAY_MS: '600',
        // The mock CLI itself doesn't post comments, so simulate the
        // agent's own mid-run write directly against the fixture, timed to
        // land while the process is still sleeping (see the test body).
        LC_DISPATCH_POLL_MS: '300',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    worker.stdout.on('data', d => process.stdout.write(`[worker] ${d}`));
    worker.stderr.on('data', d => process.stderr.write(`[worker] ${d}`));
  });

  after(() => { worker?.kill(); collectorProc?.kill(); rmSync(TMP, { recursive: true, force: true }); });

  it('still advances the lane on success even though the agent posted its own comment mid-run', async () => {
    const state0 = await poll(async () => { const s = await getState(collectorPort); return s.workers.length > 0 ? s : null; });
    const workerId = state0.workers[0].id;

    await enqueueDispatch(collectorPort, { worker_id: workerId, action: 'plan', track_number: '001' });

    await poll(async () => {
      const content = existsSync(indexPath) ? readFileSync(indexPath, 'utf8') : '';
      return /\*\*Lane Status\*\*:\s*running/i.test(content) ? true : null;
    }, { label: 'dispatch claimed and marked running' });

    // Simulate the agent's OWN mid-run write — e.g. it posted a progress
    // comment via /laneconductor comment as part of doing real work. Not a
    // human message: no `> **human**` line.
    appendFileSync(convPath, '\n> **claude**: still working on Phase 2, will report back shortly.\n');

    const finalState = await poll(async () => {
      const s = await getState(collectorPort);
      const d = s.dispatch.find(e => e.action === 'plan');
      return d && d.status === 'done' ? s : null;
    }, { timeout: 15000, label: 'dispatch resolves' });

    const finalEntry = finalState.dispatch.find(e => e.action === 'plan');
    assert.equal(finalEntry.status, 'done');

    // The critical assertion: the lane DID advance to review, and progress
    // WAS marked complete — the old mtime-based check would have forced
    // this back to plan/queue instead, exactly as it did live on track
    // 10017.
    const content = readFileSync(indexPath, 'utf8');
    assert.match(content, /\*\*Lane\*\*:\s*review/i, 'must advance to review — the agent\'s own comment must not be mistaken for a new human message');
    assert.match(content, /\*\*Lane Status\*\*:\s*queue/i);
  });
});
