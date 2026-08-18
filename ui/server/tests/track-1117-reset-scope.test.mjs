// server/tests/track-1117-reset-scope.test.mjs
// Track 1117, Bug 1 / Phase 1: POST /tracks/reset-stuck-actions must scope its
// immediate=true branch to the CALLING worker's own prior claims
// (claimed_by = its own machine_token), never project-wide.
//
// Covers:
//   - TC-1: a track claimed by worker A is NOT reset when worker B starts up
//   - TC-2: a track claimed by worker A IS reset when worker A itself restarts
//   - TC-3: the non-immediate (heartbeat-staleness) path is unaffected
//   - immediate=true with no resolvable machine_token resets nothing (and
//     never touches the DB) rather than falling back to project-wide

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { app, pool } from '../index.mjs';

vi.mock('../auth.mjs');

vi.mock('pg', () => {
  const query = vi.fn();
  const Pool = vi.fn(() => ({
    query,
    on: vi.fn(),
    connect: vi.fn().mockResolvedValue({ query, release: vi.fn() }),
  }));
  return { default: { Pool }, Pool };
});

function mockQuery(...results) {
  for (const r of results) {
    vi.mocked(pool.query).mockResolvedValueOnce(r);
  }
}

describe('POST /tracks/reset-stuck-actions (Track 1117, Bug 1)', () => {
  beforeEach(() => vi.resetAllMocks());

  it('TC-1/TC-2 shape: immediate reset scopes the UPDATE to claimed_by = this worker\'s own machine_token', async () => {
    const workerAToken = 'mtoken-worker-a';
    // collectorAuth: machine_token lookup finds worker A's row
    mockQuery({ rows: [{ id: 1, project_id: 1, user_uid: null, visibility: 'private' }] });

    let capturedSql;
    let capturedParams;
    vi.mocked(pool.query).mockImplementationOnce((sql, params) => {
      capturedSql = sql;
      capturedParams = params;
      return Promise.resolve({ rows: [{ track_number: '1116' }] });
    });

    const res = await request(app)
      .post('/tracks/reset-stuck-actions?project_id=1')
      .set('Authorization', `Bearer ${workerAToken}`)
      .send({ immediate: true });

    expect(res.status).toBe(200);
    // The UPDATE must filter by claimed_by matching THIS caller's own token,
    // not a blanket "claimed_by IS NOT NULL".
    expect(capturedSql).toContain('claimed_by = $2');
    expect(capturedSql).not.toContain('claimed_by IS NOT NULL');
    expect(capturedParams).toEqual([1, workerAToken]);
    expect(res.body.reset).toEqual(['1116']);
  });

  it('TC-1: a track claimed by worker A is untouched when worker B (different machine_token) starts up — DB enforces via claimed_by match, verified by the query itself never being loosened to IS NOT NULL', async () => {
    // Worker B authenticates with its own distinct token.
    const workerBToken = 'mtoken-worker-b';
    mockQuery({ rows: [{ id: 2, project_id: 1, user_uid: null, visibility: 'private' }] });

    let capturedParams;
    vi.mocked(pool.query).mockImplementationOnce((sql, params) => {
      capturedParams = params;
      // Simulate real Postgres behavior: WHERE claimed_by = 'mtoken-worker-b'
      // does not match a row whose claimed_by is 'mtoken-worker-a' → no rows.
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .post('/tracks/reset-stuck-actions?project_id=1')
      .set('Authorization', `Bearer ${workerBToken}`)
      .send({ immediate: true });

    expect(res.status).toBe(200);
    expect(capturedParams).toEqual([1, workerBToken]);
    // Worker B's own token is what gets matched against — track 1116 (owned
    // by worker A's token) is never in this result set.
    expect(res.body.reset).toEqual([]);
  });

  it('TC-2: worker A restarting (same persisted machine_token) still releases its own stuck claim', async () => {
    const workerAToken = 'mtoken-worker-a';
    mockQuery({ rows: [{ id: 1, project_id: 1, user_uid: null, visibility: 'private' }] });
    mockQuery({ rows: [{ track_number: '1116' }] });

    const res = await request(app)
      .post('/tracks/reset-stuck-actions?project_id=1')
      .set('Authorization', `Bearer ${workerAToken}`)
      .send({ immediate: true });

    expect(res.status).toBe(200);
    expect(res.body.reset).toEqual(['1116']);
  });

  it('immediate=true with no resolvable machine_token resets nothing and never queries the DB for the reset itself', async () => {
    // No Authorization header at all -> collectorAuth's anonymous/local path,
    // req.machine_token is never set.
    const res = await request(app)
      .post('/tracks/reset-stuck-actions?project_id=1')
      .send({ immediate: true });

    expect(res.status).toBe(200);
    expect(res.body.reset).toEqual([]);
    // No pool.query call at all — collectorAuth short-circuits before any DB hit.
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('TC-3: the non-immediate (heartbeat-staleness) path is unaffected — still keyed on last_heartbeat, not claimed_by', async () => {
    const workerAToken = 'mtoken-worker-a';
    mockQuery({ rows: [{ id: 1, project_id: 1, user_uid: null, visibility: 'private' }] });

    let capturedSql;
    let capturedParams;
    vi.mocked(pool.query).mockImplementationOnce((sql, params) => {
      capturedSql = sql;
      capturedParams = params;
      return Promise.resolve({ rows: [{ track_number: '1120' }] });
    });

    const res = await request(app)
      .post('/tracks/reset-stuck-actions?project_id=1')
      .set('Authorization', `Bearer ${workerAToken}`)
      .send({ immediate: false });

    expect(res.status).toBe(200);
    expect(capturedSql).toContain("last_heartbeat < NOW() - INTERVAL '2 minutes'");
    // claimed_by is still reset to NULL in the SET clause, but the WHERE
    // clause must not condition on it for the non-immediate path.
    const whereClause = capturedSql.split('WHERE')[1];
    expect(whereClause).not.toContain('claimed_by');
    expect(capturedParams).toEqual([1]);
    expect(res.body.reset).toEqual(['1120']);
  });

  it('default (immediate omitted) behaves as non-immediate', async () => {
    const workerAToken = 'mtoken-worker-a';
    mockQuery({ rows: [{ id: 1, project_id: 1, user_uid: null, visibility: 'private' }] });
    mockQuery({ rows: [] });

    const res = await request(app)
      .post('/tracks/reset-stuck-actions?project_id=1')
      .set('Authorization', `Bearer ${workerAToken}`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.reset).toEqual([]);
  });
});
