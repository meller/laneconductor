import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../index.mjs';

// Mock auth module — uses server/__mocks__/auth.mjs (no GCP calls, no gRPC)
vi.mock('../auth.mjs');


// Mock fetch
global.fetch = vi.fn();


// Mock pg
vi.mock('pg', () => {
    const query = vi.fn();
    const Pool = vi.fn(() => ({
        query,
        on: vi.fn(),
    }));
    return { default: { Pool } };
});

describe('API Validation', () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    it('POST /api/projects/:id/tracks - 400 if title missing', async () => {
        const res = await request(app)
            .post('/api/projects/1/tracks')
            .send({ description: 'test' });

        expect(res.status).toBe(400);
        expect(res.body.error).toBe('title is required');
    });

    it('PATCH /api/projects/:id/tracks/:num - 400 if invalid lane_status', async () => {
        const res = await request(app)
            .patch('/api/projects/1/tracks/001')
            .send({ lane_status: 'invalid-lane' });

        expect(res.status).toBe(400);
        expect(res.body.error).toBe('Invalid lane_status');
    });

    it('PATCH /api/projects/:id/tracks/:num - 400 if invalid phase_step', async () => {
        const res = await request(app)
            .patch('/api/projects/1/tracks/001')
            .send({ phase_step: 'invalid-step' });

        expect(res.status).toBe(400);
        expect(res.body.error).toBe('Invalid phase_step');
    });

    it('POST /api/projects/:id/tracks/:num/comments - 400 if body missing', async () => {
        const res = await request(app)
            .post('/api/projects/1/tracks/001/comments')
            .send({ author: 'human' });

        expect(res.status).toBe(400);
        expect(res.body.error).toBe('body is required');
    });

    it('POST /internal/sync-event - 400 if missing event or data', async () => {
        const res = await request(app)
            .post('/internal/sync-event')
            .send({ event: 'test' });

        expect(res.status).toBe(400);
        expect(res.body.error).toBe('Missing event or data');
    });
});
