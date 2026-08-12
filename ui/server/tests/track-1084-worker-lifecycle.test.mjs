// server/tests/track-1084-worker-lifecycle.test.mjs
// Track 1084 Phase 6: per-worker lifecycle control.
//
// Until now the only stop control was project-wide ("Stop All Workers",
// which shells out to `make lc-stop`), so there was no way to stop worker
// #2 while leaving #1 running — even though this track's Phase 0 made
// multiple workers per project a fully-supported case via --worker-number.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { app, pool } from '../index.mjs';

vi.mock('../auth.mjs');

const execAsyncMock = vi.hoisted(() => vi.fn());
vi.mock('child_process', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, exec: (cmd, opts, cb) => execAsyncMock(cmd, opts, cb) };
});

vi.mock('pg', () => {
    const query = vi.fn();
    const Pool = vi.fn(() => ({ query, on: vi.fn() }));
    return { default: { Pool }, Pool };
});

describe('POST /api/workers/:id/stop', () => {
    beforeEach(() => vi.resetAllMocks());

    it('stops one specific worker by its worker_number, in its own project directory', async () => {
        vi.mocked(pool.query).mockResolvedValueOnce({
            rows: [{ id: 7, worker_number: 2, type: 'project', repo_path: '/home/me/Code/proj' }],
        });
        execAsyncMock.mockImplementation((cmd, opts, cb) => cb(null, { stdout: 'stopped', stderr: '' }));

        const res = await request(app).post('/api/workers/7/stop').expect(200);
        expect(res.body.ok).toBe(true);

        const [cmd, opts] = execAsyncMock.mock.calls[0];
        // Must target THIS worker, not every worker in the project.
        expect(cmd).toContain('--worker-number 2');
        expect(cmd).not.toContain('lc-stop');
        expect(opts.cwd).toBe('/home/me/Code/proj');
    });

    it('stops a manager worker via --manager, which has no project directory', async () => {
        vi.mocked(pool.query).mockResolvedValueOnce({
            rows: [{ id: 9, worker_number: 1, type: 'manager', repo_path: null }],
        });
        execAsyncMock.mockImplementation((cmd, opts, cb) => cb(null, { stdout: 'stopped', stderr: '' }));

        const res = await request(app).post('/api/workers/9/stop').expect(200);
        expect(res.body.ok).toBe(true);
        expect(execAsyncMock.mock.calls[0][0]).toContain('--manager');
    });

    it('404s for an unknown worker', async () => {
        vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] });
        const res = await request(app).post('/api/workers/999/stop').expect(404);
        expect(res.body.error).toMatch(/worker/i);
    });
});
