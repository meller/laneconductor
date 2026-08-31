// server/tests/track-10047-dispatch-explicit-action.test.mjs
// dispatchExplicitAction (formerly dispatchIfSyncOnly) only created a
// worker_dispatch row when `!hasPoller` -- i.e. only when NO sync+poll
// worker was live, assuming a sync+poll worker's own auto-launch polling
// would pick up any lane_action_status='queue' row on its own. That
// assumption predates track 10017's **Auto Run** gate on the auto-launch
// predicate (default no). Confirmed live 2026-08-31: POST .../implement
// against a track with a live sync+poll worker but no Auto Run marker
// returned 200, flipped lane_action_status to 'queue', and created NO
// dispatch row -- so nothing ever claimed it. This file exercises the
// real endpoint against a real local Postgres, with a real registered
// sync+poll worker present, the exact shape that reproduced the bug.

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
    ['track-10047-dispatch-explicit-action-test', `/tmp/track-10047-test-${Date.now()}`]
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
  if (dbAvailable) {
    await pool.query('DELETE FROM worker_dispatch WHERE track_number IN (SELECT track_number FROM tracks WHERE project_id = $1)', [projectId]);
    await pool.query('DELETE FROM tracks WHERE project_id = $1', [projectId]);
    await pool.query('DELETE FROM workers WHERE project_id = $1', [projectId]);
  }
});

async function insertTrack(overrides = {}) {
  const r = await pool.query(
    `INSERT INTO tracks (project_id, track_number, title, lane_status, lane_action_status)
     VALUES ($1, $2, $3, $4, $5) RETURNING id, track_number`,
    [
      projectId,
      overrides.track_number ?? String(Math.floor(Math.random() * 1_000_000)),
      overrides.title ?? 'dispatch-explicit-action test track',
      overrides.lane_status ?? 'implement',
      overrides.lane_action_status ?? 'success',
    ]
  );
  return r.rows[0];
}

async function insertSyncPollWorker() {
  const r = await pool.query(
    `INSERT INTO workers (project_id, hostname, pid, mode, type, last_heartbeat)
     VALUES ($1, $2, $3, 'sync+poll', 'project', NOW()) RETURNING id`,
    [projectId, 'test-host', Math.floor(Math.random() * 100000) + 1]
  );
  return r.rows[0].id;
}

describe.skipIf(!dbAvailable)('POST .../implement — dispatch bridge (Track 10047)', () => {
  it('creates a worker_dispatch row even when a live sync+poll worker is present', async () => {
    const track = await insertTrack();
    await insertSyncPollWorker();

    // Prove this test is load-bearing: the pre-fix condition
    // (!hasPoller && projectWorkers.length > 0) is false here on purpose,
    // since a sync+poll worker IS present -- the pre-fix code would have
    // skipped dispatch entirely.
    const res = await request(app)
      .post(`/api/projects/${projectId}/tracks/${track.track_number}/implement`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.dispatched).toBe(true);

    const dispatchRows = await pool.query(
      `SELECT track_number, action FROM worker_dispatch WHERE track_number = $1`,
      [track.track_number]
    );
    expect(dispatchRows.rows).toHaveLength(1);
    expect(dispatchRows.rows[0].action).toBe('implement');
  });

  it('still dispatches when only a sync-only worker is present (unchanged behavior)', async () => {
    const track = await insertTrack();
    await pool.query(
      `INSERT INTO workers (project_id, hostname, pid, mode, type, last_heartbeat)
       VALUES ($1, $2, $3, 'sync-only', 'project', NOW())`,
      [projectId, 'test-host-2', Math.floor(Math.random() * 100000) + 1]
    );

    const res = await request(app)
      .post(`/api/projects/${projectId}/tracks/${track.track_number}/implement`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.dispatched).toBe(true);
  });

  it('does not dispatch when no live worker exists at all', async () => {
    const track = await insertTrack();

    const res = await request(app)
      .post(`/api/projects/${projectId}/tracks/${track.track_number}/implement`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.dispatched).toBe(false);
  });
});
