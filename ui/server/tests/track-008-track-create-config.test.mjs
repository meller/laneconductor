// ui/server/tests/track-008-track-create-config.test.mjs
// Track 008 Phase 5, Tasks 2/7: POST /api/projects/:id/tracks accepts
// optional merge_mode/auto_run/workspace_mode/model, validates the enum
// fields, and threads them into trackTemplates() so the real index.md
// written to disk carries the right markers (or none, for the defaults).
//
// Uses the same pool.connect()-shares-pool.query() mock shape as
// track-1033-worker-auth.test.mjs (POST /tracks opens a transaction via
// pool.connect() for atomic track numbering, then does a few more plain
// pool.query() calls) and the same real-tmp-repo-dir approach as
// track-10017-auto-run-api.test.mjs, so we can assert on the actual
// index.md bytes written rather than mocking the filesystem.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { app, pool } from '../index.mjs';

vi.mock('../auth.mjs');
vi.mock('pg', () => {
  const query = vi.fn();
  const Pool = vi.fn(() => ({
    query,
    on: vi.fn(),
    connect: vi.fn().mockResolvedValue({ query, release: vi.fn() }),
  }));
  return { default: { Pool }, Pool };
});

function queueCreateMocks({ nextNum = 20, trackNumber = '020' } = {}) {
  vi.mocked(pool.query)
    .mockResolvedValueOnce({ rows: [{ id: 1, repo_path: repoDir }] }) // project lookup
    .mockResolvedValueOnce({ rows: [] }) // BEGIN
    .mockResolvedValueOnce({ rows: [] }) // SELECT ... FOR UPDATE
    .mockResolvedValueOnce({ rows: [{ next_num: nextNum }] }) // next track number
    .mockResolvedValueOnce({ rows: [] }) // INSERT INTO tracks
    .mockResolvedValueOnce({ rows: [] }) // COMMIT
    .mockResolvedValueOnce({ rows: [] }) // queueFileSync's INSERT INTO file_sync_queue
    .mockResolvedValueOnce({ // final read-back SELECT
      rows: [{ id: 99, track_number: trackNumber, title: 'T', lane_status: 'plan', progress_percent: 0 }],
    });
}

let repoDir;

describe('POST /api/projects/:id/tracks — Phase 5 config fields (Task 2/7)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // vi.resetAllMocks() wipes the connect() mockResolvedValue set up in the
    // vi.mock('pg', ...) factory above — re-establish it so client.query()
    // inside the POST handler's transaction shares the same mocked query
    // queue as pool.query() (same pattern as track-1033-worker-auth.test.mjs).
    vi.mocked(pool.connect).mockResolvedValue({ query: vi.mocked(pool.query), release: vi.fn() });
    repoDir = mkdtempSync(join(tmpdir(), 'lc-track-create-'));
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  function indexPathFor(trackNumber, slug) {
    return join(repoDir, 'conductor', 'tracks', `${trackNumber}-${slug}`, 'index.md');
  }

  it('rejects an invalid merge_mode with 400 rather than silently coercing', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ id: 1, repo_path: repoDir }] });
    const res = await request(app)
      .post('/api/projects/1/tracks')
      .send({ title: 'Bad Merge Mode', merge_mode: 'yolo' })
      .expect(400);
    expect(res.body.error).toMatch(/merge_mode/);
  });

  it('rejects a non-boolean auto_run with 400', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ id: 1, repo_path: repoDir }] });
    const res = await request(app)
      .post('/api/projects/1/tracks')
      .send({ title: 'Bad Auto Run', auto_run: 'yes' })
      .expect(400);
    expect(res.body.error).toMatch(/auto_run/);
  });

  it('all-defaults: writes no config markers to the real index.md on disk', async () => {
    queueCreateMocks({ nextNum: 20, trackNumber: '020' });
    await request(app)
      .post('/api/projects/1/tracks')
      .send({ title: 'Plain Track', description: 'nothing special' })
      .expect(201);

    const indexContent = readFileSync(indexPathFor('020', 'plain-track'), 'utf8');
    expect(indexContent).not.toContain('**Merge Mode**');
    expect(indexContent).not.toContain('**Auto Run**');
    expect(indexContent).not.toContain('**Workspace**');
    expect(indexContent).not.toContain('**Model**');
  });

  it('all-four-non-default: writes every marker to the real index.md on disk', async () => {
    queueCreateMocks({ nextNum: 21, trackNumber: '021' });
    await request(app)
      .post('/api/projects/1/tracks')
      .send({
        title: 'Configured Track',
        description: 'has everything',
        merge_mode: 'direct',
        auto_run: true,
        workspace_mode: 'main',
        model: 'claude-opus-5',
      })
      .expect(201);

    const indexContent = readFileSync(indexPathFor('021', 'configured-track'), 'utf8');
    expect(indexContent).toContain('**Merge Mode**: direct');
    expect(indexContent).toContain('**Auto Run**: yes');
    expect(indexContent).toContain('**Workspace**: main');
    expect(indexContent).toContain('**Model**: claude-opus-5');
  });

  it('a bug-type track gets **Track Kind**: bug in addition to any set config markers', async () => {
    queueCreateMocks({ nextNum: 22, trackNumber: '022' });
    await request(app)
      .post('/api/projects/1/tracks')
      .send({ title: 'A Real Bug', description: 'steps', type: 'bug', merge_mode: 'direct' })
      .expect(201);

    const indexContent = readFileSync(indexPathFor('022', 'a-real-bug'), 'utf8');
    expect(indexContent).toContain('**Track Kind**: bug');
    expect(indexContent).toContain('**Merge Mode**: direct');
  });

  it('setting merge_mode explicitly to "pr" (the default) writes no marker', async () => {
    queueCreateMocks({ nextNum: 23, trackNumber: '023' });
    await request(app)
      .post('/api/projects/1/tracks')
      .send({ title: 'Explicit PR', merge_mode: 'pr' })
      .expect(201);

    const indexContent = readFileSync(indexPathFor('023', 'explicit-pr'), 'utf8');
    expect(indexContent).not.toContain('**Merge Mode**');
  });
});
