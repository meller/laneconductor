// server/tests/track-10040-claim-reason.test.mjs
// Track 10040 Phase 1 (REQ-13, REQ-14): POST /tracks/claim-queue used to
// filter lane_status against a hand-typed literal that omitted 'done'
// (fixed once already in bede5ab, but as an inline literal that could
// drift again) and a zero-row claim was indistinguishable from a lost
// race. This file exercises the real endpoint against a real local
// Postgres — the only way to pin what the SQL actually returns, the same
// reasoning track-10012-inbox-buckets.test.mjs uses for its CASE
// expression. Skips itself when no local Postgres is reachable.

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
    ['track-10040-claim-reason-test', `/tmp/track-10040-claim-reason-test-${Date.now()}`]
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

async function insertTrack(overrides = {}) {
  const r = await pool.query(
    `INSERT INTO tracks (project_id, track_number, title, lane_status, lane_action_status)
     VALUES ($1, $2, $3, $4, $5) RETURNING id, track_number`,
    [
      projectId,
      overrides.track_number ?? String(Math.floor(Math.random() * 1_000_000)),
      overrides.title ?? 'claim-reason test track',
      overrides.lane_status ?? 'implement',
      overrides.lane_action_status ?? 'queue',
    ]
  );
  return r.rows[0];
}

describe.skipIf(!dbAvailable)('POST /tracks/claim-queue — reason (Track 10040 REQ-13/14)', () => {
  it('TC-55 (AC-12): a done:queue track is claimable — regression guard for bede5ab', async () => {
    const track = await insertTrack({ lane_status: 'done', lane_action_status: 'queue' });

    // Prove this test is load-bearing: the pre-fix literal omitted 'done'
    // and would have returned zero rows for this exact row.
    const preFix = await pool.query(
      `SELECT id FROM tracks WHERE project_id = $1 AND lane_action_status = 'queue'
         AND lane_status IN ('plan', 'implement', 'review', 'quality-gate') AND track_number = $2`,
      [projectId, track.track_number]
    );
    expect(preFix.rows.length).toBe(0);

    const res = await request(app)
      .post(`/tracks/claim-queue?project_id=${projectId}`)
      .send({ track_number: track.track_number, limit: 1 });

    expect(res.status).toBe(200);
    expect(res.body.tracks).toHaveLength(1);
    expect(res.body.tracks[0].track_number).toBe(track.track_number);
    expect(res.body.reason).toBeNull();
  });

  it('TC-57 (AC-14): already_claimed — targeted claim of a running track', async () => {
    const track = await insertTrack({ lane_action_status: 'running' });
    const res = await request(app)
      .post(`/tracks/claim-queue?project_id=${projectId}`)
      .send({ track_number: track.track_number, limit: 1 });

    expect(res.status).toBe(200);
    expect(res.body.tracks).toHaveLength(0);
    expect(res.body.reason).toBe('already_claimed');
  });

  it('TC-58 (AC-14): lane_not_claimable — targeted claim of a backlog track', async () => {
    const track = await insertTrack({ lane_status: 'backlog', lane_action_status: 'queue' });
    const res = await request(app)
      .post(`/tracks/claim-queue?project_id=${projectId}`)
      .send({ track_number: track.track_number, limit: 1 });

    expect(res.status).toBe(200);
    expect(res.body.tracks).toHaveLength(0);
    expect(res.body.reason).toBe('lane_not_claimable');
  });

  it('TC-59 (AC-14): no_candidates — targeted claim of a nonexistent track number', async () => {
    const res = await request(app)
      .post(`/tracks/claim-queue?project_id=${projectId}`)
      .send({ track_number: 'nonexistent-999999', limit: 1 });

    expect(res.status).toBe(200);
    expect(res.body.tracks).toHaveLength(0);
    expect(res.body.reason).toBe('no_candidates');
  });

  it('TC-61: a successful claim reports reason: null', async () => {
    const track = await insertTrack({ lane_status: 'plan', lane_action_status: 'queue' });
    const res = await request(app)
      .post(`/tracks/claim-queue?project_id=${projectId}`)
      .send({ track_number: track.track_number, limit: 1 });

    expect(res.status).toBe(200);
    expect(res.body.tracks).toHaveLength(1);
    expect(res.body.reason).toBeNull();
  });

  it('TC-62: an untargeted zero-row claim reports reason: null (idle polling stays cheap)', async () => {
    // No tracks in this project at all.
    const res = await request(app)
      .post(`/tracks/claim-queue?project_id=${projectId}`)
      .send({ limit: 5 });

    expect(res.status).toBe(200);
    expect(res.body.tracks).toHaveLength(0);
    expect(res.body.reason).toBeNull();
  });

  it('TC-56 (AC-13, webhook half): a human comment on a done-lane track re-wakes the worker', async () => {
    const track = await insertTrack({
      track_number: 'webhook-done-test',
      lane_status: 'done',
      lane_action_status: 'waiting',
    });

    const res = await request(app)
      .post(`/track/${track.track_number}/comment?project_id=${projectId}`)
      .send({ author: 'human', body: 'please continue' });

    expect(res.status).toBe(201);

    const row = await pool.query(
      `SELECT lane_action_status FROM tracks WHERE id = $1`,
      [track.id]
    );
    expect(row.rows[0].lane_action_status).toBe('queue');
  });
});
