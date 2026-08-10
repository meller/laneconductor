// server/tests/track-1087-deploy-log.test.mjs
// Track 1087 Phase 6 (revised — see spec.md REQ-6's 2026-08-10 correction):
// `deploy` dispatches (worker_dispatch.track_number IS NULL) have no
// structured claude session — deploy-runner.mjs runs a plain shell command
// and logs to conductor/logs/deploy-<env>-<timestamp>.log (confirmed by
// reading deploy-runner.mjs directly, not guessed). This is a raw-text log
// viewer for that file, keyed on worker_dispatch.id, not the structured
// TranscriptView/reduceStreamEvent mechanism Phase 3/4 built for claude
// sessions — there are no structured events for a deploy run.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { app, pool } from '../index.mjs';
import * as fs from 'fs';

vi.mock('../auth.mjs');

vi.mock('fs', () => ({
    readFileSync: vi.fn(),
    readdirSync: vi.fn(),
    existsSync: vi.fn(),
    statSync: vi.fn(),
}));

vi.mock('pg', () => {
    const query = vi.fn();
    const Pool = vi.fn(() => ({ query, on: vi.fn() }));
    return { default: { Pool }, Pool };
});

function mockDispatchRow(overrides = {}) {
    vi.mocked(pool.query).mockResolvedValueOnce({
        rows: [{
            id: 42,
            action: 'deploy',
            payload: { environment: 'prod' },
            repo_path: '/r',
            ...overrides,
        }],
    });
}

describe('GET /api/projects/:id/dispatch/:dispatchId/log', () => {
    beforeEach(() => vi.resetAllMocks());

    it('returns 404 when the dispatch does not exist (or belongs to another project)', async () => {
        vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] });
        const res = await request(app).get('/api/projects/1/dispatch/42/log').expect(404);
        expect(res.body.error).toMatch(/dispatch/i);
    });

    it('returns 400 for a non-deploy action — no log viewer defined for it', async () => {
        mockDispatchRow({ action: 'implement' });
        const res = await request(app).get('/api/projects/1/dispatch/42/log').expect(400);
        expect(res.body.error).toMatch(/implement/i);
    });

    it('returns log: null when payload.environment is missing', async () => {
        mockDispatchRow({ payload: {} });
        const res = await request(app).get('/api/projects/1/dispatch/42/log').expect(200);
        expect(res.body.log).toBeNull();
    });

    it('returns log: null when repo_path does not exist on disk', async () => {
        mockDispatchRow();
        vi.mocked(fs.existsSync).mockReturnValue(false);
        const res = await request(app).get('/api/projects/1/dispatch/42/log').expect(200);
        expect(res.body.log).toBeNull();
    });

    it('returns log: null when no matching deploy log file exists', async () => {
        mockDispatchRow();
        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readdirSync).mockReturnValue(['deploy-staging-111.log']); // different env
        const res = await request(app).get('/api/projects/1/dispatch/42/log').expect(200);
        expect(res.body.log).toBeNull();
    });

    it('returns the raw content of the matching deploy log file', async () => {
        mockDispatchRow();
        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readdirSync).mockReturnValue(['deploy-prod-111.log']);
        vi.mocked(fs.statSync).mockReturnValue({ mtimeMs: 111 });
        vi.mocked(fs.readFileSync).mockReturnValue('Deploying to prod...\nDone.\n');

        const res = await request(app).get('/api/projects/1/dispatch/42/log').expect(200);
        expect(res.body.log).toBe('Deploying to prod...\nDone.\n');
    });

    it('picks the most recently modified matching file when several exist', async () => {
        mockDispatchRow();
        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readdirSync).mockReturnValue(['deploy-prod-100.log', 'deploy-prod-200.log']);
        vi.mocked(fs.statSync).mockImplementation((p) => ({
            mtimeMs: String(p).includes('-200.log') ? 200 : 100,
        }));
        vi.mocked(fs.readFileSync).mockReturnValue('newest run\n');

        await request(app).get('/api/projects/1/dispatch/42/log').expect(200);
        expect(fs.readFileSync).toHaveBeenCalledWith(
            expect.stringContaining('deploy-prod-200.log'),
            'utf8'
        );
    });

    it('does not match a different environment that happens to share a prefix (prod vs production)', async () => {
        mockDispatchRow({ payload: { environment: 'prod' } });
        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readdirSync).mockReturnValue(['deploy-production-111.log']);
        const res = await request(app).get('/api/projects/1/dispatch/42/log').expect(200);
        expect(res.body.log).toBeNull();
    });
});
