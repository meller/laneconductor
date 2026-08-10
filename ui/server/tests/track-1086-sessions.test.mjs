// server/tests/track-1086-sessions.test.mjs
// Track 1086 Phase 2: track_sessions lookup/upsert endpoints, called by the
// worker's buildCliArgs before spawning claude, to select --session-id
// (fresh) vs --resume (existing).
//
// Covers:
//   - GET /track/:num/session: returns the existing session for the calling
//     worker (via collectorAuth's req.worker_id), or null if none
//   - POST /track/:num/session: upserts (insert on first call, update
//     last_used_at on subsequent calls with the same session id)
//   - DELETE /track/:num/session (Track 1086 Phase 4): invalidates a
//     session after a detected resume-failure, so the next attempt cold-
//     starts instead of retrying the same broken --resume forever
//   - All three require worker identity (req.worker_id) — no anonymous
//     fallback, a session belongs to a specific worker

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

function mockMachineTokenAuth(workerId, projectId = 1) {
    vi.mocked(pool.query).mockResolvedValueOnce({
        rows: [{ id: workerId, project_id: projectId, user_uid: null, visibility: 'private' }],
    });
}

describe('GET /track/:num/session', () => {
    beforeEach(() => vi.resetAllMocks());

    it('returns the existing session for this worker', async () => {
        mockMachineTokenAuth(7);
        vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ claude_session_id: 'abc-123' }] });

        const res = await request(app)
            .get('/track/001/session')
            .set('Authorization', 'Bearer mtoken-abc')
            .expect(200);

        expect(res.body.claude_session_id).toBe('abc-123');
        expect(pool.query).toHaveBeenLastCalledWith(
            'SELECT claude_session_id FROM track_sessions WHERE track_number = $1 AND worker_id = $2',
            ['001', 7]
        );
    });

    it('returns null when no session exists yet', async () => {
        mockMachineTokenAuth(7);
        vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] });

        const res = await request(app)
            .get('/track/001/session')
            .set('Authorization', 'Bearer mtoken-abc')
            .expect(200);

        expect(res.body.claude_session_id).toBeNull();
    });

    it('requires worker identity — 400 without a resolvable worker', async () => {
        const res = await request(app).get('/track/001/session').expect(400);
        expect(res.body.error).toMatch(/worker/i);
    });
});

describe('POST /track/:num/session', () => {
    beforeEach(() => vi.resetAllMocks());

    it('upserts a session (insert on first call)', async () => {
        mockMachineTokenAuth(7);
        vi.mocked(pool.query).mockResolvedValueOnce({ rowCount: 1 });

        const res = await request(app)
            .post('/track/001/session')
            .set('Authorization', 'Bearer mtoken-abc')
            .send({ claude_session_id: 'new-uuid-here' })
            .expect(200);

        expect(res.body.ok).toBe(true);
        expect(pool.query).toHaveBeenLastCalledWith(
            expect.stringContaining('ON CONFLICT'),
            ['001', 7, 'new-uuid-here']
        );
    });

    it('requires claude_session_id', async () => {
        mockMachineTokenAuth(7);
        const res = await request(app)
            .post('/track/001/session')
            .set('Authorization', 'Bearer mtoken-abc')
            .send({})
            .expect(400);
        expect(res.body.error).toMatch(/claude_session_id/i);
    });

    it('requires worker identity', async () => {
        const res = await request(app)
            .post('/track/001/session')
            .send({ claude_session_id: 'x' })
            .expect(400);
        expect(res.body.error).toMatch(/worker/i);
    });
});

describe('DELETE /track/:num/session (Track 1086 Phase 4)', () => {
    beforeEach(() => vi.resetAllMocks());

    it('deletes the session for this worker', async () => {
        mockMachineTokenAuth(7);
        vi.mocked(pool.query).mockResolvedValueOnce({ rowCount: 1 });

        const res = await request(app)
            .delete('/track/001/session')
            .set('Authorization', 'Bearer mtoken-abc')
            .expect(200);

        expect(res.body.ok).toBe(true);
        expect(pool.query).toHaveBeenLastCalledWith(
            'DELETE FROM track_sessions WHERE track_number = $1 AND worker_id = $2',
            ['001', 7]
        );
    });

    it('is a no-op (still 200) when there was nothing to delete', async () => {
        mockMachineTokenAuth(7);
        vi.mocked(pool.query).mockResolvedValueOnce({ rowCount: 0 });

        const res = await request(app)
            .delete('/track/001/session')
            .set('Authorization', 'Bearer mtoken-abc')
            .expect(200);

        expect(res.body.ok).toBe(true);
    });

    it('requires worker identity', async () => {
        const res = await request(app).delete('/track/001/session').expect(400);
        expect(res.body.error).toMatch(/worker/i);
    });
});
