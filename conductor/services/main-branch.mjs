// conductor/services/main-branch.mjs
//
// Track 10050: "which branch is this repo's default" was implemented three
// separate times — laneconductor.sync.mjs's own private copy, the (dead)
// conductor/agent-runtime.mjs:42, and conductor/lock.mjs, which didn't
// implement it at all and just hardcoded `origin/main`. That last one is a
// real bug on any `master` repo, and Phase 3 of this track needed the answer
// in lock.mjs — so this is extracted once rather than copied a fourth time.
//
// Behaviour is byte-for-byte the previous laneconductor.sync.mjs
// implementation, including:
//   - GIT_ENV, so a repo needing credentials never blocks on an interactive
//     prompt inside a background daemon;
//   - the process-lifetime cache, because `git remote show origin` is a
//     NETWORK call and this is on the git-lock path;
//   - the 'master' fallback when nothing can be determined.

import { execSync } from 'node:child_process';

// Never let git prompt for credentials in any interactive terminal.
const GIT_ENV = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: 'true' };

let cachedMainBranch = null;

/**
 * @param {string} [cwd] repository to inspect (default: process.cwd())
 * @returns {string} the default branch name — never null; falls back to 'master'.
 */
export function getMainBranch(cwd = undefined) {
  if (cachedMainBranch) return cachedMainBranch;
  try {
    const remotes = execSync('git remote show origin', { encoding: 'utf8', env: GIT_ENV, cwd });
    const m = remotes.match(/HEAD branch: (.*)/);
    if (m && m[1]) {
      cachedMainBranch = m[1].trim();
      return cachedMainBranch;
    }
  } catch (e) { }

  try {
    const branches = execSync('git branch -a', { encoding: 'utf8', env: GIT_ENV, cwd });
    if (branches.includes('remotes/origin/main')) cachedMainBranch = 'main';
    else if (branches.includes('remotes/origin/master')) cachedMainBranch = 'master';
    else cachedMainBranch = 'master'; // fallback
  } catch (e) {
    cachedMainBranch = 'master';
  }
  return cachedMainBranch;
}

/** Test-only: clears the process-lifetime cache between scratch repos. */
export function resetMainBranchCache() {
  cachedMainBranch = null;
}
