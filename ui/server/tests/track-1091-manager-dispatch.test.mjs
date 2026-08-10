// server/tests/track-1091-manager-dispatch.test.mjs
// Track 1091 Phase 1 Task 3: create-project dispatch creation, restricted
// to type: 'manager' workers.
//
// Unlike POST /api/projects/:id/dispatch (deploy) and
// POST /api/tracks/:id/dispatch (lane actions) — both of which validate the
// worker against an existing project's id — create-project has no project
// to scope to yet (that's the whole point of it). A manager worker's own
// project_id is null, so this needs its own global endpoint rather than
// reusing either project-scoped one.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { app, pool } from '../index.mjs';

vi.mock('../auth.mjs');

vi.mock('pg', () => {
    const query = vi.fn();
    const Pool = vi.fn(() => ({ query, on: vi.fn() }));
    return { default: { Pool }, Pool };
});

describe('POST /api/dispatch/create-project', () => {
    beforeEach(() => vi.resetAllMocks());

    it('enqueues a create-project dispatch (track_number: null) for a manager-type worker', async () => {
        vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ id: 42, type: 'manager' }] }); // worker lookup
        vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ id: 99 }], rowCount: 1 }); // insert

        const payload = { repo_source: { type: 'path', value: '/tmp/new-project' }, scaffold_context: { project: { name: 'new-project' } } };
        const res = await request(app)
            .post('/api/dispatch/create-project')
            .send({ worker_id: 42, payload })
            .expect(200);

        expect(res.body.ok).toBe(true);
        expect(res.body.id).toBe(99);
        expect(pool.query).toHaveBeenLastCalledWith(
            expect.stringContaining('INSERT INTO worker_dispatch'),
            [42, null, 'create-project', JSON.stringify(payload)]
        );
    });

    it('requires worker_id', async () => {
        const res = await request(app)
            .post('/api/dispatch/create-project')
            .send({ payload: { repo_source: { type: 'path', value: '/tmp/x' } } })
            .expect(400);
        expect(res.body.error).toMatch(/worker_id/i);
    });

    it('requires payload.repo_source', async () => {
        const res = await request(app)
            .post('/api/dispatch/create-project')
            .send({ worker_id: 42, payload: {} })
            .expect(400);
        expect(res.body.error).toMatch(/repo_source/i);
    });

    it('returns 404 when worker_id does not exist', async () => {
        vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] });
        const res = await request(app)
            .post('/api/dispatch/create-project')
            .send({ worker_id: 999, payload: { repo_source: { type: 'path', value: '/tmp/x' } } })
            .expect(404);
        expect(res.body.error).toMatch(/worker/i);
    });

    it('rejects a worker whose type is not "manager" — the core Phase 1 guarantee', async () => {
        vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ id: 10, type: 'project' }] });
        const res = await request(app)
            .post('/api/dispatch/create-project')
            .send({ worker_id: 10, payload: { repo_source: { type: 'path', value: '/tmp/x' } } })
            .expect(400);
        expect(res.body.error).toMatch(/manager/i);
    });
});
