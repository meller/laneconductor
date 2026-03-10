#!/usr/bin/env node
/**
 * Integration tests for /laneconductor lock and unlock commands
 */

import { execSync } from 'child_process';
import { existsSync, rmSync, readFileSync } from 'fs';
import { join } from 'path';

const cwd = process.cwd();
const testTrackNumber = '9999'; // Use high number to avoid conflicts
const lockFile = join(cwd, '.conductor', 'locks', `${testTrackNumber}.lock`);
const worktreePath = join(cwd, '.git', 'worktrees', `${testTrackNumber}`);

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

// Cleanup before tests
if (existsSync(lockFile)) rmSync(lockFile);
if (existsSync(worktreePath)) {
  try {
    execSync(`git worktree remove --force "${worktreePath}"`, { cwd, stdio: 'pipe' });
  } catch (e) {}
}

console.log('Testing lock/unlock commands...\n');

// Test 1: Lock acquisition
test('Lock: Acquire lock for track', () => {
  const output = execSync(`node conductor/lock.mjs ${testTrackNumber}`, { cwd, encoding: 'utf8' });
  const jsonMatch = output.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON output found');
  const result = JSON.parse(jsonMatch[0]);
  if (!result.locked) throw new Error('Lock failed');
  if (!existsSync(lockFile)) throw new Error('Lock file not created');
  if (!existsSync(worktreePath)) throw new Error('Worktree not created');
});

// Test 2: Lock file format
test('Lock: Lock file has correct format', () => {
  const lock = JSON.parse(readFileSync(lockFile, 'utf8'));
  if (!lock.user) throw new Error('No user in lock');
  if (!lock.machine) throw new Error('No machine in lock');
  if (!lock.started_at) throw new Error('No started_at in lock');
  if (lock.track_number !== testTrackNumber) throw new Error('Wrong track_number');
  if (lock.pattern !== 'cli') throw new Error('Wrong pattern');
});

// Test 3: Lock already exists
test('Lock: Reject second lock attempt (already locked)', () => {
  try {
    execSync(`node conductor/lock.mjs ${testTrackNumber}`, { cwd, stdio: 'pipe' });
    throw new Error('Should have failed (track already locked)');
  } catch (e) {
    if (e.status === 1) {
      // Expected failure
      return;
    }
    throw e;
  }
});

// Test 4: Unlock
test('Unlock: Release lock and cleanup', () => {
  const output = execSync(`node conductor/unlock.mjs ${testTrackNumber}`, { cwd, encoding: 'utf8' });
  const jsonMatch = output.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON output found');
  const result = JSON.parse(jsonMatch[0]);
  if (!result.unlocked) throw new Error('Unlock failed');
  // Filter out non-critical errors
  const criticalErrors = result.errors.filter(e => !e.includes('push'));
  if (criticalErrors.length > 0) console.log('  Warnings:', criticalErrors);
});

// Test 5: Lock file removed
test('Unlock: Lock file was removed', () => {
  if (existsSync(lockFile)) throw new Error('Lock file still exists');
});

// Test 6: Worktree removed
test('Unlock: Worktree was removed', () => {
  if (existsSync(worktreePath)) throw new Error('Worktree still exists');
});

// Test 7: Lock again after unlock
test('Lock: Can re-acquire lock after unlock', () => {
  const output = execSync(`node conductor/lock.mjs ${testTrackNumber}`, { cwd, encoding: 'utf8' });
  const jsonMatch = output.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON output found');
  const result = JSON.parse(jsonMatch[0]);
  if (!result.locked) throw new Error('Re-lock failed');
});

// Final cleanup
if (existsSync(lockFile)) rmSync(lockFile);
if (existsSync(worktreePath)) {
  try {
    execSync(`git worktree remove --force "${worktreePath}"`, { cwd, stdio: 'pipe' });
  } catch (e) {}
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
