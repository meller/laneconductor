// ui/server/tests/track-10069-manager-comments-route.test.mjs
// Track 10069 Phase 4 (REQ-27, D8): the manager pseudo-track
// (conductor/tracks/manager/, 10067 REQ-14) has no `tracks` row by design
// (D7) — getTrackId's own query would always 404 it, and the normal POST
// route writes through collectorWrite to a row that doesn't exist. Both
// routes get a reserved-name branch that reads/writes the pseudo-track's
// conversation.md directly instead.
//
// Real filesystem (mkdtempSync), only pg/fetch mocked — matching
// track-10063-folder-resolution.test.mjs's pattern, since the whole point
// here is that the write lands on the real file and sets the real marker.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { app, pool } from '../index.mjs';

vi.mock('../auth.mjs');
vi.mock('pg', () => {
  const query = vi.fn();
  const Pool = vi.fn(() => ({ query, on: vi.fn() }));
  return { default: { Pool }, Pool };
});
global.fetch = vi.fn();

describe('Manager pseudo-track comments routes (TC-4.4, TC-4.5)', () => {
  let repoDir;
  let managerDir;

  beforeEach(() => {
    vi.resetAllMocks();
    repoDir = mkdtempSync(join(tmpdir(), 'lc-10069-manager-'));
    managerDir = join(repoDir, 'conductor', 'tracks', 'manager');
    mkdirSync(managerDir, { recursive: true });
    writeFileSync(join(managerDir, 'index.md'), '# Manager supervision\n\n**Waiting for reply**: no\n', 'utf8');
    writeFileSync(join(managerDir, 'conversation.md'), '# Conversation: manager\n', 'utf8');
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it('TC-4.4: GET returns parsed turns as 200 JSON, never 404, and issues no getTrackId query', async () => {
    writeFileSync(
      join(managerDir, 'conversation.md'),
      '# Conversation: manager\n\n> **human**: is anything stuck?\n\n> **claude**: nothing stuck right now.\n',
      'utf8'
    );
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ repo_path: repoDir }] }); // project lookup only

    const res = await request(app).get('/api/projects/1/tracks/manager/comments').expect(200);

    expect(res.body).toHaveLength(2);
    expect(res.body[0]).toMatchObject({ author: 'human', body: 'is anything stuck?' });
    expect(res.body[1]).toMatchObject({ author: 'claude', body: 'nothing stuck right now.' });
    expect(res.body[0].id).toBeDefined();
    expect(res.body[0].created_at).toBeDefined();
    // getTrackId's SELECT id FROM tracks... must never be issued for this
    // reserved name — only the one project-lookup query above.
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  it('GET on an empty/missing conversation.md returns an empty array, not an error', async () => {
    rmSync(join(managerDir, 'conversation.md'));
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ repo_path: repoDir }] });
    const res = await request(app).get('/api/projects/1/tracks/manager/comments').expect(200);
    expect(res.body).toEqual([]);
  });

  it('TC-4.5: POST appends a > **human**: turn, advances the cursor, sets Waiting for reply, and skips collectorWrite', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ repo_path: repoDir }] }); // project lookup

    await request(app)
      .post('/api/projects/1/tracks/manager/comments')
      .send({ author: 'human', body: 'which tracks are in review?' })
      .expect(201);

    const conv = readFileSync(join(managerDir, 'conversation.md'), 'utf8');
    expect(conv).toMatch(/> \*\*human\*\*: which tracks are in review\?/);

    const cursor = readFileSync(join(managerDir, '.conv-cursor'), 'utf8');
    expect(parseInt(cursor, 10)).toBe(conv.length);

    const index = readFileSync(join(managerDir, 'index.md'), 'utf8');
    expect(index).toMatch(/\*\*Waiting for reply\*\*:\s*yes/i);

    // No collector write for the pseudo-track — no fetch call at all.
    expect(fetch).not.toHaveBeenCalled();
  });

  it('a non-human POST (e.g. author: system) still appends but does not set Waiting for reply', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ repo_path: repoDir }] });

    await request(app)
      .post('/api/projects/1/tracks/manager/comments')
      .send({ author: 'system', body: 'note only' })
      .expect(201);

    const index = readFileSync(join(managerDir, 'index.md'), 'utf8');
    expect(index).toMatch(/\*\*Waiting for reply\*\*:\s*no/i);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('numbered tracks are unaffected — still routed through the existing DB-backed path', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ id: 7 }] }).mockResolvedValueOnce({ rows: [] });
    await request(app).get('/api/projects/1/tracks/42/comments').expect(200);
  });
});
