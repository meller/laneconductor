// ui/server/tests/track-1087-direct-chat.test.mjs
// Track 1087 Phase 8: Direct Worker Interactive Chat Bar backend test

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { app, pool } from '../index.mjs';

vi.mock('../auth.mjs');

vi.mock('pg', () => {
  const query = vi.fn();
  const Pool = vi.fn(() => ({ query, on: vi.fn() }));
  return { default: { Pool }, Pool };
});

describe('POST /api/projects/:id/dispatch Phase 8 Direct Chat', () => {
  beforeEach(() => vi.resetAllMocks());

  it('dispatches worker_adhoc_chat prompt without track_number', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({
      rows: [{ id: 101 }],
      rowCount: 1,
    });

    const res = await request(app)
      .post('/api/projects/1/dispatch')
      .send({
        worker_id: 'w-123',
        action: 'worker_adhoc_chat',
        payload: { prompt: 'Hello worker' },
      })
      .expect(200);

    expect(res.body).toEqual({ ok: true, id: 101 });
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO worker_dispatch'),
      ['w-123', null, 'worker_adhoc_chat', JSON.stringify({ prompt: 'Hello worker' }), '1']
    );
  });

  it('dispatches track_chat prompt WITH track_number included', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({
      rows: [{ id: 102 }],
      rowCount: 1,
    });

    const res = await request(app)
      .post('/api/projects/1/dispatch')
      .send({
        worker_id: 'w-123',
        action: 'track_chat',
        track_number: '1087',
        payload: { prompt: 'Please check Phase 8', track_number: '1087' },
      })
      .expect(200);

    expect(res.body).toEqual({ ok: true, id: 102 });
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO worker_dispatch'),
      ['w-123', '1087', 'track_chat', JSON.stringify({ prompt: 'Please check Phase 8', track_number: '1087' }), '1']
    );
  });

  it('returns 400 when worker does not belong to project', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({
      rows: [],
      rowCount: 0,
    });

    const res = await request(app)
      .post('/api/projects/1/dispatch')
      .send({
        worker_id: 'w-foreign',
        action: 'worker_adhoc_chat',
        payload: { prompt: 'Hey' },
      })
      .expect(400);

    expect(res.body.error).toMatch(/does not belong/i);
  });

  it('handles manager worker dispatch with project_id null (/api/projects/null/dispatch)', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({
      rows: [{ id: 103 }],
      rowCount: 1,
    });

    const res = await request(app)
      .post('/api/projects/null/dispatch')
      .send({
        worker_id: 'w-mgr',
        action: 'worker_adhoc_chat',
        payload: { prompt: 'Hello manager' },
      })
      .expect(200);

    expect(res.body).toEqual({ ok: true, id: 103 });
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO worker_dispatch'),
      ['w-mgr', null, 'worker_adhoc_chat', JSON.stringify({ prompt: 'Hello manager' }), null]
    );
  });
});
