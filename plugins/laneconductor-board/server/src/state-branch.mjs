// Per-repo state branch resolution (track AM-10106, Phase 5c Task 8). First match wins:
//   1. the explicit --state-branch CLI flag (applies to every --repo)
//   2. `connector.state_branch` in the repo's .laneconductor.json
//   3. the repo's default branch, from refs/remotes/origin/HEAD (no network, no fetch)
//   4. the current branch, if it is `main` or `master`
//   5. `main` (writes are then refused while the checkout is elsewhere)
// The write guard itself (store-local NOT_ON_STATE_BRANCH) is unchanged; this only picks the name.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_STATE_BRANCH = 'main';
export const SOURCES = ['cli_flag', 'config', 'origin_head', 'current_branch', 'default'];
const ORIGIN_PREFIX = 'refs/remotes/origin/';

/** A conservative branch-name check: no leading dash or slash, no `..`, `//`, trailing `/` or `.`, no `.lock` suffix. */
export function isSafeBranchName(name) {
  return typeof name === 'string'
    && /^[A-Za-z0-9_][A-Za-z0-9._/-]*$/.test(name)
    && !name.includes('..') && !name.includes('//')
    && !/[/.]$/.test(name) && !name.endsWith('.lock')
    && !name.split('/').some((seg) => seg === '' || seg.startsWith('.') || seg.endsWith('.lock'));
}

function gitOut(repo, args) {
  const r = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
  return r.status === 0 ? r.stdout.trim() : null;
}

/**
 * @param {string} repo absolute path
 * @param {{ cliBranch?: string | null }} [opts]
 * @returns {{ branch: string, source: 'cli_flag' | 'config' | 'origin_head' | 'current_branch' | 'default', problem?: string }}
 *   `problem` is set only for an invalid `connector.state_branch`; the caller must refuse to start.
 */
export function resolveStateBranch(repo, { cliBranch = null } = {}) {
  if (cliBranch) return { branch: cliBranch, source: 'cli_flag' };

  let cfg = null;
  try {
    cfg = JSON.parse(fs.readFileSync(path.join(repo, '.laneconductor.json'), 'utf8'));
  } catch { /* missing or unparseable: readPushPolicy already reports unparseable; fall through */ }
  const v = cfg?.connector?.state_branch;
  if (v !== undefined) {
    if (!isSafeBranchName(v)) {
      return { branch: DEFAULT_STATE_BRANCH, source: 'default', problem: `connector.state_branch in ${path.join(repo, '.laneconductor.json')} must be a non-empty, safe git branch name (got ${JSON.stringify(v)})` };
    }
    return { branch: v, source: 'config' };
  }

  const head = gitOut(repo, ['symbolic-ref', '-q', 'refs/remotes/origin/HEAD']);
  if (head?.startsWith(ORIGIN_PREFIX)) {
    const name = head.slice(ORIGIN_PREFIX.length);
    if (isSafeBranchName(name)) return { branch: name, source: 'origin_head' };
  }

  const current = gitOut(repo, ['symbolic-ref', '--short', '-q', 'HEAD']);
  if (current === 'main' || current === 'master') return { branch: current, source: 'current_branch' };

  return { branch: DEFAULT_STATE_BRANCH, source: 'default' };
}
