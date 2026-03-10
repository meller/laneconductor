import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { app, pool } from '../index.mjs';

// Mock auth module
vi.mock('../auth.mjs');

// Mock pg
vi.mock('pg', () => {
    const query = vi.fn();
    const Pool = vi.fn(() => ({
        query,
        on: vi.fn(),
        connect: vi.fn().mockResolvedValue({
            query,
            release: vi.fn()
        })
    }));
    return {
        default: { Pool },
        Pool: Pool
    };
});

describe('Collector Endpoints', () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    it('GET /project', async () => {
        vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ id: 1, name: 'Test' }] });
        const response = await request(app).get('/project?project_id=1');
        expect(response.status).toBe(200);
        expect(response.body.name).toBe('Test');
    });

    it('PATCH /project', async () => {
        vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] });
        const response = await request(app)
            .patch('/project?project_id=1')
            .send({ git_remote: 'https://github.com/user/repo.git' });
        expect(response.status).toBe(200);
        expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE projects'), expect.any(Array));
    });

    it('POST /track', async () => {
        vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] }); // SELECT old track
        vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ id: 1 }], rowCount: 1 }); // UPSERT
        vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ len: 10 }] }); // verify len
        vi.mocked(pool.query).mockResolvedValueOnce({ rowCount: 1 }); // status update
        
        const response = await request(app)
            .post('/track?project_id=1')
            .send({
                track_number: '001',
                title: 'Test Track',
                lane_status: 'planning',
                lane_action_status: 'queue'
            });
        expect(response.status).toBe(200);
    });

    it('PATCH /track/:num/action', async () => {
        vi.mocked(pool.query).mockResolvedValueOnce({ rowCount: 1 }); // update
        vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ repo_path: '/tmp' }] }); // project for sync-to-file
        
        const response = await request(app)
            .patch('/track/001/action?project_id=1')
            .send({ lane_action_status: 'running' });
        expect(response.status).toBe(200);
    });

    it('POST /track/:num/comment', async () => {
        vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ id: 101 }] }); // track id
        vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ id: 1, author: 'human', body: 'Test' }] }); // insert
        vi.mocked(pool.query).mockResolvedValueOnce({ rowCount: 1 }); // wake worker
        
        const response = await request(app)
            .post('/track/001/comment?project_id=1')
            .send({ author: 'human', body: 'Hello' });
        expect(response.status).toBe(201);
        expect(response.body.body).toBe('Test');
    });
});
