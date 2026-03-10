import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { app, pool, runMigration, uuidV5, gitGlobalId } from '../index.mjs';
import * as fs from 'fs';

// Mock auth module — uses server/__mocks__/auth.mjs (no GCP calls, no gRPC)
vi.mock('../auth.mjs');

// Mock fetch
global.fetch = vi.fn();


// Mock fs
vi.mock('fs', () => ({
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    readdirSync: vi.fn(),
    existsSync: vi.fn()
}));

// Mock pg
vi.mock('pg', () => {
    const query = vi.fn();
    const Pool = vi.fn(() => ({
        query,
        on: vi.fn(),
    }));
    return {
        default: { Pool },
        Pool: Pool
    };
});

// Mock child_process
vi.mock('child_process', () => ({
    exec: vi.fn(),
    spawn: vi.fn(() => ({
        pid: 1234,
        unref: vi.fn(),
        on: vi.fn()
    }))
}));

describe('API Routes', () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    it('GET /api/health', async () => {
        vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ '1': 1 }] });
        await request(app).get('/api/health').expect(200);
        vi.mocked(pool.query).mockRejectedValueOnce(new Error('fail'));
        await request(app).get('/api/health').expect(503);
    });

    it('GET /api/projects', async () => {
        vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ id: 1 }] });
        await request(app).get('/api/projects').expect(200);
    });

    it('GET /api/projects/:id/tracks', async () => {
        vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ id: 1, track_number: '001' }] });
        await request(app).get('/api/projects/1/tracks').expect(200);
    });

    it('PATCH /api/projects/:id/tracks/:num', async () => {
        vi.mocked(fetch).mockResolvedValueOnce({ ok: true, text: async () => '{"ok":true}' });
        await request(app).patch('/api/projects/1/tracks/001').send({ lane_status: 'done' }).expect(200);

        // Negative case (collector failure)
        vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 404, text: async () => 'Not Found' });
        await request(app).patch('/api/projects/1/tracks/001').send({ lane_status: 'done' }).expect(404);
    });

    it('POST /api/projects/:id/tracks', async () => {
        vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ id: 1, repo_path: '/r' }] }); // proj
        vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ next_num: 1 }] }); // num
        vi.mocked(fetch).mockResolvedValueOnce({ ok: true, text: async () => '{"ok":true}' }); // collector
        vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] }); // queueFileSync INSERT
        vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ id: 1, track_number: '001' }] }); // result
        await request(app).post('/api/projects/1/tracks').send({ title: 'T' }).expect(201);
    });

    it('POST /api/projects/:id/tracks with existing file_sync_queue.md', async () => {
        vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ id: 1, repo_path: '/r' }] }); // proj
        vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ next_num: 2 }] }); // num
        vi.mocked(fetch).mockResolvedValueOnce({ ok: true, text: async () => '{"ok":true}' }); // collector
        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue('# File Sync Queue\n\nLast processed: —\n\n## Track Creation Requests\n\n## Config Sync Requests\n\n*No pending config sync requests.*\n\n## Completed Queue\n');
        vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] }); // queueFileSync INSERT
        vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ id: 2, track_number: '002' }] }); // result
        await request(app).post('/api/projects/1/tracks').send({ title: 'T2' }).expect(201);
        expect(fs.writeFileSync).toHaveBeenCalled();
    });

    it('GET /api/tracks', async () => {
        vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] });
        await request(app).get('/api/tracks').expect(200);
    });

    it('GET /api/inbox', async () => {
        vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] });
        await request(app).get('/api/inbox').expect(200);
    });

    it('GET /api/projects/:id/conductor', async () => {
        vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ conductor_files: {} }] });
        await request(app).get('/api/projects/1/conductor').expect(200);
    });

    it('GET /api/projects/:id/tracks/:num', async () => {
        vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ track_number: '001' }] });
        await request(app).get('/api/projects/1/tracks/001').expect(200);
    });

    it('GET /api/projects/:id/tracks/:num/comments', async () => {
        vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ id: 1 }] }).mockResolvedValueOnce({ rows: [] });
        await request(app).get('/api/projects/1/tracks/001/comments').expect(200);
    });

    it('POST /api/projects/:id/tracks/:num/comments', async () => {
        vi.mocked(fetch).mockResolvedValueOnce({ ok: true, text: async () => '{"id":2}' });
        await request(app).post('/api/projects/1/tracks/001/comments').send({ body: 'b' }).expect(201);
    });

    it('POST /api/projects/:id/tracks/:num/implement', async () => {
        vi.mocked(fetch).mockResolvedValueOnce({ ok: true, text: async () => '{"ok":true}' }) // action
            .mockResolvedValueOnce({ ok: true, text: async () => '{"ok":true}' }); // comment
        await request(app).post('/api/projects/1/tracks/001/implement').expect(200);
    });

    it('POST /api/projects/:id/tracks/:num/update', async () => {
        vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ id: 1, repo_path: '/r' }] }); // project
        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue('p');
        vi.mocked(fetch).mockResolvedValueOnce({ ok: true, text: async () => '{"ok":true}' }) // reset
            .mockResolvedValueOnce({ ok: true, text: async () => '{"ok":true}' }); // comment
        await request(app).post('/api/projects/1/tracks/001/update').send({ title: 'E' }).expect(200);
    });

    it('POST /internal/sync-event', async () => {
        await request(app).post('/internal/sync-event').send({ event: 'e', data: {} }).expect(200);
        await request(app).post('/internal/sync-event').send({}).expect(400);
    });

    it('GET /api/projects/:id/members', async () => {
        vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ user_uid: '1' }] });
        await request(app).get('/api/projects/1/members').expect(200);
    });

    it('GET /api/projects/:id/conductor error case', async () => {
        vi.mocked(pool.query).mockRejectedValueOnce(new Error('fail'));
        await request(app).get('/api/projects/1/conductor').expect(500);
    });

    it('GET /api/projects/:id/workflow', async () => {
        vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ id: 1, repo_path: '/r' }] });
        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue('## Workflow Configuration\n```json\n{}\n```');
        await request(app).get('/api/projects/1/workflow').expect(200);
    });

    it('POST /api/projects/:id/workflow', async () => {
        vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ id: 1, repo_path: '/r' }] });
        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue('## Workflow Configuration\n```json\n{}\n```');
        await request(app).post('/api/projects/1/workflow').send({ config: {} }).expect(200);
    });

    it('GET /api/projects/:id/workers', async () => {
        vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] });
        await request(app).get('/api/projects/1/workers').expect(200);
    });

    it('GET /api/projects/:id/providers', async () => {
        vi.mocked(fetch).mockResolvedValueOnce({ ok: true, text: async () => '{"providers":[]}' });
        await request(app).get('/api/projects/1/providers').expect(200);
    });

    it('GET /api/projects/:id/tracks/:num error case', async () => {
        vi.mocked(pool.query).mockRejectedValueOnce(new Error('fail'));
        await request(app).get('/api/projects/1/tracks/001').expect(500);
    });

    it('POST /api/projects/:id/tracks error cases', async () => {
        await request(app).post('/api/projects/1/tracks').send({}).expect(400);
        vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] }); // proj not found
        await request(app).post('/api/projects/1/tracks').send({ title: 'T' }).expect(404);
    });

    it('POST /api/projects/:id/tracks/:num/fix-review with existing phase', async () => {
        vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ repo_path: '/r' }] }) // project
            .mockResolvedValueOnce({ rows: [{ id: 1 }] }) // getTrackId
            .mockResolvedValueOnce({ rows: [{ author: 'human', body: 'New H' }] }); // comments
        vi.mocked(fs.readdirSync).mockReturnValue(['001-s']);
        vi.mocked(fs.readFileSync).mockReturnValue('## Phase 2: Fix Review Gaps ⏳ IN PROGRESS');
        vi.mocked(fetch).mockResolvedValueOnce({ ok: true, text: async () => '{"ok":true}' }); // reset
        await request(app).post('/api/projects/1/tracks/001/fix-review').expect(200);
    });

    it('POST /api/projects/:id/tracks/:num/fix-review creating new phase', async () => {
        vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ repo_path: '/r' }] }) // project
            .mockResolvedValueOnce({ rows: [{ id: 1 }] }) // getTrackId
            .mockResolvedValueOnce({ rows: [
                { author: 'claude', body: '### ⚠️ Gaps\n- [ ] Gap 1' },
                { author: 'human', body: 'Feedback' }
            ] }); // comments
        vi.mocked(fs.readdirSync).mockReturnValue(['001-s']);
        vi.mocked(fs.readFileSync).mockReturnValue('# Plan\n## Phase 1: Test');
        vi.mocked(fetch).mockResolvedValueOnce({ ok: true, text: async () => '{"ok":true}' }) // reset
            .mockResolvedValueOnce({ ok: true, text: async () => '{"ok":true}' }) // comment
            .mockResolvedValueOnce({ ok: true, text: async () => '{"ok":true}' }); // action
        await request(app).post('/api/projects/1/tracks/001/fix-review').expect(200);
        expect(fs.writeFileSync).toHaveBeenCalled();
    });

    it('POST /api/projects/:id/tracks/:num/fix-review error case', async () => {
        vi.mocked(pool.query).mockRejectedValueOnce(new Error('DB fail'));
        await request(app).post('/api/projects/1/tracks/001/fix-review').expect(500);
    });

    it('POST /api/projects/:id/tracks/:num/update', async () => {
        vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ repo_path: '/tmp' }] }); // project
        vi.mocked(fs.readdirSync).mockReturnValue(['001-test']);
        vi.mocked(fs.readFileSync).mockReturnValue('# Plan');
        vi.mocked(fetch).mockResolvedValueOnce({ ok: true, text: async () => '{"ok":true}' }); // collector reset
        vi.mocked(fetch).mockResolvedValueOnce({ ok: true, text: async () => '{"ok":true}' }); // collector comment

        await request(app).post('/api/projects/1/tracks/001/update').send({ title: 'T', description: 'D' }).expect(200);
        expect(fs.writeFileSync).toHaveBeenCalled();
    });

    it('POST /api/projects/:id/tracks/:num/update error case', async () => {
        vi.mocked(pool.query).mockRejectedValueOnce(new Error('fail'));
        await request(app).post('/api/projects/1/tracks/001/update').send({ title: 'T' }).expect(500);
    });

    it('POST /api/projects/:id/dev-server/start', async () => {
        vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ dev_command: 'npm start', dev_url: 'http://localhost:3000', repo_path: '/r' }] });
        vi.mocked(pool.query).mockResolvedValueOnce({ rowCount: 1 }); // update PID
        const response = await request(app).post('/api/projects/1/dev-server/start').expect(200);
        expect(response.body.running).toBe(true);
    });

    it('POST /api/projects/:id/dev-server/stop', async () => {
        vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ dev_server_pid: 123 }] });
        vi.mocked(pool.query).mockResolvedValueOnce({ rowCount: 1 }); // clear PID
        const response = await request(app).post('/api/projects/1/dev-server/stop').expect(200);
        expect(response.body.running).toBe(false);
    });

    it('GET /api/projects/:id/dev-server/status', async () => {
        vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ dev_command: 'npm start', dev_url: 'http://localhost:3000', dev_server_pid: null }] });
        const response = await request(app).get('/api/projects/1/dev-server/status').expect(200);
        expect(response.body.running).toBe(false);
    });

    it('runMigration logic', async () => {
        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readdirSync).mockReturnValue(['001_init.sql']);
        vi.mocked(fs.readFileSync).mockReturnValue('CREATE TABLE users');
        await runMigration();
        expect(pool.query).toHaveBeenCalledWith('CREATE TABLE users');

        // Error case
        vi.mocked(pool.query).mockRejectedValueOnce(new Error('fail'));
        await runMigration();
        // Warned but not thrown
    });

    it('Utility: uuidV5 generates valid UUID', () => {
        const uuid = uuidV5('6ba7b810-9dad-11d1-80b4-00c04fd430c8', 'test');
        expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    });

    it('Utility: gitGlobalId returns null for missing remote', () => {
        expect(gitGlobalId(null)).toBeNull();
        expect(gitGlobalId(undefined)).toBeNull();
        expect(gitGlobalId('')).toBeNull();
    });

    it('Utility: gitGlobalId generates UUID from git remote', () => {
        const id = gitGlobalId('https://github.com/user/repo.git');
        expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    });

    it('Utility: gitGlobalId normalizes URLs', () => {
        const id1 = gitGlobalId('https://github.com/user/repo.git');
        const id2 = gitGlobalId('https://github.com/user/repo');
        expect(id1).toBe(id2);
    });
});
