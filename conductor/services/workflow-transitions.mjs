// The ONE implementation of workflow transitions (track AM-10131). Given a project's workflow.json and a track's current lane,
// it says where the track goes when the lane's action succeeds or fails. Pure and dependency-free, so both callers import the
// same file: the connector (local, the plugin) and the sync daemon (remote, the parked tier). There is no second copy of this
// grammar anywhere; a test fails if one appears. The plugin generator ships this file inside the add-on at the same relative path.
//
// THE GRAMMAR is track 1020's, exactly. A lane's `on_success` / `on_failure` is one of:
//   `lane:status`  explicit: used as written (`review:queue`, `plan:success`, `implement:failure`);
//   `lane`         bare. A bare target naming a DIFFERENT lane defaults to status `queue`; a bare target naming the SAME lane
//                  defaults to `success` (on_success) or `failure` (on_failure). A bare `done` from another lane is therefore
//                  `done:queue` (passed the gate, not shipped), never `done:success`;
//   null / absent  no automatic move (the lane's own action or a human decides).
// An unknown current lane is an explicit error, never a guess. Names are compared ignoring case and surrounding spaces.
//
// A project's own lane names (otralingo: planning, in-progress) resolve through the caller's `mapLane(name) -> project lane | null`
// (the connector passes its guide-lane mapping, `valid.guide_lanes` of track AM-10128), which keeps this file free of vocabulary.

export const OUTCOMES = ['success', 'failure'];

const norm = (s) => String(s ?? '').trim().toLowerCase();

function checkOutcome(outcome) {
  if (!OUTCOMES.includes(outcome)) throw new TypeError(`outcome must be one of ${OUTCOMES.join(', ')} (got ${JSON.stringify(outcome)})`);
}

/**
 * One target string to a transition. `value` is the raw `on_success` / `on_failure` text, `currentLane` the lane the action ran in.
 * @returns {{ lane: string, status: string } | null} null: no automatic move.
 */
export function resolveTarget(value, currentLane, outcome) {
  checkOutcome(outcome);
  if (typeof value !== 'string' || value.trim() === '') return null;
  const at = value.indexOf(':');
  const lane = (at === -1 ? value : value.slice(0, at)).trim() || String(currentLane ?? '').trim();
  const status = at === -1 ? '' : value.slice(at + 1).trim();
  if (status) return { lane, status };
  const sameLane = norm(lane) === norm(currentLane);
  return { lane, status: sameLane ? outcome : 'queue' };
}

/**
 * The transition for a track sitting in `currentLane`.
 * @param {{ lanes?: Record<string, { on_success?: string|null, on_failure?: string|null }> }} workflow parsed workflow.json
 * @param {string} currentLane the track's **Lane** (the project's own name, or a guide name when `mapLane` is given)
 * @param {'success'|'failure'} outcome
 * @param {{ mapLane?: (name: string) => string | null }} [opts]
 * @returns {{ ok: true, lane: string, outcome: string, value: string|null, next: { lane: string, status: string } | null, reason: string | null }
 *   | { ok: false, code: 'UNKNOWN_LANE', message: string, lanes: string[] }}
 */
export function resolveNext(workflow, currentLane, outcome, opts = {}) {
  checkOutcome(outcome);
  const lanes = workflow && typeof workflow === 'object' && workflow.lanes && typeof workflow.lanes === 'object' ? workflow.lanes : {};
  const names = Object.keys(lanes);
  const asked = String(currentLane ?? '').trim();
  let key = names.includes(asked) ? asked : names.find((n) => norm(n) === norm(asked)) ?? null;
  if (key === null && asked && typeof opts.mapLane === 'function') {
    const mapped = opts.mapLane(asked);
    if (mapped && names.includes(mapped)) key = mapped;
  }
  if (key === null) {
    // `backlog` is where tracks wait before any lane; a workflow may leave it out and nothing moves a track out of it automatically.
    if (norm(asked) === 'backlog') return { ok: true, lane: asked, outcome, value: null, next: null, reason: 'backlog has no automatic move' };
    return {
      ok: false,
      code: 'UNKNOWN_LANE',
      message: `${asked ? `Lane "${asked}"` : 'No lane'} is not a lane of this workflow${names.length ? ` (${names.join(', ')})` : ' (it defines no lanes)'}`,
      lanes: names,
    };
  }
  const field = outcome === 'success' ? 'on_success' : 'on_failure';
  const raw = lanes[key]?.[field];
  const value = typeof raw === 'string' && raw.trim() !== '' ? raw : null;
  const next = resolveTarget(value, key, outcome);
  return { ok: true, lane: key, outcome, value, next, reason: next ? null : `${key} has no ${field}: there is no automatic move` };
}

/**
 * Both directions for `valid.next`: `{ success: 'review:queue' | null, failure: 'in-progress:failure' | null }`.
 * @returns {{ ok: true, lane: string, next: { success: string|null, failure: string|null } } | { ok: false, code: string, message: string, lanes: string[] }}
 */
export function describeNext(workflow, currentLane, opts = {}) {
  const out = { ok: true, lane: null, next: {} };
  for (const outcome of OUTCOMES) {
    const r = resolveNext(workflow, currentLane, outcome, opts);
    if (!r.ok) return r;
    out.lane = r.lane;
    out.next[outcome] = r.next ? `${r.next.lane}:${r.next.status}` : null;
  }
  return out;
}

/** The lane (lower case) a transition value leads to from `currentLane`, or null. For callers that only need the destination lane. */
export function targetLaneOf(value, currentLane, outcome = 'success') {
  const t = resolveTarget(value, currentLane, outcome);
  return t ? norm(t.lane) : null;
}
