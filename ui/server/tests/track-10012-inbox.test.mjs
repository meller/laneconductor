// server/tests/track-10012-inbox.test.mjs
// Track 10012: inbox functionality fix — regression tests for the two
// root-cause fixes that are unit-testable against a mocked pool:
//   1. 'system' comments persist as author='system' (not coerced to
//      'human') and never wake the worker.
//   2. tracks.waiting_for_reply is actually read/persisted by POST /track
//      and PATCH /track/:num/action instead of being silently dropped.
// (Bucket classification in GET /api/inbox lives in SQL and is covered
// separately, against a real DB, in track-10012-inbox-buckets.test.mjs.)

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { app, pool } from '../index.mjs';

vi.mock('../auth.mjs');

vi.mock('pg', () => {
  const query = vi.fn();
  const Pool = vi.fn(() => ({ query, on: vi.fn() }));
  return { default: { Pool }, Pool };
});

// pool.query is a vi.fn(); its own .mock.calls already records every call
// (sql, params) in order, including ones answered by mockResolvedValueOnce
// — no need for a separate tracking wrapper.
function queryCalls() {
  return vi.mocked(pool.query).mock.calls;
}

describe('POST /track/:num/comment — author=system (Track 10012)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Default fallback for any call not covered by a test's own
    // mockResolvedValueOnce (which takes priority for its position) —
    // matches the shape most routes here expect back from pool.query.
    vi.mocked(pool.query).mockImplementation(async () => ({ rows: [], rowCount: 0 }));
  });

  it('TC-5: persists author as system, not coerced to human', async () => {
    vi.mocked(pool.query)
      .mockResolvedValueOnce({ rows: [{ id: 101 }] }) // track id lookup
      .mockResolvedValueOnce({ rows: [{ id: 1, author: 'system', body: '✅ Plan complete — moved to implement.', created_at: new Date() }] }); // insert

    const res = await request(app)
      .post('/track/010/comment?project_id=1')
      .send({ author: 'system', body: '✅ Plan complete — moved to implement.' });

    expect(res.status).toBe(201);
    expect(res.body.author).toBe('system');
  });

  it('TC-6: a system comment never wakes the worker (no lane_action_status update)', async () => {
    vi.mocked(pool.query)
      .mockResolvedValueOnce({ rows: [{ id: 101 }] })
      .mockResolvedValueOnce({ rows: [{ id: 1, author: 'system', body: '✅ Plan complete.', created_at: new Date() }] });

    await request(app)
      .post('/track/010/comment?project_id=1')
      .send({ author: 'system', body: '✅ Plan complete.' })
      .expect(201);

    const wakeCall = queryCalls().find(([sql]) => /lane_action_status\s*=\s*'queue'/i.test(sql));
    expect(wakeCall).toBeUndefined();
  });

  it('a human comment still wakes the worker (regression, unchanged)', async () => {
    vi.mocked(pool.query)
      .mockResolvedValueOnce({ rows: [{ id: 101 }] })
      .mockResolvedValueOnce({ rows: [{ id: 1, author: 'human', body: 'please fix X', created_at: new Date() }] })
      .mockResolvedValueOnce({ rowCount: 1 });

    await request(app)
      .post('/track/010/comment?project_id=1')
      .send({ author: 'human', body: 'please fix X' })
      .expect(201);

    const wakeCall = queryCalls().find(([sql]) => /lane_action_status\s*=\s*'queue'/i.test(sql));
    expect(wakeCall).toBeTruthy();
  });
});

describe('POST /track — waiting_for_reply persistence (Track 10012)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Default fallback for any call not covered by a test's own
    // mockResolvedValueOnce (which takes priority for its position) —
    // matches the shape most routes here expect back from pool.query.
    vi.mocked(pool.query).mockImplementation(async () => ({ rows: [], rowCount: 0 }));
  });

  function postTrack(body) {
    return request(app)
      .post('/track?project_id=1')
      .send({
        track_number: '010', title: 'Inbox fix test track',
        lane_status: 'implement', lane_action_status: 'queue', progress_percent: 50,
        ...body,
      });
  }

  it('TC-2: waiting_for_reply:true is sent through as the raw param (authoritative overwrite)', async () => {
    await postTrack({ waiting_for_reply: true }).expect(200);

    const upsert = queryCalls().find(([sql]) => /INSERT INTO tracks/i.test(sql));
    expect(upsert).toBeTruthy();
    expect(upsert[0]).toContain('waiting_for_reply');
    // $27 is waiting_for_reply — track 1116 appended $28 (model_override)
    // after it, so it's no longer the last param.
    expect(upsert[1][26]).toBe(true);
  });

  it('TC-3: waiting_for_reply omitted sends null (COALESCE preserves the existing DB value, not false)', async () => {
    await postTrack({}).expect(200);

    const upsert = queryCalls().find(([sql]) => /INSERT INTO tracks/i.test(sql));
    expect(upsert).toBeTruthy();
    expect(upsert[0]).toContain('COALESCE($27, tracks.waiting_for_reply)');
    expect(upsert[1][26]).toBeNull();
  });
});

describe('POST /api/projects/:id/tracks/:num/dismiss (Track 10012 follow-up)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(pool.query).mockImplementation(async () => ({ rows: [], rowCount: 0 }));
  });

  it('sets tracks.dismissed_at in addition to hiding comments — not just the comment hide', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ id: 42 }] }); // getTrackId

    await request(app)
      .post('/api/projects/1/tracks/010/dismiss')
      .expect(200);

    const hideComments = queryCalls().find(([sql]) => /UPDATE track_comments SET is_hidden/i.test(sql));
    expect(hideComments).toBeTruthy();
    expect(hideComments[1]).toEqual([42]);

    const setDismissed = queryCalls().find(([sql]) => /UPDATE tracks SET dismissed_at/i.test(sql));
    expect(setDismissed).toBeTruthy();
    expect(setDismissed[1]).toEqual([42]);
  });

  it('404s without touching anything when the track does not exist', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] }); // getTrackId: not found

    await request(app)
      .post('/api/projects/1/tracks/999/dismiss')
      .expect(404);

    expect(queryCalls().find(([sql]) => /UPDATE tracks SET dismissed_at/i.test(sql))).toBeUndefined();
  });
});

describe('PATCH /track/:num/action — waiting_for_reply persistence (Track 10012)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Default fallback for any call not covered by a test's own
    // mockResolvedValueOnce (which takes priority for its position) —
    // matches the shape most routes here expect back from pool.query.
    vi.mocked(pool.query).mockImplementation(async () => ({ rows: [], rowCount: 0 }));
  });

  it('TC-4: waiting_for_reply:false is included in the UPDATE independent of other fields', async () => {
    await request(app)
      .patch('/track/010/action?project_id=1')
      .send({ waiting_for_reply: false })
      .expect(200);

    const update = queryCalls().find(([sql]) => /UPDATE tracks SET/i.test(sql));
    expect(update).toBeTruthy();
    expect(update[0]).toContain('waiting_for_reply');
    expect(update[1]).toContain(false);
  });
});
