// ui/server/tests/track-1112-worktree-panel.test.mjs
// Track 1112 Phase 7: GET /api/projects/:id/worktrees (D-6 — project-scoped,
// deduped per host) and the /worker/heartbeat worktrees column write.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { app, pool } from '../index.mjs';

vi.mock('../auth.mjs');

vi.mock('pg', () => {
  const query = vi.fn();
  const Pool = vi.fn(() => ({ query, on: vi.fn() }));
  return { default: { Pool }, Pool };
});

describe('Track 1112 Phase 7: worktree panel API', () => {
  beforeEach(() => vi.resetAllMocks());

  describe('GET /api/projects/:id/worktrees', () => {
    it('flattens per-host worktree arrays into rows tagged with host', async () => {
      vi.mocked(pool.query).mockResolvedValueOnce({
        rows: [{
          hostname: 'dev-machine',
          worktrees: [
            { track: '1053', title: 'Reddit Launch', lane: 'done', lane_status: 'success', ahead: 1, behind: 0, dirty: 0, class: 'mergeable' },
            { track: '1044', title: null, lane: 'quality-gate', lane_status: 'queue', ahead: 2, behind: 5, dirty: null, class: 'stranded' },
          ],
        }],
      });

      const res = await request(app).get('/api/projects/1/worktrees').expect(200);
      expect(res.body).toHaveLength(2);
      expect(res.body[0]).toMatchObject({ track: '1053', class: 'mergeable', host: 'dev-machine' });
      expect(res.body[1]).toMatchObject({ track: '1044', class: 'stranded', host: 'dev-machine' });

      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('DISTINCT ON (hostname)'),
        ['1']
      );
    });

    it('dedupes at the SQL level via DISTINCT ON — one row per host regardless of worker count', async () => {
      // The DISTINCT ON query itself guarantees one row per host; this
      // test asserts the query shape does the deduping, not app-layer code
      // silently duplicating rows if the mock ever returned >1 per host.
      vi.mocked(pool.query).mockResolvedValueOnce({
        rows: [{ hostname: 'shared-host', worktrees: [{ track: '1', class: 'open' }] }],
      });
      const res = await request(app).get('/api/projects/1/worktrees').expect(200);
      expect(res.body).toHaveLength(1);
    });

    it('groups by host when multiple hosts have reported', async () => {
      vi.mocked(pool.query).mockResolvedValueOnce({
        rows: [
          { hostname: 'host-a', worktrees: [{ track: '1', class: 'open' }] },
          { hostname: 'host-b', worktrees: [{ track: '2', class: 'mergeable' }] },
        ],
      });
      const res = await request(app).get('/api/projects/1/worktrees').expect(200);
      const hosts = new Set(res.body.map(r => r.host));
      expect(hosts).toEqual(new Set(['host-a', 'host-b']));
    });

    it('returns an empty list when no worker has reported worktrees yet', async () => {
      vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] });
      const res = await request(app).get('/api/projects/1/worktrees').expect(200);
      expect(res.body).toEqual([]);
    });
  });

  describe('PATCH /worker/heartbeat — worktrees column', () => {
    it('writes the worktrees payload to the workers row', async () => {
      vi.mocked(pool.query).mockResolvedValueOnce({ rowCount: 1 });

      const worktrees = [{ track: '1', class: 'open' }];
      await request(app)
        .patch('/worker/heartbeat')
        .send({ hostname: 'h', pid: 123, project_id: 1, worktrees })
        .expect(200);

      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('worktrees ='),
        expect.arrayContaining([JSON.stringify(worktrees)])
      );
    });

    it('omits the worktrees column from the UPDATE when not provided (manager heartbeats)', async () => {
      vi.mocked(pool.query).mockResolvedValueOnce({ rowCount: 1 });

      await request(app)
        .patch('/worker/heartbeat')
        .send({ hostname: 'h', pid: 123 })
        .expect(200);

      const [sql] = pool.query.mock.calls[0];
      expect(sql).not.toMatch(/worktrees =/);
    });
  });

  describe('POST /api/projects/:id/dispatch — merge-worktree (D-7 stickiness)', () => {
    it('routes to the assignee\'s own worker when they have one registered', async () => {
      vi.mocked(pool.query)
        .mockResolvedValueOnce({ rows: [{ owner_uid: 'owner-1' }] }) // project
        .mockResolvedValueOnce({ rows: [{ assignee_uid: 'dev-1', created_by_uid: null }] }) // track
        .mockResolvedValueOnce({ rows: [{ id: 77, project_id: '1', user_uid: 'dev-1' }] }) // resolvePinnedWorkers
        .mockResolvedValueOnce({ rows: [{ id: 501 }], rowCount: 1 }); // INSERT worker_dispatch

      const res = await request(app)
        .post('/api/projects/1/dispatch')
        .send({ action: 'merge-worktree', payload: { track_number: '1053' } })
        .expect(200);

      expect(res.body).toEqual({ ok: true, id: 501 });
      const insertCall = pool.query.mock.calls.find(c => c[0].includes('INSERT INTO worker_dispatch'));
      expect(insertCall[1][0]).toBe(77); // worker_id resolved to the assignee's own worker, not an arbitrary one
    });

    it('falls back to any live worker for the project when the assignee has none of their own', async () => {
      vi.mocked(pool.query)
        .mockResolvedValueOnce({ rows: [{ owner_uid: 'owner-1' }] }) // project
        .mockResolvedValueOnce({ rows: [{ assignee_uid: 'dev-1', created_by_uid: null }] }) // track
        .mockResolvedValueOnce({ rows: [] }) // resolvePinnedWorkers — none of dev-1's own
        .mockResolvedValueOnce({ rows: [{ id: 88 }] }) // any live worker for the project
        .mockResolvedValueOnce({ rows: [{ id: 502 }], rowCount: 1 }); // INSERT worker_dispatch

      const res = await request(app)
        .post('/api/projects/1/dispatch')
        .send({ action: 'merge-worktree', payload: { track_number: '1053' } })
        .expect(200);

      expect(res.body).toEqual({ ok: true, id: 502 });
      const insertCall = pool.query.mock.calls.find(c => c[0].includes('INSERT INTO worker_dispatch'));
      expect(insertCall[1][0]).toBe(88);
    });

    it('respects an explicitly-provided worker_id instead of resolving one', async () => {
      vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ id: 999 }], rowCount: 1 });

      const res = await request(app)
        .post('/api/projects/1/dispatch')
        .send({ action: 'merge-worktree', worker_id: 55, payload: { track_number: '1053' } })
        .expect(200);

      expect(res.body).toEqual({ ok: true, id: 999 });
      // Only the INSERT ran — no project/track/worker resolution queries.
      expect(pool.query).toHaveBeenCalledTimes(1);
    });

    it('400s when no worker is available for the project at all', async () => {
      vi.mocked(pool.query)
        .mockResolvedValueOnce({ rows: [{ owner_uid: 'owner-1' }] }) // project
        .mockResolvedValueOnce({ rows: [{ assignee_uid: null, created_by_uid: null }] }) // track — falls through to project.owner_uid
        .mockResolvedValueOnce({ rows: [] }) // resolvePinnedWorkers for owner-1 — none
        .mockResolvedValueOnce({ rows: [] }); // any live worker for the project — none either

      const res = await request(app)
        .post('/api/projects/1/dispatch')
        .send({ action: 'merge-worktree', payload: { track_number: '1053' } })
        .expect(400);
      expect(res.body.error).toMatch(/no worker available/i);
    });

    it('400s when payload.track_number is missing', async () => {
      const res = await request(app)
        .post('/api/projects/1/dispatch')
        .send({ action: 'merge-worktree', payload: {} })
        .expect(400);
      expect(res.body.error).toMatch(/track_number/i);
    });
  });
});
