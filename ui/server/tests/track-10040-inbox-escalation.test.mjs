// server/tests/track-10040-inbox-escalation.test.mjs
// Track 10040 Phase 5 (AC-5): a track whose latest comment is the
// prespawn-block escalation (formatBlockComment's ❌ body) lands in the
// Inbox's needs_input bucket — driven through the real GET /api/inbox
// HTTP endpoint against a real DB, not a unit assertion on the SQL CASE.
// Mirrors track-10012-inbox-buckets.test.mjs's DB setup, but goes through
// supertest + the real app (mirrors track-10012-inbox.test.mjs's HTTP
// style) since that's what's actually being verified here: the real
// response shape, not just the query.

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import pg from 'pg';
import { app } from '../index.mjs';
import { formatBlockComment } from '../../../conductor/services/prespawn-block.mjs';

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
    ['track-10040-inbox-escalation-test', `/tmp/track-10040-inbox-escalation-test-${Date.now()}`]
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

async function makeTrack(trackNumber) {
  const r = await pool.query(
    `INSERT INTO tracks (project_id, track_number, title, lane_status, lane_action_status)
     VALUES ($1, $2, $3, 'plan', 'failure') RETURNING id`,
    [projectId, trackNumber, `Test track ${trackNumber}`]
  );
  return r.rows[0].id;
}

async function comment(trackId, author, body) {
  await pool.query(
    `INSERT INTO track_comments (track_id, author, body, is_replied) VALUES ($1, $2, $3, FALSE)`,
    [trackId, author, body]
  );
}

describe.skipIf(!dbAvailable)('GET /api/inbox — prespawn-block escalation (Track 10040 AC-5)', () => {
  it('TC-23: a track whose latest comment is the ❌ escalation lands in needs_input via the real HTTP endpoint', async () => {
    await makeTrack('305');
    const escalationBody = formatBlockComment({
      action: 'escalate',
      kind: 'dirty-checkout',
      reason: 'D ui/node_modules',
    });
    // The real caller wraps this as `> **system**: ${body}` in
    // conversation.md; the sync worker's parser strips that wrapper before
    // it lands in track_comments.body — so the DB row holds the bare body,
    // exactly what formatBlockComment returns.
    await comment(
      (await pool.query('SELECT id FROM tracks WHERE project_id = $1 AND track_number = $2', [projectId, '305'])).rows[0].id,
      'system',
      escalationBody
    );

    const res = await request(app).get('/api/inbox').query({ project_id: projectId });
    expect(res.status).toBe(200);

    const row = res.body.find(r => r.track_number === '305');
    expect(row).toBeTruthy();
    expect(row.bucket).toBe('needs_input');
    expect(row.last_comment_body).toBe(escalationBody);
  });
});
