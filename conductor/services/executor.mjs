// conductor/services/executor.mjs
// Track 10039 Phase 2: the executor seam. Every lane-action-triggering call
// site in laneconductor.sync.mjs (autoLaunchLocalFs, startNextAutoCompleteStage,
// checkDispatchInbox) previously called spawnCli() directly; runCreateProject
// had its own bespoke spawn+exit-promise. This module defines the shared
// contract those call sites route through, so a future RemoteLaunchExecutor
// (Phase 3b) or CloudSessionExecutor (Phase 4) can be swapped in per worker
// runtime without touching the call sites again.
//
// Deliberately pure and dependency-free (no import of laneconductor.sync.mjs
// or its module-level state) so it's unit-testable in isolation. The actual
// `LocalCliExecutor` implementation lives inside laneconductor.sync.mjs
// itself (see localCliExecutor there) because it delegates straight to the
// existing spawnCli(), which is deeply coupled to that module's private
// state (runningPids, git locks, worktrees, run markers) — extracting
// spawnCli itself was explicitly out of scope for a zero-behavior-change
// refactor (REQ-9/AC-7). This module supplies the parts that ARE safely
// extractable: the interface contract, an argv-independent prompt lookup,
// and the synchronous spawn-and-wait primitive runCreateProject needs
// (which has no lane/worktree concept at all, so it doesn't belong on
// LocalCliExecutor's lane-action-shaped run/poll/result).

import { spawn as defaultSpawn } from 'node:child_process';
import { openSync as defaultOpenSync } from 'node:fs';

/**
 * @typedef {Object} Executor
 * @property {(prompt: string|null, ctx: object) => Promise<{id: any}>} run
 *   Starts work and returns immediately with an identifier — for
 *   LocalCliExecutor this is the spawned child's pid; for a future cloud
 *   executor it would be a session id. Never waits for completion.
 * @property {(id: any) => Promise<{state: string, detail?: any}>} poll
 *   Checks current status. `state` is one of: running, success, error,
 *   timeout, needs-input, budget-reached, unknown.
 * @property {(id: any) => Promise<any>} result
 *   Retrieves the terminal result once `poll` reports a non-running state.
 *   Returns null when there is nothing beyond what `poll`'s `detail`
 *   already carries (true for LocalCliExecutor today — completion side
 *   effects happen inside spawnCli's own exit handler, not via this call).
 */

/**
 * Resolves the executor for a given worker runtime. Phase 2 only wires up
 * `machine` (today's behavior, unchanged); `remote` (Phase 3b) and `cloud`
 * (Phase 4) throw a clear not-yet-implemented error rather than silently
 * falling back to `machine` — a misconfigured runtime must fail loudly, not
 * run somewhere the operator didn't choose.
 *
 * @param {string|null|undefined} runtime - 'machine' | 'remote' | 'cloud'
 * @param {{localCliExecutor: Executor}} deps
 * @returns {Executor}
 */
export function createExecutor(runtime, { localCliExecutor } = {}) {
  const normalized = runtime || 'machine';
  if (normalized === 'machine') {
    if (!localCliExecutor) {
      throw new Error('createExecutor: localCliExecutor dependency is required for runtime "machine"');
    }
    return localCliExecutor;
  }
  throw new Error(
    `createExecutor: runtime "${normalized}" has no executor yet (Track 10039 Phase 2 covers "machine" ` +
      'only; "remote" lands in Phase 3b, "cloud" in Phase 4)'
  );
}

/**
 * Finds the prompt text inside an already-built CLI argv array, without
 * altering it. Mirrors the exact fallback spawnCli's own context-injection
 * block already uses (look for the arg right after `-p`; otherwise assume
 * the last argv element is the prompt) — same logic, extracted once here so
 * callers computing a `prompt` for `run(prompt, ctx)` don't duplicate it.
 * Returns null for an empty/missing argv rather than guessing.
 */
export function extractPromptFromArgs(args) {
  if (!Array.isArray(args) || args.length === 0) return null;
  const pIndex = args.indexOf('-p');
  if (pIndex !== -1 && pIndex + 1 < args.length) return args[pIndex + 1];
  return args[args.length - 1];
}

/**
 * Spawns a command and resolves once it exits — the synchronous-completion
 * shape runCreateProject's scaffold step needs (it must know the exit code
 * before deciding whether to continue provisioning). Extracted verbatim
 * from runCreateProject's previous inline `new Promise(...)` block: same
 * spawn arguments, same stdio redirect to a log file, same exit/error
 * resolution shape — a pure relocation, not a rewrite, so behavior is
 * unchanged (REQ-9). Deliberately does NOT reuse LocalCliExecutor/spawnCli:
 * project creation has no track, no lane, no worktree/git-lock to acquire —
 * forcing it through spawnCli's lane-action machinery would be a real
 * behavior change, not a refactor.
 *
 * @param {string} command
 * @param {string[]} args
 * @param {{cwd?: string, env?: object, logPath?: string, spawnFn?: Function, openSyncFn?: Function}} [opts]
 * @returns {Promise<{code: number, logPath?: string, error?: string}>}
 */
export function runToCompletion(command, args, opts = {}) {
  const { cwd, env, logPath, spawnFn = defaultSpawn, openSyncFn = defaultOpenSync } = opts;
  return new Promise((resolvePromise) => {
    const stdio = logPath ? ['ignore', openSyncFn(logPath, 'a'), openSyncFn(logPath, 'a')] : ['ignore', 'pipe', 'pipe'];
    const proc = spawnFn(command, args, { cwd, stdio, env });
    proc.on('exit', (code) => resolvePromise({ code, logPath }));
    proc.on('error', (err) => resolvePromise({ code: 1, error: err.message, logPath }));
  });
}
