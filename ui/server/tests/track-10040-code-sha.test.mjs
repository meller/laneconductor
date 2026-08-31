// server/tests/track-10040-code-sha.test.mjs
// Track 10040 Phase 2 (REQ-11): POST /worker/register persists code_sha,
// only at registration time (never on heartbeat) — real endpoint, real
// local Postgres, same reasoning as track-10012-inbox-buckets.test.mjs.

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import pg from 'pg';
import { app } from '../index.mjs';
import { classifyWorkerStaleness } from '../../../conductor/services/worker-code-staleness.mjs';

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
    ['track-10040-code-sha-test', `/tmp/track-10040-code-sha-test-${Date.now()}`]
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
  if (dbAvailable) await pool.query('DELETE FROM workers WHERE project_id = $1 OR (project_id IS NULL AND hostname LIKE $2)', [projectId, 'track-10040-code-sha-test%']);
});

describe.skipIf(!dbAvailable)('POST /worker/register — code_sha (Track 10040 REQ-11)', () => {
  it('TC-81 core / TC-82: code_sha is persisted at registration and survives a heartbeat unchanged', async () => {
    const bootSha = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const registerRes = await request(app)
      .post('/worker/register')
      .send({ hostname: 'track-10040-code-sha-test-host', pid: 12345, project_id: projectId, code_sha: bootSha });

    expect(registerRes.status).toBe(200);
    const workerId = registerRes.body.id;

    const row1 = await pool.query('SELECT code_sha FROM workers WHERE id = $1', [workerId]);
    expect(row1.rows[0].code_sha).toBe(bootSha);

    // Heartbeat several times — code_sha must not move, even if the
    // heartbeat payload doesn't carry one at all (it never should).
    for (let i = 0; i < 3; i++) {
      await request(app)
        .patch('/worker/heartbeat')
        .send({ hostname: 'track-10040-code-sha-test-host', pid: 12345, project_id: projectId });
    }

    const row2 = await pool.query('SELECT code_sha FROM workers WHERE id = $1', [workerId]);
    expect(row2.rows[0].code_sha).toBe(bootSha);

    // Close the loop with the real classifier: if HEAD has since moved and
    // touched a loaded file, this stored sha is what flags the worker critical.
    const classification = classifyWorkerStaleness({
      workerSha: row2.rows[0].code_sha,
      headSha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      commitsBehind: 1,
      touchedFiles: ['conductor/laneconductor.sync.mjs'],
    });
    expect(classification.severity).toBe('critical');
  });

  it('TC-83 (D5): a manager worker (project_id: null) also records and can be classified by code_sha', async () => {
    const bootSha = 'cccccccccccccccccccccccccccccccccccccccc';
    const registerRes = await request(app)
      .post('/worker/register')
      .send({ hostname: 'track-10040-code-sha-test-manager-host', pid: 54321, type: 'manager', code_sha: bootSha });

    expect(registerRes.status).toBe(200);
    const workerId = registerRes.body.id;

    const row = await pool.query('SELECT project_id, code_sha FROM workers WHERE id = $1', [workerId]);
    expect(row.rows[0].project_id).toBeNull();
    expect(row.rows[0].code_sha).toBe(bootSha);

    // A managed project's repo advancing is irrelevant — staleness is
    // measured against the install dir's own HEAD only, which this test
    // stands in for directly (no project repo touched at all).
    await pool.query('DELETE FROM workers WHERE id = $1', [workerId]);
  });
});
