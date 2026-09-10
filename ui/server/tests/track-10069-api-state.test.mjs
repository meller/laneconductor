// ui/server/tests/track-10069-api-state.test.mjs
// Track 10069 Phase 1 (REQ-13, TC-1.9): GET /api/state.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { existsSync, readFileSync } from 'fs';
import { Router } from 'express';

vi.mock('../auth.mjs');
vi.mock('pg', () => {
  const query = vi.fn();
  const Pool = vi.fn(() => ({ query, on: vi.fn() }));
  return { default: { Pool }, Pool };
});
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, existsSync: vi.fn(actual.existsSync), readFileSync: vi.fn(actual.readFileSync) };
});

import { app, pool } from '../index.mjs';

describe('GET /api/state', () => {
  beforeEach(() => vi.resetAllMocks());

  it('returns instance-wide projects/workers with empty gaps when no project_id given', async () => {
    vi.mocked(pool.query)
      .mockResolvedValueOnce({ rows: [{ id: 1, name: 'alpha', repo_path: '/r/alpha', primary_cli: 'claude', create_quality_gate: false }] })
      .mockResolvedValueOnce({ rows: [{ id: 9, hostname: 'h', type: 'worker', project_id: 1, current_task: null, last_heartbeat: new Date().toISOString() }] })
      .mockResolvedValueOnce({ rows: [{ project_id: 1, track_number: '1', lane: 'implement' }] });

    const res = await request(app).get('/api/state').expect(200);
    expect(res.body.projects).toHaveLength(1);
    expect(res.body.projects[0].tracksByLane).toEqual({ implement: 1 });
    expect(res.body.workers).toHaveLength(1);
    expect(res.body.gaps).toEqual([]);
  });

  it('scopes gaps to ?project_id= and computes them from real facts', async () => {
    vi.mocked(existsSync).mockReturnValue(false); // no product.md/tech-stack.md/quality-gate.md on disk
    vi.mocked(pool.query)
      .mockResolvedValueOnce({ rows: [{ id: 1, name: 'alpha', repo_path: '/r/alpha', primary_cli: 'claude', create_quality_gate: false }] })
      .mockResolvedValueOnce({ rows: [] }) // no online workers
      .mockResolvedValueOnce({ rows: [] }) // no tracks
      .mockResolvedValueOnce({ rows: [] }) // provider_status: no row
      .mockResolvedValueOnce({ rows: [] }); // Track 10084: reachable-anywhere check, no row

    const res = await request(app).get('/api/state?project_id=1').expect(200);
    const gapIds = res.body.gaps.map(g => g.id).sort();
    expect(gapIds).toEqual(['no-conductor-context', 'no-manager', 'no-provider', 'no-tracks', 'no-workers'].sort());
  });

  it("TC-1.9: with AUTH_ENABLED and a second user's private worker, that worker is omitted", async () => {
    vi.resetModules();
    vi.doMock('../auth.mjs', () => ({
      AUTH_ENABLED: true,
      loadAuthConfig: async () => {},
      authRouter: Router(),
      requireAuth: (req, _res, next) => { req.user = { uid: 'me' }; next(); },
    }));
    const { app: authedApp, pool: authedPool } = await import('../index.mjs');

    // Reimporting index.mjs re-runs its module-level migration bootstrap
    // against the (still-mocked) pool, so calls unrelated to this request
    // land ahead of the ones under test — match by SQL content, not
    // positional index, and default every other call to an empty result.
    vi.mocked(authedPool.query).mockImplementation((sql) => {
      if (sql.includes('FROM projects') && !sql.includes('JOIN')) return Promise.resolve({ rows: [] });
      if (/FROM workers w/.test(sql)) return Promise.resolve({ rows: [] });
      if (sql.includes('FROM tracks')) return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [] });
    });

    await request(authedApp).get('/api/state').expect(200);

    const workersCall = vi.mocked(authedPool.query).mock.calls.find(([sql]) => /FROM workers w/.test(sql));
    expect(workersCall).toBeTruthy();
    expect(workersCall[0]).toMatch(/visibility = 'public'/);
    expect(workersCall[0]).toMatch(/w\.user_uid = \$1/);
    expect(workersCall[1]).toEqual(['me']);
  });
});
