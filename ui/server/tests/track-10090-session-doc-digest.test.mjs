// server/tests/track-10090-session-doc-digest.test.mjs
// Track AM-10090 (TC-18, TC-19, TC-20): doc_digest round-trips through
// POST/GET /track/:num/session with the same COALESCE-preservation
// semantics last_context_tokens already has (track 10047). Mirrors
// track-10047-session-endpoints.test.mjs's real-DB pattern — the stateful
// COALESCE behavior lives in SQL, not JS, so it needs a real Postgres to
// actually prove.

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
    ['track-10090-session-doc-digest-test', `/tmp/track-10090-session-test-${Date.now()}`]
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

describe.skipIf(!dbAvailable)('POST/GET /track/:num/session — doc_digest (Track AM-10090)', () => {
  it('TC-18: doc_digest posted then fetched round-trips unchanged', async () => {
    const token = `mtoken-tc18-${Date.now()}`;
    await insertWorkerWithToken(token);
    const trackNumber = String(Math.floor(Math.random() * 1_000_000));
    const digest = 'a'.repeat(64);

    await request(app).post(`/track/${trackNumber}/session`).set('Authorization', `Bearer ${token}`)
      .send({ claude_session_id: '11111111-1111-1111-1111-111111111111', doc_digest: digest }).expect(200);
    const res = await request(app).get(`/track/${trackNumber}/session`).set('Authorization', `Bearer ${token}`).expect(200);
    expect(res.body.doc_digest).toBe(digest);
  });

  it('TC-19 (COALESCE): a POST omitting doc_digest preserves the previously stored value', async () => {
    const token = `mtoken-tc19-${Date.now()}`;
    await insertWorkerWithToken(token);
    const trackNumber = String(Math.floor(Math.random() * 1_000_000));
    const sessionId = '22222222-2222-2222-2222-222222222222';
    const digest = 'b'.repeat(64);

    await request(app).post(`/track/${trackNumber}/session`).set('Authorization', `Bearer ${token}`)
      .send({ claude_session_id: sessionId, doc_digest: digest }).expect(200);
    let res = await request(app).get(`/track/${trackNumber}/session`).set('Authorization', `Bearer ${token}`).expect(200);
    expect(res.body.doc_digest).toBe(digest);

    // Second POST for the same session, no doc_digest supplied (e.g. the
    // digest read failed, best-effort per REQ-14) — must preserve it.
    await request(app).post(`/track/${trackNumber}/session`).set('Authorization', `Bearer ${token}`)
      .send({ claude_session_id: sessionId }).expect(200);
    res = await request(app).get(`/track/${trackNumber}/session`).set('Authorization', `Bearer ${token}`).expect(200);
    expect(res.body.doc_digest).toBe(digest);
  });

  it('TC-20: GET for a track with no session row returns doc_digest: null, not undefined or an error', async () => {
    const token = `mtoken-tc20-${Date.now()}`;
    await insertWorkerWithToken(token);
    const trackNumber = String(Math.floor(Math.random() * 1_000_000));

    const res = await request(app).get(`/track/${trackNumber}/session`).set('Authorization', `Bearer ${token}`).expect(200);
    expect(res.body.doc_digest).toBeNull();
    expect(res.body.claude_session_id).toBeNull();
  });
});
