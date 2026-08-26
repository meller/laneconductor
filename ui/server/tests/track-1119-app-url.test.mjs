// ui/server/tests/track-1119-app-url.test.mjs
// Track AM-1119 Phase 4 (Task 1, REQ-4/TC-10): POST /api/projects/:id/app-url
// and GET /api/projects returning app_url.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { app, pool } from '../index.mjs';

vi.mock('../auth.mjs');

vi.mock('pg', () => {
  const query = vi.fn();
  const Pool = vi.fn(() => ({ query, on: vi.fn() }));
  return { default: { Pool }, Pool };
});

describe('POST /api/projects/:id/app-url', () => {
  beforeEach(() => vi.resetAllMocks());

  it('returns 404 when the project does not exist', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] });
    const res = await request(app)
      .post('/api/projects/999/app-url')
      .send({ app_url: 'https://digger-game-prod.web.app' })
      .expect(404);
    expect(res.body.error).toMatch(/project not found/i);
  });

  it('returns 400 for a non-http(s) app_url', async () => {
    const res = await request(app)
      .post('/api/projects/1/app-url')
      .send({ app_url: 'not-a-url' })
      .expect(400);
    expect(res.body.error).toMatch(/http\(s\) url/i);
  });

  it('sets app_url and returns it (TC-10 round-trip)', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ id: 1, app_url: 'https://digger-game-prod.web.app' }] });
    const res = await request(app)
      .post('/api/projects/1/app-url')
      .send({ app_url: 'https://digger-game-prod.web.app' })
      .expect(200);
    expect(res.body).toEqual({ ok: true, app_url: 'https://digger-game-prod.web.app' });
    expect(pool.query).toHaveBeenCalledWith(
      'UPDATE projects SET app_url = $1 WHERE id = $2 RETURNING id, app_url',
      ['https://digger-game-prod.web.app', '1']
    );
  });

  it('clears app_url when given null', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ id: 1, app_url: null }] });
    const res = await request(app)
      .post('/api/projects/1/app-url')
      .send({ app_url: null })
      .expect(200);
    expect(res.body).toEqual({ ok: true, app_url: null });
  });
});

describe('GET /api/projects includes app_url', () => {
  beforeEach(() => vi.resetAllMocks());

  it('returns app_url for each project (local/no-auth mode)', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({
      rows: [{ id: 1, name: 'Digger Game', repo_path: '/x', app_url: 'https://digger-game-prod.web.app' }],
    });
    const res = await request(app).get('/api/projects').expect(200);
    expect(res.body[0].app_url).toBe('https://digger-game-prod.web.app');
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('app_url'));
  });
});
