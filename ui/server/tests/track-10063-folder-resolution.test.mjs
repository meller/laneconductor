// ui/server/tests/track-10063-folder-resolution.test.mjs
// Track 10063: syncTrackToFile (and four sibling call sites) resolved "which
// folder is track NNN" with an inline `^(\d+)-` regex that is structurally
// blind to the modern INITIALS-NNN-slug convention. On a prefixed track it
// declared the folder "missing" and recreated a bare-numeric duplicate from
// DB content, wrote every marker into THAT folder, and the worker later
// quarantined it and pushed the marker-less canonical state back over the
// DB — silently undoing the write. TC-8..TC-16 exercise the real fix: every
// writer now resolves through resolveTrackFolderFs, the same shared
// primitive `lc track-dir` and the worker use (see
// conductor/tests/track-10063-track-folder-fs.test.mjs and
// track-10063-track-dir-cli.test.mjs for the resolver's own unit/CLI tests).
//
// Real filesystem (mkdtempSync), not mocked — the whole point is that the
// write lands on the real path. Only `pg` and `fetch` are mocked, matching
// ui/server/tests/track-10017-auto-run-api.test.mjs's pattern.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { app, pool } from '../index.mjs';
import { logger } from '../logger.mjs';

vi.mock('../auth.mjs');
vi.mock('pg', () => {
  const query = vi.fn();
  const Pool = vi.fn(() => ({ query, on: vi.fn() }));
  return { default: { Pool }, Pool };
});
global.fetch = vi.fn();

describe('syncTrackToFile folder resolution (TC-8..TC-12)', () => {
  let repoDir;
  let canonicalDir;

  beforeEach(() => {
    vi.resetAllMocks();
    repoDir = mkdtempSync(join(tmpdir(), 'lc-10063-'));
    canonicalDir = join(repoDir, 'conductor', 'tracks', 'TU-10063-slug');
    mkdirSync(canonicalDir, { recursive: true });
    writeFileSync(join(canonicalDir, 'index.md'), '# Track TU-10063: x\n\n**Lane**: implement\n**Lane Status**: queue\n**Progress**: 0%\n', 'utf8');
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it('TC-8/TC-9: PATCH auto-run on a prefixed-only track writes the marker into TU-10063-slug and creates no bare-numeric folder', async () => {
    vi.mocked(pool.query)
      .mockResolvedValueOnce({ rowCount: 1 }) // UPDATE tracks SET auto_run
      .mockResolvedValueOnce({ rows: [{ repo_path: repoDir }] }); // syncTrackToFile's project lookup

    await request(app)
      .patch('/api/projects/1/tracks/10063/auto-run')
      .send({ auto_run: true })
      .expect(200);

    const content = readFileSync(join(canonicalDir, 'index.md'), 'utf8');
    expect(content).toMatch(/\*\*Auto Run\*\*:\s*yes/);
    expect(existsSync(join(repoDir, 'conductor', 'tracks', '10063-slug'))).toBe(false);
  });

  it('TC-10: with a stale bare-numeric duplicate present, the marker lands in the canonical folder and the duplicate is untouched', async () => {
    const staleDir = join(repoDir, 'conductor', 'tracks', '10063-slug');
    mkdirSync(staleDir, { recursive: true });
    writeFileSync(join(staleDir, 'index.md'), '# Track 10063: x\n', 'utf8');
    const staleBefore = readFileSync(join(staleDir, 'index.md'), 'utf8');

    vi.mocked(pool.query)
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ repo_path: repoDir }] });

    await request(app)
      .patch('/api/projects/1/tracks/10063/auto-run')
      .send({ auto_run: true })
      .expect(200);

    const canonicalContent = readFileSync(join(canonicalDir, 'index.md'), 'utf8');
    expect(canonicalContent).toMatch(/\*\*Auto Run\*\*:\s*yes/);
    expect(readFileSync(join(staleDir, 'index.md'), 'utf8')).toBe(staleBefore);
  });

  it('TC-11: the same ambiguous write emits a structured warn naming the track and the non-canonical match', async () => {
    const staleDir = join(repoDir, 'conductor', 'tracks', '10063-slug');
    mkdirSync(staleDir, { recursive: true });
    writeFileSync(join(staleDir, 'index.md'), '# Track 10063: x\n', 'utf8');

    vi.mocked(pool.query)
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ repo_path: repoDir }] });
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});

    await request(app)
      .patch('/api/projects/1/tracks/10063/auto-run')
      .send({ auto_run: true })
      .expect(200);

    const warned = warnSpy.mock.calls.some(([meta]) =>
      meta && String(meta.trackNum ?? meta.trackNumber) === '10063' &&
      JSON.stringify(meta).includes('10063-slug')
    );
    expect(warned).toBe(true);
    warnSpy.mockRestore();
  });

  it('TC-12: when no folder exists at all, the recreate branch names the new folder from the DB author, not bare-numeric', async () => {
    rmSync(canonicalDir, { recursive: true, force: true }); // no folder on disk for this sub-test

    vi.mocked(pool.query)
      .mockResolvedValueOnce({ rowCount: 1 }) // UPDATE tracks SET auto_run
      .mockResolvedValueOnce({ rows: [{ repo_path: repoDir }] }) // syncTrackToFile's project lookup
      .mockResolvedValueOnce({
        rows: [{
          title: 'x', lane_status: 'implement', lane_action_status: 'queue', progress_percent: 0,
          current_phase: null, content_summary: null, index_content: null, plan_content: null,
          spec_content: null, author: 'TU',
        }],
      }); // recreate branch's DB row lookup

    await request(app)
      .patch('/api/projects/1/tracks/10063/auto-run')
      .send({ auto_run: true })
      .expect(200);

    const tracksDir = join(repoDir, 'conductor', 'tracks');
    const created = existsSync(join(tracksDir, 'TU-10063-x')) || readFileSync(
      join(tracksDir, 'TU-10063-x', 'index.md'), 'utf8'
    ).length > 0;
    expect(created).toBeTruthy();
    expect(existsSync(join(tracksDir, '10063-x'))).toBe(false);
  });
});

describe('DELETE /api/projects/:id/tracks/:num removes the real prefixed folder (TC-13)', () => {
  it('deletes TU-10063-slug, not nothing and not a duplicate', async () => {
    const repoDir = mkdtempSync(join(tmpdir(), 'lc-10063-del-'));
    const canonicalDir = join(repoDir, 'conductor', 'tracks', 'TU-10063-slug');
    mkdirSync(canonicalDir, { recursive: true });
    writeFileSync(join(canonicalDir, 'index.md'), '# Track TU-10063: x\n', 'utf8');

    try {
      vi.resetAllMocks();
      vi.mocked(pool.query)
        .mockResolvedValueOnce({ rows: [{ repo_path: repoDir }] }) // project lookup
        .mockResolvedValueOnce({ rows: [{ id: 42 }] }) // track id lookup
        .mockResolvedValueOnce({}) // delete comments
        .mockResolvedValueOnce({}); // delete track

      await request(app).delete('/api/projects/1/tracks/10063').expect(200);

      expect(existsSync(canonicalDir)).toBe(false);
    } finally {
      rmSync(repoDir, { recursive: true, force: true });
    }
  });
});

describe('POST /api/projects/:id/tracks/:num/comments appends to the real conversation.md (TC-14)', () => {
  it('appends the human comment to TU-10063-slug/conversation.md', async () => {
    const repoDir = mkdtempSync(join(tmpdir(), 'lc-10063-comment-'));
    const canonicalDir = join(repoDir, 'conductor', 'tracks', 'TU-10063-slug');
    mkdirSync(canonicalDir, { recursive: true });
    writeFileSync(join(canonicalDir, 'conversation.md'), '# Conversation\n', 'utf8');

    try {
      vi.resetAllMocks();
      vi.mocked(fetch).mockResolvedValueOnce({ ok: true, text: async () => '{"id":1}' });
      vi.mocked(pool.query)
        .mockResolvedValueOnce({ rows: [{ repo_path: repoDir }] }) // project lookup inside comment sync
        .mockResolvedValueOnce({}); // queueFileSync insert

      await request(app)
        .post('/api/projects/1/tracks/10063/comments')
        .send({ body: 'please check this', author: 'human' })
        .expect(201);

      const convo = readFileSync(join(canonicalDir, 'conversation.md'), 'utf8');
      expect(convo).toContain('please check this');
    } finally {
      rmSync(repoDir, { recursive: true, force: true });
    }
  });
});

describe('POST /api/projects/:id/tracks/:num/open-bug writes test.md into the real prefixed folder (TC-15)', () => {
  it('appends the regression block to TU-10063-slug/test.md and reports its real relative path', async () => {
    const repoDir = mkdtempSync(join(tmpdir(), 'lc-10063-bug-'));
    const canonicalDir = join(repoDir, 'conductor', 'tracks', 'TU-10063-slug');
    mkdirSync(canonicalDir, { recursive: true });
    writeFileSync(join(canonicalDir, 'test.md'), '# Tests\n\n## Test Cases\n', 'utf8');
    writeFileSync(join(canonicalDir, 'conversation.md'), '# Conversation\n', 'utf8');

    try {
      vi.resetAllMocks();
      vi.mocked(fetch).mockResolvedValue({ ok: true, text: async () => '{"id":1}' });
      vi.mocked(pool.query)
        .mockResolvedValueOnce({ rows: [{ repo_path: repoDir }] }) // project lookup
        .mockResolvedValueOnce({ rows: [{ id: 7 }] }) // getTrackId
        .mockResolvedValueOnce({ rows: [{ test_content: null }] }) // existing test_content
        .mockResolvedValueOnce({}) // queueFileSync test.md
        .mockResolvedValueOnce({}); // queueFileSync conversation.md

      await request(app)
        .post('/api/projects/1/tracks/10063/open-bug')
        .send({ description: 'clicking save crashes' })
        .expect(201);

      const testMd = readFileSync(join(canonicalDir, 'test.md'), 'utf8');
      expect(testMd).toContain('clicking save crashes');

      const queueCall = vi.mocked(pool.query).mock.calls.find(([sql]) => sql.includes('INSERT INTO file_sync_queue'));
      expect(queueCall[1][1]).toBe(join('conductor', 'tracks', 'TU-10063-slug', 'test.md'));
    } finally {
      rmSync(repoDir, { recursive: true, force: true });
    }
  });
});

describe('POST /api/projects/:id/tracks/:num/fix-review reads plan.md from the real prefixed folder (TC-16)', () => {
  it('200s and writes the fix phase into TU-10063-slug/plan.md instead of 404ing', async () => {
    const repoDir = mkdtempSync(join(tmpdir(), 'lc-10063-review-'));
    const canonicalDir = join(repoDir, 'conductor', 'tracks', 'TU-10063-slug');
    mkdirSync(canonicalDir, { recursive: true });
    writeFileSync(join(canonicalDir, 'plan.md'), '# Plan\n\n## Phase 1: Initial\n', 'utf8');

    try {
      vi.resetAllMocks();
      vi.mocked(fetch).mockResolvedValue({ ok: true, text: async () => '{"ok":true}' });
      vi.mocked(pool.query)
        .mockResolvedValueOnce({ rows: [{ repo_path: repoDir }] }) // project lookup
        .mockResolvedValueOnce({ rows: [{ id: 7 }] }) // getTrackId
        .mockResolvedValueOnce({ rows: [] }); // no track_comments — falls back to "Address review gaps"

      const res = await request(app)
        .post('/api/projects/1/tracks/10063/fix-review')
        .send({})
        .expect(200);

      expect(res.body.ok).toBe(true);
      const planMd = readFileSync(join(canonicalDir, 'plan.md'), 'utf8');
      expect(planMd).toContain('Fix Review Gaps');
    } finally {
      rmSync(repoDir, { recursive: true, force: true });
    }
  });
});
