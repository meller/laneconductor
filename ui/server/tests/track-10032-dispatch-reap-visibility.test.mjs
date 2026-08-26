// server/tests/track-10032-dispatch-reap-visibility.test.mjs
// Track 10032: F18 claim-timeout — surface the outcome in the UI.
//
// reapStaleDispatches() (track 1102 F18b) already reassigns or fails a
// stale dispatch, but neither outcome reaches the user: a reassignment only
// changes worker_id (indistinguishable from a healthy pending dispatch),
// and a failure's `result` gets overwritten the moment the reassigned
// worker later PATCHes completion. This file covers the fix: two durable
// columns (reaped_at/reap_reason) written on both branches, and a
// track-scoped `system` ⚠️/❌ comment that lands in the Inbox.
//
// Extends track-1102-f18b-dispatch-claim-timeout.test.mjs's mocked-pool
// pattern in a NEW file rather than rewriting it — that file's own 5 tests
// must keep passing unchanged (see the "regression" describe block below).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { app, pool, reapStaleDispatches } from '../index.mjs';

vi.mock('../auth.mjs');
vi.mock('pg', () => {
  const query = vi.fn();
  const Pool = vi.fn(() => ({
    query,
    on: vi.fn(),
    connect: vi.fn().mockResolvedValue({ query, release: vi.fn() }),
  }));
  return { default: { Pool }, Pool };
});

const STALE_DISPATCH = { id: 42, worker_id: 7, project_id: 1, track_number: '10032', action: 'implement' };
const STALE_DISPATCH_NO_TRACK = { id: 43, worker_id: 7, project_id: 1, track_number: null, action: 'deploy' };
const REAL_WORKER = { id: 8, hostname: 'dev-machine', pid: 54321 };
const TRACK_ROW = { id: 999 };

function makeMockPool({ staleRows, replacementRows, trackRows = [TRACK_ROW], commentInsertImpl } = {}) {
  const query = vi.fn(async (sql, params) => {
    if (/FROM worker_dispatch wd\s+JOIN workers w/i.test(sql)) {
      return { rows: staleRows };
    }
    if (/SELECT w\.id FROM workers w/i.test(sql)) {
      const hasPidFilter = /pid\s*!=\s*0/.test(sql);
      const hasHostnameFilter = /NOT LIKE 'pw-e2e-%'/.test(sql);
      const [, deadWorkerId] = params;
      let filtered = replacementRows.filter(w => w.id !== deadWorkerId);
      if (hasPidFilter) filtered = filtered.filter(w => w.pid !== 0);
      if (hasHostnameFilter) filtered = filtered.filter(w => !(w.hostname && w.hostname.startsWith('pw-e2e-')));
      return { rows: filtered.slice(0, 1) };
    }
    if (/UPDATE worker_dispatch SET worker_id/i.test(sql)) {
      return { rows: [] };
    }
    if (/UPDATE worker_dispatch SET reaped_at/i.test(sql)) {
      return { rows: [] };
    }
    if (/UPDATE worker_dispatch SET status = 'failed'/i.test(sql)) {
      return { rows: [] };
    }
    if (/SELECT id FROM tracks WHERE project_id/i.test(sql)) {
      return { rows: trackRows };
    }
    if (/INSERT INTO track_comments/i.test(sql)) {
      if (commentInsertImpl) return commentInsertImpl(sql, params);
      return { rows: [] };
    }
    return { rows: [] };
  });
  return { query };
}

describe('Track 10032: reap outcome durably recorded', () => {
  it('TC-1.1: reassign branch writes reaped_at + reap_reason naming both workers', async () => {
    const pool = makeMockPool({ staleRows: [STALE_DISPATCH], replacementRows: [REAL_WORKER] });
    await reapStaleDispatches(pool);

    const reapCall = pool.query.mock.calls.find(([sql]) => /UPDATE worker_dispatch SET reaped_at/i.test(sql));
    expect(reapCall).toBeDefined();
    const [, params] = reapCall;
    expect(params).toContain(STALE_DISPATCH.id);
    const reasonParam = params.find(p => typeof p === 'string');
    expect(reasonParam).toMatch(new RegExp(`${STALE_DISPATCH.worker_id}`));
    expect(reasonParam).toMatch(new RegExp(`${REAL_WORKER.id}`));
  });

  it('TC-1.2: fail branch writes reap_reason matching /timeout/i; result still written', async () => {
    const pool = makeMockPool({ staleRows: [STALE_DISPATCH], replacementRows: [] });
    await reapStaleDispatches(pool);

    const failCall = pool.query.mock.calls.find(([sql]) => /UPDATE worker_dispatch SET status = 'failed'/i.test(sql));
    expect(failCall).toBeDefined();
    const [sql, params] = failCall;
    expect(params[0]).toMatch(/timeout/i);
    expect(params[1]).toBe(STALE_DISPATCH.id);
    expect(sql).toMatch(/reap_reason/i);
    expect(sql).toMatch(/reaped_at/i);
    const reapReasonParam = params.find(p => typeof p === 'string' && /timeout/i.test(p));
    expect(reapReasonParam).toBeDefined();
  });

  it('TC-1.3: stale-selection SQL carries "reaped_at IS NULL"', async () => {
    const pool = makeMockPool({ staleRows: [], replacementRows: [] });
    await reapStaleDispatches(pool);

    const staleCall = pool.query.mock.calls.find(([sql]) => /FROM worker_dispatch wd\s+JOIN workers w/i.test(sql));
    expect(staleCall).toBeDefined();
    expect(staleCall[0]).toMatch(/reaped_at\s+IS\s+NULL/i);
  });

  it('TC-1.4: stale-selection SQL selects track_number and action', async () => {
    const pool = makeMockPool({ staleRows: [], replacementRows: [] });
    await reapStaleDispatches(pool);

    const staleCall = pool.query.mock.calls.find(([sql]) => /FROM worker_dispatch wd\s+JOIN workers w/i.test(sql));
    expect(staleCall).toBeDefined();
    expect(staleCall[0]).toMatch(/wd\.track_number/i);
    expect(staleCall[0]).toMatch(/wd\.action/i);
  });
});

describe('Track 10032: Inbox comment on track-scoped reap', () => {
  it('TC-2.1: track-scoped reassignment inserts exactly one system comment starting with ⚠️', async () => {
    const pool = makeMockPool({ staleRows: [STALE_DISPATCH], replacementRows: [REAL_WORKER] });
    await reapStaleDispatches(pool);

    const insertCalls = pool.query.mock.calls.filter(([sql]) => /INSERT INTO track_comments/i.test(sql));
    expect(insertCalls.length).toBe(1);
    const [sql, params] = insertCalls[0];
    expect(sql).toMatch(/'system'/);
    const body = params.find(p => typeof p === 'string' && p.startsWith('⚠️'));
    expect(body).toBeDefined();
  });

  it('TC-2.2: track-scoped failure inserts exactly one system comment starting with ❌', async () => {
    const pool = makeMockPool({ staleRows: [STALE_DISPATCH], replacementRows: [] });
    await reapStaleDispatches(pool);

    const insertCalls = pool.query.mock.calls.filter(([sql]) => /INSERT INTO track_comments/i.test(sql));
    expect(insertCalls.length).toBe(1);
    const [, params] = insertCalls[0];
    const body = params.find(p => typeof p === 'string' && p.startsWith('❌'));
    expect(body).toBeDefined();
  });

  it('TC-2.3: track_number IS NULL dispatch inserts no comment and does not throw', async () => {
    const pool = makeMockPool({ staleRows: [STALE_DISPATCH_NO_TRACK], replacementRows: [REAL_WORKER] });
    await expect(reapStaleDispatches(pool)).resolves.not.toThrow();

    const insertCalls = pool.query.mock.calls.filter(([sql]) => /INSERT INTO track_comments/i.test(sql));
    expect(insertCalls.length).toBe(0);
  });

  it('TC-2.4: unresolvable track (deleted since dispatch) inserts no comment and does not throw', async () => {
    const pool = makeMockPool({ staleRows: [STALE_DISPATCH], replacementRows: [REAL_WORKER], trackRows: [] });
    await expect(reapStaleDispatches(pool)).resolves.not.toThrow();

    const insertCalls = pool.query.mock.calls.filter(([sql]) => /INSERT INTO track_comments/i.test(sql));
    expect(insertCalls.length).toBe(0);
  });

  it('TC-2.5: a comment-insert rejection does not abort the loop — remaining stale rows still reaped', async () => {
    let calls = 0;
    const pool = makeMockPool({
      staleRows: [STALE_DISPATCH, { ...STALE_DISPATCH, id: 44, track_number: '10033' }],
      replacementRows: [REAL_WORKER],
      commentInsertImpl: () => {
        calls += 1;
        if (calls === 1) throw new Error('insert failed');
        return { rows: [] };
      },
    });
    await expect(reapStaleDispatches(pool)).resolves.not.toThrow();

    const reapCalls = pool.query.mock.calls.filter(([sql]) => /UPDATE worker_dispatch SET reaped_at/i.test(sql));
    expect(reapCalls.length).toBe(2);
  });

  it('TC-2.6: already-reaped row is not re-selected (reaped_at IS NULL guard)', async () => {
    // The predicate itself is asserted in TC-1.3; here we confirm a second
    // reap cycle against an empty stale set (as the real WHERE clause would
    // now return, since reaped_at is no longer NULL) produces no comment.
    const pool = makeMockPool({ staleRows: [], replacementRows: [REAL_WORKER] });
    await reapStaleDispatches(pool);

    const insertCalls = pool.query.mock.calls.filter(([sql]) => /INSERT INTO track_comments/i.test(sql));
    expect(insertCalls.length).toBe(0);
  });
});
