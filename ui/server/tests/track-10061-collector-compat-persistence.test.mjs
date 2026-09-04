// server/tests/track-10061-collector-compat-persistence.test.mjs
// Track 10061 Phase 4 (REQ-9, REQ-10): POST /worker/register persists
// collector_compat and collector_api_version, registration-only, never on
// the heartbeat path — same convention and same real-DB reasoning as
// track-10040-code-sha.test.mjs's identical assertion for code_sha.

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
    ['track-10061-compat-test', `/tmp/track-10061-compat-test-${Date.now()}`],
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
  if (dbAvailable) await pool.query('DELETE FROM workers WHERE project_id = $1', [projectId]);
});

describe.skipIf(!dbAvailable)('POST /worker/register — collector_compat (Track 10061)', () => {
  it('TC-27: collector_compat and collector_api_version are persisted at registration', async () => {
    const compat = { compatible: true, severity: 'missing-routes', apiVersionDelta: 0, missingRoutes: ['POST /tracks/claim-queue'], reason: 'x' };
    const res = await request(app)
      .post('/worker/register')
      .send({ hostname: 'track-10061-compat-host', pid: 11111, project_id: projectId, collector_api_version: 1, collector_compat: compat });

    expect(res.status).toBe(200);
    const row = await pool.query('SELECT collector_api_version, collector_compat FROM workers WHERE id = $1', [res.body.id]);
    expect(row.rows[0].collector_api_version).toBe(1);
    expect(row.rows[0].collector_compat).toEqual(compat);
  });

  it('TC-28: PATCH /worker/heartbeat never writes collector_compat / collector_api_version', async () => {
    const compat = { compatible: true, severity: 'ok', apiVersionDelta: 0, missingRoutes: [], reason: null };
    const registerRes = await request(app)
      .post('/worker/register')
      .send({ hostname: 'track-10061-compat-heartbeat-host', pid: 22222, project_id: projectId, collector_api_version: 1, collector_compat: compat });
    const workerId = registerRes.body.id;

    // Heartbeat bodies never carry these fields — the route must not
    // clobber the registration-time values (there's nothing to clobber
    // them WITH here, but the assertion is that the values a heartbeat
    // COULD carry are simply never read/written by that route at all).
    await request(app)
      .patch('/worker/heartbeat')
      .send({ hostname: 'track-10061-compat-heartbeat-host', pid: 22222, project_id: projectId, status: 'busy' });

    const row = await pool.query('SELECT collector_api_version, collector_compat FROM workers WHERE id = $1', [workerId]);
    expect(row.rows[0].collector_api_version).toBe(1);
    expect(row.rows[0].collector_compat).toEqual(compat);
  });

  it('TC-31/REQ-10: a worker that has not handshaken has NULL collector_compat, not a fabricated value', async () => {
    const res = await request(app)
      .post('/worker/register')
      .send({ hostname: 'track-10061-compat-null-host', pid: 33333, project_id: projectId });

    expect(res.status).toBe(200);
    const row = await pool.query('SELECT collector_api_version, collector_compat FROM workers WHERE id = $1', [res.body.id]);
    expect(row.rows[0].collector_api_version).toBeNull();
    expect(row.rows[0].collector_compat).toBeNull();
  });

  it('TC-29: the worker-list endpoints return both columns', async () => {
    const compat = { compatible: true, severity: 'version-drift', apiVersionDelta: -1, missingRoutes: [], reason: 'x' };
    await request(app)
      .post('/worker/register')
      .send({ hostname: 'track-10061-compat-list-host', pid: 44444, project_id: projectId, collector_api_version: 0, collector_compat: compat });

    const listRes = await request(app).get(`/api/projects/${projectId}/workers`);
    expect(listRes.status).toBe(200);
    const w = listRes.body.find((x) => x.hostname === 'track-10061-compat-list-host');
    expect(w).toBeTruthy();
    expect(w.collector_api_version).toBe(0);
    expect(w.collector_compat).toEqual(compat);

    const allRes = await request(app).get('/api/workers');
    expect(allRes.status).toBe(200);
    const w2 = allRes.body.find((x) => x.hostname === 'track-10061-compat-list-host');
    expect(w2).toBeTruthy();
    expect(w2.collector_compat).toEqual(compat);
  });

  it('TC-33: existing rows are unaffected — the migration leaves NULLs, not a default', async () => {
    // Simulate a pre-migration row by inserting without the new columns at
    // all (the columns are nullable with no default, so this is exactly
    // what every worker registered before this track looks like).
    const r = await pool.query(
      `INSERT INTO workers (project_id, hostname, pid, status) VALUES ($1, $2, $3, 'idle') RETURNING id`,
      [projectId, 'track-10061-pre-existing-host', 55555],
    );
    const row = await pool.query('SELECT collector_api_version, collector_compat FROM workers WHERE id = $1', [r.rows[0].id]);
    expect(row.rows[0].collector_api_version).toBeNull();
    expect(row.rows[0].collector_compat).toBeNull();
  });
});
