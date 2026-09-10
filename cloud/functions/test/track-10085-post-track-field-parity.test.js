// Track AM-10085: cloud's POST /track insert column list and ON CONFLICT DO
// UPDATE clause omitted waiting_for_reply, auto_run, merge_mode,
// workspace_mode, model_override, and every KPI column that
// ui/server/index.mjs's own POST /track handler persists — see spec.md's
// Requirements for the per-field semantics being asserted here.
//
// Same approach as track-10083-post-track-lane-action-status.test.js:
// exercises the REAL route handler (auth + checkProject + POST /track) with
// `pg` mocked, and asserts on the generated SQL text and bound parameters —
// no harness in this repo runs cloud/functions/index.js against a real
// Postgres instance (see that file's own header comment for why). Because
// the upsert is a single unconditional INSERT ... ON CONFLICT DO UPDATE
// statement, "insert wins" and "update payload wins" produce identical bound
// params here — the distinction that matters and that this mock CAN observe
// is the SQL text itself: a raw/EXCLUDED value on the VALUES side, and a
// COALESCE(EXCLUDED.col, tracks.col) (or, for kpi_check_after, a bare
// EXCLUDED.col with no COALESCE) on the SET side.
//
// The jest.mock('pg', ...) wiring below is duplicated from the 10083 file
// rather than shared, deliberately: jest hoists jest.mock() factories above
// all other statements in a file, so a factory can only reference
// module-scope identifiers prefixed `mock` declared in the SAME file — this
// is a jest/babel constraint, not a stylistic choice, and every existing
// cloud/functions/test/*.test.js file repeats it for the same reason.

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

/** mockAuth + mockCheckProjectOk + the existing-row SELECT this route runs. */
function mockAuthAndExisting(existingLaneStatus) {
  mockAuth();
  mockCheckProjectOk();
  mockQuery.mockResolvedValueOnce({
    rows: existingLaneStatus === null ? [] : [{ lane_status: existingLaneStatus }],
  });
}

/** Runs the upsert and returns { params, sql } for the final query() call. */
async function runUpsert(payloadOverrides) {
  mockQuery.mockResolvedValueOnce({ rows: [] }); // the upsert itself
  const res = await authed(request(app).post('/track')).send(basePayload(payloadOverrides));
  expect(res.status).toBe(200);
  const upsertIdx = mockQuery.mock.calls.length - 1;
  return { params: paramsAt(upsertIdx), sql: sqlAt(upsertIdx) };
}

beforeEach(() => {
  jest.clearAllMocks();
});

// Param index map for this route's upsert (0-indexed into the params array,
// i.e. $n = params[n-1]):
//   16: waiting_for_reply ($17)   17: auto_run ($18)
//   18: merge_mode ($19)          19: workspace_mode ($20)
//   20: model_override ($21)      21: track_type ($22)
//   22: kpi_target ($23)          23: kpi_actual ($24)
//   24: kpi_metric ($25)          25: kpi_source ($26)
//   26: kpi_source_config ($27)   27: kpi_threshold ($28)
//   28: kpi_window ($29)          29: kpi_snapshot ($30)
//   30: kpi_measured_at ($31)     31: kpi_check_after ($32)
//   32: kpi_scheduled_at ($33)    33: kpi_maps_to ($34)

describe('Phase 1 (TC-1.1-1.6): waiting_for_reply / auto_run', () => {
  test('TC-1.1/1.2: payload value is bound for waiting_for_reply', async () => {
    mockAuthAndExisting('implement');
    const { params, sql } = await runUpsert({ waiting_for_reply: true });
    expect(params[16]).toBe(true);
    expect(sql).toMatch(/COALESCE\(\$17, false\)/);
    expect(sql).toMatch(/waiting_for_reply\s*=\s*COALESCE\(\$17, tracks\.waiting_for_reply\)/);
  });

  test('TC-1.3: omitted waiting_for_reply binds null, preserving the existing value via COALESCE', async () => {
    mockAuthAndExisting('implement');
    const { params } = await runUpsert({});
    expect(params[16]).toBeNull();
  });

  test('TC-1.4/1.5: payload value is bound for auto_run', async () => {
    mockAuthAndExisting('implement');
    const { params, sql } = await runUpsert({ auto_run: true });
    expect(params[17]).toBe(true);
    expect(sql).toMatch(/COALESCE\(\$18, false\)/);
    expect(sql).toMatch(/auto_run\s*=\s*COALESCE\(\$18, tracks\.auto_run\)/);
  });

  test('TC-1.6: omitted auto_run binds null, preserving the existing value via COALESCE', async () => {
    mockAuthAndExisting('implement');
    const { params } = await runUpsert({});
    expect(params[17]).toBeNull();
  });
});

describe('Phase 2 (TC-2.1-2.6): merge_mode / workspace_mode', () => {
  test('TC-2.1/2.2: payload value is bound for merge_mode', async () => {
    mockAuthAndExisting('implement');
    const { params, sql } = await runUpsert({ merge_mode: 'direct' });
    expect(params[18]).toBe('direct');
    expect(sql).toMatch(/merge_mode\s*=\s*COALESCE\(EXCLUDED\.merge_mode, tracks\.merge_mode\)/);
  });

  test('TC-2.3: omitted merge_mode binds null, preserving the existing value via COALESCE', async () => {
    mockAuthAndExisting('implement');
    const { params } = await runUpsert({});
    expect(params[18]).toBeNull();
  });

  test('TC-2.4/2.5: payload value is bound for workspace_mode', async () => {
    mockAuthAndExisting('implement');
    const { params, sql } = await runUpsert({ workspace_mode: 'main' });
    expect(params[19]).toBe('main');
    expect(sql).toMatch(/workspace_mode\s*=\s*COALESCE\(EXCLUDED\.workspace_mode, tracks\.workspace_mode\)/);
  });

  test('TC-2.6: omitted workspace_mode binds null, preserving the existing value via COALESCE', async () => {
    mockAuthAndExisting('implement');
    const { params } = await runUpsert({});
    expect(params[19]).toBeNull();
  });
});

describe('Phase 3 (TC-3.1-3.6): KPI columns', () => {
  test('TC-3.1: a full KPI payload binds every field, with kpi_snapshot JSON.stringify-ed', async () => {
    mockAuthAndExisting('implement');
    const { params } = await runUpsert({
      track_type: 'marketing',
      kpi_target: 100,
      kpi_metric: 'HN score',
      kpi_source: 'hn-api',
      kpi_source_config: 'item=123',
      kpi_threshold: 50,
      kpi_window: '48h',
      kpi_snapshot: { raw: 1 },
      kpi_maps_to: 'signups',
    });
    expect(params[21]).toBe('marketing'); // track_type
    expect(params[22]).toBe(100); // kpi_target
    expect(params[24]).toBe('HN score'); // kpi_metric
    expect(params[25]).toBe('hn-api'); // kpi_source
    expect(params[26]).toBe('item=123'); // kpi_source_config
    expect(params[27]).toBe(50); // kpi_threshold
    expect(params[28]).toBe('48h'); // kpi_window
    expect(params[29]).toBe(JSON.stringify({ raw: 1 })); // kpi_snapshot
    expect(typeof params[29]).toBe('string');
    expect(params[33]).toBe('signups'); // kpi_maps_to
  });

  test('TC-3.2: omitted track_type defaults to dev on insert and COALESCEs with a dev fallback on update', async () => {
    mockAuthAndExisting('implement');
    const { params, sql } = await runUpsert({});
    expect(params[21]).toBe('dev');
    expect(sql).toMatch(/track_type\s*=\s*COALESCE\(EXCLUDED\.track_type, tracks\.track_type, 'dev'\)/);
  });

  test('TC-3.3/3.4: kpi_actual — payload value binds, and the update clause COALESCEs to preserve an omitted one', async () => {
    mockAuthAndExisting('implement');
    const withValue = await runUpsert({ kpi_actual: 42 });
    expect(withValue.params[23]).toBe(42);
    expect(withValue.sql).toMatch(/kpi_actual\s*=\s*COALESCE\(EXCLUDED\.kpi_actual, tracks\.kpi_actual\)/);

    mockAuthAndExisting('implement');
    const omitted = await runUpsert({});
    expect(omitted.params[23]).toBeNull();
  });

  test('TC-3.5: kpi_check_after is the one KPI field that is NEVER COALESCEd — omitted still overwrites', async () => {
    mockAuthAndExisting('implement');
    const { params, sql } = await runUpsert({}); // kpi_check_after omitted
    expect(params[31]).toBeNull();
    expect(sql).toMatch(/kpi_check_after\s*=\s*EXCLUDED\.kpi_check_after/);
    expect(sql).not.toMatch(/kpi_check_after\s*=\s*COALESCE/);
  });

  test('TC-3.6: remaining KPI fields (parameterized) bind their payload value and COALESCE on omit', async () => {
    const fields = [
      ['kpi_measured_at', 30, '2026-09-10T00:00:00Z'],
      ['kpi_scheduled_at', 32, '2026-09-11T00:00:00Z'],
    ];
    for (const [field, idx, value] of fields) {
      mockAuthAndExisting('implement');
      const withValue = await runUpsert({ [field]: value });
      expect(withValue.params[idx]).toBe(value);
      expect(withValue.sql).toMatch(new RegExp(`${field}\\s*=\\s*COALESCE\\(EXCLUDED\\.${field}, tracks\\.${field}\\)`));

      mockAuthAndExisting('implement');
      const omitted = await runUpsert({});
      expect(omitted.params[idx]).toBeNull();
    }
  });
});

describe('Phase 4 (TC-4.1-4.3): model_override', () => {
  test('TC-4.1/4.2: payload value is bound for model_override', async () => {
    mockAuthAndExisting('implement');
    const { params, sql } = await runUpsert({ model_override: 'claude-opus-4-5' });
    expect(params[20]).toBe('claude-opus-4-5');
    expect(sql).toMatch(/model_override\s*=\s*COALESCE\(EXCLUDED\.model_override, tracks\.model_override\)/);
  });

  test('TC-4.3: omitted model_override binds null, preserving the existing value via COALESCE', async () => {
    mockAuthAndExisting('implement');
    const { params } = await runUpsert({});
    expect(params[20]).toBeNull();
  });
});
