// server/tests/track-1087-chat-history.test.mjs
// Track 1087 Phase 8: chat history survives a page refresh.
//
// The turns were always persisted — worker_dispatch holds the prompt in
// payload.prompt and the reply in result — but the Activity panel kept
// them in React state only, so a refresh appeared to lose the whole
// conversation. This endpoint lets the panel re-read a worker's own chat
// turns on mount. Deliberately worker-scoped, not project-scoped like
// GET /api/projects/:id/dispatch, which mixes in deploys and can't
// address a manager worker at all (its project_id is null).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { app, pool } from '../index.mjs';

vi.mock('../auth.mjs');

vi.mock('pg', () => {
    const query = vi.fn();
    const Pool = vi.fn(() => ({ query, on: vi.fn() }));
    return { default: { Pool }, Pool };
});

describe('GET /api/workers/:id/chat-history', () => {
    beforeEach(() => vi.resetAllMocks());

    it('returns that worker\'s chat turns, oldest first so they read as a conversation', async () => {
        vi.mocked(pool.query).mockResolvedValueOnce({
            rows: [
                { id: 1, action: 'worker_adhoc_chat', status: 'done', result: 'pong', payload: { prompt: 'ping' }, created_at: new Date() },
                { id: 2, action: 'track_chat', status: 'done', result: 'it is fine', payload: { prompt: 'status?' }, created_at: new Date() },
            ],
        });

        const res = await request(app).get('/api/workers/42/chat-history').expect(200);

        expect(res.body).toHaveLength(2);
        expect(res.body[0].payload.prompt).toBe('ping');
        expect(res.body[0].result).toBe('pong');

        const [sql, params] = vi.mocked(pool.query).mock.calls[0];
        expect(sql).toContain('worker_adhoc_chat');
        expect(sql).toContain('track_chat');
        expect(params).toEqual([42, 20]);
    });

    it('accepts a limit', async () => {
        vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] });
        await request(app).get('/api/workers/42/chat-history?limit=5').expect(200);
        expect(vi.mocked(pool.query).mock.calls[0][1]).toEqual([42, 5]);
    });

    it('returns an empty list for a worker that has never been chatted with', async () => {
        vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] });
        const res = await request(app).get('/api/workers/999/chat-history').expect(200);
        expect(res.body).toEqual([]);
    });
});
