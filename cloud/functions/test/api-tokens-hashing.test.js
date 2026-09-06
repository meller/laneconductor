// Track 10070: api_tokens stores a SHA-256 digest, never the raw bearer token.
//
// Reported externally as PR #1, whose diff hashed the incoming token on lookup
// but left both the stored rows and the issuing INSERT in plaintext — so on its
// own it would have broken every token instead of protecting any. These tests
// pin all three sides: issuance stores only a digest, verification compares
// digests, and a row still in the old plaintext form keeps working and is
// rehashed on its way through.
//
// The last part is what makes deploy ordering safe. scripts/deploy.sh applies
// migrations and leaves the function deploy to a manual step, so either order
// would otherwise have a window where every lc_ credential fails: hashes
// compared against plaintext rows, or plaintext compared against hashed rows.

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
const RAW_TOKEN = 'lc_aaaabbbbccccddddeeeeffff00001111222233334444555566667777';
const TOKEN_HASH = crypto.createHash('sha256').update(RAW_TOKEN).digest('hex');

/** Every SQL string the app ran, in order. */
const sqls = () => mockQuery.mock.calls.map((c) => c[0]);
/** Every bind parameter the app sent, flattened — what actually reaches the DB. */
const allParams = () => mockQuery.mock.calls.flatMap((c) => c[1] || []);
const findCall = (needle) => mockQuery.mock.calls.find((c) => c[0].includes(needle));

// mockReset, not jest.clearAllMocks: clearAllMocks drops recorded calls but
// leaves the mockResolvedValueOnce queue intact, so a test that queues more
// responses than it consumes shifts every assertion in the next test by one and
// fails somewhere far from the cause. Reset only these mocks — resetting the
// module factories would strip the pg Pool implementation the app caches.
beforeEach(() => {
  mockQuery.mockReset();
  mockClientQuery.mockReset();
  mockConnect.mockReset();
  mockVerifyIdToken.mockReset();
  mockRelease.mockClear();
  mockConnect.mockResolvedValue({ query: mockClientQuery, release: mockRelease });
  mockClientQuery.mockResolvedValue({ rows: [], rowCount: 0 });
});

describe('TC-1..TC-3: issuance stores only a digest (POST /auth/token)', () => {
  function mockSignup({ alreadyHasToken }) {
    mockVerifyIdToken.mockResolvedValue({ uid: 'user-1', name: 'Some One' });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: WORKSPACE }] }); // upsert workspaces
    mockQuery.mockResolvedValueOnce({ rows: [] });                  // upsert workspace_members
    mockQuery.mockResolvedValueOnce({ rows: alreadyHasToken ? [{}] : [] }); // existing-token probe
    // Queue the INSERT response only when the handler will get that far, so the
    // number of queued responses always matches the number consumed.
    if (!alreadyHasToken) mockQuery.mockResolvedValueOnce({ rows: [] }); // INSERT api_tokens
  }

  // TC-1 — the core invariant. What comes back over the wire and what lands in
  // the column must not be the same string.
  test('TC-1: stores the SHA-256 digest and returns the raw token to the caller', async () => {
    mockSignup({ alreadyHasToken: false });

    const res = await request(app)
      .post('/auth/token')
      .set('Authorization', 'Bearer firebase-id-token');

    expect(res.status).toBe(200);
    expect(res.body.token).toMatch(/^lc_[0-9a-f]{48}$/);
    expect(res.body.workspace_id).toBe(WORKSPACE);

    const insert = findCall('INSERT INTO api_tokens');
    expect(insert).toBeDefined();
    const stored = insert[1][0];
    expect(stored).not.toBe(res.body.token);
    expect(stored).toMatch(/^[0-9a-f]{64}$/);
    expect(stored).toBe(crypto.createHash('sha256').update(res.body.token).digest('hex'));
  });

  // TC-2 — the raw token must not reach the database by any other route either:
  // not as a second column, not in a later statement.
  test('TC-2: the raw token appears in no bind parameter of any statement', async () => {
    mockSignup({ alreadyHasToken: false });

    const res = await request(app)
      .post('/auth/token')
      .set('Authorization', 'Bearer firebase-id-token');

    expect(allParams()).not.toContain(res.body.token);
  });

  // TC-3 — the UI calls this on every onAuthStateChanged and throws the body
  // away, so unconditional minting accumulated one unusable live credential per
  // sign-in. A repeat caller now gets no token, because a digest cannot be
  // reversed to hand back the earlier one.
  test('TC-3: a caller who already has a token gets no new row and no token', async () => {
    mockSignup({ alreadyHasToken: true });

    const res = await request(app)
      .post('/auth/token')
      .set('Authorization', 'Bearer firebase-id-token');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ workspace_id: WORKSPACE });
    expect(res.body.token).toBeUndefined();
    expect(sqls().some((s) => s.includes('INSERT INTO api_tokens'))).toBe(false);
  });
});

describe('TC-4..TC-8: verification compares digests (auth())', () => {
  // TC-4 — a migrated row authenticates, and does so by digest.
  test('TC-4: a hashed api_tokens row authenticates', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ workspace_id: WORKSPACE, token: TOKEN_HASH }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 7, name: 'p' }] }); // /api/projects

    const res = await request(app)
      .get('/api/projects')
      .set('Authorization', `Bearer ${RAW_TOKEN}`);

    expect(res.status).toBe(200);
    const lookup = findCall('FROM api_tokens');
    expect(lookup[1][0]).toBe(TOKEN_HASH);
  });

  // TC-5 — a row nobody has migrated yet must keep working. This is the whole
  // reason the fix is safe to deploy in either order relative to the migration.
  test('TC-5: a legacy plaintext row still authenticates', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ workspace_id: WORKSPACE, token: RAW_TOKEN }] });
    mockQuery.mockResolvedValueOnce({ rows: [] }); // fire-and-forget rehash
    mockQuery.mockResolvedValueOnce({ rows: [] }); // /api/projects

    const res = await request(app)
      .get('/api/projects')
      .set('Authorization', `Bearer ${RAW_TOKEN}`);

    expect(res.status).toBe(200);
  });

  // TC-6 — and it must not stay plaintext. The table converges on its own, so
  // the plaintext arm of the lookup becomes dead code rather than a permanent
  // second way in.
  test('TC-6: authenticating a plaintext row rehashes it in place', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ workspace_id: WORKSPACE, token: RAW_TOKEN }] });
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await request(app).get('/api/projects').set('Authorization', `Bearer ${RAW_TOKEN}`);

    const rehash = findCall('UPDATE api_tokens SET token');
    expect(rehash).toBeDefined();
    expect(rehash[1]).toEqual([TOKEN_HASH, RAW_TOKEN]);
  });

  // TC-7 — the counterpart: an already-migrated row must not be rewritten on
  // every single request.
  test('TC-7: authenticating a hashed row issues no rehash', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ workspace_id: WORKSPACE, token: TOKEN_HASH }] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await request(app).get('/api/projects').set('Authorization', `Bearer ${RAW_TOKEN}`);

    expect(sqls().some((s) => s.includes('UPDATE api_tokens SET token'))).toBe(false);
  });

  // TC-8 — an unknown credential is still a rejection, not a fall-through.
  test('TC-8: an unknown lc_ token is rejected with 401', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // api_tokens miss
    mockQuery.mockResolvedValueOnce({ rows: [] }); // api_keys miss

    const res = await request(app)
      .get('/api/projects')
      .set('Authorization', 'Bearer lc_not_a_real_token');

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid api token/);
  });

  // The api_keys path was already hashed and must be untouched — in particular
  // it must reuse the one digest auth() computes, not a second one.
  test('the api_keys path still authenticates against the same digest', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });                          // api_tokens miss
    mockQuery.mockResolvedValueOnce({ rows: [{ user_uid: 'user-1' }] });    // api_keys hit
    mockQuery.mockResolvedValueOnce({ rows: [] });                          // last_used_at
    mockQuery.mockResolvedValueOnce({ rows: [{ workspace_id: WORKSPACE }] }); // members
    mockQuery.mockResolvedValueOnce({ rows: [] });                          // /api/projects

    const res = await request(app)
      .get('/api/projects')
      .set('Authorization', `Bearer ${RAW_TOKEN}`);

    expect(res.status).toBe(200);
    expect(findCall('FROM api_keys')[1]).toEqual([TOKEN_HASH]);
  });
});

describe('TC-9: the raw token stops travelling past auth()', () => {
  // /file-sync/claim used to stamp file_sync_queue.worker_id with req.api_token
  // — the caller's live bearer token, put at rest in a second table. The column
  // is only ever written and read back as an opaque label, never matched on, so
  // a digest prefix names the same caller without being a credential.
  test('TC-9: a file-sync claim labels the row with a digest prefix, not the token', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ workspace_id: WORKSPACE, token: TOKEN_HASH }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 7 }] }); // project in workspace
    mockClientQuery.mockResolvedValue({ rows: [] });

    const res = await request(app)
      .post('/file-sync/claim?project_id=7')
      .set('Authorization', `Bearer ${RAW_TOKEN}`)
      .send({ limit: 5 });

    expect(res.status).toBe(200);
    const claim = mockClientQuery.mock.calls.find((c) => c[0].includes('UPDATE file_sync_queue'));
    expect(claim).toBeDefined();
    const workerId = claim[1][1];
    expect(workerId).not.toBe(RAW_TOKEN);
    expect(workerId).toBe(TOKEN_HASH.slice(0, 12));
  });
});

describe('TC-10: the migration predicate is exact, not heuristic', () => {
  // migrations/20260906120000_hash_legacy_api_tokens.sql selects rows to rehash
  // with left(token, 3) = 'lc_'. That is only safe — and only idempotent — if a
  // digest can never look like a plaintext token. It can't: hex is [0-9a-f] and
  // 'l' is not a hex digit. Same property makes the `OR token = $2` arm of the
  // lookup address a disjoint set of rows from the digest arm.
  test('TC-10: no SHA-256 digest can be mistaken for an lc_ token', () => {
    for (let i = 0; i < 2000; i++) {
      const digest = crypto.createHash('sha256').update(`lc_candidate_${i}`).digest('hex');
      expect(digest).toMatch(/^[0-9a-f]{64}$/);
      expect(digest.startsWith('lc_')).toBe(false);
      expect(digest.slice(0, 3)).not.toBe('lc_');
    }
  });
});
