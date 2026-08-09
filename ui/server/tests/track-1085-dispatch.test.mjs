// server/tests/track-1085-dispatch.test.mjs
// Track 1085 Phase 2/3: worker_dispatch inbox endpoints.
//
// Covers:
//   - GET /worker/:id/dispatch: pending entries for a worker, oldest first
//   - PATCH /worker-dispatch/:id: status transitions (claimed/done/failed)
//   - POST /api/tracks/:id/dispatch: enqueue a track-scoped (lane action) dispatch
//   - POST /api/projects/:id/dispatch: enqueue a project-scoped (deploy) dispatch

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { app, pool } from '../index.mjs';

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

describe('GET /worker/:id/dispatch', () => {
    beforeEach(() => vi.resetAllMocks());

    it('returns pending entries for the worker, oldest first', async () => {
        const entries = [
            { id: 1, worker_id: 5, track_number: '001', action: 'implement', payload: null, status: 'pending' },
            { id: 2, worker_id: 5, track_number: null, action: 'deploy', payload: { environment: 'prod' }, status: 'pending' },
        ];
        vi.mocked(pool.query).mockResolvedValueOnce({ rows: entries });

        const res = await request(app).get('/worker/5/dispatch').expect(200);

        expect(res.body.entries).toEqual(entries);
        expect(pool.query).toHaveBeenCalledWith(
            "SELECT * FROM worker_dispatch WHERE worker_id = $1 AND status = 'pending' ORDER BY created_at ASC",
            ['5']
        );
    });

    it('returns an empty list when there are no pending entries', async () => {
        vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] });
        const res = await request(app).get('/worker/5/dispatch').expect(200);
        expect(res.body.entries).toEqual([]);
    });
});

describe('PATCH /worker-dispatch/:id', () => {
    beforeEach(() => vi.resetAllMocks());

    it('rejects an invalid status', async () => {
        const res = await request(app)
            .patch('/worker-dispatch/1')
            .send({ status: 'bogus' })
            .expect(400);
        expect(res.body.error).toMatch(/status/i);
    });

    it('marks an entry claimed and sets claimed_at', async () => {
        vi.mocked(pool.query).mockResolvedValueOnce({ rowCount: 1 });

        await request(app).patch('/worker-dispatch/1').send({ status: 'claimed' }).expect(200);

        expect(pool.query).toHaveBeenCalledWith(
            expect.stringContaining('claimed_at = NOW()'),
            expect.arrayContaining(['claimed', '1'])
        );
    });

    it('marks an entry done', async () => {
        vi.mocked(pool.query).mockResolvedValueOnce({ rowCount: 1 });
        await request(app).patch('/worker-dispatch/1').send({ status: 'done' }).expect(200);
        expect(pool.query).toHaveBeenCalled();
    });

    it('marks an entry failed with an optional result message', async () => {
        vi.mocked(pool.query).mockResolvedValueOnce({ rowCount: 1 });
        await request(app).patch('/worker-dispatch/1').send({ status: 'failed', result: 'no provider available' }).expect(200);
        expect(pool.query).toHaveBeenCalledWith(
            expect.any(String),
            expect.arrayContaining(['failed', 'no provider available', '1'])
        );
    });

    it('404s when the dispatch entry does not exist', async () => {
        vi.mocked(pool.query).mockResolvedValueOnce({ rowCount: 0 });
        const res = await request(app).patch('/worker-dispatch/999').send({ status: 'done' }).expect(404);
        expect(res.body.error).toMatch(/not found/i);
    });
});

describe('POST /api/tracks/:id/dispatch — enqueue a lane-action dispatch', () => {
    beforeEach(() => vi.resetAllMocks());

    it('validates the action against the track\'s current lane and enqueues a pending entry', async () => {
        vi.mocked(pool.query)
            .mockResolvedValueOnce({ rows: [{ id: 42, project_id: 1, track_number: '001', lane_status: 'implement' }] }) // track lookup
            .mockResolvedValueOnce({ rows: [{ id: 7 }] }); // INSERT worker_dispatch

        const res = await request(app)
            .post('/api/tracks/42/dispatch')
            .send({ worker_id: 10, action: 'implement' })
            .expect(200);

        expect(res.body.ok).toBe(true);
        expect(res.body.id).toBe(7);
    });

    it('rejects an action that does not match the track\'s current lane', async () => {
        vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ id: 42, project_id: 1, track_number: '001', lane_status: 'review' }] });

        const res = await request(app)
            .post('/api/tracks/42/dispatch')
            .send({ worker_id: 10, action: 'implement' })
            .expect(400);

        expect(res.body.error).toMatch(/lane/i);
    });

    it('404s when the track does not exist', async () => {
        vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] });
        const res = await request(app)
            .post('/api/tracks/999/dispatch')
            .send({ worker_id: 10, action: 'implement' })
            .expect(404);
        expect(res.body.error).toMatch(/not found/i);
    });

    it('requires worker_id and action', async () => {
        const res = await request(app).post('/api/tracks/42/dispatch').send({}).expect(400);
        expect(res.body.error).toBeTruthy();
    });
});

describe('POST /api/projects/:id/dispatch — enqueue a deploy dispatch', () => {
    beforeEach(() => vi.resetAllMocks());

    it('enqueues a project-scoped (track_number: null) deploy dispatch', async () => {
        vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ id: 8 }] }); // INSERT worker_dispatch

        const res = await request(app)
            .post('/api/projects/1/dispatch')
            .send({ worker_id: 10, action: 'deploy', payload: { environment: 'prod' } })
            .expect(200);

        expect(res.body.ok).toBe(true);
        expect(pool.query).toHaveBeenCalledWith(
            expect.stringContaining('INSERT INTO worker_dispatch'),
            [10, null, 'deploy', JSON.stringify({ environment: 'prod' })]
        );
    });

    it('requires payload.environment for deploy', async () => {
        const res = await request(app)
            .post('/api/projects/1/dispatch')
            .send({ worker_id: 10, action: 'deploy', payload: {} })
            .expect(400);
        expect(res.body.error).toMatch(/environment/i);
    });
});
