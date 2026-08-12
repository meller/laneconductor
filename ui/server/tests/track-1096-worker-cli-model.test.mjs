// ui/server/tests/track-1096-worker-cli-model.test.mjs
// Track 1096: Worker CLI Engine and Model Picker API tests

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { app, pool } from '../index.mjs';

vi.mock('../auth.mjs');

vi.mock('pg', () => {
  const query = vi.fn();
  const Pool = vi.fn(() => ({ query, on: vi.fn() }));
  return { default: { Pool }, Pool };
});

describe('Track 1096: Worker CLI & Model Config API', () => {
  beforeEach(() => vi.resetAllMocks());

  describe('PATCH /api/workers/:id/config', () => {
    it('updates worker cli and model, and queues set_model dispatch', async () => {
      // 1. SELECT worker check
      vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ id: 5, project_id: 10, type: 'worker' }] });
      // 2. UPDATE workers
      vi.mocked(pool.query).mockResolvedValueOnce({ rowCount: 1 });
      // 3. INSERT worker_dispatch
      vi.mocked(pool.query).mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 42 }] });

      const res = await request(app)
        .patch('/api/workers/5/config')
        .send({ cli: 'gemini', model: 'gemini-2.5-pro' })
        .expect(200);

      expect(res.body).toEqual({ ok: true, worker_id: '5', cli: 'gemini', model: 'gemini-2.5-pro' });
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE workers SET cli = $1, model = $2'),
        ['gemini', 'gemini-2.5-pro', '5']
      );
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO worker_dispatch'),
        ['5', JSON.stringify({ cli: 'gemini', model: 'gemini-2.5-pro' })]
      );
    });

    it('validates cli engine', async () => {
      const res = await request(app)
        .patch('/api/workers/5/config')
        .send({ cli: 'unsupported-cli', model: 'gemini-2.5-pro' })
        .expect(400);

      expect(res.body.error).toMatch(/Invalid CLI engine/i);
    });

    it('returns 404 when worker is not found', async () => {
      vi.mocked(pool.query).mockResolvedValueOnce({ rowCount: 0, rows: [] });

      const res = await request(app)
        .patch('/api/workers/999/config')
        .send({ cli: 'claude', model: 'claude-3-7-sonnet' })
        .expect(404);

      expect(res.body.error).toMatch(/Worker not found/i);
    });
  });

  describe('POST /worker/register with cli & model', () => {
    it('persists cli and model during registration', async () => {
      const mockRegisteredWorker = {
        ok: true,
        machine_token: 'mock-token',
        id: 7
      };
      // 1. SELECT machine_token
      vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ machine_token: 'mock-token' }] });
      // 2. INSERT INTO workers
      vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ id: 7 }] });

      const res = await request(app)
        .post('/worker/register')
        .send({
          project_id: 10,
          hostname: 'worker-node',
          pid: 1234,
          mode: 'sync+poll',
          type: 'worker',
          cli: 'antigravity',
          model: 'gemini-2.5-pro'
        })
        .expect(200);

      expect(res.body.ok).toBe(true);
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO workers'),
        expect.arrayContaining(['antigravity', 'gemini-2.5-pro'])
      );
    });
  });
});
