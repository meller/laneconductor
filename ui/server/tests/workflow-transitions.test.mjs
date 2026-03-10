import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { app, pool } from '../index.mjs';

// Mock auth module
vi.mock('../auth.mjs');

// Mock pg
vi.mock('pg', () => {
    const query = vi.fn();
    const pool = {
        query,
        on: vi.fn(),
        connect: vi.fn().mockResolvedValue({
            query,
            release: vi.fn()
        })
    };
    return {
        Pool: vi.fn(() => pool),
        default: {
            Pool: vi.fn(() => pool)
        }
    };
});

describe('Workflow Transitions API', () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    it('GET /api/projects/:id/tracks/finished returns tracks in terminal states', async () => {
        const mockTracks = [
            { id: 1, track_number: '1008', lane_status: 'quality-gate', lane_action_status: 'success' },
            { id: 2, track_number: '017', lane_status: 'quality-gate', lane_action_status: 'success' }
        ];
        
        vi.mocked(pool.query).mockResolvedValueOnce({ rows: mockTracks });
        
        const response = await request(app).get('/api/projects/1/tracks/finished');
        
        expect(response.status).toBe(200);
        expect(response.body.tracks).toHaveLength(2);
        expect(response.body.tracks[0].track_number).toBe('1008');
        
        // Verify SQL filters terminal states and excludes terminal lanes
        const lastQuery = vi.mocked(pool.query).mock.calls[0][0];
        expect(lastQuery).toContain("lane_action_status IN ('success', 'failure')");
        expect(lastQuery).toContain("lane_status NOT IN ('done', 'backlog')");
    });

    it('GET /api/projects/:id/tracks/finished handles empty results', async () => {
        vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] });
        const response = await request(app).get('/api/projects/1/tracks/finished');
        expect(response.status).toBe(200);
        expect(response.body.tracks).toEqual([]);
    });
    
    it('GET /api/projects/:id/tracks/finished handles database errors', async () => {
        vi.mocked(pool.query).mockRejectedValueOnce(new Error('DB error'));
        const response = await request(app).get('/api/projects/1/tracks/finished');
        expect(response.status).toBe(500);
        expect(response.body.error).toBe('DB error');
    });
});
