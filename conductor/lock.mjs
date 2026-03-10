#!/usr/bin/env node
/**
 * /laneconductor lock [track-number]
 *
 * Acquire a git lock and create an isolated worktree for safe parallel execution.
 *
 * Returns JSON:
 * {
 *   "locked": true,
 *   "worktree_path": ".git/worktrees/NNN/",
 *   "lock_file": ".conductor/locks/NNN.lock",
 *   "user": "user",
 *   "machine": "machine"
 * }
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'fs';
import { execSync } from 'child_process';
import { join } from 'path';
import os from 'os';

const trackNumber = process.argv[2];

if (!trackNumber) {
  console.error('Usage: lock.mjs <track-number>');
  process.exit(1);
}

const cwd = process.cwd();
const lockDir = join(cwd, '.conductor', 'locks');
const lockFile = join(lockDir, `${trackNumber}.lock`);
const worktreePath = join(cwd, '.worktrees', `${trackNumber}`);

try {
  // Ensure .conductor/locks directory exists
  mkdirSync(lockDir, { recursive: true });

  // 1. Fetch latest locks from git
  try {
    execSync('git fetch origin main --quiet', { cwd, stdio: 'pipe' });
  } catch (e) {
    console.warn(`[lock] git fetch failed: ${e.message}`);
  }

  // 2. Check if lock already exists
  if (existsSync(lockFile)) {
    const lock = JSON.parse(readFileSync(lockFile, 'utf8'));
    const lockAge = Date.now() - new Date(lock.started_at).getTime();
    const staleTimeout = 5 * 60 * 1000; // 5 minutes

    if (lockAge < staleTimeout) {
      const ageSeconds = Math.round(lockAge / 1000);
      const remainingSeconds = Math.round((staleTimeout - lockAge) / 1000);
      const remainingMinutes = Math.ceil(remainingSeconds / 60);

      console.error(`ERROR: Track ${trackNumber} is locked by ${lock.user}@${lock.machine}`);
      console.error(`Lock age: ${ageSeconds}s. Will be stale in ${remainingMinutes}m${remainingSeconds % 60}s.`);
      console.error(`Try again later or ask user to run: /laneconductor unlock ${trackNumber}`);
      process.exit(1);
    }

    // Stale lock - remove it
    console.log(`[lock] Removing stale lock for track ${trackNumber} (age: ${Math.round(lockAge / 1000)}s)`);
    rmSync(lockFile);
  }

  // 3. Create new lock file
  const username = process.env.USER || process.env.USERNAME || os.userInfo().username || 'unknown';
  const hostname = os.hostname();

  const lockData = {
    user: username,
    machine: hostname,
    started_at: new Date().toISOString(),
    cli: 'claude',
    track_number: trackNumber,
    lane: 'in-progress',
    pattern: 'cli'
  };

  writeFileSync(lockFile, JSON.stringify(lockData, null, 2), 'utf8');
  console.log(`[lock] Created lock file: ${lockFile}`);

  // 4. Sync lock to API
  const laneConductorJson = join(cwd, '.laneconductor.json');
  if (existsSync(laneConductorJson)) {
    try {
      const config = JSON.parse(readFileSync(laneConductorJson, 'utf8'));
      if (config.collectors && config.collectors.length > 0) {
        const collectorUrl = config.collectors[0].url;
        // Simple fetch-like implementation using node's http or child_process
        // Since we want to stay minimal, we'll use curl if available or skip
        try {
          const body = JSON.stringify({
            user: username,
            machine: hostname,
            pattern: 'cli',
            lock_file_path: lockFile
          });
          execSync(`curl -s -X POST "${collectorUrl}/track/${trackNumber}/lock" -H "Content-Type: application/json" -d '${body}'`, { stdio: 'pipe' });
          console.log(`[lock] Synced lock to API: ${collectorUrl}`);
        } catch (e) {
          console.warn(`[lock] Failed to sync lock to API (curl): ${e.message}`);
        }
      }
    } catch (e) {
      console.warn(`[lock] Failed to read .laneconductor.json for API sync: ${e.message}`);
    }
  }

  // 5. Commit lock to git
  try {
    execSync(`git add "${lockFile}"`, { cwd, stdio: 'pipe' });
    execSync(`git commit -m "Lock track ${trackNumber}" --quiet`, { cwd, stdio: 'pipe' });
    console.log(`[lock] Committed lock to git`);
  } catch (e) {
    console.warn(`[lock] Failed to commit lock to git: ${e.message}`);
    // Continue anyway - lock file exists locally
  }

  // 5. Create worktree
  if (existsSync(worktreePath)) {
    console.error(`[lock] Worktree already exists at ${worktreePath}, removing...`);
    try {
      execSync(`git worktree remove --force "${worktreePath}"`, { cwd, stdio: 'pipe' });
      console.error(`[lock] Removed existing worktree`);
    } catch (e) {
      console.warn(`[lock] Failed to remove existing worktree: ${e.message}`);
    }
  }

  try {
    execSync(`git worktree add "${worktreePath}" origin/main`, { cwd, stdio: 'pipe' });
  } catch (e) {
    console.error(`[lock] Failed to create worktree: ${e.message}`);
    // Try to cleanup lock on failure
    try {
      rmSync(lockFile);
      execSync(`git add "${lockDir}"`, { cwd, stdio: 'pipe' });
      execSync(`git commit -m "Unlock track ${trackNumber} (lock failed)" --quiet`, { cwd, stdio: 'pipe' });
    } catch (cleanup) {
      // Ignore cleanup errors
    }
    process.exit(1);
  }

  // 6. Fetch latest in worktree
  try {
    execSync('git fetch origin main --quiet', { cwd: worktreePath, stdio: 'pipe' });
  } catch (e) {
    console.warn(`[lock] git fetch in worktree failed: ${e.message}`);
  }

  // 7. Return result as JSON
  const result = {
    locked: true,
    worktree_path: worktreePath,
    lock_file: lockFile,
    user: username,
    machine: hostname
  };

  console.log(JSON.stringify(result, null, 2));
  process.exit(0);

} catch (err) {
  console.error(`ERROR: Failed to acquire lock: ${err.message}`);
  process.exit(1);
}
