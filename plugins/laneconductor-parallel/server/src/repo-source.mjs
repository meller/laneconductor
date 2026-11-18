// Which repository(ies) the connector serves, and why (track AM-10106, directory readiness).
// First match wins:
//   1. --repo flag(s)                       source `flag`  (several allowed; the first is the default)
//   2. CLAUDE_PROJECT_DIR environment var   source `env`   (Claude Code exports it to plugin MCP servers)
//   3. the current directory's git top level  source `cwd`  (only when the directory is inside a git repo)
//   4. otherwise a clear startup error.
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export const REPO_SOURCES = ['flag', 'env', 'cwd'];
export const NO_REPO_HELP = 'pass --repo <path>, set CLAUDE_PROJECT_DIR, or start the connector inside a git checkout';

/** git's top-level directory for `dir`, or null when `dir` is not inside a work tree. */
export function gitToplevel(dir) {
  const r = spawnSync('git', ['-C', dir, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
  const out = (r.stdout ?? '').trim();
  return !r.error && r.status === 0 && out ? out : null;
}

/**
 * @param {{ flags?: string[], env?: Record<string, string|undefined>, cwd?: string }} input
 * @returns {{ repos: string[], source: 'flag' | 'env' | 'cwd' }}
 * @throws {Error} when no source yields a repository.
 */
export function resolveRepoSource({ flags = [], env = process.env, cwd = process.cwd() } = {}) {
  if (flags.length) return { repos: flags.map((r) => path.resolve(cwd, r)), source: 'flag' };
  const fromEnv = (env.CLAUDE_PROJECT_DIR ?? '').trim();
  if (fromEnv) return { repos: [path.resolve(cwd, fromEnv)], source: 'env' };
  const top = gitToplevel(cwd);
  if (top) return { repos: [top], source: 'cwd' };
  throw new Error(`no repository to serve: ${cwd} is not inside a git checkout and neither --repo nor CLAUDE_PROJECT_DIR is set; ${NO_REPO_HELP}`);
}
