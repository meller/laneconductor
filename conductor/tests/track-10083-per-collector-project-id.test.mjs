#!/usr/bin/env node
// conductor/tests/track-10083-per-collector-project-id.test.mjs
// Track AM-10083 Phase 4 (F-1/REQ-5): upsertWorker() used to assign
// `project.id` from whichever collector's /project/ensure answered LAST in
// its loop, then rewrite `.laneconductor.json` with it every time — so one
// id ended up sent to every collector regardless of what each of them
// actually resolves it to. Cloud's checkProject middleware 403s on a
// project_id that doesn't resolve in the caller's own workspace, so this
// wasn't just a cosmetic file value: it broke `postToCollectors`/
// `patchCollectors` sending a project_id-bearing body to more than one
// collector.
//
// This proves both halves of the fix with two mock collectors configured
// to answer /project/ensure with DIFFERENT project ids:
//   1. `.laneconductor.json`'s project.id ends up naming the PRIMARY's id,
//      never the secondary's (even though the secondary registers too).
//   2. A track sync fans project_id out per-collector — the primary gets
//      its own id, the secondary gets ITS OWN id, not the primary's.
//
// Run: node --test conductor/tests/track-10083-per-collector-project-id.test.mjs

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const TMP = join(ROOT, `.test-tmp-track-10083-project-id-${process.pid}`);

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

function startMock() {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [join(__dirname, 'mock-target.mjs')], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    proc.stdout.on('data', d => {
      out += d.toString();
      const m = out.match(/MOCK_COLLECTOR_PORT=(\d+)/);
      if (m) resolve({ proc, port: parseInt(m[1]) });
    });
    proc.stderr.on('data', d => process.stderr.write(`[mock] ${d}`));
    proc.on('error', reject);
    setTimeout(() => reject(new Error('mock collector startup timeout')), 5000);
  });
}

async function getState(port) {
  const r = await fetch(`http://127.0.0.1:${port}/_state`);
  return r.json();
}

async function setProjectEnsureId(port, project_id) {
  await fetch(`http://127.0.0.1:${port}/_set-project-ensure-id`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project_id }),
  });
}

function stopWorker(worker) {
  return new Promise(resolve => {
    if (!worker || worker.exitCode !== null || worker.signalCode !== null) return resolve();
    worker.once('exit', () => resolve());
    worker.kill('SIGTERM');
    setTimeout(() => { try { worker.kill('SIGKILL'); } catch { /* already dead */ } resolve(); }, 3000);
  });
}

const PRIMARY_PROJECT_ID = 111;
const SECONDARY_PROJECT_ID = 222;

describe('Track AM-10083 Phase 4: each collector gets its OWN project id, not whichever answered last', () => {
  let mockA, mockAPort, mockB, mockBPort, worker;

  before(async () => {
    ({ proc: mockA, port: mockAPort } = await startMock());
    ({ proc: mockB, port: mockBPort } = await startMock());
    await setProjectEnsureId(mockAPort, PRIMARY_PROJECT_ID);
    await setProjectEnsureId(mockBPort, SECONDARY_PROJECT_ID);

    rmSync(TMP, { recursive: true, force: true });
    mkdirSync(TMP, { recursive: true });
    execSync('git init -q', { cwd: TMP });
    execSync('git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init', { cwd: TMP });

    mkdirSync(join(TMP, 'conductor/tracks/9998-project-id-test'), { recursive: true });
    writeFileSync(join(TMP, 'conductor/tracks/9998-project-id-test/index.md'), [
      '# Track 9998: Project Id Test',
      '',
      '**Lane**: backlog',
      '**Lane Status**: queue',
      '**Progress**: 0%',
    ].join('\n'));
    writeFileSync(join(TMP, '.laneconductor.json'), JSON.stringify({
      mode: 'local-api',
      project: { name: 'test-10083-project-id', repo_path: TMP, primary: { cli: 'mock', model: 'mock' } },
      collectors: [
        { url: `http://127.0.0.1:${mockAPort}`, token: null },
        { url: `http://127.0.0.1:${mockBPort}`, token: null, enabled: true, type: 'remote' },
      ],
      ui: { port: 8090 },
    }, null, 2));

    worker = spawn('node', [join(ROOT, 'conductor/laneconductor.sync.mjs'), '--sync-only'], {
      cwd: TMP,
      env: { ...process.env, LC_SKIP_GIT_LOCK: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    worker.stdout.on('data', d => process.stdout.write(`[worker] ${d}`));
    worker.stderr.on('data', d => process.stderr.write(`[worker] ${d}`));
  });

  after(async () => {
    await stopWorker(worker);
    mockA?.kill('SIGTERM');
    mockB?.kill('SIGTERM');
    rmSync(TMP, { recursive: true, force: true });
  });

  it('.laneconductor.json ends up with the PRIMARY collector\'s project id, never the secondary\'s', async () => {
    await poll(async () => {
      const s = await getState(mockAPort);
      return s.workers.length > 0 ? s : null;
    }, { label: 'worker registered with primary' });
    await poll(async () => {
      const s = await getState(mockBPort);
      return s.workers.length > 0 ? s : null;
    }, { label: 'worker registered with secondary' });

    const cfg = JSON.parse(readFileSync(join(TMP, '.laneconductor.json'), 'utf8'));
    assert.equal(cfg.project.id, PRIMARY_PROJECT_ID,
      'the shared config file must name the PRIMARY collector\'s project id');
  });

  it('a track sync sends EACH collector its own resolved project id, not the primary\'s to both', async () => {
    // The track file exists from setup — the worker's own ignoreInitial:false
    // chokidar watch syncs it on startup without any test-driven file touch.
    await poll(async () => {
      const s = await getState(mockAPort);
      return s.tracks['9998'] ? s : null;
    }, { label: 'primary collector synced the track' });
    await poll(async () => {
      const s = await getState(mockBPort);
      return s.tracks['9998'] ? s : null;
    }, { label: 'secondary collector synced the track' });

    const primaryState = await getState(mockAPort);
    const secondaryState = await getState(mockBPort);
    assert.equal(primaryState.tracks['9998'].project_id, PRIMARY_PROJECT_ID);
    assert.equal(secondaryState.tracks['9998'].project_id, SECONDARY_PROJECT_ID,
      'the secondary collector must receive ITS OWN project id, not the primary\'s');
  });
});
