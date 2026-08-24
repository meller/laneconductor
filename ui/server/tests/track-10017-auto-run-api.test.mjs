// ui/server/tests/track-10017-auto-run-api.test.mjs
// Track 10017: FS<->DB round-trip for the per-track auto_run flag.
//
// TC-6/TC-7 exercise the POST /track upsert's COALESCE handling (mirrors
// waiting_for_reply's pattern exactly — a raw-nullable param so ON CONFLICT
// can distinguish "explicitly set" from "omitted"). TC-8 exercises the new
// PATCH .../auto-run endpoint end-to-end, including the real filesystem
// write via syncTrackToFile (not mocked — the acceptance criterion is that
// **Auto Run**: yes actually appears in index.md, not just that a DB query
// ran).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { app, pool } from '../index.mjs';

vi.mock('../auth.mjs');
vi.mock('pg', () => {
  const query = vi.fn();
  const Pool = vi.fn(() => ({ query, on: vi.fn() }));
  return { default: { Pool }, Pool };
});

describe('POST /track — auto_run upsert (TC-6, TC-7)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('TC-6: inserting a new track with auto_run: true passes it through as the 28th param', async () => {
    vi.mocked(pool.query)
      .mockResolvedValueOnce({ rows: [] }) // old-state lookup — no existing row
      .mockResolvedValueOnce({ rows: [{ id: 1 }] }) // INSERT ... RETURNING id
      .mockResolvedValueOnce({ rows: [{ len: 100 }] }) // final length check
      .mockResolvedValueOnce({ rows: [] }); // sync_status update

    await request(app)
      .post('/track')
      .send({ track_number: '10017', title: 'Test', lane_status: 'plan', auto_run: true, project_id: 1 })
      .expect(200);

    const insertCall = vi.mocked(pool.query).mock.calls.find(([sql]) => sql.includes('INSERT INTO tracks'));
    expect(insertCall[0]).toMatch(/COALESCE\(\$28, false\)/);
    expect(insertCall[1][27]).toBe(true); // params[27] = $28 = auto_run
  });

  it('TC-7: omitting auto_run sends null so COALESCE preserves the existing DB value', async () => {
    vi.mocked(pool.query)
      .mockResolvedValueOnce({ rows: [{ id: 5, lane_status: 'plan', lane_action_status: 'queue', index_content: null }] })
      .mockResolvedValueOnce({ rows: [{ id: 5 }] })
      .mockResolvedValueOnce({ rows: [{ len: 100 }] })
      .mockResolvedValueOnce({ rows: [] });

    await request(app)
      .post('/track')
      .send({ track_number: '10017', title: 'Test', lane_status: 'plan', project_id: 1 })
      .expect(200);

    const insertCall = vi.mocked(pool.query).mock.calls.find(([sql]) => sql.includes('INSERT INTO tracks'));
    expect(insertCall[1][27]).toBeNull(); // omitted -> null -> COALESCE(null, tracks.auto_run) preserves existing
    expect(insertCall[0]).toMatch(/auto_run\s*=\s*COALESCE\(\$28, tracks\.auto_run\)/);
  });
});

describe('PATCH /api/projects/:id/tracks/:num/auto-run (TC-8)', () => {
  let repoDir;
  let trackDir;

  beforeEach(() => {
    vi.resetAllMocks();
    repoDir = mkdtempSync(join(tmpdir(), 'lc-auto-run-'));
    trackDir = join(repoDir, 'conductor', 'tracks', '10017-track-auto-run-configuration');
    mkdirSync(trackDir, { recursive: true });
    writeFileSync(join(trackDir, 'index.md'), '# Track 10017: track auto run configuration\n\n**Lane**: implement\n**Lane Status**: queue\n**Progress**: 0%\n', 'utf8');
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it('rejects a non-boolean auto_run', async () => {
    const res = await request(app)
      .patch('/api/projects/1/tracks/10017/auto-run')
      .send({ auto_run: 'yes' })
      .expect(400);
    expect(res.body.error).toMatch(/boolean/);
  });

  it('404s when the track does not exist', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rowCount: 0 });
    await request(app)
      .patch('/api/projects/1/tracks/10017/auto-run')
      .send({ auto_run: true })
      .expect(404);
  });

  it('TC-8: updates the DB and writes **Auto Run**: yes into index.md via syncTrackToFile', async () => {
    vi.mocked(pool.query)
      .mockResolvedValueOnce({ rowCount: 1 }) // UPDATE tracks SET auto_run
      .mockResolvedValueOnce({ rows: [{ repo_path: repoDir }] }); // syncTrackToFile's project lookup

    const res = await request(app)
      .patch('/api/projects/1/tracks/10017/auto-run')
      .send({ auto_run: true })
      .expect(200);

    expect(res.body.ok).toBe(true);
    expect(vi.mocked(pool.query)).toHaveBeenCalledWith(
      'UPDATE tracks SET auto_run = $1 WHERE project_id = $2 AND track_number = $3',
      [true, '1', '10017']
    );

    const finalIndex = readFileSync(join(trackDir, 'index.md'), 'utf8');
    expect(finalIndex).toMatch(/\*\*Auto Run\*\*:\s*yes/);
  });

  it('writes **Auto Run**: no when toggled off', async () => {
    writeFileSync(join(trackDir, 'index.md'), '# Track 10017\n\n**Lane**: implement\n**Lane Status**: queue\n**Auto Run**: yes\n', 'utf8');
    vi.mocked(pool.query)
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ repo_path: repoDir }] });

    await request(app)
      .patch('/api/projects/1/tracks/10017/auto-run')
      .send({ auto_run: false })
      .expect(200);

    const finalIndex = readFileSync(join(trackDir, 'index.md'), 'utf8');
    expect(finalIndex).toMatch(/\*\*Auto Run\*\*:\s*no/);
  });
});
