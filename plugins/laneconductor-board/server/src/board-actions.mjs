// Board card actions, step 1 (track AM-10115): the next step of one track as a short reason plus the exact command, worked out at
// generation time from the track's own markers only (the row of summary.mjs `rowOf`, the dependency state, the stale-claim check)
// and the project's workflow. Pure, no I/O. The board shows the command and a Copy button; running work is never a page action.
//
// The mapping follows the `next` procedure (ops/next.md, S05 to S18) for one track. Lane names are the project's own: a lane is
// mapped to the lane guide it stands for (plan, implement, review, quality-gate, done) with the same name matching the connector
// uses, and where a lane succeeds the shared transition resolver says which lane comes next.
import { resolveNext } from '../../conductor/services/workflow-transitions.mjs';
import { guideLaneMap, nearestLane } from './vocabulary.mjs';
import { ownerFlags } from './owner-steps.mjs';

const GUIDES = ['plan', 'implement', 'review', 'quality-gate', 'done', 'backlog'];
const COMMAND = { plan: 'plan', implement: 'implement', review: 'review', 'quality-gate': 'quality-gate', done: 'merge' };
const READY = {
  plan: 'ready to plan',
  implement: 'ready to build from its plan',
  review: 'ready for review',
  'quality-gate': 'ready for the quality gate',
  done: 'passed the gate, not merged yet',
};
// Where a lane leads when the workflow has no automatic move out of it (ops/next.md S14 to S16).
const FALLBACK = { plan: 'implement', implement: 'review', review: 'quality-gate', 'quality-gate': 'done' };
// A failure in a lane (ops/next.md S06): retry the build, replan after a failed plan or gate.
const FAILURE = {
  plan: ['plan', 'the plan failed; plan it again'],
  implement: ['implement', 'the build failed; retry it'],
  review: ['implement', 'the review failed; fix and build again'],
  'quality-gate': ['plan', 'the gate failed; replan it'],
};

const lower = (s) => String(s ?? '').trim().toLowerCase();
const cmd = (verb, n) => `/laneconductor:${verb} ${n}`;
const act = (c, w) => ({ c, w });

/**
 * @param {{ row: object, stale?: object|null, dep?: { blocked_by: number[], ready_to_resume: boolean }|null, lanes: string[], workflow?: object|null, nowMs?: number }} a
 *   nowMs: the time the board is read at; only used to tell a waiting track whose run window (KPI Check After) has ended (a measurement, S23)
 *   row: the track's `rowOf` row; lanes: the project's lanes (backlog included); workflow: parsed conductor/workflow.json or null
 * @returns {{ c: string|null, w: string } | null} null: nothing to say (a shipped track, or a lane the board does not know)
 */
export function actionOf({ row, stale = null, dep = null, lanes, workflow = null, nowMs = null }) {
  const n = row.number;
  const lane = lower(row.lane);
  const status = lower(row.lane_status);
  const known = lanes.find((l) => lower(l) === lane);
  const g = guideLaneMap(GUIDES, lanes);
  const guideOf = (name) => GUIDES.find((k) => g[k] && lower(g[k]) === lower(name)) ?? (lower(name) === 'backlog' ? 'backlog' : null);
  const guide = known ? guideOf(known) : null;

  // Track AM-10147: a waiting track with an Owner Action is a step only the person can do (S22, read before the reply state): the comment says what they did, it is not an answer.
  if (known && guide && guide !== 'backlog' && status === 'waiting' && row.owner_action) return act(`/laneconductor:comment ${n} <what you did>`, 'owner action: do it, then comment what you did');
  // S23: a waiting track whose run window ended is a measurement, not a question (unless a reply is waiting or a dependency is unmet).
  if (nowMs !== null && known && guide && guide !== 'backlog' && guide !== 'done' && !row.waiting_for_reply && !dep?.blocked_by?.length && ownerFlags(row, nowMs).ready_to_measure) return act(cmd('quality-gate', n), 'the run window ended; measure the KPI');
  if (row.waiting_for_reply) return act(`/laneconductor:comment ${n} <your reply>`, 'a human reply is waiting');
  if (!known || !guide) return null;

  if (guide === 'done') {
    if (status === 'queue') return act(cmd('merge', n), READY.done);
    if (status === 'failure') return act(cmd('merge', n), 'the merge failed; fix the cause, then merge again');
    if (status === 'waiting') return act(`/laneconductor:move ${n} ${known}:success`, 'a pull request is open; once it is merged, record it');
    return null;
  }
  if (guide === 'backlog') return act(null, 'parked in the backlog');
  if (status === 'running') {
    return stale
      ? act(`/laneconductor:move ${n} ${known}:queue`, 'stale claim: release it if nothing is running')
      : act(null, 'running; nothing to do');
  }
  if (dep?.ready_to_resume) return act(`/laneconductor:move ${n} ${known}:queue`, 'its dependencies shipped; resume it');
  if (dep?.blocked_by?.length) return act(null, `blocked by ${dep.blocked_by.join(', ')}`);
  if (status === 'failure') {
    const [verb, why] = FAILURE[guide] ?? [guide, 'failed here'];
    return act(cmd(COMMAND[verb], n), why);
  }
  if (status === 'waiting') return act(`/laneconductor:comment ${n} <your reply>`, 'waiting on a human');
  if (status === 'queue' && COMMAND[guide]) return act(cmd(COMMAND[guide], n), READY[guide]);
  if (status === 'success') {
    // The workflow says where a finished lane leads; where it has no automatic move, the lane order does.
    let next = null;
    if (workflow) {
      const r = resolveNext(workflow, known, 'success', { mapLane: (name) => nearestLane(name, Object.keys(workflow.lanes ?? {})) });
      if (r.ok && r.next && lower(r.next.lane) !== lane) next = guideOf(r.next.lane);
    }
    next = next && COMMAND[next] ? next : FALLBACK[guide];
    if (next && COMMAND[next]) return act(cmd(COMMAND[next], n), `${READY[next]}`);
  }
  return null;
}
