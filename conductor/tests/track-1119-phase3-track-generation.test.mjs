#!/usr/bin/env node
// conductor/tests/track-1119-phase3-track-generation.test.mjs
// Track AM-1119 Phase 3 (Task 1-3, TC-7/TC-8/TC-9): create-project with a
// full wizard payload (product + deployment) generates real track folders
// and file_sync_queue.md entries, and the freshly-spawned project worker
// registers them in the DB on its own next cycle.
//
// Reuses the same manager-worker + mock-collector + mock-cli harness as
// track-1091-create-project-worker.test.mjs / track-1119-wizard-dispatch.test.mjs.
// Unaffected by the primary-checkout cwd-normalization safety net (track
// 1102 REQ-1, see track-1119-phase3-depends-on.test.mjs's comment) because
// runCreateProject `git init`s the target directory into its own
// standalone repo before spawning its worker — no LC_SKIP_CWD_NORMALIZATION
// needed here.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const MOCK_CLI = join(__dirname, 'mock-cli.mjs');
const TMP = join(ROOT, '.test-tmp-track-1119-phase3-tracks');
const MANAGER_DIR = join(TMP, 'manager');
const TARGET_DIR = join(TMP, 'digger-game');

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

async function getState(port) {
  const r = await fetch(`http://127.0.0.1:${port}/_state`);
  return r.json();
}

async function enqueueDispatch(port, entry) {
  const r = await fetch(`http://127.0.0.1:${port}/_enqueue-dispatch`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(entry),
  });
  return (await r.json()).id;
}

function setupProject(dir, collectorPort) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, '.laneconductor.json'), JSON.stringify({
    mode: 'local-api',
    project: { name: 'test-manager', id: 1, repo_path: dir, primary: { cli: 'mock', model: 'mock' } },
    collectors: [{ url: `http://127.0.0.1:${collectorPort}`, token: null }],
    ui: { port: 8090 },
  }, null, 2));
  mkdirSync(join(dir, 'conductor/tracks'), { recursive: true });
  writeFileSync(join(dir, 'conductor/workflow.json'), JSON.stringify({
    global: { total_parallel_limit: 3 }, defaults: { parallel_limit: 3, max_retries: 1 },
  }, null, 2));
}

describe('Track AM-1119 Phase 3: create-project generates the initial track breakdown', () => {
  let collectorProc, collectorPort, managerWorker;

  before(async () => {
    const c = await startMockCollector();
    collectorProc = c.proc;
    collectorPort = c.port;
    await fetch(`http://127.0.0.1:${collectorPort}/_reset`, { method: 'POST' });

    rmSync(TMP, { recursive: true, force: true });
    setupProject(MANAGER_DIR, collectorPort);
    mkdirSync(TARGET_DIR, { recursive: true });

    managerWorker = spawn('node', [join(ROOT, 'conductor/laneconductor.sync.mjs'), '--sync-only', '--manager'], {
      cwd: MANAGER_DIR,
      env: { ...process.env, LC_MOCK_CLI: `node ${MOCK_CLI}`, MOCK_CLI_DELAY_MS: '150', LC_SKIP_GIT_LOCK: '1', LC_SKIP_WORKER_LOCK: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    managerWorker.stdout.on('data', d => process.stdout.write(`[manager] ${d}`));
    managerWorker.stderr.on('data', d => process.stderr.write(`[manager] ${d}`));

    await poll(async () => {
      const s = await getState(collectorPort);
      return s.workers.length > 0 ? s : null;
    }, { label: 'manager worker registered' });
  });

  after(() => {
    managerWorker?.kill();
    collectorProc?.kill();
    rmSync(TMP, { recursive: true, force: true });
  });

  it('writes 3-6 Auto-Run track folders + queue entries, ending in a Depends-On-gated deploy track, and the spawned project worker registers them in the DB', async () => {
    const state = await getState(collectorPort);
    const workerId = state.workers[0].id;

    await enqueueDispatch(collectorPort, {
      worker_id: workerId,
      action: 'create-project',
      payload: {
        repo_source: { type: 'path', value: TARGET_DIR },
        scaffold_context: {
          project: { name: 'Digger Game' },
          brainstorm_summary: [
            'Project purpose: Dig for ore, avoid hazards',
            'Target users: casual browser-game players',
            'Tech stack: React + Canvas',
            'Success metrics / KPIs: 500 plays in week 1',
          ].join('\n'),
        },
        wizard: {
          deployment: { provider: 'firebase', environments: ['prod'] },
        },
      },
    });

    // Dispatch must resolve done (not failed) — same regression class as
    // Phase 2's .env.example bug: a mistake in track generation must not
    // silently abort the whole create-project run.
    const dispatchDone = await poll(async () => {
      const s = await getState(collectorPort);
      const d = s.dispatch.find(e => e.action === 'create-project');
      return d?.status === 'done' || d?.status === 'failed' ? d : null;
    }, { label: 'create-project dispatch resolves' });
    assert.equal(dispatchDone.status, 'done', `create-project dispatch should succeed, got: ${dispatchDone.result}`);
    assert.match(dispatchDone.result, /Generated tracks: /, 'TC-9/Task 3: dispatch result names the generated tracks');

    // TC-7: 3-6 track folders exist, each with Auto Run/Author/Created By.
    const tracksDir = join(TARGET_DIR, 'conductor', 'tracks');
    const trackDirs = readdirSync(tracksDir, { withFileTypes: true })
      .filter(d => d.isDirectory() && /^\d|^[A-Z]+-\d/.test(d.name))
      .map(d => d.name)
      .sort();
    assert.ok(trackDirs.length >= 3 && trackDirs.length <= 6, `expected 3-6 generated track folders, got ${trackDirs.length}: ${trackDirs.join(', ')}`);

    const indexContents = trackDirs.map(name => readFileSync(join(tracksDir, name, 'index.md'), 'utf8'));
    for (const content of indexContents) {
      assert.match(content, /\*\*Auto Run\*\*:\s*yes/i, 'every generated track must carry Auto Run: yes');
      assert.match(content, /\*\*Author\*\*:\s*\S+/, 'every generated track must carry an Author');
      assert.match(content, /\*\*Created By\*\*:\s*\S+/, 'every generated track must carry a Created By');
    }

    // TC-8: the set ends with exactly one deploy track referencing the
    // chosen provider, and it depends on every track ahead of it.
    const lastDir = trackDirs[trackDirs.length - 1];
    assert.match(lastDir.toLowerCase(), /deploy/, 'last generated track slug should reference deploy');
    assert.match(lastDir.toLowerCase(), /firebase/, 'last generated track slug should reference the chosen provider');
    const lastContent = indexContents[indexContents.length - 1];
    assert.match(lastContent, /\*\*Depends On\*\*:\s*\S+/, 'deploy track must declare dependencies');
    const deployCount = trackDirs.filter(d => d.toLowerCase().includes('deploy')).length;
    assert.equal(deployCount, 1, 'exactly one deploy track');

    // file_sync_queue.md carries a matching entry per generated track.
    const queueContent = readFileSync(join(tracksDir, 'file_sync_queue.md'), 'utf8');
    for (const dir of trackDirs) {
      const num = dir.match(/(\d+)/)[1];
      assert.match(queueContent, new RegExp(`### Track ${num}:`), `file_sync_queue.md should have an entry for track ${num}`);
    }

    // TC-9: the freshly spawned project worker (started at the end of
    // runCreateProject) registers each generated track in the DB on its
    // own next cycle — proven against the mock collector's /track state,
    // not just the filesystem.
    await poll(async () => {
      const s = await getState(collectorPort);
      const allRegistered = trackDirs.every(dir => {
        const num = dir.match(/(\d+)/)[1];
        return s.tracks && s.tracks[num] !== undefined;
      });
      return allRegistered ? s : null;
    }, { label: 'all generated tracks registered in DB by the new project worker', timeout: 25000 });
  });
});
