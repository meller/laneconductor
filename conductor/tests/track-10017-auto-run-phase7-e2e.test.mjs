#!/usr/bin/env node
// conductor/tests/track-10017-auto-run-phase7-e2e.test.mjs
// Track 10017 Phase 7: subprocess-level E2E proving the auto_run gate works
// end-to-end through the REAL production endpoint — not a simulated file
// edit (that's what TC-9/TC-10 in local-fs-e2e.test.mjs already cover) and
// not a mocked collector (that's what local-api-e2e.test.mjs covers for the
// ordinary lane-transition path).
//
// Deliberate deviation from this suite's usual "no real DB" convention
// (tech-stack.md's testing table): `PATCH /api/projects/:id/tracks/:num/
// auto-run` and its `syncTrackToFile` DB→FS side effect live in
// ui/server/index.mjs, which is unconditionally Postgres-backed — there is
// no mock-collector equivalent for that endpoint (mock-collector.mjs only
// simulates the separate, smaller Collector API surface the worker itself
// talks to: /track, /worker/register, /track/:num/action — the UI-facing
// /api/projects/:id/... surface is a different, larger API only
// ui/server/index.mjs implements). Proving "the new endpoint" for real (per
// this track's own re-open note) requires the real Express app against a
// real Postgres. Kept from polluting the shared dev DB by using a
// uniquely-named throwaway repo_path (upserted via /project/ensure, exactly
// like a real worker's own startup does) and deleting that project row in
// `after()`.
//
// Mirrors track-10018-pr-flow-e2e.test.mjs's pattern otherwise: real spawned
// worker process, real git fixture, deliberately NOT setting
// LC_SKIP_GIT_LOCK — the real lock/worktree lifecycle runs for real.
//
// Run: DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD must point at a reachable
// Postgres with this project's schema already migrated (defaults match the
// local dev DB used throughout this repo — see ui/server/index.mjs).

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync, spawn } from 'node:child_process';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const MOCK_CLI = join(__dirname, 'mock-cli.mjs');
const BASE = join(ROOT, '.test-tmp-track-10017-phase7-e2e');
const ORIGIN = join(BASE, 'origin.git');
const LOCAL = join(BASE, 'local');
const TRACK_NUM = '19978'; // fake, distinct from every other fixture's track-number range
const TRACK_DIR_NAME = `${TRACK_NUM}-auto-run-phase7-e2e`;
const REPO_PATH_FOR_DB = LOCAL; // unique per test run's tmp dir — safe upsert key

const dbConfig = {
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? 5432),
  database: process.env.DB_NAME ?? 'laneconductor',
  user: process.env.DB_USER ?? 'postgres',
  password: process.env.DB_PASSWORD ?? 'postgres',
};

function git(cmd, cwd) {
  return execSync(`git ${cmd}`, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}
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

function indexPath() {
  return join(LOCAL, 'conductor/tracks', TRACK_DIR_NAME, 'index.md');
}

function readIndex() {
  return existsSync(indexPath()) ? readFileSync(indexPath(), 'utf8') : null;
}

function getLaneStatus(content) {
  return content?.match(/\*\*Lane Status\*\*:\s*([^\n]+)/i)?.[1]?.trim() ?? null;
}

function getLane(content) {
  return content?.match(/\*\*Lane\*\*:\s*([^\n]+)/i)?.[1]?.trim() ?? null;
}

function getAutoRunMarker(content) {
  return content?.match(/\*\*Auto Run\*\*:\s*([^\n]+)/i)?.[1]?.trim() ?? null;
}

function setupFixture(apiPort) {
  rmSync(BASE, { recursive: true, force: true });
  mkdirSync(BASE, { recursive: true });

  git(`init -q --bare "${ORIGIN}"`);
  git(`symbolic-ref HEAD refs/heads/main`, ORIGIN);
  git(`clone -q "${ORIGIN}" "${LOCAL}"`, BASE);
  git('config user.email t@t', LOCAL);
  git('config user.name t', LOCAL);

  writeFileSync(join(LOCAL, 'README.md'), 'init\n');
  git('add -A', LOCAL);
  git('commit -q -m init', LOCAL);
  git('branch -m main', LOCAL);
  git('push -q -u origin main', LOCAL);

  mkdirSync(join(LOCAL, 'conductor/tracks'), { recursive: true });
  writeFileSync(join(LOCAL, 'conductor/workflow.json'), JSON.stringify({
    global: { total_parallel_limit: 3 },
    defaults: { parallel_limit: 1, max_retries: 1, primary_model: 'mock', on_success: null, on_failure: null },
    lanes: {
      implement: { parallel_limit: 1, max_retries: 1, on_success: 'review', on_failure: 'implement' },
    },
  }, null, 2));

  // No **Auto Run** marker — the default-closed case this whole track exists
  // to gate, seeded straight into implement:queue like a real dispatched
  // track waiting for auto-launch pickup.
  const trackDir = join(LOCAL, 'conductor/tracks', TRACK_DIR_NAME);
  mkdirSync(trackDir, { recursive: true });
  writeFileSync(join(trackDir, 'index.md'), [
    `# Track ${TRACK_NUM}: Auto Run Phase 7 E2E`,
    '',
    '**Lane**: implement',
    '**Lane Status**: queue',
    '**Progress**: 0%',
    '',
    '## Problem',
    'Test problem.',
    '',
    '## Solution',
    'Test solution.',
  ].join('\n'));
  git('add -A', LOCAL);
  git('commit -q -m "seed track"', LOCAL);
  git('push -q origin main', LOCAL);

  // .laneconductor.json — project.id filled in by the caller once
  // /project/ensure has returned a real row for this fixture's unique
  // repo_path (see registerProject below); this file is (re)written after
  // that call resolves.
  writeFileSync(join(LOCAL, '.laneconductor.json'), JSON.stringify({
    mode: 'local-api',
    project: { name: 'track-10017-phase7-e2e', repo_path: LOCAL, primary: { cli: 'mock', model: 'mock' } },
    collectors: [{ url: `http://127.0.0.1:${apiPort}`, token: null }],
    ui: { port: 8090 },
  }, null, 2));
}

async function registerProject(apiPort) {
  const res = await fetch(`http://127.0.0.1:${apiPort}/project/ensure`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'track-10017-phase7-e2e', repo_path: REPO_PATH_FOR_DB, primary_cli: 'mock', primary_model: 'mock' }),
  });
  if (!res.ok) throw new Error(`/project/ensure failed: ${res.status} ${await res.text()}`);
  const { project_id } = await res.json();

  const cfgPath = join(LOCAL, '.laneconductor.json');
  const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
  cfg.project.id = project_id;
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));

  return project_id;
}

function startApiServer(apiPort) {
  const server = spawn('node', [join(ROOT, 'ui/server/index.mjs')], {
    cwd: join(ROOT, 'ui'),
    env: {
      ...process.env,
      API_PORT: String(apiPort),
      DB_HOST: dbConfig.host, DB_PORT: String(dbConfig.port), DB_NAME: dbConfig.database,
      DB_USER: dbConfig.user, DB_PASSWORD: dbConfig.password,
      NODE_ENV: 'development', // must NOT be 'test' — that skips server.listen()
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', d => process.stdout.write(`[api] ${d}`));
  server.stderr.on('data', d => process.stderr.write(`[api] ${d}`));
  return server;
}

function startWorker(apiPort) {
  const worker = spawn('node', [join(ROOT, 'conductor/laneconductor.sync.mjs')], {
    cwd: LOCAL,
    env: {
      ...process.env,
      LC_MOCK_CLI: `node ${MOCK_CLI}`,
      MOCK_CLI_EXIT_CODE: '0',
      MOCK_CLI_DELAY_MS: '200',
      // Deliberately NOT setting LC_SKIP_GIT_LOCK — real lock/worktree
      // lifecycle, matching track-10018-pr-flow-e2e's pattern.
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  worker.stdout.on('data', d => process.stdout.write(`[worker] ${d}`));
  worker.stderr.on('data', d => process.stderr.write(`[worker] ${d}`));
  return worker;
}

async function waitForApiHealth(apiPort) {
  await poll(async () => {
    try {
      const res = await fetch(`http://127.0.0.1:${apiPort}/api/health`);
      return res.ok ? true : null;
    } catch {
      return null;
    }
  }, { label: 'API server health check', timeout: 15000 });
}

describe('Track 10017 Phase 7: subprocess E2E for the auto_run gate + real endpoint', () => {
  let apiServer, worker, apiPort, projectId;
  const pgClient = new pg.Client(dbConfig);

  before(async () => {
    await pgClient.connect();
    apiPort = 20000 + Math.floor(Math.random() * 10000);
  });

  after(async () => {
    try {
      // Cascades to this fixture's own tracks row(s) — never touches any
      // other project, since repo_path is unique to this test run's tmp dir.
      await pgClient.query('DELETE FROM projects WHERE repo_path = $1', [REPO_PATH_FOR_DB]);
    } catch (err) {
      console.warn('[cleanup] failed to delete throwaway project row:', err.message);
    }
    await pgClient.end();
    rmSync(BASE, { recursive: true, force: true });
  });

  it('a queued track with no **Auto Run** marker is left alone; PATCH .../auto-run unblocks it and the real worker runs it to completion', async () => {
    setupFixture(apiPort);

    apiServer = startApiServer(apiPort);
    await waitForApiHealth(apiPort);
    projectId = await registerProject(apiPort);

    worker = startWorker(apiPort);
    try {
      // ── Phase A: not auto-run — untouched by the real worker's poll loop ──
      await sleep(6000);
      const beforeContent = readIndex();
      assert.equal(getLaneStatus(beforeContent), 'queue', 'no CLI process should have spawned yet');
      assert.equal(getLane(beforeContent), 'implement', 'lane must not have moved either');

      // ── Phase B: toggle via the REAL production endpoint (not a file edit) ──
      const patchRes = await fetch(`http://127.0.0.1:${apiPort}/api/projects/${projectId}/tracks/${TRACK_NUM}/auto-run`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ auto_run: true }),
      });
      assert.equal(patchRes.status, 200, 'PATCH .../auto-run must succeed against the real DB-backed endpoint');
      const patchBody = await patchRes.json();
      assert.equal(patchBody.ok, true);

      // The endpoint awaits syncTrackToFile — the marker must already be on
      // disk by the time the response comes back, no polling needed here.
      const afterPatch = readIndex();
      assert.equal(getAutoRunMarker(afterPatch), 'yes', 'PATCH must write **Auto Run**: yes into index.md via syncTrackToFile (REQ-4)');

      // Confirm the DB row itself reflects it too, independent of the file.
      const { rows } = await pgClient.query(
        'SELECT auto_run FROM tracks WHERE project_id = $1 AND track_number = $2',
        [projectId, TRACK_NUM]
      );
      assert.equal(rows[0]?.auto_run, true, 'tracks.auto_run must be true in the real DB row');

      // ── Phase C: the real worker's NEXT poll cycle picks it up and runs it
      //             through to completion (implement → review, per workflow.json) ──
      await poll(() => {
        const c = readIndex();
        return getLane(c) === 'review' ? c : null;
      }, { label: 'lane → review (real worker actually ran the mock CLI action)', timeout: 20000 });

      const finalContent = readIndex();
      assert.equal(getLane(finalContent), 'review');
      assert.equal(getLaneStatus(finalContent), 'queue', 'new lane status resets to queue so the next auto-action can trigger');
    } finally {
      worker?.kill('SIGTERM');
      apiServer?.kill('SIGTERM');
      await sleep(500);
    }
  });
});
