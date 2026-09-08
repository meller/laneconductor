// ui/server/tests/track-10079-abort-endpoint.test.mjs
// Track 10079 Phase 2: POST /api/projects/:id/tracks/:num/abort against the
// real Express app + a real local Postgres `projects` row, with a real
// spawned-then-signalled child standing in for the CLI process. See
// test.md TC-2.1..TC-2.7.

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import pg from 'pg';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { app } from '../index.mjs';
import { buildRunMarker, runMarkerPath } from '../../../conductor/services/run-marker.mjs';

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
let repoPath;

function writeLiveMarker(trackNumber, child) {
  const marker = buildRunMarker({
    pid: child.pid, pgid: child.pid, workerPid: process.pid, trackNumber,
    command: process.execPath,
  });
  const markerPath = runMarkerPath(repoPath, trackNumber);
  mkdirSync(join(repoPath, 'conductor', '.runs'), { recursive: true });
  writeFileSync(markerPath, JSON.stringify(marker, null, 2), 'utf8');
  return markerPath;
}

function spawnLiveChild() {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true });
  child.unref();
  return child;
}

describe.skipIf(!dbAvailable)('POST /api/projects/:id/tracks/:num/abort (Track 10079)', () => {
  beforeAll(async () => {
    if (!dbAvailable) return;
    repoPath = mkdtempSync(join(tmpdir(), 'lc-abort-endpoint-'));
    const r = await pool.query(
      `INSERT INTO projects (name, repo_path) VALUES ($1, $2) RETURNING id`,
      ['track-10079-abort-endpoint-test', repoPath]
    );
    projectId = r.rows[0].id;
  });

  afterAll(async () => {
    if (dbAvailable && projectId) await pool.query('DELETE FROM projects WHERE id = $1', [projectId]);
    if (repoPath) rmSync(repoPath, { recursive: true, force: true });
    await pool.end();
  });

  afterEach(() => {
    rmSync(join(repoPath, 'conductor', '.runs'), { recursive: true, force: true });
    rmSync(join(repoPath, '.laneconductor.json'), { force: true });
  });

  it('TC-2.1: a live marker returns 202 with pid/pgid/SIGINT, intent on disk before the response returns', async () => {
    const child = spawnLiveChild();
    try {
      const markerPath = writeLiveMarker('tc21', child);
      const res = await request(app).post(`/api/projects/${projectId}/tracks/tc21/abort`).send({});
      expect(res.status).toBe(202);
      expect(res.body.ok).toBe(true);
      expect(res.body.pid).toBe(child.pid);
      expect(res.body.pgid).toBe(child.pid);
      expect(res.body.signal).toBe('SIGINT');

      const onDisk = JSON.parse(readFileSync(markerPath, 'utf8'));
      expect(onDisk.abort_requested).toBe(true);
    } finally {
      try { process.kill(child.pid, 'SIGKILL'); } catch { /* already gone */ }
    }
  });

  it('TC-2.2: no marker present returns 409 naming the track', async () => {
    const res = await request(app).post(`/api/projects/${projectId}/tracks/tc22-missing/abort`).send({});
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/tc22-missing/);
  });

  it('TC-2.3: a stale (pid-gone) marker returns 409, not 202', async () => {
    const child = spawn(process.execPath, ['-e', 'process.exit(0)']);
    await new Promise(resolve => child.on('exit', resolve));
    writeLiveMarker('tc23', child);
    const res = await request(app).post(`/api/projects/${projectId}/tracks/tc23/abort`).send({});
    expect(res.status).toBe(409);
  });

  it('TC-2.4: a second POST while still live returns already_requested:true and escalates', async () => {
    // Ignores SIGINT so it survives the first call's signal — otherwise
    // Node's default disposition (terminate) kills it before the second
    // POST can observe "still live".
    const child = spawn(process.execPath, [
      '-e', "process.on('SIGINT', () => {}); setInterval(() => {}, 1000);",
    ], { detached: true });
    child.unref();
    try {
      writeLiveMarker('tc24', child);
      const first = await request(app).post(`/api/projects/${projectId}/tracks/tc24/abort`).send({});
      expect(first.status).toBe(202);
      expect(first.body.signal).toBe('SIGINT');

      const second = await request(app).post(`/api/projects/${projectId}/tracks/tc24/abort`).send({});
      expect(second.status).toBe(202);
      expect(second.body.already_requested).toBe(true);
      expect(second.body.signal).toBe('SIGTERM');
    } finally {
      try { process.kill(child.pid, 'SIGKILL'); } catch { /* already gone */ }
    }
  });

  it('TC-2.5: :num of "manager" performs no tracks-row lookup and still works', async () => {
    const child = spawnLiveChild();
    try {
      writeLiveMarker('manager', child);
      const res = await request(app).post(`/api/projects/${projectId}/tracks/manager/abort`).send({});
      expect(res.status).toBe(202);
      expect(res.body.pid).toBe(child.pid);
    } finally {
      try { process.kill(child.pid, 'SIGKILL'); } catch { /* already gone */ }
    }
  });

  it('TC-2.6: unknown project id returns 404', async () => {
    const res = await request(app).post(`/api/projects/999999999/tracks/1/abort`).send({});
    expect(res.status).toBe(404);
  });

  it('TC-2.7: a project configured for remote-api mode returns 501, never 202', async () => {
    writeFileSync(join(repoPath, '.laneconductor.json'), JSON.stringify({ mode: 'remote-api' }));
    const child = spawnLiveChild();
    try {
      writeLiveMarker('tc27', child);
      const res = await request(app).post(`/api/projects/${projectId}/tracks/tc27/abort`).send({});
      expect(res.status).toBe(501);
      expect(res.body.error).toMatch(/remote abort is not implemented/);
    } finally {
      try { process.kill(child.pid, 'SIGKILL'); } catch { /* already gone */ }
    }
  });
});
