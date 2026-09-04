// conductor/services/prespawn-block.mjs
// Track 10040 Phase 5 (REQ-1, 2, 3, 8, 9, 10, Finding 1): the two
// `err.workspaceGuardBlocked = true` throw sites in spawnCli fire BEFORE
// any spawn, so the exit handler's own retry counter never runs and
// max_retries_reached structurally cannot fire. Every block reverted the
// track to queue and appended a fresh ⚠️ comment — forever. Track 10036
// accumulated 191 such comments over a permanently-dirty checkout
// (`ui/node_modules` committed as a symlink, then ignored) before this
// track's own escalation machinery existed.
//
// This module is the decision layer only — cause-generic (REQ-9: keys off
// count + kind, never off dirty-path shape) so [[AM-10039-cloud-workers-
// claude-cloud]]'s dispatcher-only mode can reuse it for its own permanent
// causes (expired credentials, missing GitHub App, failing preflight)
// rather than rebuilding the mechanism. REQ-10: spam is killed AT THE
// SOURCE — a ⚠️ only on the first block of a streak, silence in between,
// one ❌ at escalation. A permanently-blocked track therefore produces
// exactly two comments total across the whole streak, not 191.
//
// Pure module, no I/O — mirrors lane-regression-guard.mjs's style.

export const BLOCK_KINDS = Object.freeze({
  DIRTY_CHECKOUT: 'dirty-checkout',
  MAIN_MODE_LOCK: 'main-mode-lock',
  PHANTOM_RUNNING: 'phantom-running', // Phase 6
  INVALID_RESTING_STATE: 'invalid-resting-state', // Phase 4
  // Reserved for track 10039's cloud dispatcher — never produced by this
  // track's own code, but a valid `kind` for anything using this module.
  EXPIRED_CREDENTIALS: 'expired-credentials',
  GITHUB_APP_MISSING: 'github-app-missing',
  PREFLIGHT_FAILED: 'preflight-failed',
});

export const DEFAULT_ESCALATE_AFTER = Number(process.env.LC_PRESPAWN_BLOCK_ESCALATE_AFTER) || 5;

/**
 * Decides what a pre-spawn block should do, given the streak count BEFORE
 * this block.
 *
 * @param {object} opts
 * @param {string} opts.kind - one of BLOCK_KINDS
 * @param {string} [opts.reason] - human-readable cause, echoed into the comment
 * @param {number} opts.countBefore - consecutive blocks recorded before this one (0 = first)
 * @param {number} [opts.threshold] - defaults to DEFAULT_ESCALATE_AFTER
 * @returns {{action: 'warn'|'silent'|'escalate'}}
 */
export function decidePreSpawnBlockOutcome({ kind, reason, countBefore, threshold = DEFAULT_ESCALATE_AFTER }) {
  if (!Object.values(BLOCK_KINDS).includes(kind)) {
    throw new Error(`decidePreSpawnBlockOutcome: unknown block kind "${kind}" — every caller must classify its cause, never count an unclassified block`);
  }
  const countAfter = countBefore + 1;
  if (countAfter >= threshold) return { action: 'escalate', kind, reason };
  if (countBefore === 0) return { action: 'warn', kind, reason };
  return { action: 'silent', kind, reason };
}

// Track 10060 Phase 3 (REQ-6): a dirty-checkout block is not one card's
// housekeeping chore. The done lane is forced to workspace: main (track
// 10035), so this guard gates EVERY merge in the project — one non-exempt
// dirty path halts all integration until a human resolves it. The original
// wording named a path and stopped there, which is why the 2026-09-03
// incident on track 10051 read as routine tidying and went unnoticed
// (spec Finding 4). Appended only for DIRTY_CHECKOUT; every other kind's
// wording is deliberately untouched.
export const DIRTY_CHECKOUT_IMPACT =
  'This halts main-mode lane actions across the whole project, including every merge — '
  + 'no track can integrate until the path above is committed, reverted, or ignored.';

/**
 * Formats the comment body for a warn/escalate outcome. The leading emoji
 * is the literal first character of the returned string — the Inbox's
 * `/api/inbox` bucket classification matches on exactly that
 * (`body LIKE '⚠️%'` / `body LIKE '❌%'`).
 *
 * @param {{action: 'warn'|'escalate', kind: string, reason?: string}} outcome
 * @returns {string|null} null for 'silent' — nothing should be posted
 */
export function formatBlockComment(outcome) {
  const impact = outcome.kind === BLOCK_KINDS.DIRTY_CHECKOUT ? ` ${DIRTY_CHECKOUT_IMPACT}` : '';
  if (outcome.action === 'warn') {
    return `⚠️ Main-mode run blocked — ${outcome.reason || `(${outcome.kind})`}. Not spawning; will retry next cycle.${impact}`;
  }
  if (outcome.action === 'escalate') {
    return `❌ Permanently blocked (${outcome.kind}) after repeated consecutive failures — ${outcome.reason || 'no reason recorded'}. Marking failure; this needs human attention.${impact}`;
  }
  return null;
}
