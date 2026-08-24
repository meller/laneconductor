#!/usr/bin/env node
// conductor/tests/track-10011-gemini-discovery.test.mjs
// Track 10011: Gemini local provider discovery alignment
//
// Run: node --test conductor/tests/track-10011-gemini-discovery.test.mjs

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, chmodSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const TMP = join(ROOT, '.test-tmp-track-10011-discovery');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function poll(fn, { timeout = 12000, interval = 250, label = '' } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await fn();
    if (result) return result;
    await sleep(interval);
  }
  throw new Error(`poll timeout (${timeout}ms)${label ? ': ' + label : ''}`);
}

async function startMockCollector() {
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

function setupProject(collectorPort) {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
  mkdirSync(join(TMP, 'bin'), { recursive: true });

  // Write a mock 'agy' binary that lists models
  const mockAgyCode = `#!/usr/bin/env node
if (process.argv[2] === 'models') {
  console.log('gemini-3.7-flash-high     Gemini 3.7 Flash (High)');
  console.log('gemini-3.7-flash-medium   Gemini 3.7 Flash (Medium)');
  console.log('claude-sonnet-4-6         Claude Sonnet 4.6 (Thinking)');
}
`;
  writeFileSync(join(TMP, 'bin/agy'), mockAgyCode);
  chmodSync(join(TMP, 'bin/agy'), 0o755);

  // Write `.laneconductor.json`
  writeFileSync(join(TMP, '.laneconductor.json'), JSON.stringify({
    mode: 'local-api',
    project: { name: 'test-project', id: 1, repo_path: TMP, primary: { cli: 'claude', model: 'sonnet' } },
    collectors: [{ url: `http://127.0.0.1:${collectorPort}`, token: null }],
    ui: { port: 8090 },
  }, null, 2));

  mkdirSync(join(TMP, 'conductor/tracks'), { recursive: true });
  writeFileSync(join(TMP, 'conductor/workflow.json'), JSON.stringify({
    global: { total_parallel_limit: 3 },
    defaults: { parallel_limit: 3, max_retries: 1, primary_model: 'sonnet' },
    lanes: { implement: { parallel_limit: 3, max_retries: 1 } },
  }, null, 2));
}

describe('Track 10011: Gemini local provider discovery alignment', () => {
  let collectorProc, collectorPort, worker;

  before(async () => {
    const c = await startMockCollector();
    collectorProc = c.proc;
    collectorPort = c.port;
    await fetch(`http://127.0.0.1:${collectorPort}/_reset`, { method: 'POST' });
    setupProject(collectorPort);

    // Prepend TMP/bin to PATH so that the worker executes our mock 'agy'
    const newPath = `${join(TMP, 'bin')}:${process.env.PATH}`;

    worker = spawn('node', [join(ROOT, 'conductor/laneconductor.sync.mjs'), '--sync-only'], {
      cwd: TMP,
      env: {
        ...process.env,
        PATH: newPath,
        LC_SKIP_GIT_LOCK: '1',
        LC_HEARTBEAT_INTERVAL_MS: '1000',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    worker.stdout.on('data', d => process.stdout.write(`[sync-worker-stdout] ${d}`));
    worker.stderr.on('data', d => process.stderr.write(`[sync-worker-stderr] ${d}`));
  });

  after(() => {
    worker?.kill();
    collectorProc?.kill();
    rmSync(TMP, { recursive: true, force: true });
  });

  it('queries agy models as a fallback for gemini models and parses them correctly', async () => {
    const state = await poll(async () => {
      const s = await getState(collectorPort);
      const w = s.workers[0];
      return (w && w.available_models && w.available_models.gemini) ? s : null;
    }, { timeout: 20000, label: 'worker reported gemini models via heartbeat' });

    const registeredWorker = state.workers[0];
    assert.ok(registeredWorker.available_models, 'worker should report available_models');
    
    const geminiModels = registeredWorker.available_models.gemini;
    assert.ok(geminiModels, 'available_models should contain gemini key');
    // It should have the 2 discovered models first, followed by presets
    assert.ok(geminiModels.length >= 2, 'should discover at least two gemini models');
    assert.deepEqual(geminiModels.slice(0, 2), [
      { id: 'gemini-3.7-flash-high', label: 'Gemini 3.7 Flash (High)' },
      { id: 'gemini-3.7-flash-medium', label: 'Gemini 3.7 Flash (Medium)' }
    ]);
  });
});
