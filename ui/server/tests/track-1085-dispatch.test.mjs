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
            .mockResolvedValueOnce({ rows: [{ id: 7 }], rowCount: 1 }); // INSERT ... WHERE EXISTS(worker in project)

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

    it('rejects a worker_id that does not belong to the track\'s project', async () => {
        vi.mocked(pool.query)
            .mockResolvedValueOnce({ rows: [{ id: 42, project_id: 1, track_number: '001', lane_status: 'implement' }] }) // track lookup
            .mockResolvedValueOnce({ rows: [], rowCount: 0 }); // INSERT ... WHERE EXISTS(...) matched nothing

        const res = await request(app)
            .post('/api/tracks/42/dispatch')
            .send({ worker_id: 999, action: 'implement' })
            .expect(400);

        expect(res.body.error).toMatch(/worker/i);
    });
});

describe('POST /api/projects/:id/dispatch — enqueue a deploy dispatch', () => {
    beforeEach(() => vi.resetAllMocks());

    it('enqueues a project-scoped (track_number: null) deploy dispatch', async () => {
        vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ id: 8 }], rowCount: 1 });

        const res = await request(app)
            .post('/api/projects/1/dispatch')
            .send({ worker_id: 10, action: 'deploy', payload: { environment: 'prod' } })
            .expect(200);

        expect(res.body.ok).toBe(true);
        expect(pool.query).toHaveBeenCalledWith(
            expect.stringContaining('INSERT INTO worker_dispatch'),
            [10, null, 'deploy', JSON.stringify({ environment: 'prod' }), '1']
        );
    });

    it('requires payload.environment for deploy', async () => {
        const res = await request(app)
            .post('/api/projects/1/dispatch')
            .send({ worker_id: 10, action: 'deploy', payload: {} })
            .expect(400);
        expect(res.body.error).toMatch(/environment/i);
    });

    it('rejects a worker_id that does not belong to this project', async () => {
        vi.mocked(pool.query).mockResolvedValueOnce({ rows: [], rowCount: 0 });

        const res = await request(app)
            .post('/api/projects/1/dispatch')
            .send({ worker_id: 999, action: 'deploy', payload: { environment: 'prod' } })
            .expect(400);

        expect(res.body.error).toMatch(/worker/i);
    });
});

describe('GET /api/tracks/:id/dispatch — dispatch history for a track', () => {
    beforeEach(() => vi.resetAllMocks());

    it('returns dispatch history scoped to the track\'s own project, newest first', async () => {
        vi.mocked(pool.query)
            .mockResolvedValueOnce({ rows: [{ id: 42, project_id: 1, track_number: '001' }] }) // track lookup
            .mockResolvedValueOnce({ rows: [{ id: 5, action: 'implement', status: 'done' }] }); // history

        const res = await request(app).get('/api/tracks/42/dispatch').expect(200);

        expect(res.body).toEqual([{ id: 5, action: 'implement', status: 'done' }]);
        expect(pool.query).toHaveBeenLastCalledWith(
            expect.stringContaining('ORDER BY wd.created_at DESC'),
            ['001', 1]
        );
    });

    it('404s when the track does not exist', async () => {
        vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] });
        const res = await request(app).get('/api/tracks/999/dispatch').expect(404);
        expect(res.body.error).toMatch(/not found/i);
    });
});

describe('GET /api/projects/:id/dispatch — deploy dispatch history for a project', () => {
    beforeEach(() => vi.resetAllMocks());

    it('returns project-scoped (track_number IS NULL) dispatch entries, newest first', async () => {
        vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ id: 9, action: 'deploy', status: 'done' }] });

        const res = await request(app).get('/api/projects/1/dispatch').expect(200);

        expect(res.body).toEqual([{ id: 9, action: 'deploy', status: 'done' }]);
        expect(pool.query).toHaveBeenCalledWith(
            expect.stringContaining('track_number IS NULL'),
            ['1']
        );
    });
});

describe('GET /api/projects/:id/deploy-environments', () => {
    beforeEach(() => vi.resetAllMocks());

    it('lists environment names from the project\'s conductor/deploy.json', async () => {
        vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ repo_path: '/tmp/does-not-exist-for-mocked-fs-test' }] });

        const res = await request(app).get('/api/projects/1/deploy-environments').expect(200);

        // No real deploy.json on disk at this fake path — empty list, not an error.
        expect(res.body.environments).toEqual([]);
    });

    it('404s when the project does not exist', async () => {
        vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] });
        const res = await request(app).get('/api/projects/999/deploy-environments').expect(404);
        expect(res.body.error).toMatch(/not found/i);
    });
});
