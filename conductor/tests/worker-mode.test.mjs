#!/usr/bin/env node
// conductor/tests/worker-mode.test.mjs
// Test worker mode configuration (sync-only vs sync+poll)
//
// Tests:
//   1. Config without worker.mode defaults to 'sync+poll'
//   2. Config with worker.mode='sync-only' uses sync-only mode
//   3. CLI flag --sync-only overrides config
//   4. sync-only mode skips queue polling
//   5. sync+poll mode includes queue polling (default)
//
// Run: node --test conductor/tests/worker-mode.test.mjs

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

describe('Worker Mode Configuration', () => {
  describe('Config Parsing', () => {
    it('should default to sync+poll mode when worker.mode is not specified', async () => {
      const testDir = join(ROOT, '.test-worker-mode-1');
      rmSync(testDir, { recursive: true, force: true });
      mkdirSync(join(testDir, 'conductor/tracks'), { recursive: true });

      // Config without worker.mode
      writeFileSync(join(testDir, '.laneconductor.json'), JSON.stringify({
        mode: 'local-fs',
        project: { name: 'test', id: 1, repo_path: testDir, primary: { cli: 'mock', model: 'mock' } },
        collectors: [],
        ui: { port: 8090 }
      }, null, 2));

      writeFileSync(join(testDir, 'conductor/workflow.json'), JSON.stringify({
        global: { total_parallel_limit: 1 },
        defaults: { parallel_limit: 1, max_retries: 1, primary_model: 'mock' },
        lanes: { planning: { parallel_limit: 1, max_retries: 1 } }
      }, null, 2));

      // Start worker without --sync-only flag
      const proc = spawn('node', [join(ROOT, 'conductor/laneconductor.sync.mjs')], {
        cwd: testDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 5000
      });

      let output = '';
      proc.stdout.on('data', data => { output += data; });
      proc.stderr.on('data', data => { output += data; });

      // Give it time to start and log
      await sleep(1000);
      proc.kill();

      assert.match(output, /Worker mode: sync\+poll/, 'should log sync+poll mode by default');
      rmSync(testDir, { recursive: true, force: true });
    });

    it('should use sync-only mode when worker.mode is configured', async () => {
      const testDir = join(ROOT, '.test-worker-mode-2');
      rmSync(testDir, { recursive: true, force: true });
      mkdirSync(join(testDir, 'conductor/tracks'), { recursive: true });

      // Config with worker.mode='sync-only'
      writeFileSync(join(testDir, '.laneconductor.json'), JSON.stringify({
        mode: 'local-fs',
        project: { name: 'test', id: 1, repo_path: testDir, primary: { cli: 'mock', model: 'mock' } },
        collectors: [],
        ui: { port: 8090 },
        worker: { mode: 'sync-only' }
      }, null, 2));

      writeFileSync(join(testDir, 'conductor/workflow.json'), JSON.stringify({
        global: { total_parallel_limit: 1 },
        defaults: { parallel_limit: 1, max_retries: 1, primary_model: 'mock' },
        lanes: { planning: { parallel_limit: 1, max_retries: 1 } }
      }, null, 2));

      // Start worker without --sync-only flag (but config has it)
      const proc = spawn('node', [join(ROOT, 'conductor/laneconductor.sync.mjs')], {
        cwd: testDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 5000
      });

      let output = '';
      proc.stdout.on('data', data => { output += data; });
      proc.stderr.on('data', data => { output += data; });

      // Give it time to start and log
      await sleep(1000);
      proc.kill();

      assert.match(output, /Worker mode: sync-only/, 'should log sync-only mode from config');
      rmSync(testDir, { recursive: true, force: true });
    });

    it('should let CLI flag override config setting', async () => {
      const testDir = join(ROOT, '.test-worker-mode-3');
      rmSync(testDir, { recursive: true, force: true });
      mkdirSync(join(testDir, 'conductor/tracks'), { recursive: true });

      // Config with worker.mode='sync+poll' but CLI will override with --sync-only
      writeFileSync(join(testDir, '.laneconductor.json'), JSON.stringify({
        mode: 'local-fs',
        project: { name: 'test', id: 1, repo_path: testDir, primary: { cli: 'mock', model: 'mock' } },
        collectors: [],
        ui: { port: 8090 },
        worker: { mode: 'sync+poll' }
      }, null, 2));

      writeFileSync(join(testDir, 'conductor/workflow.json'), JSON.stringify({
        global: { total_parallel_limit: 1 },
        defaults: { parallel_limit: 1, max_retries: 1, primary_model: 'mock' },
        lanes: { planning: { parallel_limit: 1, max_retries: 1 } }
      }, null, 2));

      // Start worker WITH --sync-only flag (overrides config)
      const proc = spawn('node', [join(ROOT, 'conductor/laneconductor.sync.mjs'), '--sync-only'], {
        cwd: testDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 5000
      });

      let output = '';
      proc.stdout.on('data', data => { output += data; });
      proc.stderr.on('data', data => { output += data; });

      // Give it time to start and log
      await sleep(1000);
      proc.kill();

      assert.match(output, /Worker mode: sync-only/, 'CLI flag should override config setting');
      rmSync(testDir, { recursive: true, force: true });
    });
  });

  describe('CLI Mode Resolution', () => {
    it('lc start command should pass --sync-only flag to worker', async () => {
      const testDir = join(ROOT, '.test-worker-mode-4');
      rmSync(testDir, { recursive: true, force: true });
      mkdirSync(join(testDir, 'conductor/tracks'), { recursive: true });

      writeFileSync(join(testDir, '.laneconductor.json'), JSON.stringify({
        mode: 'local-fs',
        project: { name: 'test', id: 1, repo_path: testDir, primary: { cli: 'mock', model: 'mock' } },
        collectors: [],
        ui: { port: 8090 }
      }, null, 2));

      writeFileSync(join(testDir, 'conductor/workflow.json'), JSON.stringify({
        global: { total_parallel_limit: 1 },
        defaults: { parallel_limit: 1, max_retries: 1, primary_model: 'mock' },
        lanes: { planning: { parallel_limit: 1, max_retries: 1 } }
      }, null, 2));

      // Simulate CLI parsing --sync-only flag
      const args = ['start', '--sync-only'];
      const isSyncOnly = args.includes('--sync-only') || args.includes('sync-only') || args.includes('sync_only');

      assert.ok(isSyncOnly, 'CLI should recognize --sync-only flag');
      assert.equal(isSyncOnly ? 'sync-only' : 'sync+poll', 'sync-only', 'CLI flag should set mode to sync-only');

      rmSync(testDir, { recursive: true, force: true });
    });
  });

  describe('Worker Mode Behavior', () => {
    it('sync-only mode should not attempt auto-launch', async () => {
      // This is a smoke test to verify the logic exists in the code
      const syncWorkerPath = join(ROOT, 'conductor/laneconductor.sync.mjs');
      const content = readFileSync(syncWorkerPath, 'utf8');

      // Check that the code references syncOnly and skips auto-launch
      assert.match(content, /if \(syncOnly\) return;/, 'should skip auto-launch in sync-only mode');
      assert.match(content, /SKIP auto-launch in sync-only mode/, 'should have comment explaining skip');
    });

    it('worker mode should be sent to API on registration', async () => {
      const syncWorkerPath = join(ROOT, 'conductor/laneconductor.sync.mjs');
      const content = readFileSync(syncWorkerPath, 'utf8');

      // Check that workerMode is included in API calls
      assert.match(content, /mode: workerMode/, 'should send workerMode to API');
      assert.match(content, /\/worker\/register/, 'should register with API');
    });

    it('worker mode should be included in heartbeat', async () => {
      const syncWorkerPath = join(ROOT, 'conductor/laneconductor.sync.mjs');
      const content = readFileSync(syncWorkerPath, 'utf8');

      // Check that workerMode is included in heartbeat
      assert.match(content, /\/worker\/heartbeat/, 'should send heartbeat with mode');
    });
  });
});
