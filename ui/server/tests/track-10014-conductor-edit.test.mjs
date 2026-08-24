// ui/server/tests/track-10014-conductor-edit.test.mjs
// Track 10014: generalize the workflow.json write-through pattern
// (conductor_files JSONB + disk write) to the other conductor context docs.

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

describe('PATCH /api/projects/:id/conductor/:key', () => {
  beforeEach(() => vi.resetAllMocks());

  it('TC-7: edits the product doc and writes through to disk', async () => {
    vi.mocked(pool.query)
      .mockResolvedValueOnce({ rows: [{ repo_path: '/repo/proj', conductor_files: { product: 'old' } }] }) // SELECT
      .mockResolvedValueOnce({ rowCount: 1 }); // UPDATE
    vi.mocked(fs.existsSync).mockReturnValue(true);

    const res = await request(app)
      .patch('/api/projects/1/conductor/product')
      .send({ content: '# New Product Doc' })
      .expect(200);

    expect(res.body).toEqual({ ok: true });
    expect(pool.query).toHaveBeenNthCalledWith(
      2,
      expect.stringMatching(/UPDATE projects SET conductor_files/i),
      [expect.objectContaining({ product: '# New Product Doc' }), '1']
    );
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining('product.md'),
      '# New Product Doc',
      'utf8'
    );
  });

  it('TC-8: edits the kpis and tech_stack docs', async () => {
    for (const [key, file] of [['kpis', 'kpis.md'], ['tech_stack', 'tech-stack.md']]) {
      vi.mocked(pool.query)
        .mockResolvedValueOnce({ rows: [{ repo_path: '/repo/proj', conductor_files: {} }] })
        .mockResolvedValueOnce({ rowCount: 1 });
      vi.mocked(fs.existsSync).mockReturnValue(true);

      const res = await request(app)
        .patch(`/api/projects/1/conductor/${key}`)
        .send({ content: 'content for ' + key })
        .expect(200);

      expect(res.body).toEqual({ ok: true });
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining(file),
        'content for ' + key,
        'utf8'
      );
    }
  });

  it('TC-9: rejects an unknown key with 400 and makes no DB write', async () => {
    const res = await request(app)
      .patch('/api/projects/1/conductor/not_a_real_key')
      .send({ content: 'hello' })
      .expect(400);

    expect(res.body.error).toMatch(/key/i);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('TC-10: succeeds with a DB-only write when the project has no local repo_path', async () => {
    vi.mocked(pool.query)
      .mockResolvedValueOnce({ rows: [{ repo_path: null, conductor_files: {} }] })
      .mockResolvedValueOnce({ rowCount: 1 });

    const res = await request(app)
      .patch('/api/projects/1/conductor/product')
      .send({ content: 'remote-only content' })
      .expect(200);

    expect(res.body).toEqual({ ok: true });
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it('returns 404 when project does not exist', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .patch('/api/projects/999/conductor/product')
      .send({ content: 'x' })
      .expect(404);

    expect(res.body.error).toMatch(/not found/i);
  });
});
