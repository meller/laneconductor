// server/tests/track-1091-phase4-dispatch-status.test.mjs
// Track 1091 Phase 4: polling a create-project dispatch's status/result
// from the New Project UI wizard, and making manager workers (project_id
// NULL) visible via GET /api/workers so the wizard can offer a picker.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { app, pool } from '../index.mjs';

vi.mock('../auth.mjs');

vi.mock('pg', () => {
    const query = vi.fn();
    const Pool = vi.fn(() => ({ query, on: vi.fn() }));
    return { default: { Pool }, Pool };
});

describe('GET /api/dispatch/:dispatchId', () => {
    beforeEach(() => vi.resetAllMocks());

    it('returns the dispatch row', async () => {
        vi.mocked(pool.query).mockResolvedValueOnce({
            rows: [{ id: 99, worker_id: 42, action: 'create-project', status: 'done', result: 'Created at /tmp/x', created_at: new Date(), claimed_at: new Date() }],
        });
        const res = await request(app).get('/api/dispatch/99').expect(200);
        expect(res.body.id).toBe(99);
        expect(res.body.status).toBe('done');
        expect(res.body.result).toMatch(/Created at/);
    });

    it('404s when the dispatch does not exist', async () => {
        vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] });
        const res = await request(app).get('/api/dispatch/999').expect(404);
        expect(res.body.error).toMatch(/not found/i);
    });
});

describe('GET /api/workers includes manager workers (project_id NULL)', () => {
    beforeEach(() => vi.resetAllMocks());

    it('LEFT JOINs projects so a manager row is not silently dropped', async () => {
        vi.mocked(pool.query).mockResolvedValueOnce({
            rows: [{ id: 1, hostname: 'host-a', type: 'manager', project_id: null, project_name: null, repo_path: null }],
        });
        const res = await request(app).get('/api/workers').expect(200);
        expect(res.body).toHaveLength(1);
        expect(res.body[0].type).toBe('manager');
        expect(pool.query).toHaveBeenCalledWith(
            expect.stringContaining('LEFT JOIN projects'),
            expect.anything()
        );
    });
});

// Track 1091 Phase 4: found live, not by inspection — a real manager
// worker's heartbeat silently updated zero rows and it "vanished" from
// GET /api/workers ~60s after registering, despite the process staying
// alive and heartbeating the whole time. Root cause: SQL's `NULL = NULL`
// is never true, so a plain `WHERE project_id = $1` can never match a
// manager's (always-NULL) project_id, however that $1 value was produced.
describe('PATCH /worker/heartbeat and DELETE /worker are NULL-safe on project_id', () => {
    beforeEach(() => vi.resetAllMocks());

    it('heartbeat with project_id: null uses a NULL-safe WHERE clause', async () => {
        vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] }); // UPDATE workers
        await request(app)
            .patch('/worker/heartbeat')
            .send({ hostname: 'host-a', pid: 123, project_id: null, worker_number: 1, status: 'idle' })
            .expect(200);
        expect(pool.query).toHaveBeenCalledWith(
            expect.stringContaining('IS NOT DISTINCT FROM'),
            expect.arrayContaining([null, 'host-a', 1])
        );
    });

    it('worker de-registration with a null project_id uses a NULL-safe WHERE clause', async () => {
        vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] }); // DELETE workers
        await request(app)
            .delete('/worker')
            .send({ hostname: 'host-a', worker_number: 1 })
            .expect(200);
        expect(pool.query).toHaveBeenCalledWith(
            expect.stringContaining('IS NOT DISTINCT FROM'),
            expect.arrayContaining([null, 'host-a', 1])
        );
    });
});
