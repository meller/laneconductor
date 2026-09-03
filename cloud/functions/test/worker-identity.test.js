// Track 10053 Phase 2: worker identity (X-Worker-Token) and the transaction
// primitive.
//
// These two are prerequisites for the ported routes, not conveniences. Without
// worker identity, /track/:num/session can only ever answer 400 in the cloud.
// Without a real transaction, /tracks/claim-queue's FOR UPDATE SKIP LOCKED
// silently stops excluding rows and two workers can claim the same track.

const request = require('supertest');

jest.mock('firebase-functions/v2/https', () => ({
  onRequest: jest.fn((opts, app) => app),
}));

jest.mock('firebase-functions/params', () => ({
  defineSecret: jest.fn((name) => ({
    value: jest.fn(() => (name === 'DATABASE_URL' ? '' : 'mock-secret')),
  })),
}));

const mockQuery = jest.fn();
const mockClientQuery = jest.fn();
const mockRelease = jest.fn();
const mockConnect = jest.fn();

jest.mock('pg', () => ({
  Pool: jest.fn(() => ({
    query: mockQuery,
    connect: mockConnect,
    on: jest.fn(),
  })),
}));

process.env.NODE_ENV = 'test';
const app = require('../index');

const WORKSPACE = 'ws-1';
const API_KEY = 'lc_testkey';
const WORKER_TOKEN = 'machine-token-abc';

/**
 * The four queries auth() runs for an lc_ key. The third is easy to miss: the
 * api_keys branch fires an `UPDATE api_keys SET last_used_at` before resolving
 * the workspace, and although it's fire-and-forget it still consumes a mocked
 * response — omitting it shifts every later mock by one and produces
 * misleading failures far from the cause.
 */
function mockApiKeyAuth() {
  mockQuery.mockResolvedValueOnce({ rows: [] }); // api_tokens lookup misses
  mockQuery.mockResolvedValueOnce({ rows: [{ user_uid: 'user-1' }] }); // api_keys hit
  mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE api_keys SET last_used_at
  mockQuery.mockResolvedValueOnce({ rows: [{ workspace_id: WORKSPACE }] }); // workspace_members
}

beforeEach(() => {
  jest.clearAllMocks();
  mockConnect.mockResolvedValue({ query: mockClientQuery, release: mockRelease });
  mockClientQuery.mockResolvedValue({ rows: [], rowCount: 0 });
});

describe('TC-11..TC-14: X-Worker-Token resolution in auth()', () => {
  // TC-11 — an absent header must not change anything. The cloud UI and every
  // already-working worker route send no such header.
  test('TC-11: no X-Worker-Token still authorizes, and resolves no worker', async () => {
    mockApiKeyAuth();
    // GET /track/:num is a ported route; without worker identity it still
    // works, because it scopes by project, not by worker.
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 7 }] }); // workspace-scoped project
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 99, track_number: '10053' }] });
    mockQuery.mockResolvedValueOnce({ rows: [] }); // comments

    const res = await request(app)
      .get('/track/10053?project_id=7')
      .set('Authorization', `Bearer ${API_KEY}`);

    expect(res.status).toBe(200);
    // No workers/machine_token lookup happened.
    const sqls = mockQuery.mock.calls.map((c) => c[0]);
    expect(sqls.some((s) => s.includes('machine_token'))).toBe(false);
  });

  // TC-12 — a token for a worker in the caller's own workspace resolves.
  // /track/:num/session is the observable proof: it 400s without worker
  // identity and 200s with it.
  test('TC-12: a workspace-matched worker token resolves identity', async () => {
    mockApiKeyAuth();
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 42, project_id: 7, user_uid: 'user-1', visibility: 'private' }],
    }); // workers JOIN projects
    mockQuery.mockResolvedValueOnce({
      rows: [{ claude_session_id: 'sess-1', last_context_tokens: 1234, resume_count: 2 }],
    });

    const res = await request(app)
      .get('/track/10053/session')
      .set('Authorization', `Bearer ${API_KEY}`)
      .set('X-Worker-Token', WORKER_TOKEN);

    expect(res.status).toBe(200);
    expect(res.body.claude_session_id).toBe('sess-1');

    const workerLookup = mockQuery.mock.calls.find((c) => c[0].includes('machine_token'));
    expect(workerLookup).toBeDefined();
    // Scoped by BOTH the token and the authenticated workspace — the workspace
    // bind is what makes cross-tenant use impossible.
    expect(workerLookup[1]).toEqual([WORKER_TOKEN, WORKSPACE]);
    expect(workerLookup[0]).toContain('p.workspace_id');
  });

  // TC-13 (AC-8) — the security case. A valid machine_token belonging to
  // another workspace's worker must be refused, not ignored.
  test('TC-13: a worker token from another workspace is rejected with 403', async () => {
    mockApiKeyAuth();
    mockQuery.mockResolvedValueOnce({ rows: [] }); // workspace-scoped lookup finds nothing

    const res = await request(app)
      .get('/track/10053/session')
      .set('Authorization', `Bearer ${API_KEY}`)
      .set('X-Worker-Token', 'token-of-another-workspaces-worker');

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/workspace/);
  });

  // TC-14 — an unknown credential is a rejection, never a silent downgrade to
  // "no worker identity". A downgrade would turn a stolen/stale token into a
  // confusing 400 instead of a clear 403.
  test('TC-14: an unknown worker token is rejected, not ignored', async () => {
    mockApiKeyAuth();
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .get('/track/10053/session')
      .set('Authorization', `Bearer ${API_KEY}`)
      .set('X-Worker-Token', 'not-a-real-token');

    expect(res.status).toBe(403);
  });

  test('a worker token without any Authorization header is still 401', async () => {
    const res = await request(app)
      .get('/track/10053/session')
      .set('X-Worker-Token', WORKER_TOKEN);

    expect(res.status).toBe(401);
  });
});

describe('TC-19/TC-20: withTransaction', () => {
  // Exercised through /tracks/claim-queue, the only caller — testing the
  // helper through its real consumer rather than reaching into module
  // internals.
  function mockClaimAuth() {
    mockApiKeyAuth();
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 42, project_id: 7, user_uid: 'user-1', visibility: 'public' }],
    }); // resolveWorkerIdentity: workers JOIN projects
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 7 }] }); // resolveWorkerProject: workspace-scoped project
  }

  // TC-19 — BEGIN, the work, COMMIT, and release, all on one client.
  test('TC-19: commits on success and releases the client', async () => {
    mockClaimAuth();
    mockClientQuery.mockImplementation((sql) => {
      if (/^\s*(BEGIN|COMMIT)/.test(sql)) return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [{ track_number: '10053', lane_status: 'plan' }] });
    });

    const res = await request(app)
      .post('/tracks/claim-queue?project_id=7')
      .set('Authorization', `Bearer ${API_KEY}`)
      .set('X-Worker-Token', WORKER_TOKEN)
      .send({ limit: 5 });

    expect(res.status).toBe(200);
    expect(mockConnect).toHaveBeenCalledTimes(1);

    const stmts = mockClientQuery.mock.calls.map((c) => c[0].trim().split(/\s/)[0]);
    expect(stmts[0]).toBe('BEGIN');
    expect(stmts).toContain('COMMIT');
    expect(stmts).not.toContain('ROLLBACK');
    expect(mockRelease).toHaveBeenCalledTimes(1);
  });

  // TC-20 — a throw inside the transaction must roll back AND release. A
  // leaked client is worse than the original error: the pool is capped at 3,
  // so three leaks wedge the whole function.
  test('TC-20: rolls back and still releases when the work throws', async () => {
    mockClaimAuth();
    mockClientQuery.mockImplementation((sql) => {
      if (/^\s*BEGIN/.test(sql)) return Promise.resolve({ rows: [] });
      if (/^\s*ROLLBACK/.test(sql)) return Promise.resolve({ rows: [] });
      return Promise.reject(new Error('deadlock detected'));
    });

    const res = await request(app)
      .post('/tracks/claim-queue?project_id=7')
      .set('Authorization', `Bearer ${API_KEY}`)
      .set('X-Worker-Token', WORKER_TOKEN)
      .send({ limit: 5 });

    expect(res.status).toBe(500);
    const stmts = mockClientQuery.mock.calls.map((c) => c[0].trim().split(/\s/)[0]);
    expect(stmts).toContain('ROLLBACK');
    expect(stmts).not.toContain('COMMIT');
    expect(mockRelease).toHaveBeenCalledTimes(1);
  });

  test('a failing ROLLBACK does not mask the original error', async () => {
    mockClaimAuth();
    mockClientQuery.mockImplementation((sql) => {
      if (/^\s*BEGIN/.test(sql)) return Promise.resolve({ rows: [] });
      if (/^\s*ROLLBACK/.test(sql)) return Promise.reject(new Error('connection terminated'));
      return Promise.reject(new Error('original failure'));
    });

    const res = await request(app)
      .post('/tracks/claim-queue?project_id=7')
      .set('Authorization', `Bearer ${API_KEY}`)
      .set('X-Worker-Token', WORKER_TOKEN)
      .send({});

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('original failure');
    expect(mockRelease).toHaveBeenCalledTimes(1);
  });
});
