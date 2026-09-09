// ui/server/tests/track-10086-resume-clears-markers.test.mjs
// Track AM-10086 Phase 3 (TC-5.1, TC-5.3): POST /api/projects/:id/tracks/:num/resume
// must retire the auto-resume machinery's own markers — **Waiting On
// Tracks** and **Auto Resumed** — the same way it already retires
// **Waiting Reason**, via the real filesystem write in syncTrackToFile
// (not mocked — the acceptance criterion is that the markers actually
// disappear from index.md, not just that a DB query ran). Without this, a
// human resuming a track that the auto-resume reconciler had previously
// resumed once already would leave **Auto Resumed** in place, permanently
// blocking any future auto-resume for that same dependency set even after
// the human has taken over.

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

describe('POST /api/projects/:id/tracks/:num/resume — retires auto-resume markers (TC-5.1, TC-5.3)', () => {
  let repoDir;
  let trackDir;

  beforeEach(() => {
    vi.resetAllMocks();
    repoDir = mkdtempSync(join(tmpdir(), 'lc-resume-'));
    trackDir = join(repoDir, 'conductor', 'tracks', '10086-track-auto-resume');
    mkdirSync(trackDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  function writeParkedIndex(extra = '') {
    writeFileSync(
      join(trackDir, 'index.md'),
      [
        '# Track 10086: track auto resume',
        '',
        '**Lane**: implement',
        '**Lane Status**: waiting',
        '**Progress**: 40%',
        '**Depends On**: 1000',
        '**Waiting Reason**: AM-1000 unmerged; awaiting merge order',
        '**Waiting On Tracks**: 1000',
        '**Auto Resumed**: 2026-01-01T00:00:00.000Z deps=1000',
        extra,
        '',
      ].join('\n'),
      'utf8'
    );
  }

  it('TC-5.1: clears Waiting Reason, Waiting On Tracks, and Auto Resumed together', async () => {
    writeParkedIndex();
    vi.mocked(pool.query)
      .mockResolvedValueOnce({ rows: [{ lane_status: 'implement', lane_action_status: 'waiting' }] }) // SELECT lane_status/lane_action_status
      .mockResolvedValueOnce({ rowCount: 1 }) // UPDATE tracks
      .mockResolvedValueOnce({ rows: [{ repo_path: repoDir }] }); // syncTrackToFile's own project lookup

    const res = await request(app)
      .post('/api/projects/1/tracks/10086/resume')
      .expect(200);

    expect(res.body.ok).toBe(true);
    expect(res.body.lane_action_status).toBe('queue');

    const finalIndex = readFileSync(join(trackDir, 'index.md'), 'utf8');
    expect(finalIndex).not.toMatch(/\*\*Waiting Reason\*\*/);
    expect(finalIndex).not.toMatch(/\*\*Waiting On Tracks\*\*/);
    expect(finalIndex).not.toMatch(/\*\*Auto Resumed\*\*/);
    // Depends On is orthogonal — a track can legitimately keep depending on
    // another track after being resumed for an unrelated reason; only the
    // park-specific markers are retired.
    expect(finalIndex).toMatch(/\*\*Depends On\*\*:\s*1000/);
  });

  it('409s (and touches no file) when the track is not actually waiting', async () => {
    writeParkedIndex();
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ lane_status: 'implement', lane_action_status: 'running' }] });

    await request(app)
      .post('/api/projects/1/tracks/10086/resume')
      .expect(409);

    const finalIndex = readFileSync(join(trackDir, 'index.md'), 'utf8');
    expect(finalIndex).toMatch(/\*\*Auto Resumed\*\*/, 'a rejected resume must not touch the file at all');
  });
});
