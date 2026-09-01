// server/tests/track-10040-prespawn-block-api.test.mjs
// Track 10040 Phase 5 (REQ-1, REQ-8): POST /track/:num/prespawn-block and
// its /reset counterpart — real endpoint, real local Postgres, same
// reasoning as track-10012-inbox-buckets.test.mjs.

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import pg from 'pg';
import { app } from '../index.mjs';

const { Pool } = pg;

const pool = new Pool({
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? 5432),
  database: process.env.DB_NAME ?? 'laneconductor',
  user: process.env.DB_USER ?? 'postgres',
  password: process.env.DB_PASSWORD ?? 'postgres',
});

let dbAvailable = true;
try {
  await pool.query('SELECT 1');
} catch {
  dbAvailable = false;
}

let projectId;

beforeAll(async () => {
  if (!dbAvailable) return;
  const r = await pool.query(
    `INSERT INTO projects (name, repo_path) VALUES ($1, $2) RETURNING id`,
    ['track-10040-prespawn-block-test', `/tmp/track-10040-prespawn-block-test-${Date.now()}`]
  );
  projectId = r.rows[0].id;
});

afterAll(async () => {
  if (dbAvailable && projectId) {
    await pool.query('DELETE FROM projects WHERE id = $1', [projectId]);
  }
  await pool.end();
});

afterEach(async () => {
  if (dbAvailable) await pool.query('DELETE FROM tracks WHERE project_id = $1', [projectId]);
});

async function createTrack(trackNumber) {
  const r = await pool.query(
    `INSERT INTO tracks (project_id, track_number, title, lane_status, lane_action_status)
     VALUES ($1, $2, $3, 'plan', 'running') RETURNING id`,
    [projectId, trackNumber, `Test track ${trackNumber}`]
  );
  return r.rows[0].id;
}

describe.skipIf(!dbAvailable)('POST /track/:num/prespawn-block (Track 10040 REQ-1, REQ-8)', () => {
  it('TC-18: two consecutive calls return count 1 then count 2, and the row reflects kind/reason/blocked_at', async () => {
    await createTrack('301');

    const first = await request(app)
      .post('/track/301/prespawn-block')
      .query({ project_id: projectId })
      .send({ kind: 'dirty-checkout', reason: 'D ui/node_modules' });
    expect(first.status).toBe(200);
    expect(first.body.count).toBe(1);

    const second = await request(app)
      .post('/track/301/prespawn-block')
      .query({ project_id: projectId })
      .send({ kind: 'dirty-checkout', reason: 'D ui/node_modules' });
    expect(second.status).toBe(200);
    expect(second.body.count).toBe(2);

    const row = await pool.query(
      'SELECT prespawn_block_count, prespawn_block_kind, prespawn_block_reason, prespawn_blocked_at FROM tracks WHERE project_id = $1 AND track_number = $2',
      [projectId, '301']
    );
    expect(row.rows[0].prespawn_block_count).toBe(2);
    expect(row.rows[0].prespawn_block_kind).toBe('dirty-checkout');
    expect(row.rows[0].prespawn_block_reason).toBe('D ui/node_modules');
    expect(row.rows[0].prespawn_blocked_at).not.toBeNull();
  });

  it('TC-19: /reset zeroes the count and clears kind/reason', async () => {
    await createTrack('302');
    await request(app).post('/track/302/prespawn-block').query({ project_id: projectId }).send({ kind: 'main-mode-lock', reason: 'lock held' });
    await request(app).post('/track/302/prespawn-block').query({ project_id: projectId }).send({ kind: 'main-mode-lock', reason: 'lock held' });

    const resetRes = await request(app).post('/track/302/prespawn-block/reset').query({ project_id: projectId });
    expect(resetRes.status).toBe(200);

    const row = await pool.query(
      'SELECT prespawn_block_count, prespawn_block_kind, prespawn_block_reason, prespawn_blocked_at FROM tracks WHERE project_id = $1 AND track_number = $2',
      [projectId, '302']
    );
    expect(row.rows[0].prespawn_block_count).toBe(0);
    expect(row.rows[0].prespawn_block_kind).toBeNull();
    expect(row.rows[0].prespawn_block_reason).toBeNull();
    expect(row.rows[0].prespawn_blocked_at).toBeNull();
  });

  it('TC-20 (AC-7): escalation state is readable from the DB with no filesystem access, and survives a simulated worker restart', async () => {
    await createTrack('303');
    for (let i = 0; i < 5; i++) {
      await request(app).post('/track/303/prespawn-block').query({ project_id: projectId }).send({ kind: 'expired-credentials', reason: 'token expired' });
    }
    // Simulated restart: a fresh pool query, no in-memory state, no fs read.
    const row = await pool.query(
      'SELECT prespawn_block_count, prespawn_block_kind, prespawn_block_reason FROM tracks WHERE project_id = $1 AND track_number = $2',
      [projectId, '303']
    );
    expect(row.rows[0].prespawn_block_count).toBe(5);
    expect(row.rows[0].prespawn_block_kind).toBe('expired-credentials');
    expect(row.rows[0].prespawn_block_reason).toBe('token expired');
  });

  it('TC-21: unknown track number returns a clean 404, never a 500', async () => {
    const res = await request(app)
      .post('/track/999999/prespawn-block')
      .query({ project_id: projectId })
      .send({ kind: 'dirty-checkout', reason: 'x' });
    expect(res.status).toBe(404);
  });

  it('TC-22: missing kind is rejected with 400, not silently counted', async () => {
    await createTrack('304');
    const res = await request(app)
      .post('/track/304/prespawn-block')
      .query({ project_id: projectId })
      .send({ reason: 'no kind supplied' });
    expect(res.status).toBe(400);
  });
});
