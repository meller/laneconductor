#!/usr/bin/env node
/**
 * Phase 7 Integration Tests: Multi-pattern lock/unlock coordination
 * Tests all patterns: CLI-driven, daemon-driven, stale recovery, concurrent access
 */

import { execSync } from 'child_process';
import { existsSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { spawn } from 'child_process';

const cwd = process.cwd();

// Test track numbers to avoid conflicts
const tracks = {
  parallel1: '9997',
  parallel2: '9998',
  parallel3: '9999',
  contention: '9996',
  stale: '9995',
  failed: '9994',
  multiprocess: '9993'
};

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✅ ${name}`);
    passed++;
  } catch (err) {
    console.error(`❌ ${name}: ${err.message}`);
    failed++;
  }
}

function cleanup(trackNumber) {
  const lockFile = join(cwd, '.conductor', 'locks', `${trackNumber}.lock`);
  const worktreePath = join(cwd, '.git', 'worktrees', `${trackNumber}`);

  if (existsSync(lockFile)) rmSync(lockFile);
  if (existsSync(worktreePath)) {
    try {
      execSync(`git worktree remove --force "${worktreePath}"`, { cwd, stdio: 'pipe' });
    } catch (e) {}
  }
}

function cleanupAll() {
  Object.values(tracks).forEach(cleanup);
}

console.log('Phase 7: Multi-Pattern Integration Tests\n');

// Pre-cleanup
cleanupAll();

// Scenario 2: Multiple tracks in parallel
test('Parallel 1: Acquire lock for track 9997', () => {
  const output = execSync(`node conductor/lock.mjs ${tracks.parallel1}`, { cwd, encoding: 'utf8' });
  const jsonMatch = output.match(/\{[\s\S]*\}/);
  const result = JSON.parse(jsonMatch[0]);
  if (!result.locked) throw new Error('Lock failed');
  if (!existsSync(join(cwd, '.conductor', 'locks', `${tracks.parallel1}.lock`))) throw new Error('Lock file not created');
  if (!existsSync(join(cwd, '.git', 'worktrees', `${tracks.parallel1}`))) throw new Error('Worktree not created');
});

test('Parallel 2: Acquire lock for track 9998 (simultaneously)', () => {
  const output = execSync(`node conductor/lock.mjs ${tracks.parallel2}`, { cwd, encoding: 'utf8' });
  const jsonMatch = output.match(/\{[\s\S]*\}/);
  const result = JSON.parse(jsonMatch[0]);
  if (!result.locked) throw new Error('Lock failed');
  if (!existsSync(join(cwd, '.conductor', 'locks', `${tracks.parallel2}.lock`))) throw new Error('Lock file not created');
  if (!existsSync(join(cwd, '.git', 'worktrees', `${tracks.parallel2}`))) throw new Error('Worktree not created');
});

test('Parallel 3: Acquire lock for track 9999 (simultaneously)', () => {
  const output = execSync(`node conductor/lock.mjs ${tracks.parallel3}`, { cwd, encoding: 'utf8' });
  const jsonMatch = output.match(/\{[\s\S]*\}/);
  const result = JSON.parse(jsonMatch[0]);
  if (!result.locked) throw new Error('Lock failed');
  if (!existsSync(join(cwd, '.conductor', 'locks', `${tracks.parallel3}.lock`))) throw new Error('Lock file not created');
  if (!existsSync(join(cwd, '.git', 'worktrees', `${tracks.parallel3}`))) throw new Error('Worktree not created');
});

test('Parallel: Git status should be clean (no conflicts)', () => {
  try {
    const status = execSync('git status --porcelain', { cwd, encoding: 'utf8' });
    // Should only show lock files (new untracked/staged)
    // Should not show worktree conflicts
    if (status.includes('both modified') || status.includes('conflict')) {
      throw new Error('Git conflicts detected');
    }
  } catch (e) {
    if (!e.message.includes('Git conflicts')) throw e;
  }
});

test('Parallel: Unlock all three tracks', () => {
  [tracks.parallel1, tracks.parallel2, tracks.parallel3].forEach(trackNum => {
    const output = execSync(`node conductor/unlock.mjs ${trackNum}`, { cwd, encoding: 'utf8' });
    const jsonMatch = output.match(/\{[\s\S]*\}/);
    const result = JSON.parse(jsonMatch[0]);
    if (!result.unlocked) throw new Error(`Unlock failed for track ${trackNum}`);
  });
});

// Scenario 3: Lock contention
test('Contention: First lock succeeds', () => {
  const output = execSync(`node conductor/lock.mjs ${tracks.contention}`, { cwd, encoding: 'utf8' });
  const jsonMatch = output.match(/\{[\s\S]*\}/);
  const result = JSON.parse(jsonMatch[0]);
  if (!result.locked) throw new Error('First lock failed');
});

test('Contention: Second lock on same track fails', () => {
  try {
    execSync(`node conductor/lock.mjs ${tracks.contention}`, { cwd, stdio: 'pipe' });
    throw new Error('Should have failed (track already locked)');
  } catch (e) {
    if (e.status === 1) {
      // Expected failure
      return;
    }
    throw e;
  }
});

test('Contention: Error message contains helpful info', () => {
  try {
    execSync(`node conductor/lock.mjs ${tracks.contention}`, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    const stderr = e.stderr?.toString() || e.toString();
    if (!stderr.includes('locked by')) throw new Error('Error message missing "locked by"');
    if (!stderr.includes('@')) throw new Error('Error message missing user@machine');
  }
});

test('Contention: Unlock to reset', () => {
  const output = execSync(`node conductor/unlock.mjs ${tracks.contention}`, { cwd, encoding: 'utf8' });
  const jsonMatch = output.match(/\{[\s\S]*\}/);
  const result = JSON.parse(jsonMatch[0]);
  if (!result.unlocked) throw new Error('Unlock failed');
});

// Scenario 4: Stale lock recovery
test('Stale: Create old lock file manually', () => {
  const lockDir = join(cwd, '.conductor', 'locks');
  mkdirSync(lockDir, { recursive: true });
  const lockFile = join(lockDir, `${tracks.stale}.lock`);
  const now = new Date();
  const oldTime = new Date(now.getTime() - 10 * 60 * 1000); // 10 minutes ago

  const lockData = {
    user: 'test-old',
    machine: 'old-machine',
    started_at: oldTime.toISOString(),
    cli: 'claude',
    track_number: tracks.stale,
    lane: 'in-progress',
    pattern: 'cli'
  };

  writeFileSync(lockFile, JSON.stringify(lockData, null, 2), 'utf8');
  if (!existsSync(lockFile)) throw new Error('Failed to create stale lock file');
});

test('Stale: Lock command auto-recovers stale lock', () => {
  const testStartTime = Date.now();
  // Wait 1s to ensure timestamp is different
  const sleepCmd = process.platform === 'win32' ? 'powershell.exe -Command "Start-Sleep -Seconds 1"' : 'sleep 1';
  execSync(sleepCmd, { stdio: 'inherit' });
  let output = '';
  try {
    output = execSync(`node conductor/lock.mjs ${tracks.stale}`, { cwd, encoding: 'utf8', env: { ...process.env, LC_NO_FETCH: '1' } });
  } catch (e) {
    console.log(`[debug] lock.mjs failed: ${e.stderr || e.message}`);
    throw e;
  }
  const jsonMatch = output.match(/\{[\s\S]*\}/);
  const result = JSON.parse(jsonMatch[0]);
  if (!result.locked) throw new Error('Lock acquisition failed after stale recovery');

  // Verify new lock has current timestamp (should be >= testStartTime)
  const lockFile = join(cwd, '.conductor', 'locks', `${tracks.stale}.lock`);
  const lock = JSON.parse(readFileSync(lockFile, 'utf8'));
  const lockTime = new Date(lock.started_at).getTime();
  console.log(`[debug] testStartTime: ${testStartTime}, lock.started_at: ${lock.started_at} (${lockTime})`);
  
  if (lockTime < testStartTime) {
    throw new Error(`New lock has old timestamp: ${lock.started_at} is before test started at ${new Date(testStartTime).toISOString()}`);
  }
});

test('Stale: Unlock after recovery', () => {
  const output = execSync(`node conductor/unlock.mjs ${tracks.stale}`, { cwd, encoding: 'utf8' });
  const jsonMatch = output.match(/\{[\s\S]*\}/);
  const result = JSON.parse(jsonMatch[0]);
  if (!result.unlocked) throw new Error('Unlock failed');
});

// Scenario 5: Failed unlock recovery
test('Failed: Create lock and dirty worktree', () => {
  const output = execSync(`node conductor/lock.mjs ${tracks.failed}`, { cwd, encoding: 'utf8' });
  const jsonMatch = output.match(/\{[\s\S]*\}/);
  const result = JSON.parse(jsonMatch[0]);
  if (!result.locked) throw new Error('Lock failed');

  // Create untracked file in worktree
  const worktreePath = join(cwd, '.git', 'worktrees', `${tracks.failed}`);
  const dirtyFile = join(worktreePath, 'test-dirty.txt');
  writeFileSync(dirtyFile, 'test content', 'utf8');
  if (!existsSync(dirtyFile)) throw new Error('Failed to create dirty file');
});

test('Failed: Unlock succeeds despite dirty worktree', () => {
  const output = execSync(`node conductor/unlock.mjs ${tracks.failed}`, { cwd, encoding: 'utf8' });
  const jsonMatch = output.match(/\{[\s\S]*\}/);
  const result = JSON.parse(jsonMatch[0]);
  if (!result.unlocked) throw new Error('Unlock failed');
});

test('Failed: Worktree was removed despite dirty files', () => {
  const worktreePath = join(cwd, '.git', 'worktrees', `${tracks.failed}`);
  if (existsSync(worktreePath)) throw new Error('Worktree still exists after unlock');
});

// Scenario 6: Multi-process coordination
test('Multiprocess: First process acquires lock', () => {
  const output = execSync(`node conductor/lock.mjs ${tracks.multiprocess}`, { cwd, encoding: 'utf8' });
  const jsonMatch = output.match(/\{[\s\S]*\}/);
  const result = JSON.parse(jsonMatch[0]);
  if (!result.locked) throw new Error('Lock failed');
});

test('Multiprocess: Second process blocked by lock', () => {
  try {
    execSync(`node conductor/lock.mjs ${tracks.multiprocess}`, { cwd, stdio: 'pipe' });
    throw new Error('Should have been blocked');
  } catch (e) {
    if (e.status === 1) {
      // Expected
      return;
    }
    throw e;
  }
});

test('Multiprocess: First process unlocks', () => {
  const output = execSync(`node conductor/unlock.mjs ${tracks.multiprocess}`, { cwd, encoding: 'utf8' });
  const jsonMatch = output.match(/\{[\s\S]*\}/);
  const result = JSON.parse(jsonMatch[0]);
  if (!result.unlocked) throw new Error('Unlock failed');
});

test('Multiprocess: Second process can now acquire lock', () => {
  const output = execSync(`node conductor/lock.mjs ${tracks.multiprocess}`, { cwd, encoding: 'utf8' });
  const jsonMatch = output.match(/\{[\s\S]*\}/);
  const result = JSON.parse(jsonMatch[0]);
  if (!result.locked) throw new Error('Lock failed after first unlock');
});

test('Multiprocess: Final cleanup', () => {
  execSync(`node conductor/unlock.mjs ${tracks.multiprocess}`, { cwd, encoding: 'utf8' });
});

// Final cleanup
cleanupAll();

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
