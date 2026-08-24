// ui/server/tests/track-10014-project-crud.test.mjs
// Track 10014: Rename & Delete project API endpoints.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { app, pool } from '../index.mjs';
import * as fs from 'fs';

vi.mock('../auth.mjs');

vi.mock('fs', () => ({
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  rmSync: vi.fn(),
  readdirSync: vi.fn(() => []),
  statSync: vi.fn(),
  appendFileSync: vi.fn(),
}));

vi.mock('pg', () => {
  const query = vi.fn();
  const Pool = vi.fn(() => ({ query, on: vi.fn() }));
  return { default: { Pool }, Pool };
});

describe('PATCH /api/projects/:id (rename)', () => {
  beforeEach(() => vi.resetAllMocks());

  it('TC-1: renames a project', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ id: 1, name: 'Renamed' }] });

    const res = await request(app)
      .patch('/api/projects/1')
      .send({ name: 'Renamed' })
      .expect(200);

    expect(res.body).toEqual({ ok: true, name: 'Renamed' });
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringMatching(/UPDATE projects SET name/i),
      ['Renamed', '1']
    );
  });

  it('TC-2: rejects an empty name', async () => {
    const res = await request(app)
      .patch('/api/projects/1')
      .send({ name: '   ' })
      .expect(400);

    expect(res.body.error).toMatch(/name/i);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('returns 404 when project does not exist', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .patch('/api/projects/999')
      .send({ name: 'Whatever' })
      .expect(404);

    expect(res.body.error).toMatch(/not found/i);
  });
});

describe('DELETE /api/projects/:id', () => {
  beforeEach(() => vi.resetAllMocks());

  it('TC-3: deletes DB row only when deleteLocalFiles is not set', async () => {
    vi.mocked(pool.query)
      .mockResolvedValueOnce({ rows: [{ id: 1, repo_path: '/repo/proj' }] }) // SELECT
      .mockResolvedValueOnce({ rowCount: 1 }); // DELETE

    const res = await request(app)
      .delete('/api/projects/1')
      .send({})
      .expect(200);

    expect(res.body).toEqual({ ok: true, localFilesDeleted: false });
    expect(fs.rmSync).not.toHaveBeenCalled();
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringMatching(/DELETE FROM projects/i),
      ['1']
    );
  });

  it('TC-4: removes conductor/ and .laneconductor.json from disk when deleteLocalFiles=true and repo_path exists', async () => {
    vi.mocked(pool.query)
      .mockResolvedValueOnce({ rows: [{ id: 1, repo_path: '/repo/proj' }] })
      .mockResolvedValueOnce({ rowCount: 1 });
    vi.mocked(fs.existsSync).mockReturnValue(true);

    const res = await request(app)
      .delete('/api/projects/1')
      .send({ deleteLocalFiles: true })
      .expect(200);

    expect(res.body).toEqual({ ok: true, localFilesDeleted: true });
    expect(fs.rmSync).toHaveBeenCalledWith(
      expect.stringContaining('conductor'),
      expect.objectContaining({ recursive: true, force: true })
    );
    expect(fs.rmSync).toHaveBeenCalledWith(
      expect.stringContaining('.laneconductor.json'),
      expect.objectContaining({ force: true })
    );
    // Never shells out to git for delete.
    const execCalls = vi.mocked(fs.rmSync).mock.calls.flat().join(' ');
    expect(execCalls).not.toMatch(/\.git/);
  });

  it('TC-5: does not throw when deleteLocalFiles=true but repo_path does not exist locally', async () => {
    vi.mocked(pool.query)
      .mockResolvedValueOnce({ rows: [{ id: 1, repo_path: null }] })
      .mockResolvedValueOnce({ rowCount: 1 });
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const res = await request(app)
      .delete('/api/projects/1')
      .send({ deleteLocalFiles: true })
      .expect(200);

    expect(res.body).toEqual({ ok: true, localFilesDeleted: false });
    expect(fs.rmSync).not.toHaveBeenCalled();
  });

  it('TC-6: returns 404 for a nonexistent project', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .delete('/api/projects/999')
      .send({})
      .expect(404);

    expect(res.body.error).toMatch(/not found/i);
  });
});
