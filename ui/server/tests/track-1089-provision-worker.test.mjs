// ui/server/tests/track-1089-provision-worker.test.mjs
// Track 1089: Remote Worker Provisioning API and Dispatch tests

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { app, pool } from '../index.mjs';

vi.mock('../auth.mjs');

vi.mock('pg', () => {
    const query = vi.fn();
    const Pool = vi.fn(() => ({ query, on: vi.fn() }));
    return { default: { Pool }, Pool };
});

describe('Track 1089: Provisioning Targets & Dispatch', () => {
    beforeEach(() => vi.resetAllMocks());

    describe('GET /api/projects/:id/provision-targets', () => {
        it('lists provision targets for a project', async () => {
            const mockTargets = [
                { id: 1, project_id: 10, host: '192.168.1.50', label: 'Staging Server', created_at: new Date().toISOString() }
            ];
            vi.mocked(pool.query).mockResolvedValueOnce({ rows: mockTargets });

            const res = await request(app)
                .get('/api/projects/10/provision-targets')
                .expect(200);

            expect(res.body).toEqual(mockTargets);
            expect(pool.query).toHaveBeenCalledWith(
                expect.stringContaining('SELECT * FROM provision_targets WHERE project_id = $1'),
                ['10']
            );
        });
    });

    describe('POST /api/projects/:id/provision-targets', () => {
        it('creates or updates a provision target', async () => {
            const mockTarget = { id: 1, project_id: 10, host: '192.168.1.50', label: 'Staging Server' };
            vi.mocked(pool.query).mockResolvedValueOnce({ rows: [mockTarget] });

            const res = await request(app)
                .post('/api/projects/10/provision-targets')
                .send({ host: '192.168.1.50', label: 'Staging Server' })
                .expect(201);

            expect(res.body).toEqual(mockTarget);
            expect(pool.query).toHaveBeenCalledWith(
                expect.stringContaining('INSERT INTO provision_targets'),
                ['10', 'test-user-uid', '192.168.1.50', 'Staging Server']
            );
        });

        it('validates host is required', async () => {
            const res = await request(app)
                .post('/api/projects/10/provision-targets')
                .send({ label: 'No host' })
                .expect(400);

            expect(res.body.error).toMatch(/host is required/i);
        });
    });

    describe('DELETE /api/projects/:id/provision-targets/:targetId', () => {
        it('deletes a provision target', async () => {
            vi.mocked(pool.query).mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 5 }] });

            const res = await request(app)
                .delete('/api/projects/10/provision-targets/5')
                .expect(200);

            expect(res.body).toEqual({ success: true, id: 5 });
        });

        it('returns 404 if target to delete is not found', async () => {
            vi.mocked(pool.query).mockResolvedValueOnce({ rowCount: 0, rows: [] });

            const res = await request(app)
                .delete('/api/projects/10/provision-targets/99')
                .expect(404);

            expect(res.body.error).toMatch(/target not found/i);
        });
    });

    describe('POST /api/projects/:id/dispatch with action=provision-worker', () => {
        it('enqueues a provision-worker dispatch entry when target host exists', async () => {
            // 1. target host check
            vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ id: 1 }] });
            // 2. dispatch insert
            vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ id: 101 }], rowCount: 1 });

            const payload = { target_host: '192.168.1.50', worker_number: 2 };
            const res = await request(app)
                .post('/api/projects/10/dispatch')
                .send({ worker_id: 3, action: 'provision-worker', payload })
                .expect(200);

            expect(res.body).toEqual({ ok: true, id: 101 });
            expect(pool.query).toHaveBeenLastCalledWith(
                expect.stringContaining('INSERT INTO worker_dispatch'),
                [3, null, 'provision-worker', JSON.stringify(payload), '10']
            );
        });

        it('rejects provision-worker dispatch if payload.target_host is missing', async () => {
            const res = await request(app)
                .post('/api/projects/10/dispatch')
                .send({ worker_id: 3, action: 'provision-worker', payload: {} })
                .expect(400);

            expect(res.body.error).toMatch(/target_host is required/i);
        });

        it('rejects provision-worker dispatch if target_host is not registered in provision_targets', async () => {
            vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] }); // no target found

            const res = await request(app)
                .post('/api/projects/10/dispatch')
                .send({ worker_id: 3, action: 'provision-worker', payload: { target_host: 'unknown.host' } })
                .expect(400);

            expect(res.body.error).toMatch(/not a registered provision target/i);
        });
    });
});
