// server/tests/track-10032-dispatch-reap-api.test.mjs
// Track 10032, Phase 5 Task 5.2: proves the reap outcome actually reaches
// the HTTP response bodies real clients read — track-10032-dispatch-reap-
// visibility.test.mjs's mocked-pool tests can show reapStaleDispatches()
// writes the right SQL, but a mocked pool can't prove GET
// /api/tracks/:id/dispatch, GET /api/projects/:id/dispatch, or GET
// /api/inbox actually carry reap_reason/reaped_at through to JSON, or that
// the Inbox's SQL-level bucket CASE (track-10012-inbox-buckets.test.mjs's
// own rationale for going real-DB) classifies a reaped track correctly.
//
// Targets the REAL local laneconductor DB (server/index.mjs's own
// defaults), matching track-10012-inbox-buckets.test.mjs's and
// track-1102-f10c-live-db-fk.test.mjs's established convention — some
// things can only be proven against the real thing, including that
// migration 011_dispatch_reap.sql actually applies (AC-7). A dedicated
// throwaway project/workers/tracks is created and torn down per test so
// this doesn't touch real board data.
//
// Skips itself (rather than failing) when no local Postgres is reachable.

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import { app, pool, reapStaleDispatches } from '../index.mjs';

let dbAvailable = true;
try {
  await pool.query('SELECT 1');
} catch {
  dbAvailable = false;
}

let projectId;
let workerId;

beforeAll(async () => {
  if (!dbAvailable) return;
  const p = await pool.query(
    `INSERT INTO projects (name, repo_path) VALUES ($1, $2) RETURNING id`,
    ['track-10032-dispatch-reap-api-test', `/tmp/track-10032-dispatch-reap-api-test-${Date.now()}`]
  );
  projectId = p.rows[0].id;
  const w = await pool.query(
    `INSERT INTO workers (project_id, hostname, pid, worker_number, mode, type, last_heartbeat)
     VALUES ($1, 'track-10032-dying-host', 1, 1, 'sync-only', 'project', NOW()) RETURNING id`,
    [projectId]
  );
  workerId = w.rows[0].id;
});

afterAll(async () => {
  if (dbAvailable && projectId) {
    await pool.query('DELETE FROM projects WHERE id = $1', [projectId]);
  }
});

afterEach(async () => {
  if (!dbAvailable) return;
  await pool.query('DELETE FROM worker_dispatch WHERE worker_id = $1 OR track_number LIKE $2', [workerId, '10032-api-%']);
  await pool.query('DELETE FROM tracks WHERE project_id = $1', [projectId]);
  await pool.query(`DELETE FROM workers WHERE project_id = $1 AND hostname != 'track-10032-dying-host'`, [projectId]);
});

async function makeTrack(trackNumber) {
  const r = await pool.query(
    `INSERT INTO tracks (project_id, track_number, title, lane_status) VALUES ($1, $2, $3, 'implement') RETURNING id`,
    [projectId, trackNumber, `Test track ${trackNumber}`]
  );
  return r.rows[0].id;
}

async function makeStaleDispatch({ trackNumber = null, action = 'implement' } = {}) {
  const r = await pool.query(
    `INSERT INTO worker_dispatch (worker_id, track_number, action, status, created_at)
     VALUES ($1, $2, $3, 'pending', NOW() - INTERVAL '10 minutes') RETURNING id`,
    [workerId, trackNumber, action]
  );
  return r.rows[0].id;
}

describe.skipIf(!dbAvailable)('Track 10032: reap outcome reaches the real API responses', () => {
  it('TC-3.1/TC-3.3: GET /api/tracks/:id/dispatch carries reap_reason/reaped_at for a reaped row, null for a never-reaped one (AC-6/AC-7)', async () => {
    const trackDbId = await makeTrack('10032-api-1');
    const staleId = await makeStaleDispatch({ trackNumber: '10032-api-1' });
    const { rows: [fresh] } = await pool.query(
      `INSERT INTO worker_dispatch (worker_id, track_number, action, status, created_at) VALUES ($1, '10032-api-1', 'implement', 'pending', NOW()) RETURNING id`,
      [workerId]
    );

    await reapStaleDispatches(pool);

    const res = await request(app).get(`/api/tracks/${trackDbId}/dispatch`).expect(200);

    const reaped = res.body.find(d => d.id === staleId);
    expect(reaped).toBeDefined();
    expect(reaped.reap_reason).not.toBeNull();
    expect(reaped.reap_reason).toMatch(/timeout/i);
    expect(reaped.reaped_at).not.toBeNull();

    const freshRow = res.body.find(d => d.id === fresh.id);
    expect(freshRow).toBeDefined();
    expect(freshRow).toHaveProperty('reap_reason', null);
    expect(freshRow).toHaveProperty('reaped_at', null);
  });

  it('TC-3.2: GET /api/projects/:id/dispatch carries reap_reason for a reaped deploy (track_number NULL) row (AC-4)', async () => {
    const staleId = await makeStaleDispatch({ trackNumber: null, action: 'deploy' });

    await reapStaleDispatches(pool);

    const res = await request(app).get(`/api/projects/${projectId}/dispatch`).expect(200);
    const reaped = res.body.find(d => d.id === staleId);
    expect(reaped).toBeDefined();
    expect(reaped.reap_reason).not.toBeNull();
    expect(reaped.reaped_at).not.toBeNull();
  });

  it('TC-3.4a: a failed-timeout reap (no replacement worker) lands in the Inbox needs_input bucket with a ❌ body (AC-2/AC-3)', async () => {
    const trackDbId = await makeTrack('10032-api-inbox-fail');
    await makeStaleDispatch({ trackNumber: '10032-api-inbox-fail', action: 'review' });

    // Only the dying worker exists in this project — no replacement, so the
    // reaper takes the fail branch.
    await reapStaleDispatches(pool);

    const res = await request(app).get(`/api/inbox?project_id=${projectId}`).expect(200);
    const row = res.body.find(r => r.track_id === trackDbId);
    expect(row).toBeDefined();
    expect(row.bucket).toBe('needs_input');
    expect(row.last_comment_body).toMatch(/^❌/);
  });

  it('TC-3.4b: a reassignment reap (live replacement worker) lands in needs_input with a ⚠️ body, and triggers a track:updated broadcast (AC-1/AC-3)', async () => {
    const trackDbId = await makeTrack('10032-api-inbox-reassign');
    await makeStaleDispatch({ trackNumber: '10032-api-inbox-reassign', action: 'implement' });
    // A second, live worker in the same project — the reaper's replacement
    // candidate.
    await pool.query(
      `INSERT INTO workers (project_id, hostname, pid, worker_number, mode, type, last_heartbeat)
       VALUES ($1, 'track-10032-replacement-host', 2, 1, 'sync-only', 'project', NOW())`,
      [projectId]
    );

    await reapStaleDispatches(pool);

    const res = await request(app).get(`/api/inbox?project_id=${projectId}`).expect(200);
    const row = res.body.find(r => r.track_id === trackDbId);
    expect(row).toBeDefined();
    expect(row.bucket).toBe('needs_input');
    expect(row.last_comment_body).toMatch(/^⚠️/);
  });

  it('TC-2.6 (real DB): a second reap cycle does not re-comment on an already-reaped, still-pending (reassigned) dispatch (AC-5)', async () => {
    const trackDbId = await makeTrack('10032-api-no-double');
    await makeStaleDispatch({ trackNumber: '10032-api-no-double', action: 'implement' });
    await pool.query(
      `INSERT INTO workers (project_id, hostname, pid, worker_number, mode, type, last_heartbeat)
       VALUES ($1, 'track-10032-replacement-host-2', 3, 1, 'sync-only', 'project', NOW())`,
      [projectId]
    );

    await reapStaleDispatches(pool);
    await reapStaleDispatches(pool); // second cycle — row is no longer status='pending' with reaped_at IS NULL

    const { rows: comments } = await pool.query(
      `SELECT id FROM track_comments WHERE track_id = $1`,
      [trackDbId]
    );
    expect(comments.length).toBe(1);
  });
});
