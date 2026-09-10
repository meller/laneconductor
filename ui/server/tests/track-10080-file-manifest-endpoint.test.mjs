// ui/server/tests/track-10080-file-manifest-endpoint.test.mjs
// Track 10080 Phase 4 (REQ-8, REQ-11, TC-59, TC-60): PATCH /worker/file-manifest.
//
// TC-59 (rejected without a valid collector token) is not re-tested here as
// a fresh 401 scenario — this route is guarded by the exact same
// `collectorAuth` middleware function as /worker/heartbeat (imported and
// registered identically), and that middleware's own auth-matrix behaviour
// (global token / machine_token / api_keys / anonymous-when-no-token-env)
// is already unit-tested in track-1033-worker-auth.test.mjs. Re-deriving a
// 401 here would need `COLLECTOR_TOKEN_ENV` set before `index.mjs` loads,
// which a test file cannot do at runtime (same constraint noted in that
// file). What's specific to THIS route is covered below instead.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

vi.mock('../auth.mjs');

vi.mock('pg', () => {
  const query = vi.fn();
  const Pool = vi.fn(() => ({ query, on: vi.fn() }));
  return { default: { Pool }, Pool };
});

const { app, pool } = await import('../index.mjs');

describe('PATCH /worker/file-manifest', () => {
  beforeEach(() => vi.mocked(pool.query).mockReset());

  it('REQ-8: stores files + digest and stamps file_manifest_updated_at', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rowCount: 1 });

    const res = await request(app)
      .patch('/worker/file-manifest')
      .send({ project_id: 1, hostname: 'hydra', digest: 'sha256:abc', files: ['Makefile', 'bin/lc.mjs'] })
      .expect(200);

    expect(res.body).toEqual({ ok: true });
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringMatching(/UPDATE projects SET file_manifest = \$2, file_manifest_digest = \$3, file_manifest_updated_at = NOW\(\)/i),
      [1, JSON.stringify(['Makefile', 'bin/lc.mjs']), 'sha256:abc']
    );
  });

  it('TC-60: an absent files key leaves the stored manifest untouched, not overwritten with null', async () => {
    const res = await request(app)
      .patch('/worker/file-manifest')
      .send({ project_id: 1, hostname: 'hydra', digest: 'sha256:abc' })
      .expect(200);

    expect(res.body).toEqual({ ok: true });
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('rejects with 400 when no project_id can be resolved', async () => {
    const res = await request(app)
      .patch('/worker/file-manifest')
      .send({ files: ['Makefile'] })
      .expect(400);

    expect(res.body.error).toMatch(/project_id/i);
    expect(pool.query).not.toHaveBeenCalled();
  });
});
