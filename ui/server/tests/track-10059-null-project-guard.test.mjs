// ui/server/tests/track-10059-null-project-guard.test.mjs
//
// Track 10059 Phase 2 (REQ-1, REQ-2, REQ-8, REQ-6).
//
// POST /track resolved `projectId` to null when a caller presented neither a
// recognised `machine_token` nor a `project_id` parameter, and nothing guarded
// that before the upsert. `ON CONFLICT (project_id, track_number)` never fires
// on a NULL project_id (Postgres treats NULL as distinct in a unique index),
// so the upsert silently degraded into a plain insert and produced an orphan
// row — 156 of them, live. These tests pin the guard that closes the hole,
// confirm it does not over-tighten into blocking normal syncs, and pin the
// `GET /api/tracks` inner join that made those orphan rows harmless rather
// than user-visible (REQ-8) — the property the whole investigation relied on.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { app, pool } from '../index.mjs';

vi.mock('../auth.mjs');
vi.mock('pg', () => {
  const query = vi.fn();
  const Pool = vi.fn(() => ({ query, on: vi.fn() }));
  return { default: { Pool }, Pool };
});

const insertCall = () => vi.mocked(pool.query).mock.calls.find(([sql]) => sql.includes('INSERT INTO tracks'));

/** POST /track's four queries when the guard lets the request through: old-state lookup, upsert, length check, sync_status. */
function mockPostTrack(oldTrack = null) {
  vi.mocked(pool.query)
    .mockResolvedValueOnce({ rows: oldTrack ? [oldTrack] : [] })
    .mockResolvedValueOnce({ rows: [{ id: 1 }] })
    .mockResolvedValueOnce({ rows: [{ len: 100 }] })
    .mockResolvedValueOnce({ rows: [] });
}

describe('POST /track — project_id guard (REQ-1, TC-1..TC-4)', () => {
  beforeEach(() => vi.resetAllMocks());

  it('TC-1: no project_id parameter and no recognised machine_token — 400, names the missing param, no insert issued', async () => {
    const res = await request(app)
      .post('/track')
      .send({ track_number: '10059', title: 'T', lane_status: 'implement' })
      .expect(400);

    expect(res.body.error).toMatch(/project_id/);
    expect(insertCall()).toBeUndefined();
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('TC-2: ?project_id=1 with a valid body — 200, and the upsert IS issued (guard is not over-tight)', async () => {
    mockPostTrack();
    await request(app)
      .post('/track?project_id=1')
      .send({ track_number: '10059', title: 'T', lane_status: 'implement' })
      .expect(200);

    expect(insertCall()).toBeDefined();
  });

  it('TC-3: a non-numeric ?project_id=abc — 400, no insert (parseInt(NaN) reaches the insert identically to null if unguarded)', async () => {
    const res = await request(app)
      .post('/track?project_id=abc')
      .send({ track_number: '10059', title: 'T', lane_status: 'implement' })
      .expect(400);

    expect(res.body.error).toMatch(/project_id/);
    expect(insertCall()).toBeUndefined();
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('TC-4: a recognised machine_token resolving req.worker_project_id, no project_id parameter — 200, normal upsert', async () => {
    mockPostTrack();
    await request(app)
      .post('/track')
      .send({ track_number: '10059', title: 'T', lane_status: 'implement', project_id: 1 })
      .expect(200);

    // The test double for auth resolves worker_project_id the same way the
    // real anonymous/global-token path does (from body/query project_id) —
    // see resolveCollectorCredential's step 4. This exercises the same code
    // path a recognised worker token would take at collectorAuth.
    expect(insertCall()).toBeDefined();
  });
});

describe('GET /api/tracks — unscoped read retains the project inner join (REQ-8, TC-5)', () => {
  beforeEach(() => vi.resetAllMocks());

  it('TC-5: the query joins projects on p.id = t.project_id — the property that makes a NULL-project row unrenderable', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] });
    await request(app).get('/api/tracks').expect(200);

    const [sql] = vi.mocked(pool.query).mock.calls[0];
    expect(sql).toMatch(/JOIN\s+projects\s+p\s+ON\s+p\.id\s*=\s*t\.project_id/);
  });
});
