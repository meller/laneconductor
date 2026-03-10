#!/usr/bin/env node
/**
 * /laneconductor unlock [track-number]
 *
 * Release a git lock and clean up the worktree.
 *
 * Returns JSON:
 * {
 *   "unlocked": true,
 *   "removed_lock": ".conductor/locks/1010.lock",
 *   "removed_worktree": ".git/worktrees/1010/"
 * }
 */

import { readFileSync, existsSync, rmSync } from 'fs';
import { execSync } from 'child_process';
import { join } from 'path';

const trackNumber = process.argv[2];

if (!trackNumber) {
  console.error('Usage: unlock.mjs <track-number>');
  process.exit(1);
}

const cwd = process.cwd();
const lockDir = join(cwd, '.conductor', 'locks');
const lockFile = join(lockDir, `${trackNumber}.lock`);
const worktreePath = join(cwd, '.worktrees', `${trackNumber}`);

const results = {
  unlocked: true,
  removed_lock: null,
  removed_worktree: null,
  errors: []
};

try {
  // 1. Remove lock file
  if (existsSync(lockFile)) {
    try {
      rmSync(lockFile);
      results.removed_lock = lockFile;
      console.log(`[unlock] Removed lock file: ${lockFile}`);

      // Sync unlock to API
      const laneConductorJson = join(cwd, '.laneconductor.json');
      if (existsSync(laneConductorJson)) {
        try {
          const config = JSON.parse(readFileSync(laneConductorJson, 'utf8'));
          if (config.collectors && config.collectors.length > 0) {
            const collectorUrl = config.collectors[0].url;
            try {
              execSync(`curl -s -X POST "${collectorUrl}/track/${trackNumber}/unlock"`, { stdio: 'pipe' });
              console.log(`[unlock] Synced unlock to API: ${collectorUrl}`);
            } catch (e) {
              console.warn(`[unlock] Failed to sync unlock to API (curl): ${e.message}`);
            }
          }
        } catch (e) {
          console.warn(`[unlock] Failed to read .laneconductor.json for API sync: ${e.message}`);
        }
      }
    } catch (e) {
      const msg = `Failed to remove lock file: ${e.message}`;
      console.warn(`[unlock] ${msg}`);
      results.errors.push(msg);
    }
  } else {
    console.log(`[unlock] Lock file not found (may have been already removed)`);
  }

  // 2. Commit lock removal to git
  try {
    execSync(`git add "${lockDir}"`, { cwd, stdio: 'pipe' });
    execSync(`git commit -m "Unlock track ${trackNumber}" --quiet`, { cwd, stdio: 'pipe' });
    console.log(`[unlock] Committed lock removal to git`);
  } catch (e) {
    const msg = `Failed to commit lock removal: ${e.message}`;
    console.warn(`[unlock] ${msg}`);
    results.errors.push(msg);
  }

  // 3. Try to push (fire-and-forget)
  try {
    execSync('git push origin main --quiet', { cwd, stdio: 'pipe' });
    console.log(`[unlock] Pushed lock removal to remote`);
  } catch (e) {
    console.warn(`[unlock] Failed to push (non-fatal): ${e.message}`);
    // Don't add to errors - this is non-critical
  }

  // 4. Remove worktree
  if (existsSync(worktreePath)) {
    try {
      execSync(`git worktree remove "${worktreePath}"`, { cwd, stdio: 'pipe' });
      results.removed_worktree = worktreePath;
      console.log(`[unlock] Removed worktree: ${worktreePath}`);
    } catch (e) {
      const msg = `Failed to remove worktree: ${e.message}`;
      console.warn(`[unlock] ${msg}`);
      results.errors.push(msg);

      // Try force remove
      try {
        console.log(`[unlock] Attempting force remove of worktree...`);
        execSync(`git worktree remove --force "${worktreePath}"`, { cwd, stdio: 'pipe' });
        results.removed_worktree = worktreePath;
        console.log(`[unlock] Force removed worktree`);
        // Remove from errors since we succeeded
        results.errors = results.errors.filter(err => !err.includes('Failed to remove worktree'));
      } catch (e2) {
        console.warn(`[unlock] Force remove also failed: ${e2.message}`);
      }
    }
  } else {
    console.log(`[unlock] Worktree not found (may have been already removed)`);
  }

  // 5. Return result as JSON
  if (results.errors.length === 0) {
    results.unlocked = true;
  } else {
    results.unlocked = false;
  }

  console.log(JSON.stringify(results, null, 2));
  process.exit(results.errors.length === 0 ? 0 : 1);

} catch (err) {
  console.error(`ERROR: Unexpected error during unlock: ${err.message}`);
  results.unlocked = false;
  results.errors.push(`Unexpected error: ${err.message}`);
  console.log(JSON.stringify(results, null, 2));
  process.exit(1);
}
