import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { app, pool } from '../index.mjs';
import * as fs from 'fs';
import { appendRegressionTest } from '../utils.mjs';

vi.mock('../auth.mjs');
global.fetch = vi.fn();

vi.mock('fs', () => ({
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  readdirSync: vi.fn(),
  existsSync: vi.fn(),
  statSync: vi.fn(() => ({ size: 100 })),
  appendFileSync: vi.fn(),
  rmSync: vi.fn(),
}));

vi.mock('pg', () => {
  const query = vi.fn();
  const Pool = vi.fn(() => ({ query, on: vi.fn() }));
  return { default: { Pool }, Pool };
});

vi.mock('child_process', () => ({
  exec: vi.fn(),
  spawn: vi.fn(() => ({ pid: 1234, unref: vi.fn(), on: vi.fn() })),
}));

// ── Unit tests: appendRegressionTest (pure function) ─────────────────────────

describe('appendRegressionTest', () => {
  it('TC-8: empty input → creates ## Test Cases section + TC-BUG-1 line', () => {
    const result = appendRegressionTest('', 'clicking open bug crashes UI', '1045');
    expect(result).toContain('## Test Cases');
    expect(result).toContain('TC-BUG-1');
    expect(result).toContain('clicking open bug crashes UI');
  });

  it('TC-9: existing content with no TC-BUG- entries → appends TC-BUG-1', () => {
    const existing = '# Tests\n\n## Test Cases\n\n- [ ] TC-1: some test\n';
    const result = appendRegressionTest(existing, 'some bug', '1045');
    expect(result).toContain('TC-BUG-1');
    expect(result).not.toContain('TC-BUG-2');
  });

  it('TC-10: content with 2 TC-BUG- entries → appends TC-BUG-3', () => {
    const existing =
      '# Tests\n\n## Test Cases\n\n' +
      '### Regression: bug1\n- [ ] TC-BUG-1: ...\n\n' +
      '### Regression: bug2\n- [ ] TC-BUG-2: ...\n';
    const result = appendRegressionTest(existing, 'third bug', '1045');
    expect(result).toContain('TC-BUG-3');
  });

  it('TC-11: description with markdown special chars does not break format', () => {
    const result = appendRegressionTest('', 'bug with *asterisks* and _underscores_', '1045');
    expect(result).toContain('TC-BUG-1');
    // Should be present in the output without crashing
    expect(result).toContain('### Regression:');
  });

  it('creates correct format with date and track context', () => {
    const result = appendRegressionTest('', 'test bug', '1045');
    expect(result).toMatch(/### Regression: test bug \(\d{4}-\d{2}-\d{2}/);
    expect(result).toContain('- [ ] TC-BUG-1:');
  });
});

// ── API integration tests: POST /open-bug ────────────────────────────────────

describe('POST /api/projects/:id/tracks/:num/open-bug', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  function setupMocks({ repoPath = '/repo', trackDir = '1045-bug-to-test-flow', testMdExists = false, testMdContent = '' } = {}) {
    // pool.query calls in order:
    // 1. SELECT repo_path FROM projects
    // 2. getTrackId (SELECT id FROM tracks)
    // 3. SELECT test_content FROM tracks WHERE id
    // 4. queueFileSync INSERT
    vi.mocked(pool.query)
      .mockResolvedValueOnce({ rows: [{ repo_path: repoPath }] })
      .mockResolvedValueOnce({ rows: [{ id: 99 }] })
      .mockResolvedValueOnce({ rows: [{ test_content: testMdContent }] })
      .mockResolvedValueOnce({ rows: [] }); // queueFileSync

    // fs: readdirSync returns track folder, existsSync for test.md
    vi.mocked(fs.readdirSync).mockReturnValue([trackDir]);
    vi.mocked(fs.existsSync).mockReturnValue(testMdExists);
    vi.mocked(fs.readFileSync).mockReturnValue(testMdContent);
    vi.mocked(fs.statSync).mockReturnValue({ size: 100 });

    // fetch: collectorWrite calls
    // 1. POST /track/:num/comment
    // 2. PATCH /track/:num (lane + test_content)
    vi.mocked(fetch)
      .mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify({ id: 1, author: 'human', body: '🐛 Bug reported: test', created_at: new Date().toISOString() }) })
      .mockResolvedValueOnce({ ok: true, text: async () => '{"ok":true}' });
  }

  it('TC-1: returns 201 with ok and test_appended on success', async () => {
    setupMocks();
    const res = await request(app)
      .post('/api/projects/1/tracks/1045/open-bug')
      .send({ description: 'clicking open bug crashes the UI' })
      .expect(201);

    expect(res.body.ok).toBe(true);
    expect(res.body.test_appended).toBe(true);
  });

  it('TC-2: missing description uses placeholder', async () => {
    setupMocks();
    const res = await request(app)
      .post('/api/projects/1/tracks/1045/open-bug')
      .send({})
      .expect(201);

    expect(res.body.ok).toBe(true);
    // Should not crash with empty description
  });

  it('TC-3: non-existent project → 404', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] });
    await request(app)
      .post('/api/projects/999/tracks/1045/open-bug')
      .send({ description: 'test' })
      .expect(404);
  });

  it('TC-4: test.md on disk is written with regression block', async () => {
    setupMocks({ testMdExists: true, testMdContent: '# Tests\n\n## Test Cases\n' });
    await request(app)
      .post('/api/projects/1/tracks/1045/open-bug')
      .send({ description: 'some bug' })
      .expect(201);

    expect(fs.writeFileSync).toHaveBeenCalled();
    const writtenContent = vi.mocked(fs.writeFileSync).mock.calls[0][1];
    expect(writtenContent).toContain('TC-BUG-1');
    expect(writtenContent).toContain('some bug');
  });

  it('TC-6: comment is posted via collectorWrite', async () => {
    setupMocks();
    await request(app)
      .post('/api/projects/1/tracks/1045/open-bug')
      .send({ description: 'the bug description' })
      .expect(201);

    // fetch should have been called for the comment
    expect(fetch).toHaveBeenCalled();
    const firstCall = vi.mocked(fetch).mock.calls[0];
    expect(firstCall[1].body).toContain('Bug reported');
  });
});
