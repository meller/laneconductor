// Parking and resume without a daemon (track AM-10136). Nothing resumes a parked track by itself in the plugin world; what the files
// can say is which dependencies are met and which parked tracks could be resumed now. Pure functions over the track rows of
// summary.mjs `rowOf`, no I/O.
//
// A track's dependencies are the union of `**Depends On**` and `**Waiting On Tracks**`. A dependency is met when that track sits in the
// done lane with status success (`done:queue` is gated but not merged). A number no track has counts as unmet: it cannot ever resolve.

const isDone = (r) => r.lane === 'done' && r.lane_status === 'success';

/** The dependency numbers of one row, in order, without repeats. */
export const dependenciesOf = (row) => [...new Set([...(row.depends_on ?? []), ...(row.waiting_on ?? [])].map(Number))];

/**
 * @param {Array<{ number: number, lane: string|null, lane_status: string|null, depends_on?: string[], waiting_on?: string[], waiting_for_reply?: boolean }>} rows
 * @returns {Map<number, { blocked_by: number[], ready_to_resume: boolean }>} only tracks that have dependencies and are not done
 */
export function dependencyState(rows) {
  const byNumber = new Map();
  for (const r of rows) if (!byNumber.has(r.number)) byNumber.set(r.number, r);
  const out = new Map();
  for (const r of rows) {
    const deps = dependenciesOf(r);
    if (!deps.length || r.lane === 'done') continue;
    const blocked_by = deps.filter((n) => !(byNumber.has(n) && isDone(byNumber.get(n))));
    // A track parked with a **Waiting Reason** and no **Waiting On Tracks** waits for something else (a question, an approval): finished
    // dependencies do not make it ready; an **Owner Action** (track AM-10147) is such a reason. Waiting On Tracks keeps the union meaning below.
    const parkedForOther = (Boolean(r.waiting_reason) || Boolean(r.owner_action)) && !(r.waiting_on ?? []).length;
    const ready_to_resume = r.lane_status === 'waiting' && blocked_by.length === 0 && !r.waiting_for_reply && !parkedForOther;
    out.set(r.number, { blocked_by, ready_to_resume });
  }
  return out;
}

/** The ids of the parked tracks that are ready to resume, newest number first. */
export function readyToResume(rows) {
  const state = dependencyState(rows);
  return rows.filter((r) => state.get(r.number)?.ready_to_resume).sort((a, b) => b.number - a.number).map((r) => r.id);
}
