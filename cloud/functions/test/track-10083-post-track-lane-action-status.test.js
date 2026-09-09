// Track AM-10083 Phase 1/2: POST /track's ON CONFLICT upsert used to derive
// lane_action_status purely from the row already in the database — the
// payload's own value was bound into the VALUES list and never referenced on
// the update path. Two live symptoms followed directly: a track sitting at
// 'queue' could never be pushed to 'running' by this endpoint, and a stale
// 'running' could never be cleared by it either (spec.md RC-2).
//
// These tests exercise the REAL route handler (auth + checkProject +
// POST /track, exactly as a request would hit it) with `pg` mocked, and
// assert on the actual SQL text and bound parameters sent to the database —
// the "generated SQL" plan.md Task 1.2 says to assert against, since no
// harness in this repo runs cloud/functions/index.js against a real
// Postgres instance (every existing cloud/functions/test/*.test.js file
// mocks `pg` the same way).

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

jest.mock('pg', () => ({
  Pool: jest.fn(() => ({
    query: mockQuery,
    on: jest.fn(),
  })),
}));

process.env.NODE_ENV = 'test';
const app = require('../index');

const WORKSPACE = 'ws-1';
const API_KEY = 'lc_testkey';
const PROJECT_ID = 7;

/** auth()'s queries for an lc_ key (api_tokens miss, api_keys hit, last_used_at, workspace_members). */
function mockAuth() {
  mockQuery.mockResolvedValueOnce({ rows: [] }); // api_tokens miss
  mockQuery.mockResolvedValueOnce({ rows: [{ user_uid: 'user-1' }] }); // api_keys hit
  mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE last_used_at
  mockQuery.mockResolvedValueOnce({ rows: [{ workspace_id: WORKSPACE }] }); // workspace_members
}

/** checkProject's project lookup, called with req.body.project_id for POST /track. */
function mockCheckProjectOk() {
  mockQuery.mockResolvedValueOnce({ rows: [{ id: PROJECT_ID }] });
}

const authed = (req) => req.set('Authorization', `Bearer ${API_KEY}`);

/** SQL text / params of the nth (0-indexed) query() call. */
const sqlAt = (n) => mockQuery.mock.calls[n][0];
const paramsAt = (n) => mockQuery.mock.calls[n][1];

function basePayload(overrides = {}) {
  return {
    track_number: '10080',
    title: 'Some track',
    lane_status: 'implement',
    progress_percent: 50,
    project_id: PROJECT_ID,
    ...overrides,
  };
}

/** mockAuth + mockCheckProjectOk + the existing-row SELECT this route now runs. */
function mockAuthAndExisting(existingLaneStatus) {
  mockAuth();
  mockCheckProjectOk();
  mockQuery.mockResolvedValueOnce({
    rows: existingLaneStatus === null ? [] : [{ lane_status: existingLaneStatus }],
  });
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('TC-1.3/TC-2.1: an existing row at queue moves to running when the payload says running', () => {
  test('lane unchanged, explicit lane_action_status: running', async () => {
    mockAuthAndExisting('implement');
    mockQuery.mockResolvedValueOnce({ rows: [] }); // the upsert itself

    const res = await authed(request(app).post('/track')).send(
      basePayload({ lane_status: 'implement', lane_action_status: 'running' })
    );

    expect(res.status).toBe(200);
    const upsertIdx = mockQuery.mock.calls.length - 1;
    const params = paramsAt(upsertIdx);
    // $15 = updateActionStatus — must be the payload's own value, not derived
    // from the existing row.
    expect(params[14]).toBe('running');
    // $16 = resetActionResult — lane didn't change, so the result is left alone.
    expect(params[15]).toBe(false);
    expect(sqlAt(upsertIdx)).toMatch(/lane_action_status = COALESCE\(\$15, tracks\.lane_action_status\)/);
    expect(sqlAt(upsertIdx)).not.toMatch(/WHEN tracks\.lane_action_status = 'running' THEN 'running'/);
  });
});

describe('TC-1.4/TC-2.1: an existing row at running moves to queue when the payload says queue', () => {
  test('explicit lane_action_status: queue clears a stale running', async () => {
    mockAuthAndExisting('implement');
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await authed(request(app).post('/track')).send(
      basePayload({ lane_status: 'implement', lane_action_status: 'queue' })
    );

    expect(res.status).toBe(200);
    const upsertIdx = mockQuery.mock.calls.length - 1;
    const params = paramsAt(upsertIdx);
    expect(params[14]).toBe('queue');
  });
});

describe('TC-2.2: payload omits status, lane changes — resets to queue and clears the result', () => {
  test('no lane_action_status in payload, lane_status differs from the existing row', async () => {
    mockAuthAndExisting('plan'); // existing lane differs from payload's 'implement'
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await authed(request(app).post('/track')).send(
      basePayload({ lane_status: 'implement' }) // no lane_action_status field at all
    );

    expect(res.status).toBe(200);
    const upsertIdx = mockQuery.mock.calls.length - 1;
    const params = paramsAt(upsertIdx);
    expect(params[14]).toBe('queue');
    expect(params[15]).toBe(true); // resetActionResult
  });
});

describe('TC-2.3: payload omits status, lane unchanged — existing value untouched', () => {
  test('no lane_action_status field, lane_status matches the existing row', async () => {
    mockAuthAndExisting('implement');
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await authed(request(app).post('/track')).send(
      basePayload({ lane_status: 'implement' })
    );

    expect(res.status).toBe(200);
    const upsertIdx = mockQuery.mock.calls.length - 1;
    const params = paramsAt(upsertIdx);
    // null → COALESCE falls through to the existing column, i.e. untouched.
    expect(params[14]).toBeNull();
    expect(params[15]).toBe(false);
  });
});

describe('TC-2.4/REQ-3: payload supplies a status with lane_status null — the status still writes', () => {
  test('lane_status: null must not suppress the lane_action_status write', async () => {
    mockAuthAndExisting('implement');
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await authed(request(app).post('/track')).send(
      basePayload({ lane_status: null, lane_action_status: 'running' })
    );

    expect(res.status).toBe(200);
    const upsertIdx = mockQuery.mock.calls.length - 1;
    const params = paramsAt(upsertIdx);
    expect(params[14]).toBe('running');
    // The lane_status column assignment itself must be omitted (unrelated to
    // whether lane_action_status writes), matching today's behaviour.
    expect(sqlAt(upsertIdx)).not.toMatch(/lane_status\s*=\s*EXCLUDED\.lane_status/);
  });
});

describe('TC-2.6: a first-time insert with an explicit status is unaffected by this change', () => {
  test('no existing row — INSERT path uses insertActionStatus exactly as before', async () => {
    mockAuthAndExisting(null); // no existing row
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await authed(request(app).post('/track')).send(
      basePayload({ lane_status: 'plan', lane_action_status: 'running' })
    );

    expect(res.status).toBe(200);
    const upsertIdx = mockQuery.mock.calls.length - 1;
    const params = paramsAt(upsertIdx);
    // $13 = insertActionStatus — the INSERT-time value, unchanged by this fix.
    expect(params[12]).toBe('running');
  });
});
