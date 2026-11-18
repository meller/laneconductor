// Push policy (decision D4). Default `ask`: the connector never pushes, and its responses tell
// Claude to ask the human. Opt-in `auto-state` (a standing human decision, set as `connector.push`
// in the optional settings file .laneconductor.json, see the skill file ops/settings.md): LocalGitStore pushes conductor-only commits fast-forward after 60 s idle.
import fs from 'node:fs';
import path from 'node:path';

export const PUSH_IDLE_MS = 60_000;
export const POLICIES = ['ask', 'auto-state'];

/** @returns {{ policy: 'ask' | 'auto-state', problem?: string }} */
export function readPushPolicy(repo) {
  let cfg;
  try {
    cfg = JSON.parse(fs.readFileSync(path.join(repo, '.laneconductor.json'), 'utf8'));
  } catch (e) {
    return e.code === 'ENOENT' ? { policy: 'ask' } : { policy: 'ask', problem: '.laneconductor.json is not valid JSON; using push policy "ask"' };
  }
  const v = cfg?.connector?.push;
  if (v === undefined) return { policy: 'ask' };
  if (POLICIES.includes(v)) return { policy: v };
  return { policy: 'ask', problem: `connector.push must be one of ${POLICIES.join(', ')} (got ${JSON.stringify(v)}); using "ask"` };
}

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

const BLOCKED = {
  non_state_commit: (l) => `commit${l.commits.length === 1 ? '' : 's'} ${l.commits.join(', ')} touch${l.commits.length === 1 ? 'es' : ''} files outside conductor/, so nothing was pushed. Ask the human before pushing.`,
  behind_upstream: () => 'the remote has newer commits, so nothing was pushed (never forced). Fetch and reconcile with the human first.',
  merge_commit: (l) => `${plural(l.commits.length, 'unpushed merge commit')} (${l.commits.join(', ')}) could carry code, so nothing was pushed. Ask the human before pushing.`,
  no_upstream: () => 'this branch has no upstream, so there is nowhere to push.',
  push_rejected: () => 'git rejected the push (not forced). Ask the human.',
};

/**
 * Warnings for a response when local commits are unpushed. `last` is the store's last auto-push
 * attempt (`{ ok, reason, commits }`) or null.
 */
export function pushWarnings({ policy, ahead, last }) {
  if (!ahead || ahead < 1) return [];
  const n = plural(ahead, 'local commit');
  if (policy !== 'auto-state') {
    return [`${n} not pushed, so remote surfaces cannot see them. The connector never pushes by itself: ask the human whether to push.`];
  }
  if (last && !last.ok && BLOCKED[last.reason]) return [`${n} not pushed. Auto-push is on but skipped: ${BLOCKED[last.reason](last)}`];
  return [`${n} not pushed yet; auto-state pushes conductor-only commits ${PUSH_IDLE_MS / 1000} s after the last write.`];
}
