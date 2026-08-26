// ui/server/tests/track-1119-deploy-credentials.test.mjs
// Track AM-1119 Phase 2 (Task 2, REQ-2/TC-5): GET /api/workers/:id/deploy-credentials
// — worker-side gcloud/firebase auth check, reported as verified / NOT CONFIGURED.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { app, pool } from '../index.mjs';
import { spawnSync } from 'child_process';

vi.mock('../auth.mjs');

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, spawnSync: vi.fn() };
});

vi.mock('pg', () => {
  const query = vi.fn();
  const Pool = vi.fn(() => ({ query, on: vi.fn() }));
  return { default: { Pool }, Pool };
});

describe('GET /api/workers/:id/deploy-credentials', () => {
  beforeEach(() => vi.resetAllMocks());

  it('returns 404 when worker is not found', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get('/api/workers/999/deploy-credentials?provider=firebase').expect(404);
    expect(res.body.error).toMatch(/worker not found/i);
  });

  it('returns 400 for an unsupported provider', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ id: 1 }] });
    const res = await request(app).get('/api/workers/1/deploy-credentials?provider=aws').expect(400);
    expect(res.body.error).toMatch(/provider must be/i);
  });

  it('reports verified for firebase when the CLI check exits 0', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ id: 1 }] });
    vi.mocked(spawnSync).mockReturnValueOnce({ status: 0, stdout: '' });

    const res = await request(app).get('/api/workers/1/deploy-credentials?provider=firebase').expect(200);
    expect(res.body).toEqual({ provider: 'firebase', status: 'verified', detail: null });
    expect(spawnSync).toHaveBeenCalledWith('firebase', ['projects:list', '--json'], expect.any(Object));
  });

  it('reports NOT CONFIGURED for firebase when the CLI check exits non-zero', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ id: 1 }] });
    vi.mocked(spawnSync).mockReturnValueOnce({ status: 1, stdout: '' });

    const res = await request(app).get('/api/workers/1/deploy-credentials?provider=firebase').expect(200);
    expect(res.body).toEqual({ provider: 'firebase', status: 'NOT CONFIGURED', detail: null });
  });

  it('reports verified with the active account for gcp when authenticated', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ id: 1 }] });
    vi.mocked(spawnSync).mockReturnValueOnce({ status: 0, stdout: 'dev@example.com\n' });

    const res = await request(app).get('/api/workers/1/deploy-credentials?provider=gcp').expect(200);
    expect(res.body).toEqual({ provider: 'gcp', status: 'verified', detail: 'dev@example.com' });
    expect(spawnSync).toHaveBeenCalledWith(
      'gcloud',
      ['auth', 'list', '--format=value(account)', '--filter=status=ACTIVE'],
      expect.any(Object)
    );
  });

  it('reports NOT CONFIGURED for gcp when no active account', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ id: 1 }] });
    vi.mocked(spawnSync).mockReturnValueOnce({ status: 0, stdout: '' });

    const res = await request(app).get('/api/workers/1/deploy-credentials?provider=gcp').expect(200);
    expect(res.body).toEqual({ provider: 'gcp', status: 'NOT CONFIGURED', detail: null });
  });
});
