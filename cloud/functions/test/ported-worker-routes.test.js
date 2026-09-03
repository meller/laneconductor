// Track 10053 Phases 3-4: the ported worker routes.
//
// One case per contract that a plausible-looking rewrite could get wrong. The
// session semantics (TC-32..TC-35) matter most: they are what track 10047's
// context-cap policy reads, and coercing last_context_tokens to 0 or
// recomputing resume_count client-side would break it silently, with no test
// failing and no error anywhere.

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
const PROJECT_ID = 7;
const WORKER_ID = 42;

/**
 * auth()'s four queries for an lc_ key. The third — the fire-and-forget
 * `UPDATE api_keys SET last_used_at` — still consumes a mocked response;
 * omitting it shifts every later mock and produces failures far from the cause.
 */
function mockAuth() {
  mockQuery.mockResolvedValueOnce({ rows: [] }); // api_tokens miss
  mockQuery.mockResolvedValueOnce({ rows: [{ user_uid: 'user-1' }] }); // api_keys hit
  mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE last_used_at
  mockQuery.mockResolvedValueOnce({ rows: [{ workspace_id: WORKSPACE }] }); // workspace_members
}

/** auth() + resolveWorkerIdentity for a worker in this workspace. */
function mockAuthWithWorker(visibility = 'public') {
  mockAuth();
  mockQuery.mockResolvedValueOnce({
    rows: [{ id: WORKER_ID, project_id: PROJECT_ID, user_uid: 'user-1', visibility }],
  });
}

/** The workspace-scoped project lookup resolveWorkerProject runs. */
function mockProjectOk() {
  mockQuery.mockResolvedValueOnce({ rows: [{ id: PROJECT_ID }] });
}

/** The lookup checkProject runs for routes with an :id param. */
function mockCheckProjectOk() {
  mockQuery.mockResolvedValueOnce({ rows: [{ id: PROJECT_ID }] });
}

const authed = (req) => req.set('Authorization', `Bearer ${API_KEY}`);
const asWorker = (req) => authed(req).set('X-Worker-Token', WORKER_TOKEN);

/** SQL text of the nth (0-indexed) query, for asserting on what was run. */
const sqlAt = (n) => mockQuery.mock.calls[n][0];
const paramsAt = (n) => mockQuery.mock.calls[n][1];
const lastCall = () => mockQuery.mock.calls[mockQuery.mock.calls.length - 1];

beforeEach(() => {
  jest.clearAllMocks();
  mockConnect.mockResolvedValue({ query: mockClientQuery, release: mockRelease });
  mockClientQuery.mockResolvedValue({ rows: [], rowCount: 0 });
});

// ── TC-21 / TC-22: project workflow ──────────────────────────────────────────

describe('TC-21/TC-22: GET /projects/:id/workflow', () => {
  test('TC-21: returns the parsed workflow when conductor_files has one', async () => {
    mockAuth();
    mockCheckProjectOk();
    const workflow = { lanes: { plan: { on_success: 'plan:success' } } };
    mockQuery.mockResolvedValueOnce({
      rows: [{ conductor_files: { workflow_json: JSON.stringify(workflow) } }],
    });

    const res = await authed(request(app).get(`/projects/${PROJECT_ID}/workflow`));

    expect(res.status).toBe(200);
    expect(res.body).toEqual(workflow);
  });

  test('TC-21b: returns {} when there is no stored workflow, without reading disk', async () => {
    mockAuth();
    mockCheckProjectOk();
    mockQuery.mockResolvedValueOnce({ rows: [{ conductor_files: null }] });

    const res = await authed(request(app).get(`/projects/${PROJECT_ID}/workflow`));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({});
  });

  test('TC-21c: unparseable stored content returns {} rather than 500', async () => {
    // A worker fetches this every sync cycle; malformed stored content must not
    // turn into a permanent error loop.
    mockAuth();
    mockCheckProjectOk();
    mockQuery.mockResolvedValueOnce({
      rows: [{ conductor_files: { workflow_json: '{not json' } }],
    });

    const res = await authed(request(app).get(`/projects/${PROJECT_ID}/workflow`));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({});
  });

  test('TC-22: a project in another workspace is 403, not the workflow', async () => {
    mockAuth();
    mockQuery.mockResolvedValueOnce({ rows: [] }); // checkProject finds nothing in this workspace

    const res = await authed(request(app).get('/projects/999/workflow'));

    expect(res.status).toBe(403);
  });
});

// ── TC-23: conductor files ───────────────────────────────────────────────────

describe('TC-23: POST /conductor-files', () => {
  test('TC-23: writes scoped to the caller’s own project', async () => {
    mockAuthWithWorker();
    mockProjectOk();
    mockQuery.mockResolvedValueOnce({ rows: [] }); // the UPDATE

    const res = await asWorker(request(app).post('/conductor-files')).send({
      content: { 'product.md': 'hello' },
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    const [sql, params] = lastCall();
    expect(sql).toMatch(/UPDATE projects SET conductor_files/);
    expect(params[1]).toBe(PROJECT_ID);
  });

  test('with neither X-Worker-Token nor project_id it is a clean 400', async () => {
    mockAuth();

    const res = await authed(request(app).post('/conductor-files')).send({ content: {} });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/project/);
  });

  test('an explicit project_id outside the workspace is 403', async () => {
    mockAuth();
    mockQuery.mockResolvedValueOnce({ rows: [] }); // workspace-scoped lookup misses

    const res = await authed(request(app).post('/conductor-files?project_id=999')).send({
      content: {},
    });

    expect(res.status).toBe(403);
  });
});

// ── TC-24: track read-back ───────────────────────────────────────────────────

describe('TC-24: GET /track/:num', () => {
  test('TC-24: returns the track with its comments', async () => {
    mockAuthWithWorker();
    mockProjectOk();
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 99, track_number: '10053', title: 'T' }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 1, author: 'system', body: 'hi' }] });

    const res = await asWorker(request(app).get('/track/10053'));

    expect(res.status).toBe(200);
    expect(res.body.track_number).toBe('10053');
    expect(res.body.comments).toHaveLength(1);
  });

  test('TC-24b: an unknown track number is 404', async () => {
    mockAuthWithWorker();
    mockProjectOk();
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await asWorker(request(app).get('/track/999999'));

    expect(res.status).toBe(404);
  });
});

// ── TC-25 / TC-26: git lock coordination ─────────────────────────────────────

describe('TC-25/TC-26: lock and unlock', () => {
  test('TC-25: lock upserts track_locks and marks the track running', async () => {
    mockAuthWithWorker();
    mockProjectOk();
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 99 }] }); // track lookup
    mockQuery.mockResolvedValueOnce({ rows: [] }); // track_locks upsert
    mockQuery.mockResolvedValueOnce({ rows: [] }); // tracks update

    const res = await asWorker(request(app).post('/track/10053/lock')).send({
      user: 'dev',
      machine: 'laptop',
      lock_file_path: '.conductor/locks/10053.lock',
    });

    expect(res.status).toBe(200);

    const upsert = mockQuery.mock.calls.find((c) => /INSERT INTO track_locks/.test(c[0]));
    // ON CONFLICT is what makes two racing locks converge on one row rather
    // than two that both look authoritative.
    expect(upsert[0]).toMatch(/ON CONFLICT \(project_id, track_number\)/);

    const update = mockQuery.mock.calls.find((c) => /UPDATE tracks SET locked_by/.test(c[0]));
    expect(update[0]).toMatch(/lane_action_status = 'running'/);
    expect(update[1]).toContain('dev@laptop');
  });

  test('TC-25b: locking an unknown track is 404 and writes no lock row', async () => {
    mockAuthWithWorker();
    mockProjectOk();
    mockQuery.mockResolvedValueOnce({ rows: [] }); // track lookup misses

    const res = await asWorker(request(app).post('/track/999999/lock')).send({
      user: 'dev',
      machine: 'laptop',
    });

    expect(res.status).toBe(404);
    expect(mockQuery.mock.calls.some((c) => /INSERT INTO track_locks/.test(c[0]))).toBe(false);
  });

  test('TC-26: unlock deletes the lock row and clears locked_by', async () => {
    mockAuthWithWorker();
    mockProjectOk();
    mockQuery.mockResolvedValueOnce({ rows: [] }); // delete
    mockQuery.mockResolvedValueOnce({ rows: [] }); // clear locked_by

    const res = await asWorker(request(app).post('/track/10053/unlock')).send({});

    expect(res.status).toBe(200);
    expect(mockQuery.mock.calls.some((c) => /DELETE FROM track_locks/.test(c[0]))).toBe(true);
    expect(mockQuery.mock.calls.some((c) => /SET locked_by = NULL/.test(c[0]))).toBe(true);
  });
});

// ── TC-27: pre-spawn block counter ───────────────────────────────────────────

describe('TC-27: prespawn-block', () => {
  test('TC-27: increments and returns count/kind/reason', async () => {
    mockAuthWithWorker();
    mockProjectOk();
    mockQuery.mockResolvedValueOnce({
      rows: [{ count: 3, kind: 'dirty-checkout', reason: 'uncommitted changes' }],
    });

    const res = await asWorker(request(app).post('/track/10053/prespawn-block')).send({
      kind: 'dirty-checkout',
      reason: 'uncommitted changes',
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ count: 3, kind: 'dirty-checkout', reason: 'uncommitted changes' });
  });

  test('TC-27b: a missing kind is 400 and increments nothing', async () => {
    mockAuth();

    const res = await authed(request(app).post('/track/10053/prespawn-block')).send({
      reason: 'no kind',
    });

    expect(res.status).toBe(400);
    expect(mockQuery.mock.calls.some((c) => /prespawn_block_count \+ 1/.test(c[0]))).toBe(false);
  });

  test('TC-27c: an unknown track is 404', async () => {
    mockAuthWithWorker();
    mockProjectOk();
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await asWorker(request(app).post('/track/999999/prespawn-block')).send({
      kind: 'dirty-checkout',
    });

    expect(res.status).toBe(404);
  });

  test('TC-27d: reset clears all four columns', async () => {
    mockAuthWithWorker();
    mockProjectOk();
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await asWorker(request(app).post('/track/10053/prespawn-block/reset')).send({});

    expect(res.status).toBe(200);
    const [sql] = lastCall();
    expect(sql).toMatch(/prespawn_block_count = 0/);
    expect(sql).toMatch(/prespawn_block_kind = NULL/);
    expect(sql).toMatch(/prespawn_block_reason = NULL/);
    expect(sql).toMatch(/prespawn_blocked_at = NULL/);
  });
});

// ── TC-32..TC-37: session continuity ─────────────────────────────────────────

describe('TC-32..TC-37: track sessions', () => {
  // TC-32 — the distinction track 10047's cap policy depends on. `null` means
  // "never measured"; 0 would mean "measured as empty". Collapsing them
  // changes which runs are allowed to resume, silently.
  test('TC-32: an absent row reports last_context_tokens as null, not 0', async () => {
    mockAuthWithWorker();
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await asWorker(request(app).get('/track/10053/session'));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      claude_session_id: null,
      last_context_tokens: null,
      resume_count: 0,
    });
    expect(res.body.last_context_tokens).not.toBe(0);
  });

  test('TC-32b: a row predating the migration reports null, never coerced', async () => {
    mockAuthWithWorker();
    mockQuery.mockResolvedValueOnce({
      rows: [{ claude_session_id: 'sess', last_context_tokens: null, resume_count: 0 }],
    });

    const res = await asWorker(request(app).get('/track/10053/session'));

    expect(res.body.last_context_tokens).toBeNull();
  });

  // TC-33 / TC-34 — resume_count is computed in SQL so the worker never has to
  // read-then-write (which would race between two lane actions).
  test('TC-33/TC-34: resume_count increments on the same id and resets on a different one', async () => {
    mockAuthWithWorker();
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await asWorker(request(app).post('/track/10053/session')).send({
      claude_session_id: 'sess-1',
      context_tokens: 100,
    });

    expect(res.status).toBe(200);
    const [sql] = lastCall();
    expect(sql).toMatch(/resume_count = CASE/);
    expect(sql).toMatch(
      /WHEN track_sessions\.claude_session_id = EXCLUDED\.claude_session_id THEN track_sessions\.resume_count \+ 1/
    );
    expect(sql).toMatch(/ELSE 0/);
  });

  // TC-35 — a POST from a run that didn't measure context must not erase the
  // previous measurement.
  test('TC-35: an omitted context_tokens COALESCEs rather than nulling the stored value', async () => {
    mockAuthWithWorker();
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await asWorker(request(app).post('/track/10053/session')).send({
      claude_session_id: 'sess-1',
    });

    expect(res.status).toBe(200);
    const [sql, params] = lastCall();
    expect(sql).toMatch(/last_context_tokens = COALESCE\(\$4, track_sessions\.last_context_tokens\)/);
    expect(params[3]).toBeNull();
  });

  test('POST without a claude_session_id is 400', async () => {
    mockAuthWithWorker();

    const res = await asWorker(request(app).post('/track/10053/session')).send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/claude_session_id/);
  });

  test('TC-36: DELETE removes only this worker’s row for this track', async () => {
    mockAuthWithWorker();
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await asWorker(request(app).delete('/track/10053/session'));

    expect(res.status).toBe(200);
    const [sql, params] = lastCall();
    expect(sql).toMatch(/DELETE FROM track_sessions WHERE track_number = \$1 AND worker_id = \$2/);
    expect(params).toEqual(['10053', WORKER_ID]);
  });

  // TC-37 — all three verbs refuse without worker identity rather than
  // silently acting on some other worker's session.
  test('TC-37: all three verbs are 400 without worker identity', async () => {
    for (const verb of ['get', 'post', 'delete']) {
      jest.clearAllMocks();
      mockAuth();
      const res = await authed(request(app)[verb]('/track/10053/session')).send({
        claude_session_id: 'sess-1',
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/worker identity/);
    }
  });
});

// ── TC-28..TC-31: queue claim ────────────────────────────────────────────────

describe('TC-28..TC-31: POST /tracks/claim-queue', () => {
  function claimReturning(rows, diag) {
    mockClientQuery.mockImplementation((sql) => {
      if (/^\s*(BEGIN|COMMIT|ROLLBACK)/.test(sql)) return Promise.resolve({ rows: [] });
      if (/^\s*SELECT lane_status, lane_action_status/.test(sql)) {
        return Promise.resolve({ rows: diag ? [diag] : [] });
      }
      return Promise.resolve({ rows });
    });
  }

  test('TC-28: the claim runs FOR UPDATE SKIP LOCKED inside the transaction', async () => {
    mockAuthWithWorker();
    mockProjectOk();
    claimReturning([{ track_number: '10053', lane_status: 'plan' }]);

    const res = await asWorker(request(app).post('/tracks/claim-queue')).send({ limit: 5 });

    expect(res.status).toBe(200);
    expect(res.body.tracks).toHaveLength(1);

    const claimSql = mockClientQuery.mock.calls.find((c) => /UPDATE tracks t/.test(c[0]))[0];
    expect(claimSql).toMatch(/FOR UPDATE SKIP LOCKED/);
    // On the transaction's client, not the pool — this is the whole point.
    expect(mockConnect).toHaveBeenCalledTimes(1);
  });

  test('TC-29: ordering is priority, then lane, then age', async () => {
    mockAuthWithWorker();
    mockProjectOk();
    claimReturning([]);

    await asWorker(request(app).post('/tracks/claim-queue')).send({});

    const claimSql = mockClientQuery.mock.calls.find((c) => /UPDATE tracks t/.test(c[0]))[0];
    expect(claimSql).toMatch(/ORDER BY priority DESC/);
    expect(claimSql).toMatch(/WHEN lane_status = 'plan' THEN 1/);
    expect(claimSql).toMatch(/created_at ASC/);
  });

  test('TC-29b: only claimable lanes are eligible, bound as a parameter', async () => {
    mockAuthWithWorker();
    mockProjectOk();
    claimReturning([]);

    await asWorker(request(app).post('/tracks/claim-queue')).send({});

    const call = mockClientQuery.mock.calls.find((c) => /UPDATE tracks t/.test(c[0]));
    expect(call[0]).toMatch(/lane_status = ANY\(\$4\)/);
    // 'done' must be in the list — it became claimable with track 10035, and a
    // hand-typed literal is exactly what missed it last time.
    expect(call[1][3]).toEqual(['plan', 'implement', 'review', 'quality-gate', 'done']);
  });

  test('TC-30: private visibility restricts to the owner’s tracks', async () => {
    mockAuthWithWorker('private');
    mockProjectOk();
    claimReturning([]);

    await asWorker(request(app).post('/tracks/claim-queue')).send({});

    const claimSql = mockClientQuery.mock.calls.find((c) => /UPDATE tracks t/.test(c[0]))[0];
    expect(claimSql).toMatch(/t\.last_updated_by_uid = \$5/);
    expect(claimSql).not.toMatch(/worker_permissions/);
  });

  test('TC-30b: team visibility also honours worker_permissions grants', async () => {
    mockAuthWithWorker('team');
    mockProjectOk();
    claimReturning([]);

    await asWorker(request(app).post('/tracks/claim-queue')).send({});

    const claimSql = mockClientQuery.mock.calls.find((c) => /UPDATE tracks t/.test(c[0]))[0];
    expect(claimSql).toMatch(/FROM worker_permissions wp/);
  });

  test('TC-30c: public visibility adds no ownership filter', async () => {
    mockAuthWithWorker('public');
    mockProjectOk();
    claimReturning([]);

    await asWorker(request(app).post('/tracks/claim-queue')).send({});

    const claimSql = mockClientQuery.mock.calls.find((c) => /UPDATE tracks t/.test(c[0]))[0];
    expect(claimSql).not.toMatch(/last_updated_by_uid/);
    expect(claimSql).not.toMatch(/worker_permissions/);
  });

  test('TC-31: a targeted claim that wins nothing explains why', async () => {
    mockAuthWithWorker();
    mockProjectOk();
    claimReturning([], { lane_status: 'plan', lane_action_status: 'running' });

    const res = await asWorker(request(app).post('/tracks/claim-queue')).send({
      track_number: '10053',
    });

    expect(res.status).toBe(200);
    expect(res.body.tracks).toEqual([]);
    expect(res.body.reason).toBe('already_claimed');
  });

  test('TC-31b: a targeted claim for a track in an unclaimable lane says so', async () => {
    mockAuthWithWorker();
    mockProjectOk();
    claimReturning([], { lane_status: 'backlog', lane_action_status: 'queue' });

    const res = await asWorker(request(app).post('/tracks/claim-queue')).send({
      track_number: '10053',
    });

    expect(res.body.reason).toBe('lane_not_claimable');
  });

  test('TC-31c: a targeted claim for a nonexistent track reports no_candidates', async () => {
    mockAuthWithWorker();
    mockProjectOk();
    claimReturning([], null);

    const res = await asWorker(request(app).post('/tracks/claim-queue')).send({
      track_number: '999999',
    });

    expect(res.body.reason).toBe('no_candidates');
  });

  test('TC-31d: an untargeted empty claim runs no diagnostic query', async () => {
    // Idle polling is the common case; a second query on every idle beat of
    // every worker is real cost for no signal.
    mockAuthWithWorker();
    mockProjectOk();
    claimReturning([]);

    const res = await asWorker(request(app).post('/tracks/claim-queue')).send({ limit: 5 });

    expect(res.body.reason).toBeNull();
    const diagnostics = mockClientQuery.mock.calls.filter((c) =>
      /^\s*SELECT lane_status, lane_action_status/.test(c[0])
    );
    expect(diagnostics).toHaveLength(0);
  });
});

// ── TC-38..TC-41: dispatch inbox ─────────────────────────────────────────────

describe('TC-38..TC-41: worker dispatch', () => {
  test('TC-38: the inbox returns only pending entries, oldest first', async () => {
    mockAuthWithWorker();
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 1 }] }); // workerInWorkspace
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 5, status: 'pending' }] });

    const res = await asWorker(request(app).get(`/worker/${WORKER_ID}/dispatch`));

    expect(res.status).toBe(200);
    expect(res.body.entries).toHaveLength(1);
    const [sql] = lastCall();
    expect(sql).toMatch(/status = 'pending'/);
    expect(sql).toMatch(/ORDER BY created_at ASC/);
  });

  test('TC-39: the claimed inbox returns claimed entries by claim time', async () => {
    mockAuthWithWorker();
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 1 }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 6, status: 'claimed' }] });

    const res = await asWorker(request(app).get(`/worker/${WORKER_ID}/dispatch/claimed`));

    expect(res.status).toBe(200);
    const [sql] = lastCall();
    expect(sql).toMatch(/status = 'claimed'/);
    expect(sql).toMatch(/ORDER BY claimed_at ASC/);
  });

  // TC-40 (AC-8) — the divergence from the local handler. Locally there is one
  // tenant so no check is needed; here, without it, any project key could read
  // another workspace's dispatch queue.
  test('TC-40: reading another workspace’s worker inbox is 403, not its entries', async () => {
    mockAuthWithWorker();
    mockQuery.mockResolvedValueOnce({ rows: [] }); // workerInWorkspace says no

    const res = await asWorker(request(app).get('/worker/9999/dispatch'));

    expect(res.status).toBe(403);
    expect(res.body.entries).toBeUndefined();
  });

  test('TC-41: a claimed report stamps claimed_at', async () => {
    mockAuthWithWorker();
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const res = await asWorker(request(app).patch('/worker-dispatch/5')).send({
      status: 'claimed',
    });

    expect(res.status).toBe(200);
    const [sql] = lastCall();
    expect(sql).toMatch(/claimed_at = NOW\(\)/);
    // Scoped through the owning worker — worker_dispatch has no project_id.
    expect(sql).toMatch(/JOIN projects p ON p\.id = w\.project_id/);
  });

  test('TC-41b: an invalid status is 400 and names the valid set', async () => {
    mockAuthWithWorker();

    const res = await asWorker(request(app).patch('/worker-dispatch/5')).send({
      status: 'bogus',
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/pending, claimed, done, failed/);
  });

  test('TC-41c: an unknown or out-of-workspace id is 404', async () => {
    mockAuthWithWorker();
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const res = await asWorker(request(app).patch('/worker-dispatch/9999')).send({
      status: 'done',
    });

    expect(res.status).toBe(404);
  });

  test('TC-41d: result is written only when supplied', async () => {
    // A 'claimed' report carries no result; writing NULL over an earlier one
    // would erase it.
    mockAuthWithWorker();
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

    await asWorker(request(app).patch('/worker-dispatch/5')).send({ status: 'claimed' });
    expect(lastCall()[0]).not.toMatch(/result = /);

    jest.clearAllMocks();
    mockAuthWithWorker();
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

    await asWorker(request(app).patch('/worker-dispatch/5')).send({
      status: 'done',
      result: 'exit 0',
    });
    expect(lastCall()[0]).toMatch(/result = \$2/);
  });
});

// ── TC-42 / TC-43: claimable tracks ──────────────────────────────────────────

describe('TC-42/TC-43: GET /api/projects/:id/claimable-tracks', () => {
  test('TC-43: worker_id is required', async () => {
    mockAuth();
    mockCheckProjectOk();

    const res = await authed(request(app).get(`/api/projects/${PROJECT_ID}/claimable-tracks`));

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/worker_id/);
  });

  test('TC-42: a track with no assignee, creator or project owner is open to any worker', async () => {
    mockAuth();
    mockCheckProjectOk();
    mockQuery.mockResolvedValueOnce({ rows: [{ owner_uid: null }] });
    mockQuery.mockResolvedValueOnce({
      rows: [{ track_number: '10053', assignee_uid: null, created_by_uid: null }],
    });

    const res = await authed(
      request(app).get(`/api/projects/${PROJECT_ID}/claimable-tracks?worker_id=${WORKER_ID}`)
    );

    expect(res.status).toBe(200);
    expect(res.body.claimable).toEqual(['10053']);
  });

  test('TC-42b: an assigned track is claimable only by one of the assignee’s own workers', async () => {
    mockAuth();
    mockCheckProjectOk();
    mockQuery.mockResolvedValueOnce({ rows: [{ owner_uid: 'owner' }] });
    mockQuery.mockResolvedValueOnce({
      rows: [{ track_number: '10053', assignee_uid: 'someone-else', created_by_uid: null }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 777 }] }); // that assignee's workers

    const res = await authed(
      request(app).get(`/api/projects/${PROJECT_ID}/claimable-tracks?worker_id=${WORKER_ID}`)
    );

    expect(res.body.claimable).toEqual([]);
  });

  test('TC-42c: an assignee with no workers of their own leaves the track open', async () => {
    mockAuth();
    mockCheckProjectOk();
    mockQuery.mockResolvedValueOnce({ rows: [{ owner_uid: 'owner' }] });
    mockQuery.mockResolvedValueOnce({
      rows: [{ track_number: '10053', assignee_uid: 'nobody', created_by_uid: null }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [] }); // no workers

    const res = await authed(
      request(app).get(`/api/projects/${PROJECT_ID}/claimable-tracks?worker_id=${WORKER_ID}`)
    );

    expect(res.body.claimable).toEqual(['10053']);
  });

  test('TC-42d: the asking worker being one of the assignee’s own makes it claimable', async () => {
    mockAuth();
    mockCheckProjectOk();
    mockQuery.mockResolvedValueOnce({ rows: [{ owner_uid: 'owner' }] });
    mockQuery.mockResolvedValueOnce({
      rows: [{ track_number: '10053', assignee_uid: 'user-1', created_by_uid: null }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: WORKER_ID }] });

    const res = await authed(
      request(app).get(`/api/projects/${PROJECT_ID}/claimable-tracks?worker_id=${WORKER_ID}`)
    );

    expect(res.body.claimable).toEqual(['10053']);
  });

  test('resolves each assignee’s workers at most once across many tracks', async () => {
    mockAuth();
    mockCheckProjectOk();
    mockQuery.mockResolvedValueOnce({ rows: [{ owner_uid: 'owner' }] });
    mockQuery.mockResolvedValueOnce({
      rows: [
        { track_number: 'a', assignee_uid: 'u1', created_by_uid: null },
        { track_number: 'b', assignee_uid: 'u1', created_by_uid: null },
        { track_number: 'c', assignee_uid: 'u1', created_by_uid: null },
      ],
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: WORKER_ID }] });

    const res = await authed(
      request(app).get(`/api/projects/${PROJECT_ID}/claimable-tracks?worker_id=${WORKER_ID}`)
    );

    expect(res.body.claimable).toEqual(['a', 'b', 'c']);
    const workerLookups = mockQuery.mock.calls.filter((c) =>
      /FROM workers WHERE project_id = \$1 AND user_uid = \$2/.test(c[0])
    );
    expect(workerLookups).toHaveLength(1);
  });
});
