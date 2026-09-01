// server/tests/track-10047-session-endpoints.test.mjs
// Track 10047 (TC-11, TC-12, TC-13): the stateful resume_count/
// last_context_tokens behavior lives in POST /track/:num/session's own
// SQL (an ON CONFLICT ... CASE/COALESCE), not in JS — track-1086-
// sessions.test.mjs mocks pool.query entirely, so it can verify the right
// SQL text got sent but not that Postgres actually executes it correctly.
// This runs the real endpoint against a real local Postgres to prove the
// stateful part: resume_count increments on the same session id, resets
// on a different one, and last_context_tokens is preserved (never nulled)
// by a POST that doesn't supply context_tokens.

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
    ['track-10047-session-endpoints-test', `/tmp/track-10047-session-test-${Date.now()}`]
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
    await pool.query('DELETE FROM track_sessions WHERE worker_id IN (SELECT id FROM workers WHERE project_id = $1)', [projectId]);
    await pool.query('DELETE FROM workers WHERE project_id = $1', [projectId]);
  }
});

async function insertWorkerWithToken(machineToken) {
  const r = await pool.query(
    `INSERT INTO workers (project_id, hostname, pid, mode, type, last_heartbeat, machine_token)
     VALUES ($1, $2, $3, 'sync+poll', 'project', NOW(), $4) RETURNING id`,
    [projectId, 'test-host', Math.floor(Math.random() * 100000) + 1, machineToken]
  );
  return r.rows[0].id;
}

describe.skipIf(!dbAvailable)('POST/GET /track/:num/session — resume_count and last_context_tokens (Track 10047)', () => {
  it('TC-11: resume_count goes 0 -> 1 -> 2 across repeat POSTs with the SAME claude_session_id', async () => {
    const token = `mtoken-tc11-${Date.now()}`;
    await insertWorkerWithToken(token);
    const trackNumber = String(Math.floor(Math.random() * 1_000_000));
    const sessionId = '11111111-1111-1111-1111-111111111111';

    await request(app).post(`/track/${trackNumber}/session`).set('Authorization', `Bearer ${token}`)
      .send({ claude_session_id: sessionId }).expect(200);
    let res = await request(app).get(`/track/${trackNumber}/session`).set('Authorization', `Bearer ${token}`).expect(200);
    expect(res.body.resume_count).toBe(0);

    await request(app).post(`/track/${trackNumber}/session`).set('Authorization', `Bearer ${token}`)
      .send({ claude_session_id: sessionId }).expect(200);
    res = await request(app).get(`/track/${trackNumber}/session`).set('Authorization', `Bearer ${token}`).expect(200);
    expect(res.body.resume_count).toBe(1);

    await request(app).post(`/track/${trackNumber}/session`).set('Authorization', `Bearer ${token}`)
      .send({ claude_session_id: sessionId }).expect(200);
    res = await request(app).get(`/track/${trackNumber}/session`).set('Authorization', `Bearer ${token}`).expect(200);
    expect(res.body.resume_count).toBe(2);
  });

  it('TC-12: resume_count resets to 0 when a POST supplies a DIFFERENT claude_session_id', async () => {
    const token = `mtoken-tc12-${Date.now()}`;
    await insertWorkerWithToken(token);
    const trackNumber = String(Math.floor(Math.random() * 1_000_000));

    await request(app).post(`/track/${trackNumber}/session`).set('Authorization', `Bearer ${token}`)
      .send({ claude_session_id: '11111111-1111-1111-1111-111111111111' }).expect(200);
    await request(app).post(`/track/${trackNumber}/session`).set('Authorization', `Bearer ${token}`)
      .send({ claude_session_id: '11111111-1111-1111-1111-111111111111' }).expect(200);
    let res = await request(app).get(`/track/${trackNumber}/session`).set('Authorization', `Bearer ${token}`).expect(200);
    expect(res.body.resume_count).toBe(1);

    // A fresh session id (e.g. a cap-triggered cold-start, or a resume-failure recovery)
    await request(app).post(`/track/${trackNumber}/session`).set('Authorization', `Bearer ${token}`)
      .send({ claude_session_id: '22222222-2222-2222-2222-222222222222' }).expect(200);
    res = await request(app).get(`/track/${trackNumber}/session`).set('Authorization', `Bearer ${token}`).expect(200);
    expect(res.body.claude_session_id).toBe('22222222-2222-2222-2222-222222222222');
    expect(res.body.resume_count).toBe(0);
  });

  it('TC-13: a POST without context_tokens does not erase a previously measured value', async () => {
    const token = `mtoken-tc13-${Date.now()}`;
    await insertWorkerWithToken(token);
    const trackNumber = String(Math.floor(Math.random() * 1_000_000));
    const sessionId = '33333333-3333-3333-3333-333333333333';

    await request(app).post(`/track/${trackNumber}/session`).set('Authorization', `Bearer ${token}`)
      .send({ claude_session_id: sessionId, context_tokens: 250000 }).expect(200);
    let res = await request(app).get(`/track/${trackNumber}/session`).set('Authorization', `Bearer ${token}`).expect(200);
    expect(res.body.last_context_tokens).toBe(250000);

    // Second POST for the same session, no context_tokens supplied (e.g. a
    // non-claude CLI run, or extraction failed) — must preserve 250000.
    await request(app).post(`/track/${trackNumber}/session`).set('Authorization', `Bearer ${token}`)
      .send({ claude_session_id: sessionId }).expect(200);
    res = await request(app).get(`/track/${trackNumber}/session`).set('Authorization', `Bearer ${token}`).expect(200);
    expect(res.body.last_context_tokens).toBe(250000);
    expect(res.body.resume_count).toBe(1);
  });
});
