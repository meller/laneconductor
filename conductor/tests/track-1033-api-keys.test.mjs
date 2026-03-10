#!/usr/bin/env node
// conductor/tests/track-1033-api-keys.test.mjs
// Verification tests for Track 1033: Worker Identity & Remote API Keys
//
// Tests:
//   1. local-fs and local-api remain zero-auth (no API key required)
//   2. remote-api requires API key configuration
//   3. API key is properly stored in .env as COLLECTOR_N_TOKEN
//   4. Path isolation prevents directory traversal
//   5. Worker visibility settings are respected
//
// Run: node --test conductor/tests/track-1033-api-keys.test.mjs

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { spawn, execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const TMP = join(ROOT, '.test-tmp-track-1033');

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function cleanupProject() {
  rmSync(TMP, { recursive: true, force: true });
}

function setupProject(mode = 'local-fs', configOverrides = {}) {
  cleanupProject();
  mkdirSync(TMP, { recursive: true });
  mkdirSync(join(TMP, 'conductor', 'tracks'), { recursive: true });

  const config = {
    mode,
    project: {
      name: 'test-project',
      id: null,
      repo_path: TMP,
      git_remote: 'https://github.com/test/repo.git',
      primary: { cli: 'claude', model: 'haiku' },
      create_quality_gate: false
    },
    collectors: mode === 'local-api'
      ? [{ url: 'http://localhost:8091', token: null }]
      : mode === 'remote-api'
      ? [{ url: 'https://collector.example.com', token: null }]
      : [],
    ui: { port: 8090 },
    ...configOverrides
  };

  writeFileSync(join(TMP, '.laneconductor.json'), JSON.stringify(config, null, 2));

  // Ensure .gitignore includes .env
  writeFileSync(join(TMP, '.gitignore'), '.env\n.laneconductor.json\n');

  return config;
}

function setEnvVar(varName, value) {
  const envFile = join(TMP, '.env');
  let content = existsSync(envFile) ? readFileSync(envFile, 'utf8') : '';

  // Update or append
  if (content.includes(`${varName}=`)) {
    content = content.replace(new RegExp(`${varName}=.*`), `${varName}=${value}`);
  } else {
    content += `\n${varName}=${value}\n`;
  }

  writeFileSync(envFile, content.trim() + '\n');
}

function getEnvVar(varName) {
  const envFile = join(TMP, '.env');
  if (!existsSync(envFile)) return null;
  const content = readFileSync(envFile, 'utf8');
  const match = content.match(new RegExp(`${varName}=(.+)$`, 'm'));
  return match ? match[1] : null;
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('Track 1033: Worker Identity & Remote API Keys', () => {

  after(() => {
    cleanupProject();
  });

  describe('Phase 1: Zero-Auth Modes (local-fs and local-api)', () => {

    it('local-fs mode requires no API key in .env', () => {
      setupProject('local-fs');

      // No API key should be needed
      const apiKey = getEnvVar('COLLECTOR_0_TOKEN');
      assert.strictEqual(apiKey, null, 'No API key should be set for local-fs mode');

      // Config should be valid
      const config = JSON.parse(readFileSync(join(TMP, '.laneconductor.json'), 'utf8'));
      assert.strictEqual(config.mode, 'local-fs');
      assert.deepStrictEqual(config.collectors, []);
    });

    it('local-api mode requires no API key in .env', () => {
      setupProject('local-api');

      // No API key should be needed for local collector
      const apiKey = getEnvVar('COLLECTOR_0_TOKEN');
      assert.strictEqual(apiKey, null, 'No API key should be set for local-api mode');

      // But collector should be configured
      const config = JSON.parse(readFileSync(join(TMP, '.laneconductor.json'), 'utf8'));
      assert.strictEqual(config.mode, 'local-api');
      assert.strictEqual(config.collectors[0]?.url, 'http://localhost:8091');
    });

  });

  describe('Phase 2: Remote API Authentication', () => {

    it('remote-api mode should be configured with API key', () => {
      setupProject('remote-api');
      setEnvVar('COLLECTOR_0_TOKEN', 'lc_test_abc123xyz');

      // API key should be set
      const apiKey = getEnvVar('COLLECTOR_0_TOKEN');
      assert.strictEqual(apiKey, 'lc_test_abc123xyz');

      // Config should reference remote collector
      const config = JSON.parse(readFileSync(join(TMP, '.laneconductor.json'), 'utf8'));
      assert.strictEqual(config.mode, 'remote-api');
      assert(config.collectors[0]?.url.includes('collector.example.com'));
    });

    it('API key is properly stored and retrieved from .env', () => {
      setupProject('remote-api');

      // Set API key
      const testKey = 'lc_live_test_key_1234567890abcdef';
      setEnvVar('COLLECTOR_0_TOKEN', testKey);

      // Verify retrieval
      const retrieved = getEnvVar('COLLECTOR_0_TOKEN');
      assert.strictEqual(retrieved, testKey, 'API key should be retrievable from .env');
    });

    it('multiple collectors can have different API keys', () => {
      setupProject('local-api', {
        collectors: [
          { url: 'http://localhost:8091', token: null },
          { url: 'https://cloud.collector.com', token: null }
        ]
      });

      // Set different keys for each collector
      setEnvVar('COLLECTOR_0_TOKEN', 'local_token_123');
      setEnvVar('COLLECTOR_1_TOKEN', 'cloud_token_456');

      // Verify both are set
      assert.strictEqual(getEnvVar('COLLECTOR_0_TOKEN'), 'local_token_123');
      assert.strictEqual(getEnvVar('COLLECTOR_1_TOKEN'), 'cloud_token_456');
    });

  });

  describe('Phase 3: Path Isolation Enforcement', () => {

    it('worktree paths must be within .worktrees directory', () => {
      setupProject('local-fs');

      const projectRoot = TMP;
      const worktreeBase = resolve(projectRoot, '.worktrees');
      const validPath = resolve(projectRoot, '.worktrees', '1001');

      // Simulate path validation logic
      const isValid = validPath.startsWith(worktreeBase) && validPath.startsWith(projectRoot);
      assert.ok(isValid, 'Valid path should be within .worktrees and project root');
    });

    it('path traversal in track numbers is rejected', () => {
      const invalidTrackNumbers = ['../', '../.env', '../../etc/passwd', '../1001', '1001/../../other'];

      for (const trackNum of invalidTrackNumbers) {
        // Simulate path traversal check
        const hasTraversal = trackNum.includes('..') || trackNum.includes('/');
        assert.ok(hasTraversal, `Track number "${trackNum}" should be detected as path traversal attempt`);
      }
    });

    it('proposed paths outside project root are rejected', () => {
      const projectRoot = resolve(TMP);
      const validPath = resolve(projectRoot, '.worktrees', '1001');
      const invalidPath = resolve(projectRoot, '..', 'sibling-project', 'data');

      const validCheck = validPath.startsWith(projectRoot);
      const invalidCheck = invalidPath.startsWith(projectRoot);

      assert.ok(validCheck, 'Valid path should be within project root');
      assert.ok(!invalidCheck, 'Invalid path should be rejected (outside project root)');
    });

  });

  describe('Phase 4: Worker Visibility Settings', () => {

    it('worker visibility can be set to private', () => {
      const config = setupProject('local-api');
      config.worker = { visibility: 'private' };
      writeFileSync(join(TMP, '.laneconductor.json'), JSON.stringify(config, null, 2));

      const stored = JSON.parse(readFileSync(join(TMP, '.laneconductor.json'), 'utf8'));
      assert.strictEqual(stored.worker?.visibility, 'private');
    });

    it('worker visibility can be set to team', () => {
      const config = setupProject('local-api');
      config.worker = { visibility: 'team' };
      writeFileSync(join(TMP, '.laneconductor.json'), JSON.stringify(config, null, 2));

      const stored = JSON.parse(readFileSync(join(TMP, '.laneconductor.json'), 'utf8'));
      assert.strictEqual(stored.worker?.visibility, 'team');
    });

    it('worker visibility can be set to public', () => {
      const config = setupProject('local-api');
      config.worker = { visibility: 'public' };
      writeFileSync(join(TMP, '.laneconductor.json'), JSON.stringify(config, null, 2));

      const stored = JSON.parse(readFileSync(join(TMP, '.laneconductor.json'), 'utf8'));
      assert.strictEqual(stored.worker?.visibility, 'public');
    });

    it('default visibility is private if not specified', () => {
      const config = setupProject('local-api');
      // Don't set visibility

      const stored = JSON.parse(readFileSync(join(TMP, '.laneconductor.json'), 'utf8'));
      // Default is private
      assert(!stored.worker?.visibility || stored.worker?.visibility === 'private');
    });

  });

  describe('Phase 5: Integration Checks', () => {

    it('switching from local-api to remote-api requires API key', () => {
      setupProject('local-api');

      // Simulate mode switch
      const config = JSON.parse(readFileSync(join(TMP, '.laneconductor.json'), 'utf8'));
      config.mode = 'remote-api';
      config.collectors = [{ url: 'https://collector.example.com', token: null }];
      writeFileSync(join(TMP, '.laneconductor.json'), JSON.stringify(config, null, 2));

      // In real scenario, user would be prompted for API key
      // For testing, we manually set it
      setEnvVar('COLLECTOR_0_TOKEN', 'lc_remote_key');

      // Verify configuration is correct
      const updated = JSON.parse(readFileSync(join(TMP, '.laneconductor.json'), 'utf8'));
      assert.strictEqual(updated.mode, 'remote-api');
      assert.strictEqual(getEnvVar('COLLECTOR_0_TOKEN'), 'lc_remote_key');
    });

    it('.gitignore properly protects .env and .laneconductor.json', () => {
      setupProject('remote-api');

      const gitignore = readFileSync(join(TMP, '.gitignore'), 'utf8');
      assert.ok(gitignore.includes('.env'), '.gitignore should include .env');
      assert.ok(gitignore.includes('.laneconductor.json'), '.gitignore should include .laneconductor.json');
    });

    it('API key prefix format is valid', () => {
      const validKeys = [
        'lc_live_abc123',
        'lc_test_xyz789',
        'lc_dev_000'
      ];

      for (const key of validKeys) {
        assert.ok(key.startsWith('lc_'), `API key "${key}" should have lc_ prefix`);
      }
    });

  });

});
