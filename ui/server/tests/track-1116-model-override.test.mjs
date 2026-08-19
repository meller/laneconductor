// Track 1116 REQ-7: per-track model override — PATCH endpoint + the
// syncTrackToFile marker write/remove logic it drives (TC-14's underlying
// contract; TrackDetailPanel.jsx itself isn't covered here — its streaming/
// websocket dependencies make full-component mocking disproportionate to
// what this one dropdown needs).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { app, pool, syncTrackToFile } from '../index.mjs';

vi.mock('../auth.mjs');

vi.mock('pg', () => {
  const query = vi.fn();
  const Pool = vi.fn(() => ({ query, on: vi.fn() }));
  return { default: { Pool }, Pool };
});

describe('PATCH /api/projects/:id/tracks/:num/model-override', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('accepts a model id, updates tracks.model_override, and returns ok', async () => {
    vi.mocked(pool.query)
      .mockResolvedValueOnce({ rowCount: 1 }) // UPDATE
      .mockResolvedValueOnce({ rows: [] }); // syncTrackToFile's project lookup (no-op path)

    const res = await request(app)
      .patch('/api/projects/1/tracks/1116/model-override')
      .send({ model_override: 'claude-opus-4-5' })
      .expect(200);

    expect(res.body.ok).toBe(true);
    expect(pool.query).toHaveBeenCalledWith(
      'UPDATE tracks SET model_override = $1 WHERE project_id = $2 AND track_number = $3',
      ['claude-opus-4-5', '1', '1116']
    );
  });

  it('clearing (null) writes null, not an empty string', async () => {
    vi.mocked(pool.query)
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rows: [] });

    await request(app)
      .patch('/api/projects/1/tracks/1116/model-override')
      .send({ model_override: null })
      .expect(200);

    expect(pool.query).toHaveBeenCalledWith(
      'UPDATE tracks SET model_override = $1 WHERE project_id = $2 AND track_number = $3',
      [null, '1', '1116']
    );
  });

  it('rejects a non-string, non-null model_override', async () => {
    const res = await request(app)
      .patch('/api/projects/1/tracks/1116/model-override')
      .send({ model_override: 42 })
      .expect(400);
    expect(res.body.error).toMatch(/model_override/);
  });

  it('404s when the track does not exist', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rowCount: 0 });
    const res = await request(app)
      .patch('/api/projects/1/tracks/9999/model-override')
      .send({ model_override: 'claude-opus-4-5' })
      .expect(404);
    expect(res.body.error).toMatch(/not found/);
  });
});

// syncTrackToFile talks to the real filesystem (it's the DB→file half of
// the bridge) — exercise it directly against a throwaway tracks dir rather
// than mocking fs, since the marker regex behavior is exactly what TC-14
// needs proven correct.
describe('syncTrackToFile — **Model** marker (TC-14)', () => {
  let tmpRoot, tracksDir, indexPath;

  beforeEach(() => {
    vi.resetAllMocks();
    tmpRoot = mkdtempSync(join(tmpdir(), 'lc-model-override-'));
    tracksDir = join(tmpRoot, 'conductor', 'tracks');
    mkdirSync(join(tracksDir, '1116-test-track'), { recursive: true });
    indexPath = join(tracksDir, '1116-test-track', 'index.md');
    writeFileSync(indexPath, '# Track 1116: Test Track\n\n**Lane**: implement\n**Lane Status**: queue\n**Progress**: 0%\n');
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('writes a **Model** marker when set for the first time (empty = no marker written)', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ repo_path: tmpRoot }] });
    expect(readFileSync(indexPath, 'utf8')).not.toMatch(/\*\*Model\*\*/);

    await syncTrackToFile(1, '1116', { model_override: 'claude-opus-4-5' });

    expect(readFileSync(indexPath, 'utf8')).toMatch(/\*\*Model\*\*:\s*claude-opus-4-5/);
  });

  it('updates an existing **Model** marker in place', async () => {
    writeFileSync(indexPath, '# Track 1116: Test Track\n\n**Lane**: implement\n**Model**: claude-sonnet-5\n');
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ repo_path: tmpRoot }] });

    await syncTrackToFile(1, '1116', { model_override: 'claude-opus-4-5' });

    const content = readFileSync(indexPath, 'utf8');
    expect(content).toMatch(/\*\*Model\*\*:\s*claude-opus-4-5/);
    expect(content).not.toMatch(/claude-sonnet-5/);
  });

  it('clearing (null) removes the marker line entirely', async () => {
    writeFileSync(indexPath, '# Track 1116: Test Track\n\n**Lane**: implement\n**Model**: claude-opus-4-5\n**Progress**: 0%\n');
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ repo_path: tmpRoot }] });

    await syncTrackToFile(1, '1116', { model_override: null });

    const content = readFileSync(indexPath, 'utf8');
    expect(content).not.toMatch(/\*\*Model\*\*/);
    expect(content).toMatch(/\*\*Lane\*\*/); // untouched sibling marker survives
  });
});
