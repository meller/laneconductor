// ui/server/tests/track-10049-credentials.test.mjs
// Track TU-10049 Phase 2 (TC-8..TC-17): GET /api/workers/:id/credentials
// generalizes the AM-1119 deploy-credentials check to github|jira|gcp|firebase.
// jira's token is resolved server-side from a named env var / GCP secret —
// never carried in the request — and TC-14 asserts a sentinel token value
// never appears in any response body.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
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

const checkGhAuthMock = vi.fn();
vi.mock('../../../conductor/services/pr-flow.mjs', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, checkGhAuth: (...args) => checkGhAuthMock(...args) };
});

const jiraProjectExistsMock = vi.fn();
vi.mock('../../../conductor/services/jira-auth.mjs', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, jiraProjectExists: (...args) => jiraProjectExistsMock(...args) };
});

const { app, pool } = await import('../index.mjs');

const SENTINEL_TOKEN = 'sentinel-token-should-never-leak-9f8e7d';

describe('GET /api/workers/:id/credentials', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns 404 when worker is not found', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get('/api/workers/999/credentials?provider=github').expect(404);
    expect(res.body.error).toMatch(/worker not found/i);
  });

  it('returns 400 for an unsupported provider', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ id: 1 }] });
    const res = await request(app).get('/api/workers/1/credentials?provider=bogus').expect(400);
    expect(res.body.error).toMatch(/provider must be/i);
  });

  // TC-8/TC-9
  describe('github', () => {
    it('reports verified when gh auth status succeeds', async () => {
      vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ id: 1 }] });
      checkGhAuthMock.mockReturnValueOnce({ ok: true });
      const res = await request(app).get('/api/workers/1/credentials?provider=github').expect(200);
      expect(res.body).toEqual({ provider: 'github', status: 'verified', detail: null });
    });

    it('reports NOT CONFIGURED when gh is unauthenticated, route returns 200', async () => {
      vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ id: 1 }] });
      checkGhAuthMock.mockReturnValueOnce({ ok: false, error: 'not logged in to any GitHub hosts' });
      const res = await request(app).get('/api/workers/1/credentials?provider=github').expect(200);
      expect(res.body.status).toBe('NOT CONFIGURED');
      expect(res.body.detail).toMatch(/not logged in/i);
    });
  });

  // TC-10/TC-11/TC-12/TC-14
  describe('jira', () => {
    const baseQuery = 'provider=jira&domain=acme.atlassian.net&email=me%40acme.com&project_key=ACME&token_env=JIRA_API_TOKEN';

    afterEach(() => {
      delete process.env.JIRA_API_TOKEN;
    });

    it('reports verified when the project is reachable with a resolved token', async () => {
      process.env.JIRA_API_TOKEN = SENTINEL_TOKEN;
      vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ id: 1 }] });
      jiraProjectExistsMock.mockResolvedValueOnce(true);

      const res = await request(app).get(`/api/workers/1/credentials?${baseQuery}`).expect(200);
      expect(res.body).toEqual({ provider: 'jira', status: 'verified', detail: 'ACME @ acme.atlassian.net' });
      expect(jiraProjectExistsMock).toHaveBeenCalledWith('acme.atlassian.net', 'me@acme.com', SENTINEL_TOKEN, 'ACME');
    });

    it('reports NOT CONFIGURED when the project key does not resolve', async () => {
      process.env.JIRA_API_TOKEN = SENTINEL_TOKEN;
      vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ id: 1 }] });
      jiraProjectExistsMock.mockResolvedValueOnce(false);

      const res = await request(app).get(`/api/workers/1/credentials?${baseQuery}`).expect(200);
      expect(res.body.status).toBe('NOT CONFIGURED');
    });

    it('reports NOT CONFIGURED and makes no network call when the token env var is unset', async () => {
      vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ id: 1 }] });

      const res = await request(app).get(`/api/workers/1/credentials?${baseQuery}`).expect(200);
      expect(res.body.status).toBe('NOT CONFIGURED');
      expect(res.body.detail).toMatch(/JIRA_API_TOKEN/);
      expect(jiraProjectExistsMock).not.toHaveBeenCalled();
    });

    it('never leaks the resolved token value in the response body', async () => {
      process.env.JIRA_API_TOKEN = SENTINEL_TOKEN;
      vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ id: 1 }] });
      jiraProjectExistsMock.mockResolvedValueOnce(true);

      const res = await request(app).get(`/api/workers/1/credentials?${baseQuery}`).expect(200);
      expect(JSON.stringify(res.body)).not.toContain(SENTINEL_TOKEN);
    });

    it('never leaks the token value even on a NOT CONFIGURED / error path', async () => {
      process.env.JIRA_API_TOKEN = SENTINEL_TOKEN;
      vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ id: 1 }] });
      jiraProjectExistsMock.mockResolvedValueOnce(false);

      const res = await request(app).get(`/api/workers/1/credentials?${baseQuery}`).expect(200);
      expect(JSON.stringify(res.body)).not.toContain(SENTINEL_TOKEN);
    });
  });

  // TC-13 — gcp behavior unchanged from the original deploy-credentials route
  describe('gcp', () => {
    it('reports verified with the active account', async () => {
      vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ id: 1 }] });
      vi.mocked(spawnSync).mockReturnValueOnce({ status: 0, stdout: 'dev@example.com\n' });

      const res = await request(app).get('/api/workers/1/credentials?provider=gcp').expect(200);
      expect(res.body).toEqual({ provider: 'gcp', status: 'verified', detail: 'dev@example.com' });
    });

    it('reports NOT CONFIGURED with no active account', async () => {
      vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ id: 1 }] });
      vi.mocked(spawnSync).mockReturnValueOnce({ status: 0, stdout: '' });

      const res = await request(app).get('/api/workers/1/credentials?provider=gcp').expect(200);
      expect(res.body).toEqual({ provider: 'gcp', status: 'NOT CONFIGURED', detail: null });
    });
  });
});
