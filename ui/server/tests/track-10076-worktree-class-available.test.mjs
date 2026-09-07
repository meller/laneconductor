// server/tests/track-10076-worktree-class-available.test.mjs
// Track 10076 Phase 2 (REQ-2): GET /api/projects/:id/tracks must
// distinguish "no live worker reported worktree state" from "a worker
// reported and this track has nothing unmerged" — worktree_class alone is
// null in both cases, and treating them the same would let a stopped
// worker silently make the board report every unmerged track as shipped
// (see done-lane-bucket.mjs's own doc comment for the full reasoning).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { app, pool } from '../index.mjs';

vi.mock('../auth.mjs');

vi.mock('pg', () => {
  const query = vi.fn();
  const Pool = vi.fn(() => ({
    query,
    on: vi.fn(),
  }));
  return { default: { Pool }, Pool };
});

function trackRow(overrides = {}) {
  return {
    id: 1, track_number: '101', title: 'A track', lane_status: 'done',
    lane_action_status: 'success', progress_percent: 100,
    ...overrides,
  };
}

describe('GET /api/projects/:id/tracks — worktree_class_available (TC-2)', () => {
  beforeEach(() => vi.resetAllMocks());

  it('TC-2.1: a live worker reporting one unmerged track — that track gets its class, all tracks are marked available', async () => {
    vi.mocked(pool.query)
      .mockResolvedValueOnce({ rows: [trackRow({ track_number: '101' }), trackRow({ track_number: '102' })] }) // main tracks query
      .mockResolvedValueOnce({ // fetchWorktreeRows
        rows: [{ hostname: 'h1', last_heartbeat: new Date().toISOString(), worktrees: [{ track: '101', class: 'mergeable' }] }],
      });

    const res = await request(app).get('/api/projects/1/tracks').expect(200);
    const t101 = res.body.find(t => t.track_number === '101');
    const t102 = res.body.find(t => t.track_number === '102');

    expect(t101.worktree_class).toBe('mergeable');
    expect(t101.worktree_class_available).toBe(true);
    // t102 has no live unmerged branch — null class, but STILL available,
    // since a worker did report this cycle.
    expect(t102.worktree_class).toBeNull();
    expect(t102.worktree_class_available).toBe(true);
  });

  it('TC-2.2: no worker heartbeat inside the window — every track is unavailable, not falsely "merged"', async () => {
    vi.mocked(pool.query)
      .mockResolvedValueOnce({ rows: [trackRow({ track_number: '103' })] })
      .mockResolvedValueOnce({ rows: [] }); // fetchWorktreeRows — nothing matched the 60s window

    const res = await request(app).get('/api/projects/1/tracks').expect(200);
    expect(res.body[0].worktree_class).toBeNull();
    expect(res.body[0].worktree_class_available).toBe(false);
  });

  it('TC-2.3: worker row present but worktrees is SQL NULL — treated as no signal, not an empty "everything merged" report', async () => {
    vi.mocked(pool.query)
      .mockResolvedValueOnce({ rows: [trackRow({ track_number: '104' })] })
      .mockResolvedValueOnce({ rows: [{ hostname: 'h1', last_heartbeat: new Date().toISOString(), worktrees: null }] });

    const res = await request(app).get('/api/projects/1/tracks').expect(200);
    // The DB query itself filters on `worktrees IS NOT NULL`, so a real
    // Postgres result would never include this row — this fixture models
    // fetchWorktreeRows()'s own defensive Array.isArray guard for a
    // non-array `worktrees` value reaching this far regardless.
    expect(res.body[0].worktree_class).toBeNull();
  });

  it('TC-2.4: GET /api/projects/:id/worktrees keeps returning a flat array (fetchWorktreeRows return-shape change is internal only)', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({
      rows: [{ hostname: 'h1', last_heartbeat: new Date().toISOString(), worktrees: [{ track: '101', class: 'mergeable' }] }],
    });

    const res = await request(app).get('/api/projects/1/worktrees').expect(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0]).toMatchObject({ track: '101', class: 'mergeable', host: 'h1' });
  });
});
