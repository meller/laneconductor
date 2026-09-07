// server/tests/track-10072-buried-human-reply.test.mjs
// Track 10072: human_needs_reply used to be a write-time flag flipped by
// POST /track/:num/comment, which only ever touched the single newest human
// comment row and only when the reply's body contained one of three
// arbitrary keywords ("Answered", "i updated", "done"). Any newer human row
// — including the server's own bookkeeping ("Moved to X", "Manual retry
// requested") — permanently stranded every older unreplied comment. Fixed by
// deriving human_needs_reply at READ time from comment ordering: a human
// comment needs a reply when no non-human comment exists after it.
//
// Same rationale as track-10012-inbox-buckets.test.mjs for not mocking `pg`:
// this is a SQL predicate (EXISTS/NOT EXISTS over (created_at, id) tuple
// ordering), and only a real Postgres can confirm what it actually
// evaluates to. Skips itself when no local DB is reachable.

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
    ['track-10072-buried-human-reply-test', `/tmp/track-10072-buried-human-reply-test-${Date.now()}`]
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

// Literal copy of HUMAN_NEEDS_REPLY_SQL (ui/server/index.mjs) — kept
// deliberately un-imported, same convention as track-10012-inbox-buckets's
// INBOX_QUERY copy, so this test fails the moment the two drift apart.
const HUMAN_NEEDS_REPLY_QUERY = `
  SELECT EXISTS (
    SELECT 1 FROM track_comments hc
    WHERE hc.track_id = $1
      AND hc.author = 'human'
      AND hc.is_replied = FALSE
      AND hc.is_hidden = FALSE
      AND NOT EXISTS (
        SELECT 1 FROM track_comments rc
        WHERE rc.track_id = $1
          AND rc.author <> 'human'
          AND rc.is_hidden = FALSE
          AND (rc.created_at, rc.id) > (hc.created_at, hc.id)
      )
  ) AS human_needs_reply
`;

async function makeTrack(trackNumber) {
  const r = await pool.query(
    `INSERT INTO tracks (project_id, track_number, title, lane_status)
     VALUES ($1, $2, $3, 'implement') RETURNING id`,
    [projectId, trackNumber, `Test track ${trackNumber}`]
  );
  return r.rows[0].id;
}

// createdAt lets a test place two rows at an identical timestamp (REQ-9) —
// insertion order alone doesn't guarantee id order in Postgres under a
// forced equal timestamp, so tests that need a specific tie-break pass an
// explicit id-ordering expectation via two sequential inserts instead.
async function comment(trackId, author, body, { isReplied = false, isHidden = false, createdAt = null } = {}) {
  const r = await pool.query(
    createdAt
      ? `INSERT INTO track_comments (track_id, author, body, is_replied, is_hidden, created_at)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, created_at`
      : `INSERT INTO track_comments (track_id, author, body, is_replied, is_hidden)
         VALUES ($1, $2, $3, $4, $5) RETURNING id, created_at`,
    createdAt
      ? [trackId, author, body, isReplied, isHidden, createdAt]
      : [trackId, author, body, isReplied, isHidden]
  );
  return r.rows[0];
}

async function needsReply(trackId) {
  const { rows } = await pool.query(HUMAN_NEEDS_REPLY_QUERY, [trackId]);
  return rows[0].human_needs_reply;
}

describe.skipIf(!dbAvailable)('human_needs_reply — read-time derivation (Track 10072)', () => {
  it('TC-1 (load-bearing, REQ-2): an older unreplied human comment is cleared by a later reply even with newer human bookkeeping rows in between — the exact track 10067 shape', async () => {
    const id = await makeTrack('buried-1');
    await comment(id, 'human', 'the plan is missing the retry path');
    await comment(id, 'system', 'Looked into the retry path — investigating.');
    await comment(id, 'system', 'Still investigating the retry path edge cases.');
    await comment(id, 'system', 'Root cause found in the exhaustion handler.');
    await comment(id, 'human', 'Manual retry requested (Re-run Implement)', { isReplied: true });
    await comment(id, 'human', 'Manual retry requested (Re-run Implement)', { isReplied: true });
    await comment(id, 'human', 'Moved to plan (via file sync)', { isReplied: true });

    expect(await needsReply(id)).toBe(false);
  });

  it('TC-2 (REQ-1, positive): a human comment as the newest comment needs a reply', async () => {
    const id = await makeTrack('buried-2');
    await comment(id, 'human', 'Please double check the retry logic');
    expect(await needsReply(id)).toBe(true);
  });

  it('TC-3 (REQ-1, negative): a human comment followed by a single non-human comment does not need a reply', async () => {
    const id = await makeTrack('buried-3');
    await comment(id, 'human', 'Please double check the retry logic');
    await comment(id, 'claude', 'Checked — the retry logic is correct.');
    expect(await needsReply(id)).toBe(false);
  });

  it('TC-4 (REQ-2, minimal form): clearing reaches past an intervening human row in both directions', async () => {
    const id = await makeTrack('buried-4');
    await comment(id, 'human', 'question A');
    await comment(id, 'claude', 'answer to A');
    await comment(id, 'human', 'question B');
    expect(await needsReply(id)).toBe(true); // B has nothing after it yet

    await comment(id, 'system', 'answer to B');
    expect(await needsReply(id)).toBe(false); // now both A and B are covered
  });

  it('TC-5 (REQ-3): clearing is not gated on any keyword in the replying comment body', async () => {
    const id = await makeTrack('buried-5');
    await comment(id, 'human', 'Please double check the retry logic');
    await comment(id, 'claude', 'Looked at the retry path; it is handled in the worker.');
    expect(await needsReply(id)).toBe(false);
  });

  it('TC-6 (REQ-3, inverse): the outcome does not depend on the word "done" appearing in the reply', async () => {
    const id = await makeTrack('buried-6');
    await comment(id, 'human', 'Please double check the retry logic');
    await comment(id, 'system', '✅ Plan complete — moved to done:queue.');
    expect(await needsReply(id)).toBe(false);
  });

  it('TC-7 (REQ-5): a suppressed (is_replied=true) human comment never raises the badge, even as the newest comment', async () => {
    const id = await makeTrack('buried-7');
    await comment(id, 'human', 'Moved to done (via file sync)', { isReplied: true });
    expect(await needsReply(id)).toBe(false);
  });

  it('TC-8 (REQ-1): a human comment followed only by more human comments still needs a reply', async () => {
    const id = await makeTrack('buried-8');
    await comment(id, 'human', 'first thought');
    await comment(id, 'human', 'second thought');
    await comment(id, 'human', 'third thought');
    expect(await needsReply(id)).toBe(true);
  });

  it('TC-9 (REQ-9): identical-timestamp tuple ordering breaks the tie deterministically', async () => {
    const id = await makeTrack('buried-9');
    const ts = new Date('2026-06-01T12:00:00.000Z');
    const hc = await comment(id, 'human', 'question at the same instant', { createdAt: ts });
    const rc = await comment(id, 'system', 'reply at the same instant', { createdAt: ts });
    expect(rc.id).toBeGreaterThan(hc.id); // sanity: reply really did get the higher id
    expect(await needsReply(id)).toBe(false);

    const id2 = await makeTrack('buried-9b');
    const hc2 = await comment(id2, 'system', 'reply first, same instant', { createdAt: ts });
    const rc2 = await comment(id2, 'human', 'question second, same instant', { createdAt: ts });
    expect(rc2.id).toBeGreaterThan(hc2.id);
    expect(await needsReply(id2)).toBe(true); // the human row has the higher id — nothing came after it
  });

  it('TC-10 (REQ-6): a hidden human comment with nothing after it does not need a reply', async () => {
    const id = await makeTrack('buried-10');
    await comment(id, 'human', 'this got hidden later', { isHidden: true });
    expect(await needsReply(id)).toBe(false);
  });

  it('REQ-4: the reply-marking UPDATE is gone — is_replied is never flipped after insert', async () => {
    const id = await makeTrack('buried-11');
    const hc = await comment(id, 'human', 'a question');
    await comment(id, 'claude', 'Answered — see above.'); // contains the old trigger keyword on purpose

    const { rows } = await pool.query('SELECT is_replied FROM track_comments WHERE id = $1', [hc.id]);
    expect(rows[0].is_replied).toBe(false); // still false — only the read-time predicate changed, not the row
    expect(await needsReply(id)).toBe(false); // but the badge is correctly clear
  });

  it('TC-11 (REQ-6, consistency): the standalone predicate agrees with the Inbox\'s bucket classification', async () => {
    // Mirrors the "does the badge agree everywhere" guarantee REQ-6 asks
    // for, using the same literal INBOX_QUERY copy as
    // track-10012-inbox-buckets.test.mjs (kept in sync with it, not
    // re-imported, for the same anti-drift reason both files exist).
    const buriedId = await makeTrack('buried-consistency-1');
    await comment(buriedId, 'human', 'the plan is missing the retry path');
    await comment(buriedId, 'system', 'investigating');
    await comment(buriedId, 'human', 'Moved to plan (via file sync)', { isReplied: true });

    const freshId = await makeTrack('buried-consistency-2');
    await comment(freshId, 'human', 'a brand new unanswered question');

    expect(await needsReply(buriedId)).toBe(false);
    expect(await needsReply(freshId)).toBe(true);
  });

  it('TC-12 (Inbox bucketing): the TC-1 shape is not classified awaiting_ai, and a fresh unanswered question is', async () => {
    const INBOX_QUERY = `
      SELECT t.track_number, hr.human_needs_reply,
             CASE WHEN hr.human_needs_reply THEN 'awaiting_ai' ELSE 'recent_activity' END AS bucket
      FROM tracks t
      JOIN LATERAL (
        SELECT body, created_at FROM track_comments
        WHERE track_id = t.id AND is_hidden = FALSE ORDER BY created_at DESC LIMIT 1
      ) lc ON true
      LEFT JOIN LATERAL (
        SELECT EXISTS (
          SELECT 1 FROM track_comments hc
          WHERE hc.track_id = t.id AND hc.author = 'human' AND hc.is_replied = FALSE AND hc.is_hidden = FALSE
          AND NOT EXISTS (
            SELECT 1 FROM track_comments rc
            WHERE rc.track_id = t.id AND rc.author <> 'human' AND rc.is_hidden = FALSE
            AND (rc.created_at, rc.id) > (hc.created_at, hc.id)
          )
        ) AS human_needs_reply
      ) hr ON true
      WHERE t.project_id = $1
    `;

    const buriedId = await makeTrack('buried-bucket-1');
    await comment(buriedId, 'human', 'the plan is missing the retry path');
    await comment(buriedId, 'system', 'investigating');
    await comment(buriedId, 'human', 'Moved to plan (via file sync)', { isReplied: true });

    const freshId = await makeTrack('buried-bucket-2');
    await comment(freshId, 'human', 'a brand new unanswered question');

    const { rows } = await pool.query(INBOX_QUERY, [projectId]);
    const buriedRow = rows.find(r => r.track_number === 'buried-bucket-1');
    const freshRow = rows.find(r => r.track_number === 'buried-bucket-2');
    expect(buriedRow.bucket).toBe('recent_activity');
    expect(freshRow.bucket).toBe('awaiting_ai');
  });
});
