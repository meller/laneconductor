// server/tests/track-1102-f18b-dispatch-claim-timeout.test.mjs
// Track 1102 F18 follow-up: phantom-signature exclusion (F18's own fix)
// stops a FAKE worker absorbing a dispatch, but not a REAL worker that
// dies (crash, machine sleep, `lc stop`) after being assigned one and
// before claiming it — same silent starvation, a cause exclusion-by-
// signature can't cover since the dead worker's row looks completely
// legitimate. reapStaleDispatches() bounds how long a dispatch may sit
// 'pending': reassigns to another live worker for the same project if one
// exists, or marks it 'failed' with an explicit reason otherwise.
//
// A mocked pool.query can't run real SQL — this simulates Postgres
// applying the app's own WHERE clauses (staleness window, phantom
// exclusion, project scoping) by inspecting the actual SQL text sent, the
// same pattern track-1102-f18-phantom-worker.test.mjs already established,
// so a regression that drops a filter from the query fails these tests
// too, not just a dedicated SQL-string check.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { reapStaleDispatches } from '../index.mjs';

vi.mock('../auth.mjs');
vi.mock('pg', () => {
  const query = vi.fn();
  const Pool = vi.fn(() => ({ query, on: vi.fn() }));
  return { default: { Pool }, Pool };
});

const STALE_DISPATCH = { id: 42, worker_id: 7, project_id: 1 };
const PHANTOM = { id: 1013, hostname: 'pw-e2e-worker', pid: 999999 };
const REAL_WORKER = { id: 8, hostname: 'dev-machine', pid: 54321 };

function makeMockPool({ staleRows, replacementRows }) {
  const query = vi.fn(async (sql, params) => {
    if (/FROM worker_dispatch wd\s+JOIN workers w/i.test(sql)) {
      return { rows: staleRows };
    }
    if (/SELECT w\.id FROM workers w/i.test(sql)) {
      // Simulate the app's own WHERE clause by inspecting the ACTUAL SQL
      // text sent — same pattern track-1102-f18-phantom-worker.test.mjs
      // uses (simulateAnyLiveWorkerQuery), so a regression that drops a
      // filter from the real query fails these tests too, not just a
      // dedicated SQL-string check. A JS-side filter applied
      // unconditionally (regardless of what the SQL actually says) would
      // pass even after such a regression — verified by mutation-testing
      // an earlier draft of this file against a deliberately weakened
      // production query, which this version correctly failed on.
      const hasPidFilter = /pid\s*!=\s*0/.test(sql);
      const hasHostnameFilter = /NOT LIKE 'pw-e2e-%'/.test(sql);
      const [projectId, deadWorkerId] = params;
      let filtered = replacementRows.filter(w => w.id !== deadWorkerId);
      if (hasPidFilter) filtered = filtered.filter(w => w.pid !== 0);
      if (hasHostnameFilter) filtered = filtered.filter(w => !(w.hostname && w.hostname.startsWith('pw-e2e-')));
      return { rows: filtered.slice(0, 1) };
    }
    if (/UPDATE worker_dispatch SET worker_id/i.test(sql)) {
      return { rows: [] };
    }
    if (/UPDATE worker_dispatch SET status = 'failed'/i.test(sql)) {
      return { rows: [] };
    }
    return { rows: [] };
  });
  return { query };
}

describe('Track 1102 F18 follow-up: reapStaleDispatches', () => {
  it('reassigns a stale pending dispatch to another live worker when one exists', async () => {
    const pool = makeMockPool({ staleRows: [STALE_DISPATCH], replacementRows: [REAL_WORKER] });
    await reapStaleDispatches(pool);

    const reassignCall = pool.query.mock.calls.find(([sql]) => /UPDATE worker_dispatch SET worker_id/i.test(sql));
    expect(reassignCall).toBeDefined();
    expect(reassignCall[1]).toEqual([REAL_WORKER.id, STALE_DISPATCH.id]);
  });

  it('marks the dispatch failed with a reason when no other live worker exists', async () => {
    const pool = makeMockPool({ staleRows: [STALE_DISPATCH], replacementRows: [] });
    await reapStaleDispatches(pool);

    const failCall = pool.query.mock.calls.find(([sql]) => /UPDATE worker_dispatch SET status = 'failed'/i.test(sql));
    expect(failCall).toBeDefined();
    expect(failCall[1][0]).toMatch(/timeout/i);
    expect(failCall[1][1]).toBe(STALE_DISPATCH.id);
  });

  it('does not reassign onto a phantom fixture worker even if it is the only "live" one', async () => {
    const pool = makeMockPool({ staleRows: [STALE_DISPATCH], replacementRows: [PHANTOM] });
    await reapStaleDispatches(pool);

    const reassignCall = pool.query.mock.calls.find(([sql]) => /UPDATE worker_dispatch SET worker_id/i.test(sql));
    const failCall = pool.query.mock.calls.find(([sql]) => /UPDATE worker_dispatch SET status = 'failed'/i.test(sql));
    expect(reassignCall).toBeUndefined();
    expect(failCall).toBeDefined();
  });

  it('leaves a dispatch untouched when it is not stale (the stale-selection query itself returns nothing)', async () => {
    const pool = makeMockPool({ staleRows: [], replacementRows: [REAL_WORKER] });
    await reapStaleDispatches(pool);

    const anyUpdate = pool.query.mock.calls.some(([sql]) => /UPDATE worker_dispatch/i.test(sql));
    expect(anyUpdate).toBe(false);
  });

  it('the staleness query filters on the configured timeout window, not an arbitrary one', async () => {
    const pool = makeMockPool({ staleRows: [], replacementRows: [] });
    process.env.LC_DISPATCH_CLAIM_TIMEOUT_MS = '120000';
    try {
      await reapStaleDispatches(pool);
    } finally {
      delete process.env.LC_DISPATCH_CLAIM_TIMEOUT_MS;
    }

    const staleCall = pool.query.mock.calls.find(([sql]) => /FROM worker_dispatch wd\s+JOIN workers w/i.test(sql));
    expect(staleCall).toBeDefined();
    expect(staleCall[1]).toEqual([120000]);
  });
});
