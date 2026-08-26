#!/usr/bin/env node
// conductor/tests/track-1119-resolve-track-folder-quarantine.test.mjs
//
// Dogfooding 2026-08-26: resolveTrackFolder()'s matches.length === 1
// branch trusted a lone legacy-pattern folder match (`${trackNumber}-slug`)
// immediately, without ever checking whether tracks-metadata.json
// registers a DIFFERENT, currently-existing folder. That combination only
// arises when a prefixed track (e.g. "AM-1119-app-creator-wizard", which
// structurally can never appear in `matches` — it doesn't start with the
// bare `${trackNumber}-` prefix) has a stale legacy-named duplicate
// sitting next to it. Confirmed live, track 1119: checkAndClaimGitLock's
// own git-add/commit step trusted this branch and repeatedly re-committed
// a scaffolded placeholder into the STALE folder on every dispatch
// ("chore(track-1119): sync files before worktree", fired 5+ times),
// while the real, actively-worked "AM-1119-app-creator-wizard" folder
// never got touched.
//
// This test seeds exactly that fixture — a stale legacy folder AND a
// registered prefixed folder both present — dispatches a real lane
// action through the real spawned worker (LC_SKIP_GIT_LOCK NOT set, so
// checkAndClaimGitLock's real git-add/commit path actually runs), and
// asserts the stale folder gets quarantined (renamed to `_duplicate-*`)
// rather than silently winning and being auto-committed.
//
// Run: node --test conductor/tests/track-1119-resolve-track-folder-quarantine.test.mjs

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const MOCK_CLI = join(__dirname, 'mock-cli.mjs');
const TMP = join(ROOT, '.test-tmp-track-1119-resolve-folder-quarantine');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
async function poll(fn, { timeout = 20000, interval = 250, label = '' } = {}) {
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
    setTimeout(() => reject(new Error('mock-collector startup timeout')), 5000);
  });
}
async function getState(port) { return (await fetch(`http://127.0.0.1:${port}/_state`)).json(); }
async function enqueueDispatch(port, entry) {
  const r = await fetch(`http://127.0.0.1:${port}/_enqueue-dispatch`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(entry) });
  return (await r.json()).id;
}

function setupProject(collectorPort) {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
  execSync('git init -q', { cwd: TMP });
  writeFileSync(join(TMP, '.gitignore'), [
    '.conductor/',
    'conductor/logs/',
    '*.log',
    'conductor/tracks-metadata.json',
    'conductor/tracks/**/conversation.md',
    'conductor/tracks/**/conversation.json',
    '.conv-cursor',
    '',
  ].join('\n'));

  writeFileSync(join(TMP, '.laneconductor.json'), JSON.stringify({
    mode: 'local-api',
    project: { name: 'test-project', id: 1, repo_path: TMP, primary: { cli: 'mock', model: 'mock' } },
    collectors: [{ url: `http://127.0.0.1:${collectorPort}`, token: null }],
    ui: { port: 8090 },
  }, null, 2));

  mkdirSync(join(TMP, 'conductor/tracks'), { recursive: true });
  writeFileSync(join(TMP, 'conductor/workflow.json'), JSON.stringify({
    global: { total_parallel_limit: 3 },
    defaults: { parallel_limit: 2, max_retries: 1, primary_model: 'mock' },
    lanes: { plan: { parallel_limit: 2, max_retries: 1 } },
  }, null, 2));

  // The stale legacy duplicate — matches `1119-` directly, would win
  // resolveTrackFolder's matches.length===1 branch under the old logic.
  const staleDir = join(TMP, 'conductor/tracks/1119-stale-placeholder');
  mkdirSync(staleDir, { recursive: true });
  writeFileSync(join(staleDir, 'index.md'), [
    '# Track 1119: Scaffolded placeholder (should never be used)',
    '',
    '**Lane**: plan',
    '**Lane Status**: queue',
    '**Progress**: 0%',
    '',
    '## Problem',
    'STALE — this folder should be quarantined, not dispatched against.',
  ].join('\n'));

  // The real, prefixed, currently-registered folder.
  const realDir = join(TMP, 'conductor/tracks/AM-1119-app-creator-wizard');
  mkdirSync(realDir, { recursive: true });
  writeFileSync(join(realDir, 'index.md'), [
    '# Track AM-1119: App Creator Wizard (the real one)',
    '',
    '**Lane**: plan',
    '**Lane Status**: queue',
    '**Progress**: 0%',
    '',
    '## Problem',
    'REAL — this is the actively-worked folder, registered in metadata.',
  ].join('\n'));

  writeFileSync(join(TMP, 'conductor/tracks-metadata.json'), JSON.stringify({
    format: '1.0',
    last_checked: new Date().toISOString(),
    tracks: {
      '1119': {
        folder_path: 'conductor/tracks/AM-1119-app-creator-wizard',
        last_file_update: new Date().toISOString(),
        synced: true,
      },
    },
  }, null, 2));

  execSync('git add -A', { cwd: TMP });
  execSync('git -c user.email=t@t -c user.name=t commit -q -m "seed fixture"', { cwd: TMP });
  execSync('git branch -M main', { cwd: TMP });
}

describe('resolveTrackFolder: quarantines a stale legacy duplicate instead of trusting it over a registered prefixed folder', () => {
  let collectorProc, collectorPort, worker;

  before(async () => {
    const c = await startMockCollector();
    collectorProc = c.proc; collectorPort = c.port;
    await fetch(`http://127.0.0.1:${collectorPort}/_reset`, { method: 'POST' });
    setupProject(collectorPort);

    // Deliberately NOT LC_SKIP_GIT_LOCK — this test exists to exercise the
    // real checkAndClaimGitLock -> resolveTrackFolder -> git add/commit path.
    worker = spawn('node', [join(ROOT, 'conductor/laneconductor.sync.mjs'), '--sync-only'], {
      cwd: TMP,
      env: {
        ...process.env,
        LC_MOCK_CLI: `node ${MOCK_CLI}`,
        MOCK_CLI_DELAY_MS: '200',
        LC_DISPATCH_POLL_MS: '150',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    worker.stdout.on('data', d => process.stdout.write(`[worker] ${d}`));
    worker.stderr.on('data', d => process.stderr.write(`[worker] ${d}`));
  });

  after(() => { worker?.kill(); collectorProc?.kill(); rmSync(TMP, { recursive: true, force: true }); });

  it('quarantines the stale folder, dispatches against the real one, and never auto-commits the placeholder', async () => {
    const state0 = await poll(async () => { const s = await getState(collectorPort); return s.workers.length > 0 ? s : null; });
    const workerId = state0.workers[0].id;

    await enqueueDispatch(collectorPort, { worker_id: workerId, action: 'plan', track_number: '1119' });

    await poll(async () => {
      const s = await getState(collectorPort);
      const d = s.dispatch.find(e => e.track_number === '1119' && e.action === 'plan');
      return (d && d.status !== 'pending' && d.status !== 'claimed') ? s : null;
    }, { timeout: 20000, label: 'dispatch resolves' });

    // The stale folder must be quarantined, not left in place under its
    // original name (which would let it keep winning every future call).
    await poll(async () => {
      return existsSync(join(TMP, 'conductor/tracks/_duplicate-1119-stale-placeholder')) ? true : null;
    }, { timeout: 10000, label: 'stale folder gets quarantined' });

    assert.ok(!existsSync(join(TMP, 'conductor/tracks/1119-stale-placeholder')), 'stale folder must no longer exist under its original name');

    // The real folder must be the one actually dispatched against —
    // its content should reflect the real dispatch (Lane Status moved
    // off "queue"), not the untouched placeholder text.
    const realContent = readFileSync(join(TMP, 'conductor/tracks/AM-1119-app-creator-wizard/index.md'), 'utf8');
    assert.match(realContent, /App Creator Wizard \(the real one\)/, 'the real folder must still be the one carrying the real title');
    assert.doesNotMatch(realContent, /\*\*Lane Status\*\*:\s*queue/i, 'the real folder must have actually been dispatched against (Lane Status advanced)');

    // The quarantined placeholder's own content must be untouched by the
    // dispatch — proof nothing was ever committed/run against it.
    const staleContent = readFileSync(join(TMP, 'conductor/tracks/_duplicate-1119-stale-placeholder/index.md'), 'utf8');
    assert.match(staleContent, /STALE — this folder should be quarantined/, 'quarantined folder content must be untouched');

    // Metadata must still point at the real folder, unchanged.
    const meta = JSON.parse(readFileSync(join(TMP, 'conductor/tracks-metadata.json'), 'utf8'));
    assert.equal(meta.tracks['1119'].folder_path, 'conductor/tracks/AM-1119-app-creator-wizard');

    // No stray auto-commit ever touched the stale folder's original path.
    const log = execSync('git log --oneline --all', { cwd: TMP, encoding: 'utf8' });
    assert.doesNotMatch(log, /1119-stale-placeholder/, 'the stale folder must never have been git-added/committed under its original name');
  });
});
