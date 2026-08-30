// conductor/services/cloud-session-driver.mjs
// Track 10039 Phase 1: throwaway-quality feasibility prototype for a driver
// that would launch/poll a claude.ai cloud session ("Claude Code on the
// web", the surface D-1 picked as option A).
//
// THIS IS NOT A WORKING DRIVER. It exists to make the Phase 1 spike's
// finding executable rather than just asserted: createSession() shells out
// to the real `claude --cloud` flag (confirmed to exist despite being
// undocumented in `--help`) and surfaces the exact failure a headless
// dispatcher hits. See conversation.md's GO/NO-GO comment and spec.md's
// "Phase 1 Findings" section for the full writeup — the short version is
// that `--cloud` hard-requires an interactive terminal, which a background
// worker process structurally does not have, so this module cannot be
// completed into the createSession/getSessionStatus/getSessionUrl trio the
// plan asked for until that's resolved (or the execution surface changes —
// see the GO/NO-GO comment's fallback options).
//
// Same injectable-exec pattern as conductor/services/pr-flow.mjs so a real
// test can assert on argv without shelling out for real.

import { execFileSync } from 'node:child_process';

function defaultExec(cmd, args, opts) {
  return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], ...opts });
}

/**
 * Attempts to launch a claude.ai cloud session for the given prompt against
 * a repo already accessible to the invoking account's GitHub connection.
 *
 * Confirmed (Phase 1 spike, 2026-08-30): this throws every time when called
 * from a non-interactive process (no TTY) — `claude --cloud` refuses to run
 * without one, regardless of whether the account is authenticated. That is
 * exactly the environment a dispatcher/worker runs in, so this function is
 * not a viable path today. It's kept (rather than deleted) so a future spike
 * re-run against a newer CLI build, or a pty-wrapped invocation the team
 * explicitly decides to pursue, has a single place to plug that in — see the
 * GO/NO-GO comment before extending this rather than guessing.
 *
 * @param {{prompt: string, repo: string, cwd?: string, exec?: Function}} opts
 * @returns {{id: string}} never actually returns in the current environment
 * @throws {Error} always, from a non-interactive caller — see message
 */
export function createSession({ prompt, repo, cwd, exec = defaultExec }) {
  if (!prompt) throw new Error('createSession: prompt is required');
  if (!repo) throw new Error('createSession: repo is required');

  // `claude --cloud` takes the prompt as its positional argument, the same
  // as a local invocation; repo/environment selection in the real product is
  // done via the browser's repo selector or `--add-dir`-style flags we have
  // not been able to reach because the TTY check fires first. This argv is
  // therefore best-effort/unverified beyond "the flag exists."
  try {
    const output = exec('claude', ['--cloud', prompt], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    // Never reached in the confirmed-blocked environment, but if a future
    // CLI build allows headless --cloud, the real session id would need to
    // be parsed out of whatever machine-readable output that build adds.
    return { id: output.trim() };
  } catch (err) {
    const stderr = err.stderr?.toString?.() || err.message;
    throw new Error(
      `createSession failed — this is the Phase 1 spike's confirmed blocker, not a bug: ${stderr}`
    );
  }
}

/**
 * Not implemented. No documented (or discovered) way exists to poll a
 * claude.ai cloud session's status from outside the browser/CLI session
 * that created it — `claude agents --json` lists local background agents
 * (started with `--bg`), not claude.ai/code cloud sessions specifically,
 * and was not confirmed to include them. Left unimplemented rather than
 * guessed at, per the "no stubs that pass as done" rule — this would need
 * its own verification pass before Phase 4 could build on it.
 */
export function getSessionStatus(_id) {
  throw new Error(
    'getSessionStatus: no confirmed API/CLI surface for polling a claude.ai/code cloud ' +
      'session — see spec.md Phase 1 Findings before implementing this.'
  );
}

/**
 * Not implemented for the same reason as getSessionStatus. The deep-link
 * format for an individual claude.ai/code session was not discovered during
 * this spike (only the pre-fill *creation* URL shape is documented).
 */
export function getSessionUrl(_id) {
  throw new Error(
    'getSessionUrl: no confirmed deep-link format for an existing claude.ai/code cloud ' +
      'session — see spec.md Phase 1 Findings before implementing this.'
  );
}
