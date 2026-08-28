// server/tests/track-10037-worker-last-track.test.mjs
// Track 10037 Phase 1: GET /api/workers and GET /api/projects/:id/workers
// enrich each worker row with last_track_number/last_track_used_at (from a
// LEFT JOIN LATERAL on track_sessions, newest last_used_at first) and
// last_track_project_id (the worker's own project_id — track_sessions has
// no project column of its own).

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

describe('GET /api/projects/:id/workers — last-context track (REQ-4)', () => {
    beforeEach(() => vi.resetAllMocks());

    it('returns last_track_number from the newest track_sessions row', async () => {
        vi.mocked(pool.query).mockResolvedValueOnce({
            rows: [{
                id: 7, hostname: 'h1', project_id: 1, project_name: 'proj',
                last_track_project_id: 1, last_track_number: '10036', last_track_used_at: '2026-08-26T10:12:00Z',
            }],
        });

        const res = await request(app).get('/api/projects/1/workers').expect(200);
        expect(res.body[0].last_track_number).toBe('10036');
        expect(res.body[0].last_track_project_id).toBe(1);
    });

    it('returns null last_track_number for a worker with no sessions', async () => {
        vi.mocked(pool.query).mockResolvedValueOnce({
            rows: [{
                id: 8, hostname: 'h2', project_id: 1, project_name: 'proj',
                last_track_project_id: 1, last_track_number: null, last_track_used_at: null,
            }],
        });

        const res = await request(app).get('/api/projects/1/workers').expect(200);
        expect(res.body[0].last_track_number).toBeNull();
    });

    it('SQL joins track_sessions via LEFT JOIN LATERAL scoped to worker_id', async () => {
        vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] });
        await request(app).get('/api/projects/1/workers').expect(200);
        const [sql] = vi.mocked(pool.query).mock.calls[0];
        expect(sql).toMatch(/LEFT JOIN LATERAL/);
        expect(sql).toMatch(/track_sessions/);
        expect(sql).toMatch(/ORDER BY last_used_at DESC/);
    });
});

describe('GET /api/workers — last-context track (REQ-4)', () => {
    beforeEach(() => vi.resetAllMocks());

    it('returns last_track_number across all projects', async () => {
        vi.mocked(pool.query).mockResolvedValueOnce({
            rows: [{
                id: 9, hostname: 'h3', project_id: 2, project_name: 'proj2',
                last_track_project_id: 2, last_track_number: '5001', last_track_used_at: '2026-08-26T09:00:00Z',
            }],
        });

        const res = await request(app).get('/api/workers').expect(200);
        expect(res.body[0].last_track_number).toBe('5001');
        expect(res.body[0].last_track_project_id).toBe(2);
    });
});
