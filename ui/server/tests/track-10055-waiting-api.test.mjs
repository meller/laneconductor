// ui/server/tests/track-10055-waiting-api.test.mjs
//
// Track 10055 Phase 1 + Phase 3 + Phase 5, collector side.
//
// TC-1/TC-2 are the live-bug guards: POST /track — the destination of the
// worker's generic chokidar file-sync — rejected lane_action_status:'waiting'
// with a 400, so every file-triggered re-sync of a parked track was thrown
// away wholesale (title, progress, summary and index_content included), with
// the failure swallowed as a logger.warn on the worker side. That broke the
// one lane where `waiting` was supposed to work already.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { app, pool } from '../index.mjs';

vi.mock('../auth.mjs');
vi.mock('pg', () => {
  const query = vi.fn();
  const Pool = vi.fn(() => ({ query, on: vi.fn() }));
  return { default: { Pool }, Pool };
});

/** POST /track's four queries: old-state lookup, upsert, length check, sync_status. */
function mockPostTrack(oldTrack = null) {
  vi.mocked(pool.query)
    .mockResolvedValueOnce({ rows: oldTrack ? [oldTrack] : [] })
    .mockResolvedValueOnce({ rows: [{ id: 1 }] })
    .mockResolvedValueOnce({ rows: [{ len: 100 }] })
    .mockResolvedValueOnce({ rows: [] });
}

const upsertCall = () => vi.mocked(pool.query).mock.calls.find(([sql]) => sql.includes('INSERT INTO tracks'));
const updateCall = () => vi.mocked(pool.query).mock.calls.find(([sql]) => sql.startsWith('UPDATE tracks SET'));

describe('POST /track — `waiting` is accepted on every lane (REQ-4)', () => {
  beforeEach(() => vi.resetAllMocks());

  it('TC-1: lane_action_status "waiting" on the implement lane is accepted', async () => {
    mockPostTrack();
    await request(app)
      .post('/track')
      .send({ track_number: '10055', title: 'T', lane_status: 'implement', lane_action_status: 'waiting', project_id: 1 })
      .expect(200);

    expect(upsertCall()[1][12]).toBe('waiting'); // $13 = lane_action_status
  });

  it('TC-2: lane_action_status "waiting" on the done lane is accepted (the live 400)', async () => {
    mockPostTrack();
    await request(app)
      .post('/track')
      .send({ track_number: '10055', title: 'T', lane_status: 'done', lane_action_status: 'waiting', project_id: 1 })
      .expect(200);

    expect(upsertCall()[1][12]).toBe('waiting');
  });

  it('TC-2b: every other canonical status is still accepted', async () => {
    for (const status of ['queue', 'running', 'success', 'failure']) {
      vi.resetAllMocks();
      mockPostTrack();
      await request(app)
        .post('/track')
        .send({ track_number: '10055', title: 'T', lane_status: 'implement', lane_action_status: status, project_id: 1 })
        .expect(200);
    }
  });

  it('TC-3: an unknown status is still rejected — widening the set did not remove validation', async () => {
    const res = await request(app)
      .post('/track')
      .send({ track_number: '10055', title: 'T', lane_status: 'implement', lane_action_status: 'nonsense', project_id: 1 })
      .expect(400);
    expect(res.body.error).toMatch(/Invalid lane_action_status/);
  });

  it('TC-3b: "blocked" is rejected — it is in constants.mjs but not in the Postgres enum, so it must 400 here rather than 500 at INSERT', async () => {
    await request(app)
      .post('/track')
      .send({ track_number: '10055', title: 'T', lane_status: 'implement', lane_action_status: 'blocked', project_id: 1 })
      .expect(400);
  });
});

describe('POST /track — waiting_reason (REQ-3)', () => {
  beforeEach(() => vi.resetAllMocks());

  it('TC-7: a supplied reason is written as $31', async () => {
    mockPostTrack();
    await request(app)
      .post('/track')
      .send({
        track_number: '10055', title: 'T', lane_status: 'implement',
        lane_action_status: 'waiting', waiting_reason: 'Needs prod DB approval', project_id: 1,
      })
      .expect(200);

    const [sql, params] = upsertCall();
    expect(sql).toContain('waiting_reason = $31');
    expect(params[30]).toBe('Needs prod DB approval');
  });

  it('TC-7b: syncing a NON-waiting status with no reason clears any stale reason', async () => {
    mockPostTrack({ id: 5, lane_status: 'implement', lane_action_status: 'waiting', index_content: null });
    await request(app)
      .post('/track')
      .send({ track_number: '10055', title: 'T', lane_status: 'implement', lane_action_status: 'queue', project_id: 1 })
      .expect(200);

    expect(upsertCall()[0]).toContain('waiting_reason = NULL');
  });

  it('TC-7c: a waiting sync carrying no reason leaves the existing one alone rather than erasing it', async () => {
    mockPostTrack({ id: 5, lane_status: 'implement', lane_action_status: 'waiting', index_content: null });
    await request(app)
      .post('/track')
      .send({ track_number: '10055', title: 'T', lane_status: 'implement', lane_action_status: 'waiting', project_id: 1 })
      .expect(200);

    const sql = upsertCall()[0];
    expect(sql).not.toContain('waiting_reason = NULL');
    expect(sql).not.toContain('waiting_reason = $31');
  });
});

describe('PATCH /track/:num/action — parking and un-parking', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(pool.query).mockResolvedValue({ rows: [], rowCount: 1 });
  });

  it('TC-15e: parking with a reason writes both', async () => {
    await request(app)
      .patch('/track/10055/action?project_id=1')
      .send({ lane_action_status: 'waiting', waiting_reason: 'Needs prod DB approval' })
      .expect(200);

    const [sql, params] = updateCall();
    expect(sql).toContain('lane_action_status = $3');
    expect(sql).toContain('waiting_reason = $4');
    expect(params).toContain('waiting');
    expect(params).toContain('Needs prod DB approval');
  });

  it('TC-17c: moving to any other status retires the reason', async () => {
    await request(app)
      .patch('/track/10055/action?project_id=1')
      .send({ lane_action_status: 'running' })
      .expect(200);

    expect(updateCall()[0]).toContain('waiting_reason = NULL');
  });

  it('TC-17d: staying at waiting does not retire the reason', async () => {
    await request(app)
      .patch('/track/10055/action?project_id=1')
      .send({ lane_action_status: 'waiting' })
      .expect(200);

    expect(updateCall()[0]).not.toContain('waiting_reason = NULL');
  });

  it('TC-3c: an unknown status is rejected here too', async () => {
    await request(app)
      .patch('/track/10055/action?project_id=1')
      .send({ lane_action_status: 'nonsense' })
      .expect(400);
  });
});
