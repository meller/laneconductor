// server/tests/track-10053-worker-token-header.test.mjs
// Track 10053 Phase 2 (REQ-2): X-Worker-Token resolves worker identity in
// collectorAuth.
//
// This closes a live local bug, not only a cloud one. A worker configured with
// an lc_ api key authenticates through collectorAuth's api_keys branch, which
// sets req.user_uid but never req.worker_id — so /track/:num/session answered
// `400 worker identity required` and session continuity (--resume) silently
// never engaged for that worker. Same real Postgres + supertest approach as
// track-10040-prespawn-block-api.test.mjs.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import pg from 'pg';
import { createHash, randomUUID } from 'node:crypto';
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

const API_KEY = `lc_10053_${randomUUID()}`;
const USER_UID = `user-10053-${randomUUID().slice(0, 8)}`;
const keyHash = createHash('sha256').update(API_KEY).digest('hex');

let projectId;
let workerA;
let workerB;
let tokenA;
let tokenB;

// track_sessions.claude_session_id is a uuid column, not text — the CLI's real
// session ids are UUIDs, and a non-UUID string makes the INSERT fail with a 500.
const SESSION_A = randomUUID();
const SESSION_B = randomUUID();

beforeAll(async () => {
  if (!dbAvailable) return;

  const p = await pool.query(
    'INSERT INTO projects (name, repo_path) VALUES ($1, $2) RETURNING id',
    ['track-10053-worker-token-test', `/tmp/track-10053-worker-token-${Date.now()}`]
  );
  projectId = p.rows[0].id;

  // workers.user_uid is FK-constrained to users(uid), so the owning user has
  // to exist before either worker row can.
  await pool.query(
    `INSERT INTO users (github_id, login, uid) VALUES ($1, $2, $3)
     ON CONFLICT DO NOTHING`,
    [`gh-${USER_UID}`, `login-${USER_UID}`, USER_UID]
  );

  await pool.query(
    'INSERT INTO api_keys (key_hash, key_prefix, user_uid, name) VALUES ($1, $2, $3, $4)',
    [keyHash, API_KEY.slice(0, 11), USER_UID, 'track-10053 test key']
  );

  tokenA = `machine-a-${randomUUID()}`;
  tokenB = `machine-b-${randomUUID()}`;

  const a = await pool.query(
    `INSERT INTO workers (project_id, hostname, pid, status, machine_token, user_uid, visibility)
     VALUES ($1, 'host-a', 1001, 'idle', $2, $3, 'private') RETURNING id`,
    [projectId, tokenA, USER_UID]
  );
  workerA = a.rows[0].id;

  const b = await pool.query(
    `INSERT INTO workers (project_id, hostname, pid, status, machine_token, user_uid, visibility)
     VALUES ($1, 'host-b', 1002, 'idle', $2, $3, 'private') RETURNING id`,
    [projectId, tokenB, USER_UID]
  );
  workerB = b.rows[0].id;
});

afterAll(async () => {
  if (dbAvailable && projectId) {
    await pool.query('DELETE FROM track_sessions WHERE worker_id = ANY($1)', [[workerA, workerB]]);
    await pool.query('DELETE FROM workers WHERE project_id = $1', [projectId]);
    await pool.query('DELETE FROM api_keys WHERE key_hash = $1', [keyHash]);
    await pool.query('DELETE FROM projects WHERE id = $1', [projectId]);
    await pool.query('DELETE FROM users WHERE uid = $1', [USER_UID]);
  }
  await pool.end();
});

describe.skipIf(!dbAvailable)('track 10053: X-Worker-Token in collectorAuth', () => {
  // TC-15 — the bug this fixes. An api-key bearer carries no worker identity;
  // the header supplies it, and the session route starts working.
  it('TC-15: an api-key bearer plus X-Worker-Token can read a session', async () => {
    await request(app)
      .post('/track/10053-a/session')
      .set('Authorization', `Bearer ${API_KEY}`)
      .set('X-Worker-Token', tokenA)
      .send({ claude_session_id: SESSION_A, context_tokens: 4321 })
      .expect(200);

    const res = await request(app)
      .get('/track/10053-a/session')
      .set('Authorization', `Bearer ${API_KEY}`)
      .set('X-Worker-Token', tokenA);

    expect(res.status).toBe(200);
    expect(res.body.claude_session_id).toBe(SESSION_A);
    expect(res.body.last_context_tokens).toBe(4321);
  });

  it('TC-15b: the same call without the header is still 400 — the header is what identifies the worker', async () => {
    const res = await request(app)
      .get('/track/10053-a/session')
      .set('Authorization', `Bearer ${API_KEY}`);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/worker identity/);
  });

  // TC-16 — the header supplements; it must never re-point an
  // already-identified caller. A machine_token bearer has already said which
  // worker this is, and letting a header override it would make worker
  // identity forgeable by anyone holding any valid machine token.
  it('TC-16: a machine-token bearer wins over a conflicting X-Worker-Token', async () => {
    await request(app)
      .post('/track/10053-b/session')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ claude_session_id: SESSION_B })
      .expect(200);

    // Bearer = worker A, header = worker B. The read must resolve as A.
    const res = await request(app)
      .get('/track/10053-b/session')
      .set('Authorization', `Bearer ${tokenA}`)
      .set('X-Worker-Token', tokenB);

    expect(res.status).toBe(200);
    expect(res.body.claude_session_id).toBe(SESSION_B);

    // And worker B genuinely has no session for that track, so the assertion
    // above could not have passed by coincidence.
    const rowsB = await pool.query(
      'SELECT 1 FROM track_sessions WHERE track_number = $1 AND worker_id = $2',
      ['10053-b', workerB]
    );
    expect(rowsB.rowCount).toBe(0);
  });

  it('an unrecognised X-Worker-Token is ignored locally, not rejected', async () => {
    // Deliberately unlike the cloud function, which 403s: a local collector is
    // single-tenant and already serves anonymous callers, so there is no
    // boundary to protect and rejecting would only break local setups.
    const res = await request(app)
      .get('/track/10053-a/session')
      .set('Authorization', `Bearer ${API_KEY}`)
      .set('X-Worker-Token', 'no-such-machine-token');

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/worker identity/);
  });

  it('resolves worker identity for the claim path too, not just sessions', async () => {
    const res = await request(app)
      .post('/tracks/claim-queue')
      .set('Authorization', `Bearer ${API_KEY}`)
      .set('X-Worker-Token', tokenA)
      .send({ limit: 1 });

    // No queued tracks exist for this scratch project, so the interesting
    // assertion is that it resolved a project and ran the claim at all rather
    // than erroring on a missing identity.
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.tracks)).toBe(true);
  });
});
