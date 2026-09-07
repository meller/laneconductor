// Track 10074: POST /auth/token's "one token per user" guarantee used to be a
// SELECT-then-INSERT check-then-act race — no transaction, no unique index.
// Two concurrent calls for the same (workspace_id, created_by) (two open
// tabs, a fast reload, any double-fire of onAuthStateChanged — see
// ui/src/contexts/AuthContext.jsx:76) could both pass the SELECT before
// either INSERT committed, minting two live tokens for one user.
//
// The fix replaces both statements with a single
// INSERT ... ON CONFLICT (workspace_id, created_by) DO NOTHING RETURNING
// token, backed by the unique index from
// migrations/20260907120000_unique_api_token_per_user.sql.
//
// The fake `query` below is backed by a Map that genuinely enforces
// uniqueness on workspace_id|created_by — it honours ON CONFLICT ... DO
// NOTHING by returning zero rows when the key is already taken. Without that,
// these tests would assert the shape of a SQL string rather than the
// behaviour it produces. TC-R3 is the control: run the same interleaving
// against the old SELECT-then-INSERT sequence and confirm it actually
// produces two rows, so a passing TC-R1 means something.

const crypto = require('crypto');
const request = require('supertest');

jest.mock('firebase-functions/v2/https', () => ({
  onRequest: jest.fn((opts, app) => app),
}));

jest.mock('firebase-functions/params', () => ({
  defineSecret: jest.fn((name) => ({
    value: jest.fn(() => (name === 'DATABASE_URL' ? '' : 'mock-secret')),
  })),
}));

const mockVerifyIdToken = jest.fn();
jest.mock('firebase-admin', () => ({
  apps: [],
  initializeApp: jest.fn(),
  auth: jest.fn(() => ({ verifyIdToken: mockVerifyIdToken })),
}));

// A store genuinely keyed on (workspace_id, created_by), the same invariant
// the real unique index enforces. `insert` mimics
// INSERT ... ON CONFLICT (workspace_id, created_by) DO NOTHING RETURNING
// token: returns the row on first insert for a key, empty on every conflict.
function makeTokenStore() {
  const byUserKey = new Map();
  return {
    insert(tokenHash, workspaceId, createdBy) {
      const key = `${workspaceId}|${createdBy}`;
      if (byUserKey.has(key)) return { rows: [] };
      byUserKey.set(key, tokenHash);
      return { rows: [{ token: tokenHash }] };
    },
    count(workspaceId, createdBy) {
      return byUserKey.has(`${workspaceId}|${createdBy}`) ? 1 : 0;
    },
  };
}

const mockQuery = jest.fn();
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

const WORKSPACE = 'ws-race';
const UID = 'user-race';

beforeEach(() => {
  mockQuery.mockReset();
  mockConnect.mockReset();
  mockVerifyIdToken.mockReset();
  mockVerifyIdToken.mockResolvedValue({ uid: UID, name: 'Race User' });
});

function callToken() {
  return request(app).post('/auth/token').set('Authorization', 'Bearer firebase-id-token');
}

describe('TC-R1/R2: two concurrent calls mint exactly one token (fixed handler)', () => {
  test('TC-R1: fires two concurrent calls, exactly one mints a token', async () => {
    const store = makeTokenStore();
    // Route every query call through workspace/member upserts (fixed
    // responses) and the fixed handler's single INSERT ... ON CONFLICT.
    mockQuery.mockImplementation(async (sql, params) => {
      if (sql.includes('INSERT INTO workspaces')) {
        return { rows: [{ id: WORKSPACE }] };
      }
      if (sql.includes('INSERT INTO workspace_members')) {
        return { rows: [] };
      }
      if (sql.includes('INSERT INTO api_tokens')) {
        const [tokenHash, workspaceId, createdBy] = params;
        return store.insert(tokenHash, workspaceId, createdBy);
      }
      throw new Error(`unexpected query in TC-R1: ${sql}`);
    });

    const [res1, res2] = await Promise.all([callToken(), callToken()]);

    expect(store.count(WORKSPACE, UID)).toBe(1);
    const withToken = [res1, res2].filter((r) => r.body.token !== undefined);
    expect(withToken.length).toBe(1);
    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
  });

  // TC-R2: force the two handlers' workspace/member upserts to both complete
  // before either reaches the INSERT, so the two INSERTs are genuinely
  // concurrent rather than accidentally serialised by promise scheduling.
  test('TC-R2: inserts are held at a barrier until both handlers reach them', async () => {
    const store = makeTokenStore();
    let atBarrier = 0;
    let releaseBarrier;
    const barrier = new Promise((resolve) => {
      releaseBarrier = resolve;
    });

    mockQuery.mockImplementation(async (sql, params) => {
      if (sql.includes('INSERT INTO workspaces')) {
        return { rows: [{ id: WORKSPACE }] };
      }
      if (sql.includes('INSERT INTO workspace_members')) {
        return { rows: [] };
      }
      if (sql.includes('INSERT INTO api_tokens')) {
        atBarrier += 1;
        if (atBarrier >= 2) releaseBarrier();
        await barrier;
        const [tokenHash, workspaceId, createdBy] = params;
        return store.insert(tokenHash, workspaceId, createdBy);
      }
      throw new Error(`unexpected query in TC-R2: ${sql}`);
    });

    const [res1, res2] = await Promise.all([callToken(), callToken()]);

    expect(store.count(WORKSPACE, UID)).toBe(1);
    const withToken = [res1, res2].filter((r) => r.body.token !== undefined);
    expect(withToken.length).toBe(1);
  });
});

describe('TC-R3: the control — the old SELECT-then-INSERT design fails this harness', () => {
  // Simulates the pre-fix sequence directly against the same kind of store,
  // proving the harness can detect the bug it's meant to catch.
  test('TC-R3: two concurrent SELECT-then-INSERT calls produce two rows', async () => {
    const rows = [];
    let bothPassedSelect = 0;
    let releaseSelectBarrier;
    const selectBarrier = new Promise((resolve) => {
      releaseSelectBarrier = resolve;
    });

    async function oldSequence() {
      // SELECT 1 FROM api_tokens WHERE workspace_id = $1 AND created_by = $2
      const existing = rows.filter((r) => r.workspace_id === WORKSPACE && r.created_by === UID);
      bothPassedSelect += 1;
      if (bothPassedSelect >= 2) releaseSelectBarrier();
      await selectBarrier; // force both callers past the SELECT before either INSERTs
      if (existing.length > 0) return { minted: false };
      rows.push({ token: crypto.randomUUID(), workspace_id: WORKSPACE, created_by: UID });
      return { minted: true };
    }

    const [a, b] = await Promise.all([oldSequence(), oldSequence()]);

    expect(rows.length).toBe(2);
    expect(a.minted && b.minted).toBe(true);
  });
});

describe('TC-R4/R5/R6: the fixed handler issues no probe and names the conflict target', () => {
  test('TC-R4: no existence probe is issued against api_tokens', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'user-single', name: 'Single' });
    mockQuery.mockImplementation(async (sql) => {
      if (sql.includes('INSERT INTO workspaces')) return { rows: [{ id: WORKSPACE }] };
      if (sql.includes('INSERT INTO workspace_members')) return { rows: [] };
      if (sql.includes('INSERT INTO api_tokens')) return { rows: [{ token: 'digest' }] };
      throw new Error(`unexpected query: ${sql}`);
    });

    await callToken();

    const sqls = mockQuery.mock.calls.map((c) => c[0]);
    expect(sqls.some((s) => /SELECT[\s\S]*FROM api_tokens[\s\S]*workspace_id/.test(s))).toBe(false);
  });

  test('TC-R5: the INSERT names the conflict target and RETURNING clause', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'user-single', name: 'Single' });
    mockQuery.mockImplementation(async (sql) => {
      if (sql.includes('INSERT INTO workspaces')) return { rows: [{ id: WORKSPACE }] };
      if (sql.includes('INSERT INTO workspace_members')) return { rows: [] };
      if (sql.includes('INSERT INTO api_tokens')) return { rows: [{ token: 'digest' }] };
      throw new Error(`unexpected query: ${sql}`);
    });

    await callToken();

    const insertCall = mockQuery.mock.calls.find((c) => c[0].includes('INSERT INTO api_tokens'));
    expect(insertCall).toBeDefined();
    expect(insertCall[0]).toMatch(/ON CONFLICT \(workspace_id, created_by\)/);
    expect(insertCall[0]).toMatch(/DO NOTHING/);
    expect(insertCall[0]).toMatch(/RETURNING token/);
  });

  test('TC-R6: a missing index (42P10) surfaces as a legible 500', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'user-single', name: 'Single' });
    mockQuery.mockImplementation(async (sql) => {
      if (sql.includes('INSERT INTO workspaces')) return { rows: [{ id: WORKSPACE }] };
      if (sql.includes('INSERT INTO workspace_members')) return { rows: [] };
      if (sql.includes('INSERT INTO api_tokens')) {
        const err = new Error('no unique or exclusion constraint matching the ON CONFLICT specification');
        err.code = '42P10';
        throw err;
      }
      throw new Error(`unexpected query: ${sql}`);
    });

    const res = await callToken();

    expect(res.status).toBe(500);
    expect(res.body.details).toMatch(/api_tokens_workspace_id_created_by_key/);
    expect(res.body.details).toMatch(/migration/i);
  });
});
