// server/tests/track-1102-f13-heartbeat-shared-token.test.mjs
// Track 1102 F13: PATCH /worker/heartbeat must trust an explicit
// project_id in the request BODY over collectorAuth's auth-derived
// req.worker_project_id.
//
// Observed live (2026-08-13): a manager worker, co-located with a project
// in the same directory (a common dogfooding/single-machine setup), has
// no credential storage separate from that project's own
// .laneconductor.json -- resolveCollectorToken() falls through to
// collectors[0].machine_token, which belongs to whichever worker
// registered on this collector last (in this repo's case, the project's
// own worker_number=1). So the manager authenticates its heartbeat using
// the PROJECT worker's machine_token, even though its own heartbeat body
// correctly declares project_id: null.
//
// Before this fix, the handler computed
// `projectId = req.worker_project_id || body.project_id` -- since
// collectorAuth resolves req.worker_project_id from the (shared, wrong)
// token's OWNING ROW (project_id: 1), that value won regardless of the
// body's own correct project_id: null, and the UPDATE's WHERE clause
// matched the PROJECT worker's row instead of the manager's own row --
// live-observed corrupting a project worker's `pid` field with the
// manager's pid, flapping every ~10s between the two as both processes
// heartbeat against the same DB row.
//
// Fix: an explicit project_id in the body (including an explicit null)
// must be trusted over the auth-derived value -- the calling process
// knows its own identity; a shared/misattributed auth token should not
// override what it explicitly declares about itself.
//
// collectorAuth is defined in index.mjs itself (not auth.mjs), so these
// tests exercise its REAL machine_token lookup rather than mocking it
// away -- that lookup finding the wrong row is the actual mechanism
// being reproduced.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { app, pool } from '../index.mjs';

vi.mock('pg', () => {
  const query = vi.fn();
  const Pool = vi.fn(() => ({ query, on: vi.fn() }));
  return { default: { Pool }, Pool };
});

describe('PATCH /worker/heartbeat — F13 explicit body project_id wins over a shared/misattributed auth token', () => {
  beforeEach(() => vi.resetAllMocks());

  it('a manager heartbeat (body project_id: null) is not redirected to the wrong project by a token shared with a co-located project worker', async () => {
    let capturedProjectId = 'unset';
    vi.mocked(pool.query).mockImplementation(async (sql, params) => {
      // collectorAuth's machine_token lookup: simulates the real-world
      // trigger -- the bearer token being sent actually belongs to the
      // co-located PROJECT worker's row (project_id: 1), not the
      // manager's own.
      if (/SELECT id, project_id, user_uid, visibility FROM workers WHERE machine_token/i.test(sql)) {
        return { rows: [{ id: 1112, project_id: 1, user_uid: null, visibility: 'private' }] };
      }
      if (/UPDATE workers/i.test(sql)) {
        capturedProjectId = params[0]; // projectId is always the first bound param in this handler
        return { rowCount: 1 };
      }
      return { rows: [] };
    });

    await request(app)
      .patch('/worker/heartbeat')
      .set('Authorization', 'Bearer shared-token-belongs-to-project-worker')
      .send({ hostname: 'meller-X1-AI', pid: 954975, project_id: null, worker_number: 1, mode: 'sync-only' })
      .expect(200);

    expect(capturedProjectId).toBeNull();
  });

  it('still falls back to the auth-resolved project_id when the body omits project_id entirely', async () => {
    let capturedProjectId = 'unset';
    vi.mocked(pool.query).mockImplementation(async (sql, params) => {
      if (/SELECT id, project_id, user_uid, visibility FROM workers WHERE machine_token/i.test(sql)) {
        return { rows: [{ id: 1112, project_id: 1, user_uid: null, visibility: 'private' }] };
      }
      if (/UPDATE workers/i.test(sql)) {
        capturedProjectId = params[0];
        return { rowCount: 1 };
      }
      return { rows: [] };
    });

    await request(app)
      .patch('/worker/heartbeat')
      .set('Authorization', 'Bearer some-token')
      .send({ hostname: 'meller-X1-AI', pid: 1295719, worker_number: 1, mode: 'sync-only' })
      .expect(200);

    // No body project_id at all -> correctly falls back to the
    // auth-resolved value (this is the legitimate, common case: a normal
    // project worker's own heartbeat, not a manager's).
    expect(capturedProjectId).toBe(1);
  });

  it('an explicit numeric project_id in the body is trusted even when auth resolves a different one', async () => {
    let capturedProjectId = 'unset';
    vi.mocked(pool.query).mockImplementation(async (sql, params) => {
      if (/SELECT id, project_id, user_uid, visibility FROM workers WHERE machine_token/i.test(sql)) {
        return { rows: [{ id: 1112, project_id: 1, user_uid: null, visibility: 'private' }] };
      }
      if (/UPDATE workers/i.test(sql)) {
        capturedProjectId = params[0];
        return { rowCount: 1 };
      }
      return { rows: [] };
    });

    await request(app)
      .patch('/worker/heartbeat')
      .set('Authorization', 'Bearer some-token')
      .send({ hostname: 'meller-X1-AI', pid: 42, project_id: 2, worker_number: 1 })
      .expect(200);

    expect(capturedProjectId).toBe(2);
  });
});
