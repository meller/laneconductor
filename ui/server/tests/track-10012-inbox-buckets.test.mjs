// server/tests/track-10012-inbox-buckets.test.mjs
// Track 10012: GET /api/inbox's three-way bucket classification (needs_input /
// awaiting_ai / recent_activity) is expressed as a SQL CASE inside the query
// itself (see /api/inbox in ../index.mjs) — every other test file in this
// suite mocks `pg` entirely, which can exercise the JS around a query but
// can't verify what a CASE expression actually evaluates to. This file
// deliberately does NOT mock `pg`: it talks to the same local Postgres the
// dev stack already uses (server/index.mjs's own defaults —
// localhost:5432/laneconductor, postgres/postgres — see DB_HOST/DB_PORT/
// DB_NAME/DB_USER/DB_PASSWORD), the only way to pin the actual bucket
// behavior rather than a JS approximation of it. A dedicated throwaway
// project+tracks are created and torn down per test so this doesn't touch
// real board data.
//
// Skips itself (rather than failing) when no local Postgres is reachable —
// e.g. CI without a DB — since every other test in the suite mocks the DB
// and doesn't need one.

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import pg from 'pg';

const { Pool } = pg;

const pool = new Pool({
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? 5432),
  database: process.env.DB_NAME ?? 'laneconductor',
  user: process.env.DB_USER ?? 'postgres',
  password: process.env.DB_PASSWORD ?? 'postgres',
});

// Top-level await: skip.if needs this resolved before the describe block
// below is even registered, which is before any beforeAll hook runs.
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
    ['track-10012-inbox-bucket-test', `/tmp/track-10012-inbox-bucket-test-${Date.now()}`]
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

// Mirrors GET /api/inbox's query in ../index.mjs exactly (see Track 10012
// Phase 2) — kept as a literal copy, not an import, so this test fails the
// moment the two drift apart.
const INBOX_QUERY = `
  SELECT t.id AS track_id, t.track_number, t.title, t.lane_status,
          t.lane_action_status, t.waiting_for_reply,
          p.id AS project_id, p.name AS project_name,
          lc.author AS last_comment_author, lc.body AS last_comment_body, lc.created_at AS last_comment_at,
          uc.unreplied_count, hr.human_needs_reply,
          CASE
            WHEN hr.human_needs_reply THEN 'awaiting_ai'
            WHEN t.waiting_for_reply THEN 'needs_input'
            WHEN lc.author = 'system' AND (lc.body LIKE '⚠️%' OR lc.body LIKE '❌%') THEN 'needs_input'
            WHEN lc.author = 'system' AND lc.body LIKE '✅%' THEN 'recent_activity'
            WHEN COALESCE(uc.unreplied_count, 0) > 0 THEN 'needs_input'
            ELSE 'recent_activity'
          END AS bucket
   FROM tracks t
   JOIN projects p ON p.id = t.project_id
   LEFT JOIN LATERAL (
     SELECT body, author, created_at FROM track_comments
     WHERE track_id = t.id AND is_hidden = FALSE ORDER BY created_at DESC LIMIT 1
   ) lc ON true
   LEFT JOIN LATERAL (
     SELECT COUNT(*)::int AS unreplied_count FROM track_comments uc
     WHERE uc.track_id = t.id
       AND uc.author IN ('claude', 'gemini', 'system')
       AND uc.is_hidden = FALSE
       AND uc.created_at > COALESCE(
         (SELECT MAX(created_at) FROM track_comments
          WHERE track_id = t.id AND author = 'human' AND is_hidden = FALSE),
         '1970-01-01'
       )
   ) uc ON true
   LEFT JOIN LATERAL (
     SELECT EXISTS(
       SELECT 1 FROM track_comments WHERE track_id = t.id AND author = 'human' AND is_replied = FALSE AND is_hidden = FALSE
     ) AS human_needs_reply
   ) hr ON true
   WHERE (lc.created_at IS NOT NULL OR t.waiting_for_reply = TRUE)
     AND NOT (t.dismissed_at IS NOT NULL AND t.dismissed_at >= COALESCE(lc.created_at, t.dismissed_at))
     AND t.project_id = $1
   ORDER BY lc.created_at DESC
`;

async function makeTrack(trackNumber, { waitingForReply = false } = {}) {
  const r = await pool.query(
    `INSERT INTO tracks (project_id, track_number, title, lane_status, waiting_for_reply)
     VALUES ($1, $2, $3, 'implement', $4) RETURNING id`,
    [projectId, trackNumber, `Test track ${trackNumber}`, waitingForReply]
  );
  return r.rows[0].id;
}

async function comment(trackId, author, body, opts = {}) {
  await pool.query(
    `INSERT INTO track_comments (track_id, author, body, is_replied) VALUES ($1, $2, $3, $4)`,
    [trackId, author, body, opts.isReplied ?? false]
  );
}

async function bucketFor(trackNumber) {
  const { rows } = await pool.query(INBOX_QUERY, [projectId]);
  const row = rows.find(r => r.track_number === trackNumber);
  return row?.bucket;
}

async function dismiss(trackId) {
  await pool.query('UPDATE tracks SET dismissed_at = NOW() WHERE id = $1', [trackId]);
}

describe.skipIf(!dbAvailable)('GET /api/inbox — bucket classification (Track 10012)', () => {
  it('TC-7: a system ✅ notice as the latest comment lands in recent_activity', async () => {
    const id = await makeTrack('bucket-7');
    await comment(id, 'system', '✅ Plan complete — moved to implement.');
    expect(await bucketFor('bucket-7')).toBe('recent_activity');
  });

  it('TC-8: a system ⚠️ notice as the latest comment lands in needs_input', async () => {
    const id = await makeTrack('bucket-8a');
    await comment(id, 'system', '⚠️ Plan complete with a fundamentals conflict.');
    expect(await bucketFor('bucket-8a')).toBe('needs_input');

    const id2 = await makeTrack('bucket-8b');
    await comment(id2, 'system', '❌ QUALITY GATE FAILED');
    expect(await bucketFor('bucket-8b')).toBe('needs_input');
  });

  it('TC-9: waiting_for_reply=true with zero comments still appears, in needs_input', async () => {
    await makeTrack('bucket-9', { waitingForReply: true });
    expect(await bucketFor('bucket-9')).toBe('needs_input');
  });

  it('a dismissed track with waiting_for_reply=true and no comments stops reappearing (track-8002 live incident)', async () => {
    // Reproduces this repo's own live incident: a stale brainstorm fixture
    // (track 8002) has waiting_for_reply=true and no comments at all — the
    // one condition "Dismiss from inbox" (which only ever hid comments)
    // could never actually clear, so it reappeared on every single poll no
    // matter how many times it was dismissed. waiting_for_reply itself is
    // re-asserted from the track's own index.md marker on every sync
    // cycle, so a dismiss that tried to flip it false would just get
    // silently overwritten back to true moments later — dismissed_at has
    // to be an independent signal, not a fight over the same flag.
    const id = await makeTrack('bucket-dismiss-1', { waitingForReply: true });
    expect(await bucketFor('bucket-dismiss-1')).toBe('needs_input');

    await dismiss(id);
    const { rows } = await pool.query(INBOX_QUERY, [projectId]);
    expect(rows.find(r => r.track_number === 'bucket-dismiss-1')).toBeUndefined();
  });

  it('a dismissed track reappears once a genuinely NEW comment arrives after dismissal', async () => {
    const id = await makeTrack('bucket-dismiss-2');
    await comment(id, 'human', 'first question', { isReplied: true });
    await dismiss(id);
    expect(await bucketFor('bucket-dismiss-2')).toBeUndefined();

    await comment(id, 'claude', 'here is the answer');
    expect(await bucketFor('bucket-dismiss-2')).toBe('needs_input');
  });

  it('a dismissed track with a comment OLDER than the dismissal stays hidden, even with waiting_for_reply still true', async () => {
    const id = await makeTrack('bucket-dismiss-3', { waitingForReply: true });
    await comment(id, 'gemini', 'stale message from before dismissal');
    await dismiss(id);
    const { rows } = await pool.query(INBOX_QUERY, [projectId]);
    expect(rows.find(r => r.track_number === 'bucket-dismiss-3')).toBeUndefined();
  });

  it('TC-10: an unresolved real human comment lands in awaiting_ai', async () => {
    const id = await makeTrack('bucket-10');
    await comment(id, 'human', 'Please double check the retry logic', { isReplied: false });
    expect(await bucketFor('bucket-10')).toBe('awaiting_ai');
  });

  it('TC-11: an unresolved claude comment (regression) still counts toward unreplied_count', async () => {
    const id = await makeTrack('bucket-11');
    await comment(id, 'claude', 'Implemented phase 2, ready for review.');
    const { rows } = await pool.query(INBOX_QUERY, [projectId]);
    const row = rows.find(r => r.track_number === 'bucket-11');
    expect(row.unreplied_count).toBeGreaterThan(0);
    expect(row.bucket).toBe('needs_input');
  });

  it('a track with no comments and waiting_for_reply=false does not appear at all', async () => {
    await makeTrack('bucket-invisible');
    const { rows } = await pool.query(INBOX_QUERY, [projectId]);
    expect(rows.find(r => r.track_number === 'bucket-invisible')).toBeUndefined();
  });

  it('human_needs_reply (awaiting_ai) takes priority over a system ⚠️ last comment', async () => {
    const id = await makeTrack('bucket-priority');
    await comment(id, 'system', '⚠️ Something needs a look.');
    await comment(id, 'human', 'What exactly is wrong?', { isReplied: false });
    expect(await bucketFor('bucket-priority')).toBe('awaiting_ai');
  });
});
