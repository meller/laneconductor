// server/tests/track-10011-providers.test.mjs
// Track 10011: New Worker Providers Support.
//
// Covers the server-side observable behavior of the provider registry
// rollout: POST /workers/start-new forwarding cli/model (mirrors the
// execFile-mocking approach in track-1091-manager-start.test.mjs, since
// this endpoint reaches a real command execution the same way), and
// POST /track/:num/comment accepting every registry provider as an author
// instead of silently downgrading Copilot/Antigravity comments to 'human'.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

const execFileMock = vi.fn((...callArgs) => {
    const cb = callArgs.find(a => typeof a === 'function');
    if (!cb) return; // see track-1091-manager-start.test.mjs's identical note
    process.nextTick(() => cb(null, { stdout: 'started\n', stderr: '' }));
});

vi.mock('child_process', async importOriginal => {
    const actual = await importOriginal();
    return { ...actual, execFile: (...args) => execFileMock(...args) };
});

vi.mock('../auth.mjs');

vi.mock('pg', () => {
    const query = vi.fn();
    const Pool = vi.fn(() => ({ query, on: vi.fn() }));
    return { default: { Pool }, Pool };
});

import { app, pool } from '../index.mjs';

describe('POST /api/projects/:id/workers/start-new', () => {
    beforeEach(() => {
        execFileMock.mockClear();
        vi.mocked(pool.query).mockReset();
    });

    it('TC-26: forwards cli/model from the request body into the spawned lc start args', async () => {
        vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ repo_path: '/repo' }] }); // project lookup
        vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ max_num: 1 }] }); // next worker number

        await request(app)
            .post('/api/projects/1/workers/start-new')
            .send({ cli: 'gemini', model: 'gemini-2.5-pro' })
            .expect(200);

        const [cmd, args] = execFileMock.mock.calls[0];
        expect(cmd).toBe('lc');
        expect(args).toEqual(['start', '--worker-number', '2', '--cli', 'gemini', '--model', 'gemini-2.5-pro']);
    });

    it('TC-27: omits --cli/--model entirely when not provided — no regression for existing callers', async () => {
        vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ repo_path: '/repo' }] });
        vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ max_num: 0 }] });

        await request(app)
            .post('/api/projects/1/workers/start-new')
            .send({})
            .expect(200);

        const [cmd, args] = execFileMock.mock.calls[0];
        expect(cmd).toBe('lc');
        expect(args).toEqual(['start', '--worker-number', '1']);
    });
});

describe('POST /track/:num/comment — author validation', () => {
    beforeEach(() => vi.mocked(pool.query).mockReset());

    it('TC-15: accepts author antigravity and persists it, not downgraded to human', async () => {
        vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ id: 101 }] }); // track id lookup
        vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ id: 1, author: 'antigravity', body: 'hi' }] }); // insert

        const res = await request(app)
            .post('/track/001/comment?project_id=1')
            .send({ author: 'antigravity', body: 'hi' })
            .expect(201);

        expect(res.body.author).toBe('antigravity');
        expect(pool.query).toHaveBeenNthCalledWith(
            2,
            expect.stringContaining('INSERT INTO track_comments'),
            [101, 'antigravity', 'hi', false]
        );
    });

    it('TC-16: accepts author copilot and persists it', async () => {
        vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ id: 101 }] });
        vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ id: 2, author: 'copilot', body: 'hi' }] });

        const res = await request(app)
            .post('/track/001/comment?project_id=1')
            .send({ author: 'copilot', body: 'hi' })
            .expect(201);

        expect(res.body.author).toBe('copilot');
    });

    it('normalizes the legacy agy alias to antigravity before storing', async () => {
        vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ id: 101 }] });
        vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ id: 3, author: 'antigravity', body: 'hi' }] });

        await request(app)
            .post('/track/001/comment?project_id=1')
            .send({ author: 'agy', body: 'hi' })
            .expect(201);

        expect(pool.query).toHaveBeenNthCalledWith(
            2,
            expect.stringContaining('INSERT INTO track_comments'),
            [101, 'antigravity', 'hi', false]
        );
    });

    it('still downgrades a genuinely unrecognized author to human', async () => {
        vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ id: 101 }] });
        vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ id: 4, author: 'human', body: 'hi' }] });

        const res = await request(app)
            .post('/track/001/comment?project_id=1')
            .send({ author: 'not-a-real-provider', body: 'hi' })
            .expect(201);

        expect(res.body.author).toBe('human');
    });
});

describe('legacy agy normalization — the forward-migration point', () => {
    beforeEach(() => vi.mocked(pool.query).mockReset());

    it('TC-13: PATCH /api/workers/:id/config with cli:agy stores cli:antigravity', async () => {
        vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ id: 5, project_id: 10, type: 'worker' }] }); // SELECT worker
        vi.mocked(pool.query).mockResolvedValueOnce({ rowCount: 1 }); // UPDATE
        vi.mocked(pool.query).mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 42 }] }); // INSERT worker_dispatch

        const res = await request(app)
            .patch('/api/workers/5/config')
            .send({ cli: 'agy', model: 'auto' })
            .expect(200);

        expect(res.body).toMatchObject({ cli: 'antigravity', model: 'auto' });
        expect(pool.query).toHaveBeenNthCalledWith(
            2,
            expect.stringContaining('UPDATE workers SET cli = $1, model = $2'),
            ['antigravity', 'auto', '5']
        );
    });

    it('TC-14: POST /worker/register with cli:agy stores cli:antigravity in the workers table', async () => {
        vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ machine_token: 'tok' }] }); // SELECT machine_token
        vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ id: 7 }] }); // INSERT workers

        await request(app)
            .post('/worker/register')
            .send({ project_id: 10, hostname: 'h', pid: 1, mode: 'sync+poll', cli: 'agy', model: 'auto' })
            .expect(200);

        expect(pool.query).toHaveBeenNthCalledWith(
            2,
            expect.stringContaining('INSERT INTO workers'),
            expect.arrayContaining(['antigravity', 'auto'])
        );
    });

    it('PATCH /worker/heartbeat with cli:agy stores cli:antigravity', async () => {
        vi.mocked(pool.query).mockResolvedValueOnce({ rowCount: 1 }); // UPDATE workers

        await request(app)
            .patch('/worker/heartbeat')
            .send({ hostname: 'h', pid: 1, project_id: 10, cli: 'agy' })
            .expect(200);

        expect(pool.query).toHaveBeenNthCalledWith(
            1,
            expect.stringContaining('UPDATE workers SET'),
            expect.arrayContaining(['antigravity'])
        );
    });
});
