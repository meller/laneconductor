#!/usr/bin/env node
// conductor/tests/brainstorm-dispatch.test.mjs
// Tests for brainstorm/replan dispatch logic in laneconductor.sync.mjs

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const SYNC_PATH = join(ROOT, 'conductor', 'laneconductor.sync.mjs');
const TMP = join(ROOT, '.test-tmp-dispatch');

// Import the functions we want to test
const { syncConversation, updateHeader } = await import(SYNC_PATH);

// ── Helpers ───────────────────────────────────────────────────────────────────

function setupProject() {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });

  mkdirSync(join(TMP, 'conductor', 'tracks', '1059-test'), { recursive: true });
  writeFileSync(join(TMP, 'conductor', 'tracks', '1059-test', 'index.md'),
    '# Track 1059: Test\n\n**Lane**: implement\n**Lane Status**: success\n**Progress**: 100%\n');
  
  // We need to change the process.cwd() so the sync script finds the files
  process.chdir(TMP);
}

const originalCwd = process.cwd();

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Brainstorm Dispatch Logic', () => {
  before(setupProject);
  after(() => {
    process.chdir(originalCwd);
    rmSync(TMP, { recursive: true, force: true });
  });

  it('TC-5: (brainstorm) tag sets Waiting for reply: yes', async () => {
    const trackDir = join(TMP, 'conductor', 'tracks', '1059-test');
    const convPath = join(trackDir, 'conversation.md');
    writeFileSync(convPath, '> **human** (brainstorm): What about X?\n');

    await syncConversation(convPath);

    const indexPath = join(trackDir, 'index.md');
    const content = readFileSync(indexPath, 'utf8');
    assert.ok(content.includes('**Waiting for reply**: yes'), 'index.md should have Waiting for reply: yes');
    assert.ok(content.includes('**Lane**: implement'), 'Lane should remain implement');
  });

  it('TC-8: (replan) tag sets Lane: plan and Lane Status: queue', async () => {
    setupProject();
    const trackDir = join(TMP, 'conductor', 'tracks', '1059-test');
    const convPath = join(trackDir, 'conversation.md');
    writeFileSync(convPath, '> **human** (replan): Start over\n');

    await syncConversation(convPath);

    const indexPath = join(trackDir, 'index.md');
    const content = readFileSync(indexPath, 'utf8');
    assert.ok(content.includes('**Lane**: plan'), 'Lane should be changed to plan');
    assert.ok(content.includes('**Lane Status**: queue'), 'Lane Status should be changed to queue');
  });

  it('updateHeader helper works correctly', () => {
    let content = '# Title\n\n**Lane**: implement\n';
    content = updateHeader(content, 'Waiting for reply', 'yes');
    assert.ok(content.includes('**Waiting for reply**: yes'), 'Should inject new header');
    
    content = updateHeader(content, 'Waiting for reply', 'no');
    assert.ok(content.includes('**Waiting for reply**: no'), 'Should update existing header');
    assert.equal(content.match(/\*\*Waiting for reply\*\*/g).length, 1, 'Should not duplicate');
  });
});
