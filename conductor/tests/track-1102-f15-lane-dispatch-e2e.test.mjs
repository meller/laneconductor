#!/usr/bin/env node
// conductor/tests/track-1102-f15-lane-dispatch-e2e.test.mjs
// Track 1102 F15 Phase 15a: proves the sync-only dispatch bridge
// end-to-end through the REAL chain — the real Express collector API
// (ui/server/index.mjs, not the lightweight mock-collector.mjs every
// other track-1102 test uses), a real spawned sync-only worker, and a
// real PATCH /track/:num/lane request — the same request the Kanban
// board's drag-and-drop sends.
//
// Why this exists as its own file rather than reusing mock-collector.mjs:
// F5/F15's own tests (track-1102-f5-ui-dispatch.test.mjs,
// track-1102-f15-lane-reset-dispatch.test.mjs) prove the API *would*
// insert the right worker_dispatch row (mocked pg pool, supertest,
// in-process). F8/F9/F12/F21's tests prove a real worker *claims and
// runs* a dispatch that already exists (mock-collector.mjs, a hand-rolled
// fake). Neither proves the two halves connect — that the real endpoint's
// real INSERT is what a real worker's real poll picks up. That gap is
// exactly what "confirmed by unit test alone" means, the thing this whole
// track exists to distrust.
//
// Runs the real ui/server/index.mjs as a child process against the
// scratch `laneconductor_dev` database (schema stood up via
// prisma/schema.sql + cloud/schema.sql, matching atlas.hcl's own `dev`
// database — NOT the live `laneconductor` DB). No live-system access.
//
// Run: node --test conductor/tests/track-1102-f15-lane-dispatch-e2e.test.mjs

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execSync } from 'node:child_process';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const MOCK_CLI = join(__dirname, 'mock-cli.mjs');
const TMP = join(ROOT, '.test-tmp-track-1102-f15-e2e');

const DB_CONFIG = {
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? 5432),
  database: 'laneconductor_dev',
  user: process.env.DB_USER ?? 'postgres',
  password: process.env.DB_PASSWORD ?? 'postgres',
};

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function poll(fn, { timeout = 20000, interval = 300, label = '' } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await fn();
    if (result) return result;
    await sleep(interval);
  }
  throw new Error(`poll timeout (${timeout}ms)${label ? ': ' + label : ''}`);
}

let pool;
let dbAvailable = true;
try {
  pool = new pg.Pool(DB_CONFIG);
  await pool.query('SELECT 1');
  // Sanity check the schema this test needs actually exists — if not,
  // this test can't tell "DB unreachable" apart from "schema missing"
  // without this, and would otherwise fail with a confusing SQL error.
  await pool.query('SELECT 1 FROM worker_dispatch LIMIT 0');
} catch (err) {
  dbAvailable = false;
  console.warn(`[F15 E2E] laneconductor_dev unreachable or missing schema, skipping: ${err.message}`);
}

let apiProc, workerProc, apiPort, projectId, trackDbId;

function setupProjectDir() {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(join(TMP, 'conductor/tracks'), { recursive: true });
  execSync('git init -q', { cwd: TMP });

  writeFileSync(join(TMP, '.laneconductor.json'), JSON.stringify({
    mode: 'local-api',
    project: { name: 'f15-e2e-test-project', repo_path: TMP, primary: { cli: 'mock', model: 'mock' } },
    collectors: [{ url: `http://127.0.0.1:${apiPort}`, token: null }],
    ui: { port: 0 },
  }, null, 2));

  mkdirSync(join(TMP, 'conductor/tracks'), { recursive: true });
  writeFileSync(join(TMP, 'conductor/workflow.json'), JSON.stringify({
    global: { total_parallel_limit: 3 },
    defaults: { parallel_limit: 1, max_retries: 1, primary_model: 'mock' },
    lanes: { review: { parallel_limit: 1, max_retries: 1 } },
  }, null, 2));

  const trackDir = join(TMP, 'conductor/tracks/1104-f15-e2e-track');
  mkdirSync(trackDir, { recursive: true });
  writeFileSync(join(trackDir, 'index.md'), [
    '# Track 1104: F15 E2E Track',
    '',
    '**Lane**: implement',
    '**Lane Status**: success',
    '**Progress**: 100%',
  ].join('\n'));
  writeFileSync(join(trackDir, 'plan.md'), '# Plan\n\n## Phase 1\n\n**Problem**: unrelated.\n');

  // TC-15a.2 target — a second track for the /reset path, kept separate
  // from 1104 so the two tests' dispatch rows can't be confused for
  // each other when polling by track_number.
  const trackDir2 = join(TMP, 'conductor/tracks/1105-f15-e2e-reset-track');
  mkdirSync(trackDir2, { recursive: true });
  writeFileSync(join(trackDir2, 'index.md'), [
    '# Track 1105: F15 E2E Reset Track',
    '',
    '**Lane**: review',
    '**Lane Status**: failure',
    '**Progress**: 60%',
  ].join('\n'));
  writeFileSync(join(trackDir2, 'plan.md'), '# Plan\n\n## Phase 1\n\n**Problem**: unrelated.\n');

  // TC-15a.3 target — a third track, used only for the negative case
  // (a sync+poll worker present means the bridge must NOT dispatch).
  const trackDir3 = join(TMP, 'conductor/tracks/1106-f15-e2e-negative-track');
  mkdirSync(trackDir3, { recursive: true });
  writeFileSync(join(trackDir3, 'index.md'), [
    '# Track 1106: F15 E2E Negative Track',
    '',
    '**Lane**: implement',
    '**Lane Status**: success',
    '**Progress**: 100%',
  ].join('\n'));
  writeFileSync(join(trackDir3, 'plan.md'), '# Plan\n\n## Phase 1\n\n**Problem**: unrelated.\n');

  execSync('git add -A', { cwd: TMP });
  execSync('git -c user.email=t@t -c user.name=t commit -q -m init', { cwd: TMP });
}

async function findFreePort() {
  const { createServer } = await import('node:net');
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

describe('Track 1102 F15 Phase 15a: real dispatch bridge, end to end', { skip: !dbAvailable ? 'laneconductor_dev unreachable/missing schema' : false }, () => {
  before(async () => {
    apiPort = await findFreePort();

    // Real ui/server/index.mjs, pointed at the SCRATCH db, on a free port —
    // deliberately NOT NODE_ENV=test (that skips server.listen() entirely)
    // and NOT setting any Firebase env vars (keeps AUTH_ENABLED false, i.e.
    // local-api's zero-auth mode — collectorAuth allows anonymous access
    // when no COLLECTOR_0_TOKEN is configured).
    apiProc = spawn('node', ['server/index.mjs'], {
      cwd: join(ROOT, 'ui'),
      env: { ...process.env, DB_HOST: DB_CONFIG.host, DB_PORT: String(DB_CONFIG.port), DB_NAME: 'laneconductor_dev', DB_USER: DB_CONFIG.user, DB_PASSWORD: DB_CONFIG.password, API_PORT: String(apiPort) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    apiProc.stdout.on('data', d => process.stdout.write(`[api] ${d}`));
    apiProc.stderr.on('data', d => process.stderr.write(`[api] ${d}`));

    await poll(async () => {
      try {
        const r = await fetch(`http://127.0.0.1:${apiPort}/api/health`);
        return r.ok || null;
      } catch { return null; }
    }, { label: 'real API server listening' });

    setupProjectDir();

    workerProc = spawn('node', [join(ROOT, 'conductor/laneconductor.sync.mjs'), '--sync-only'], {
      cwd: TMP,
      env: { ...process.env, LC_MOCK_CLI: `node ${MOCK_CLI}`, MOCK_CLI_DELAY_MS: '300', LC_DISPATCH_POLL_MS: '500' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    workerProc.stdout.on('data', d => process.stdout.write(`[worker] ${d}`));
    workerProc.stderr.on('data', d => process.stderr.write(`[worker] ${d}`));

    // Wait for the worker to have registered itself AND the project via the
    // real API — read straight from the DB rather than guessing an API
    // shape, since this test's job is to prove the DB ends up right.
    const proj = await poll(async () => {
      const { rows } = await pool.query(`SELECT id FROM projects WHERE repo_path = $1`, [TMP]);
      return rows[0] || null;
    }, { label: 'project registered' });
    projectId = proj.id;

    await poll(async () => {
      const { rows } = await pool.query(`SELECT id FROM workers WHERE project_id = $1`, [projectId]);
      return rows.length > 0 ? rows : null;
    }, { label: 'worker registered' });

    const track = await poll(async () => {
      const { rows } = await pool.query(`SELECT id FROM tracks WHERE project_id = $1 AND track_number = '1104'`, [projectId]);
      return rows[0] || null;
    }, { label: 'track synced to DB' });
    trackDbId = track.id;

    await poll(async () => {
      const { rows } = await pool.query(`SELECT id FROM tracks WHERE project_id = $1 AND track_number = '1105'`, [projectId]);
      return rows[0] || null;
    }, { label: 'track 1105 synced to DB' });

    await poll(async () => {
      const { rows } = await pool.query(`SELECT id FROM tracks WHERE project_id = $1 AND track_number = '1106'`, [projectId]);
      return rows[0] || null;
    }, { label: 'track 1106 synced to DB' });
  });

  after(async () => {
    workerProc?.kill();
    apiProc?.kill();
    await sleep(300);
    if (pool) {
      await pool.query('DELETE FROM worker_dispatch WHERE worker_id IN (SELECT id FROM workers WHERE project_id = $1)', [projectId]).catch(() => {});
      await pool.query('DELETE FROM workers WHERE project_id = $1', [projectId]).catch(() => {});
      await pool.query('DELETE FROM track_comments WHERE track_id = $1', [trackDbId]).catch(() => {});
      await pool.query('DELETE FROM tracks WHERE id = $1', [trackDbId]).catch(() => {});
      await pool.query('DELETE FROM projects WHERE id = $1', [projectId]).catch(() => {});
      await pool.end();
    }
    rmSync(TMP, { recursive: true, force: true });
  });

  it('PATCH /track/:num/lane creates a worker_dispatch row that the real worker claims and runs', async () => {
    // The real request the Kanban board's drag-and-drop sends — see
    // track-1102-f15-lane-reset-dispatch.test.mjs for the same shape
    // asserted against a mocked pool; this sends it for real.
    const res = await fetch(`http://127.0.0.1:${apiPort}/track/1104/lane?project_id=${projectId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lane_status: 'review' }),
    });
    assert.equal(res.status, 200, `PATCH /track/:num/lane should succeed, got ${res.status}: ${await res.text().catch(() => '')}`);

    const dispatchRow = await poll(async () => {
      const { rows } = await pool.query(
        `SELECT id, status, action FROM worker_dispatch WHERE track_number = '1104' ORDER BY id DESC LIMIT 1`
      );
      return rows[0] || null;
    }, { label: 'worker_dispatch row created' });

    assert.equal(dispatchRow.action, 'review', 'dispatch action should be the track\'s new lane');

    // The real worker must claim and finish it — 'pending' is the failure
    // mode this whole finding (F5's original symptom) is about.
    const finalDispatch = await poll(async () => {
      const { rows } = await pool.query(`SELECT status FROM worker_dispatch WHERE id = $1`, [dispatchRow.id]);
      const status = rows[0]?.status;
      return status && status !== 'pending' ? status : null;
    }, { timeout: 15000, label: 'dispatch claimed and resolved (not stuck pending)' });

    assert.notEqual(finalDispatch, 'pending', 'dispatch must not be left pending — that is F5\'s original bug');
  });

  it('PATCH /track/:num/reset creates a worker_dispatch row the same way', async () => {
    const res = await fetch(`http://127.0.0.1:${apiPort}/track/1105/reset?project_id=${projectId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lane_status: 'implement' }),
    });
    assert.equal(res.status, 200, `PATCH /track/:num/reset should succeed, got ${res.status}: ${await res.text().catch(() => '')}`);

    const dispatchRow = await poll(async () => {
      const { rows } = await pool.query(
        `SELECT id, status, action FROM worker_dispatch WHERE track_number = '1105' ORDER BY id DESC LIMIT 1`
      );
      return rows[0] || null;
    }, { label: 'worker_dispatch row created for /reset' });

    assert.equal(dispatchRow.action, 'implement', 'dispatch action should be the reset track\'s new lane');

    const finalDispatch = await poll(async () => {
      const { rows } = await pool.query(`SELECT status FROM worker_dispatch WHERE id = $1`, [dispatchRow.id]);
      const status = rows[0]?.status;
      return status && status !== 'pending' ? status : null;
    }, { timeout: 15000, label: '/reset dispatch claimed and resolved' });

    assert.notEqual(finalDispatch, 'pending', '/reset dispatch must not be left pending either');
  });

  it('does NOT dispatch when a sync+poll worker is present for the project (the bridge\'s own precondition)', async () => {
    // Register a second worker for the same project directly in the DB,
    // mode='sync+poll' — dispatchIfSyncOnly()'s whole reason to exist is
    // "no poller exists to claim the queue flag otherwise"; with a poller
    // present, the bridge must stand down and let the normal queue path
    // handle it, or the track would double-run.
    await pool.query(
      `INSERT INTO workers (project_id, hostname, pid, worker_number, mode, type, last_heartbeat)
       VALUES ($1, 'fake-poller-host', 999998, 2, 'sync+poll', 'project', NOW())`,
      [projectId]
    );

    const res = await fetch(`http://127.0.0.1:${apiPort}/track/1106/lane?project_id=${projectId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lane_status: 'review' }),
    });
    assert.equal(res.status, 200);

    // Give the (nonexistent) dispatch every chance to appear before
    // asserting its absence — a poll that returns instantly on "not found"
    // would pass even if the bridge fired async and just hadn't landed yet.
    await sleep(2000);
    const { rows } = await pool.query(
      `SELECT id FROM worker_dispatch WHERE track_number = '1106'`
    );
    assert.equal(rows.length, 0, 'no dispatch should be created when a sync+poll worker exists for the project');

    await pool.query(`DELETE FROM workers WHERE project_id = $1 AND hostname = 'fake-poller-host'`, [projectId]);
  });
});
