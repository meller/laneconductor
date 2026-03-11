#!/usr/bin/env node
// conductor/tests/brainstorm-e2e.test.mjs
// E2E tests for the lc brainstorm command and conversation.md integration.
//
// Tests:
//   1. lc brainstorm writes trigger to conversation.md
//   2. lc brainstorm sets **Waiting for reply**: yes in index.md
//   3. lc brainstorm on missing track exits non-zero
//   4. lc brainstorm without track number exits non-zero with usage
//   5. Trigger format is parseable (> **system**: Brainstorm requested)
//   6. conversation.md trigger persists after multiple brainstorm calls
//   7. index.md Waiting for reply already set: no duplicate added
//
// Run: node --test conductor/tests/brainstorm-e2e.test.mjs

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const LC = join(ROOT, 'bin', 'lc.mjs');
const TMP = join(ROOT, '.test-tmp-brainstorm');

// ── Helpers ───────────────────────────────────────────────────────────────────

function lc(...args) {
  return spawnSync(process.execPath, [LC, ...args], {
    cwd: TMP,
    encoding: 'utf8',
    env: { ...process.env, LC_SKIP_GIT_LOCK: '1' },
  });
}

function setupProject() {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });

  writeFileSync(join(TMP, '.laneconductor.json'), JSON.stringify({
    mode: 'local-fs',
    project: { name: 'test-brainstorm', id: 1, repo_path: TMP, primary: { cli: 'claude', model: 'sonnet' } },
    collectors: [],
  }, null, 2));

  mkdirSync(join(TMP, 'conductor', 'tracks', '1099-test-track'), { recursive: true });
  writeFileSync(join(TMP, 'conductor', 'tracks', '1099-test-track', 'index.md'),
    '# Track 1099: Test Track\n\n**Lane**: plan\n**Lane Status**: queue\n**Progress**: 0%\n');
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('lc brainstorm', () => {
  before(setupProject);
  after(() => rmSync(TMP, { recursive: true, force: true }));

  it('TC-17: writes brainstorm trigger to conversation.md', () => {
    const result = lc('brainstorm', '1099');
    assert.equal(result.status, 0, `Expected exit 0, got ${result.status}\nstderr: ${result.stderr}`);

    const convPath = join(TMP, 'conductor', 'tracks', '1099-test-track', 'conversation.md');
    assert.ok(existsSync(convPath), 'conversation.md should be created');
    const content = readFileSync(convPath, 'utf8');
    assert.ok(content.includes('Brainstorm requested'), 'should contain "Brainstorm requested"');
  });

  it('TC-18: sets **Waiting for reply**: yes in index.md', () => {
    const indexPath = join(TMP, 'conductor', 'tracks', '1099-test-track', 'index.md');
    const content = readFileSync(indexPath, 'utf8');
    assert.ok(content.includes('**Waiting for reply**: yes'), 'index.md should have Waiting for reply: yes');
  });

  it('TC-19: exits non-zero for missing track', () => {
    const result = lc('brainstorm', '9999');
    assert.notEqual(result.status, 0, 'Should exit non-zero for missing track');
    assert.ok(result.stderr.includes('not found'), `stderr should mention "not found": ${result.stderr}`);
  });

  it('TC-20: exits non-zero without track number', () => {
    const result = lc('brainstorm');
    assert.notEqual(result.status, 0, 'Should exit non-zero without track number');
    assert.ok(
      result.stdout.includes('Usage') || result.stderr.includes('Usage'),
      `Should print usage: stdout=${result.stdout} stderr=${result.stderr}`
    );
  });

  it('TC-22: trigger format uses > **system**: prefix', () => {
    const convPath = join(TMP, 'conductor', 'tracks', '1099-test-track', 'conversation.md');
    const content = readFileSync(convPath, 'utf8');
    assert.ok(content.includes('> **system**:'), 'trigger should use > **system**: format');
  });

  it('TC-23: conversation.md trigger persists on second brainstorm call', () => {
    lc('brainstorm', '1099');
    const convPath = join(TMP, 'conductor', 'tracks', '1099-test-track', 'conversation.md');
    const content = readFileSync(convPath, 'utf8');
    const triggerCount = (content.match(/Brainstorm requested/g) || []).length;
    assert.ok(triggerCount >= 2, `Should have 2+ triggers after two calls, got ${triggerCount}`);
  });

  it('TC-18b: index.md does not get duplicate Waiting for reply lines', () => {
    const indexPath = join(TMP, 'conductor', 'tracks', '1099-test-track', 'index.md');
    const content = readFileSync(indexPath, 'utf8');
    const matches = content.match(/\*\*Waiting for reply\*\*/g) || [];
    assert.equal(matches.length, 1, `Should have exactly 1 Waiting for reply marker, got ${matches.length}`);
  });
});
