// server/tests/api-keys.test.mjs
// Tests for Track 1033: API key management and worker visibility/permissions endpoints

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { app, pool } from '../index.mjs';

vi.mock('../auth.mjs');

vi.mock('pg', () => {
    const query = vi.fn();
    const Pool = vi.fn(() => ({
        query,
        on: vi.fn(),
        connect: vi.fn().mockResolvedValue({ query, release: vi.fn() })
    }));
    return { default: { Pool }, Pool };
});

describe('API Key Management (Track 1033)', () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    describe('POST /api/keys', () => {
        it('generates a new API key and returns prefix + raw key', async () => {
            vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] }); // INSERT
            const res = await request(app)
                .post('/api/keys')
                .send({ name: 'Home Desktop' });
            expect(res.status).toBe(200);
            expect(res.body.ok).toBe(true);
            expect(res.body.key).toMatch(/^lc_live_/);
            expect(res.body.key_prefix).toMatch(/^lc_live_/);
        });

        it('returns 500 on DB error', async () => {
            vi.mocked(pool.query).mockRejectedValueOnce(new Error('db error'));
            const res = await request(app).post('/api/keys').send({});
            expect(res.status).toBe(500);
        });
    });

    describe('GET /api/keys', () => {
        it('lists API keys for the authenticated user', async () => {
            const mockKeys = [
                { id: 1, key_prefix: 'lc_live_ab12', name: 'Home', created_at: new Date(), last_used_at: null }
            ];
            vi.mocked(pool.query).mockResolvedValueOnce({ rows: mockKeys });
            const res = await request(app).get('/api/keys');
            expect(res.status).toBe(200);
            expect(Array.isArray(res.body)).toBe(true);
            expect(res.body[0].key_prefix).toBe('lc_live_ab12');
        });

        it('returns 500 on DB error', async () => {
            vi.mocked(pool.query).mockRejectedValueOnce(new Error('db error'));
            const res = await request(app).get('/api/keys');
            expect(res.status).toBe(500);
        });
    });

    describe('DELETE /api/keys/:id', () => {
        it('revokes an existing key', async () => {
            vi.mocked(pool.query).mockResolvedValueOnce({ rowCount: 1 });
            const res = await request(app).delete('/api/keys/1');
            expect(res.status).toBe(200);
            expect(res.body.ok).toBe(true);
        });

        it('returns 404 when key not found or not owned by user', async () => {
            vi.mocked(pool.query).mockResolvedValueOnce({ rowCount: 0 });
            const res = await request(app).delete('/api/keys/999');
            expect(res.status).toBe(404);
        });
    });

    describe('PATCH /api/workers/:id/visibility', () => {
        it('updates worker visibility to team', async () => {
            vi.mocked(pool.query).mockResolvedValueOnce({ rowCount: 1 });
            const res = await request(app)
                .patch('/api/workers/1/visibility')
                .send({ visibility: 'team' });
            expect(res.status).toBe(200);
            expect(res.body.ok).toBe(true);
        });

        it('rejects invalid visibility values', async () => {
            const res = await request(app)
                .patch('/api/workers/1/visibility')
                .send({ visibility: 'invalid' });
            expect(res.status).toBe(400);
        });

        it('returns 404 when worker not found or not owner', async () => {
            vi.mocked(pool.query).mockResolvedValueOnce({ rowCount: 0 });
            const res = await request(app)
                .patch('/api/workers/999/visibility')
                .send({ visibility: 'public' });
            expect(res.status).toBe(404);
        });
    });

    describe('Worker Permissions', () => {
        it('GET /api/workers/:id/permissions — lists team members', async () => {
            vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ id: 1 }] }); // owner check
            vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ user_uid: 'user-b', added_at: new Date() }] });
            const res = await request(app).get('/api/workers/1/permissions');
            expect(res.status).toBe(200);
            expect(res.body[0].user_uid).toBe('user-b');
        });

        it('GET /api/workers/:id/permissions — 404 if not owner', async () => {
            vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] }); // owner check returns empty
            const res = await request(app).get('/api/workers/999/permissions');
            expect(res.status).toBe(404);
        });

        it('POST /api/workers/:id/permissions — grants access to user', async () => {
            vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ id: 1 }] }); // owner check
            vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] }); // INSERT
            const res = await request(app)
                .post('/api/workers/1/permissions')
                .send({ user_uid: 'user-b' });
            expect(res.status).toBe(200);
            expect(res.body.ok).toBe(true);
        });

        it('POST /api/workers/:id/permissions — 400 if no user_uid', async () => {
            const res = await request(app)
                .post('/api/workers/1/permissions')
                .send({});
            expect(res.status).toBe(400);
        });

        it('DELETE /api/workers/:id/permissions/:uid — revokes access', async () => {
            vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ id: 1 }] }); // owner check
            vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] }); // DELETE
            const res = await request(app).delete('/api/workers/1/permissions/user-b');
            expect(res.status).toBe(200);
            expect(res.body.ok).toBe(true);
        });
    });

    describe('collectorAuth — SHA-256 API key lookup', () => {
        it('POST /worker/register with visibility field stores it in DB', async () => {
            vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] }); // SELECT existing machine_token
            vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] }); // INSERT
            const res = await request(app)
                .post('/worker/register')
                .send({ hostname: 'test-host', pid: 1234, project_id: 1, visibility: 'team' });
            expect(res.status).toBe(200);
            expect(res.body.ok).toBe(true);
            // Verify visibility was passed in the INSERT
            const insertCall = vi.mocked(pool.query).mock.calls.find(c =>
                typeof c[0] === 'string' && c[0].includes('INSERT INTO workers')
            );
            expect(insertCall).toBeTruthy();
            expect(insertCall[1]).toContain('team');
        });
    });
});
