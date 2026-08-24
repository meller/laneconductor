// server/tests/track-1089-manager-provision-dispatch.test.mjs
// Track 1089 Phase 6: provision-worker dispatch, restricted to type: 'manager'
// workers, same reasoning as track 1091's create-project dispatch — a
// manager's own project_id is always null, so the existing project-scoped
// POST /api/projects/:id/dispatch can never validate it (that endpoint
// requires the dispatched-to worker to belong to the given project).
//
// Redesigned 2026-08-12: no SSH. The chosen manager IS the machine choice
// (machine-level singleton) and starts the worker locally, resolving the
// project folder from its own --projects-dir — so no host/path is sent.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { app, pool } from '../index.mjs';

vi.mock('../auth.mjs');

vi.mock('pg', () => {
    const query = vi.fn();
    const Pool = vi.fn(() => ({ query, on: vi.fn() }));
    return { default: { Pool }, Pool };
});

describe('POST /api/dispatch/provision-worker', () => {
    beforeEach(() => vi.resetAllMocks());

    it('enqueues a provision-worker dispatch (track_number: null) for a manager-type worker', async () => {
        vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ id: 42, type: 'manager' }] }); // worker lookup
        vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ id: 99 }], rowCount: 1 }); // insert

        const payload = { project_name: 'macrodash', project_id: 94, worker_number: 2, cli: 'claude', model: 'sonnet' };
        const res = await request(app)
            .post('/api/dispatch/provision-worker')
            .send({ worker_id: 42, payload })
            .expect(200);

        expect(res.body.ok).toBe(true);
        expect(res.body.id).toBe(99);
        expect(pool.query).toHaveBeenLastCalledWith(
            expect.stringContaining('INSERT INTO worker_dispatch'),
            [42, null, 'provision-worker', JSON.stringify(payload)]
        );
    });

    it('requires worker_id', async () => {
        const res = await request(app)
            .post('/api/dispatch/provision-worker')
            .send({ payload: { project_name: 'macrodash', worker_number: 1 } })
            .expect(400);
        expect(res.body.error).toMatch(/worker_id/i);
    });

    it('requires payload.project_name — the manager resolves the folder from it', async () => {
        const res = await request(app)
            .post('/api/dispatch/provision-worker')
            .send({ worker_id: 42, payload: { worker_number: 1 } })
            .expect(400);
        expect(res.body.error).toMatch(/project_name/i);
    });

    it('returns 404 when worker_id does not exist', async () => {
        vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] });
        const res = await request(app)
            .post('/api/dispatch/provision-worker')
            .send({ worker_id: 999, payload: { project_name: 'macrodash', worker_number: 1 } })
            .expect(404);
        expect(res.body.error).toMatch(/worker/i);
    });

    it('rejects a worker whose type is not "manager"', async () => {
        vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ id: 10, type: 'project' }] });
        const res = await request(app)
            .post('/api/dispatch/provision-worker')
            .send({ worker_id: 10, payload: { project_name: 'macrodash', worker_number: 1 } })
            .expect(400);
        expect(res.body.error).toMatch(/manager/i);
    });
});
