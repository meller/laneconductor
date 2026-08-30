// conductor/services/cloud-session-driver.mjs
// Track 10039 Phase 1b: driver over the Managed Agents API
// (`api.anthropic.com/v1/sessions`, beta `managed-agents-2026-04-01`), the
// surface the track pivoted to after Phase 1's claude.ai/code NO-GO.
//
// Shells out to the `ant` CLI (same injectable-exec pattern as
// conductor/services/pr-flow.mjs) rather than hand-rolling HTTP + the OAuth
// profile/WIF auth chain — `ant` already implements exactly that chain,
// which is the whole point of the keyless-only credential policy (REQ-3):
// this driver never touches ANTHROPIC_API_KEY, so callers must invoke it
// with that variable unset (see `env -u ANTHROPIC_API_KEY` at every call
// site in Phase 1b's manual verification — not yet enforced in code here).
//
// VERIFICATION STATUS (2026-08-30, Phase 1b): command *shapes* below are
// confirmed against `ant --help` output and the live Managed Agents docs
// (platform.claude.com/docs/en/managed-agents/*), and read-only calls
// (`beta:agents list`, `beta:environments create`, `beta:vaults create`)
// were run for real and succeeded. `createSession`, `sendEvent`,
// `pollEvents`, and `getSessionStatus` were NOT exercised end-to-end: this
// workspace's Anthropic org has no funded API credit balance, so
// `beta:agents create` (a prerequisite for any session) fails with a 400
// `credit balance is too low` error before a session can ever be created —
// see spec.md's Phase 1b findings and the GO/NO-GO comment in
// conversation.md. Treat this file as "correct per the documented contract,
// unverified live" until that billing gap is resolved and Phase 1b resumes.

import { execFileSync } from 'node:child_process';

function defaultExec(cmd, args, opts) {
  return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], ...opts });
}

function runAnt(args, { exec = defaultExec, input } = {}) {
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  const out = exec('ant', [...args, '--format', 'json'], { input, env });
  return JSON.parse(out);
}

/**
 * Creates a Managed Agents session mounting a single GitHub repo, with a
 * hard budget cap (REQ-10), and optionally seeds it with the lane-action
 * prompt as an initial user.message (starts the session running in one
 * call rather than create-then-send).
 *
 * @param {object} opts
 * @param {string} opts.agentId - agent_... id (created once, shared config)
 * @param {string} opts.environmentId - env_... id
 * @param {string} opts.repoUrl - https://github.com/<owner>/<repo>, no .git suffix
 * @param {string} opts.repoToken - GitHub token with `repo` scope; NEVER
 *   logged or echoed — the Managed Agents API itself treats this as a
 *   write-only field (not returned in any response), same guarantee the
 *   vault mechanism gives, so no separate vault credential was needed for
 *   this specific use (a simplification vs. rev. 2 spec's original assumption
 *   that the GitHub token would go through a vault `environment_variable`
 *   credential — see Phase 1b findings for why the simpler path suffices).
 * @param {string} [opts.mountPath] - defaults to /workspace/<repo-name>
 * @param {string} [opts.prompt] - lane-action prompt; if given, session
 *   starts running immediately (initial_events)
 * @param {number} [opts.budgetCents] - hard cap in US cents (REQ-10)
 * @returns {{id: string}}
 */
export function createSession({
  agentId,
  environmentId,
  repoUrl,
  repoToken,
  mountPath,
  prompt,
  budgetCents,
  exec = defaultExec,
}) {
  if (!agentId) throw new Error('createSession: agentId is required');
  if (!environmentId) throw new Error('createSession: environmentId is required');
  if (!repoUrl) throw new Error('createSession: repoUrl is required');
  if (!repoToken) throw new Error('createSession: repoToken is required');

  const resource = {
    type: 'github_repository',
    url: repoUrl,
    authorization_token: repoToken,
    ...(mountPath ? { mount_path: mountPath } : {}),
  };

  const args = [
    'beta:sessions',
    'create',
    '--agent',
    agentId,
    '--environment-id',
    environmentId,
    '--resource',
    JSON.stringify(resource),
  ];

  if (budgetCents != null) {
    args.push(
      '--budget',
      JSON.stringify({ type: 'limit', max_list_cost: { amount: String(budgetCents), currency: 'USD' } })
    );
  }

  if (prompt) {
    args.push(
      '--initial-event',
      JSON.stringify({ type: 'user.message', content: [{ type: 'text', text: prompt }] })
    );
  }

  const session = runAnt(args, { exec });
  return { id: session.id, raw: session };
}

/**
 * Sends a follow-up message to an existing session — used both for
 * multi-lane session reuse (D-8's track=session mapping, if Phase 1b
 * confirms session lifetime supports it) and for the resume-after-idle
 * check in Phase 1b Task 4.
 */
export function sendEvent(sessionId, text, { exec = defaultExec } = {}) {
  if (!sessionId) throw new Error('sendEvent: sessionId is required');
  runAnt(
    [
      'beta:sessions:events',
      'send',
      '--session-id',
      sessionId,
      '--event',
      JSON.stringify({ type: 'user.message', content: [{ type: 'text', text }] }),
    ],
    { exec }
  );
}

/**
 * Lists events on a session since a given cursor/time — the poll
 * primitive the dispatcher's loop uses instead of watching a child
 * process's exit code.
 */
export function pollEvents(sessionId, { sinceIso, exec = defaultExec } = {}) {
  if (!sessionId) throw new Error('pollEvents: sessionId is required');
  const args = ['beta:sessions:events', 'list', '--session-id', sessionId];
  if (sinceIso) args.push('--created-at-gt', sinceIso);
  return runAnt(args, { exec });
}

/**
 * Retrieves the session resource itself — status/state, budget spend so
 * far, and (per D-9's claim, NOT yet verified live — see file header) the
 * fields a Console trace URL would be built from.
 */
export function getSessionStatus(sessionId, { exec = defaultExec } = {}) {
  if (!sessionId) throw new Error('getSessionStatus: sessionId is required');
  return runAnt(['beta:sessions', 'retrieve', '--session-id', sessionId], { exec });
}

/**
 * Best-effort Console trace URL. UNVERIFIED (see file header): Phase 1b
 * could not create a real session to confirm this format, because agent
 * creation — a session's prerequisite — is blocked by this workspace's
 * empty API credit balance. Do not treat this as confirmed until a real
 * session has been created and this URL checked in a browser.
 */
export function getTraceUrl(sessionId, { workspaceId } = {}) {
  if (!sessionId) throw new Error('getTraceUrl: sessionId is required');
  if (!workspaceId) throw new Error('getTraceUrl: workspaceId is required (unverified format)');
  return `https://platform.claude.com/workspaces/${workspaceId}/sessions/${sessionId}`;
}
