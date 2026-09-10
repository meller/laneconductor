// ui/server/tests/track-10080-files-api.test.mjs
// Track 10080 Phase 2 (TC-24..TC-34, TC-61, TC-62): GET /api/projects/:id/files.
//
// Mocks child_process (execFile, for `git ls-files`), fs (existsSync) and
// pg, following the precedent in track-1091-manager-start.test.mjs and
// track-10014-conductor-edit.test.mjs.
//
// Each test uses its own project id. The endpoint's disk-file cache is
// keyed by project id and lives for the process lifetime (module-level
// Map, by design — REQ-2), so two tests sharing an id would see each
// other's cached result instead of the fresh git ls-files call the test
// asserts on.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

const DEFAULT_STDOUT = 'ui/src/components/ChatView.jsx\0ui/src/components/ChatView.test.jsx\0Makefile\0bin/lc.mjs\0';

const execFileMock = vi.fn((...callArgs) => {
  const cb = callArgs.find(a => typeof a === 'function');
  if (!cb) return;
  process.nextTick(() => cb(null, { stdout: DEFAULT_STDOUT, stderr: '' }));
});

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, execFile: (...args) => execFileMock(...args) };
});

vi.mock('../auth.mjs');

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    existsSync: vi.fn(() => true),
  };
});

vi.mock('pg', () => {
  const query = vi.fn();
  const Pool = vi.fn(() => ({ query, on: vi.fn() }));
  return { default: { Pool }, Pool };
});

const { app, pool } = await import('../index.mjs');
const { existsSync } = await import('fs');

function mockProject(id, overrides = {}) {
  return {
    id,
    repo_path: '/repo/proj',
    file_manifest: null,
    file_manifest_updated_at: null,
    ...overrides,
  };
}

describe('GET /api/projects/:id/files', () => {
  beforeEach(() => {
    vi.mocked(pool.query).mockReset();
    execFileMock.mockClear();
    vi.mocked(existsSync).mockReturnValue(true);
  });

  it('TC-24: repo_path present — source disk, ranked best-first, every path from git ls-files', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [mockProject(101)] });

    const res = await request(app).get('/api/projects/101/files?q=chat').expect(200);

    expect(res.body.source).toBe('disk');
    expect(res.body.files.length).toBeGreaterThan(0);
    const known = ['ui/src/components/ChatView.jsx', 'ui/src/components/ChatView.test.jsx', 'Makefile', 'bin/lc.mjs'];
    for (const f of res.body.files) {
      expect(known).toContain(f.path);
    }
    // Best-first: the shorter, more direct ChatView.jsx match should not
    // rank below its own .test.jsx sibling.
    const paths = res.body.files.map(f => f.path);
    expect(paths.indexOf('ui/src/components/ChatView.jsx')).toBeLessThan(paths.indexOf('ui/src/components/ChatView.test.jsx'));
  });

  it('TC-25: no q — first `limit` paths in deterministic path order', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [mockProject(102)] });

    const res = await request(app).get('/api/projects/102/files?limit=2').expect(200);

    expect(res.body.files).toEqual([
      { path: 'ui/src/components/ChatView.jsx', score: null },
      { path: 'ui/src/components/ChatView.test.jsx', score: null },
    ]);
  });

  it('TC-26: an oversized limit is clamped to 100, not an error', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [mockProject(103)] });

    const res = await request(app).get('/api/projects/103/files?limit=5000').expect(200);

    expect(res.body.files.length).toBeLessThanOrEqual(100);
  });

  it('TC-27: an oversized q is truncated internally, not an error', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [mockProject(104)] });

    const longQuery = 'a'.repeat(500);
    await request(app).get(`/api/projects/104/files?q=${longQuery}`).expect(200);
  });

  it('TC-28: two concurrent requests on a cold cache invoke git ls-files once', async () => {
    vi.mocked(pool.query)
      .mockResolvedValueOnce({ rows: [mockProject(105)] })
      .mockResolvedValueOnce({ rows: [mockProject(105)] });

    await Promise.all([
      request(app).get('/api/projects/105/files').expect(200),
      request(app).get('/api/projects/105/files').expect(200),
    ]);

    expect(execFileMock).toHaveBeenCalledTimes(1);
  });

  it('TC-29: a second request inside the TTL makes no further git ls-files invocation', async () => {
    vi.mocked(pool.query)
      .mockResolvedValueOnce({ rows: [mockProject(106)] })
      .mockResolvedValueOnce({ rows: [mockProject(106)] });

    await request(app).get('/api/projects/106/files').expect(200);
    await request(app).get('/api/projects/106/files').expect(200);

    expect(execFileMock).toHaveBeenCalledTimes(1);
  });

  it('TC-30: repo_path null and no stored manifest — 200, source none, empty list', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [mockProject(107, { repo_path: null })] });

    const res = await request(app).get('/api/projects/107/files').expect(200);

    expect(res.body).toEqual({
      files: [],
      source: 'none',
      total: 0,
      truncated: false,
      age_seconds: expect.any(Number),
    });
  });

  it('TC-31: repo_path is not a git repository — same as TC-30, no unhandled rejection', async () => {
    execFileMock.mockImplementationOnce((...callArgs) => {
      const cb = callArgs.find(a => typeof a === 'function');
      process.nextTick(() => cb(new Error('fatal: not a git repository')));
    });
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [mockProject(108)] });

    const res = await request(app).get('/api/projects/108/files').expect(200);

    expect(res.body.source).toBe('none');
    expect(res.body.files).toEqual([]);
  });

  it('TC-32: unknown project id returns 404', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] });

    await request(app).get('/api/projects/999/files').expect(404);
  });

  it('TC-33: git ls-files is invoked with an argument array and cwd = repo_path, never a shell string', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [mockProject(109, { repo_path: '/repo/proj-109' })] });

    await request(app).get('/api/projects/109/files').expect(200);

    const [cmd, args, opts] = execFileMock.mock.calls[0];
    expect(cmd).toBe('git');
    expect(args).toEqual(['ls-files', '-z']);
    expect(opts.cwd).toBe('/repo/proj-109');
  });

  it('TC-34: the response body carries no file contents under any input', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [mockProject(110)] });

    const res = await request(app).get('/api/projects/110/files?q=chat').expect(200);

    expect(Object.keys(res.body).sort()).toEqual(['age_seconds', 'files', 'source', 'total', 'truncated']);
    for (const f of res.body.files) {
      expect(Object.keys(f).sort()).toEqual(['path', 'score']);
    }
  });

  it('TC-61: repo_path unreachable but a stored manifest present — source worker, results from the manifest', async () => {
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(pool.query).mockResolvedValueOnce({
      rows: [mockProject(111, {
        repo_path: '/repo/not-on-this-host',
        file_manifest: ['Makefile', 'bin/lc.mjs'],
        file_manifest_updated_at: new Date(Date.now() - 5000).toISOString(),
      })],
    });

    const res = await request(app).get('/api/projects/111/files').expect(200);

    expect(res.body.source).toBe('worker');
    expect(res.body.files.map(f => f.path).sort()).toEqual(['Makefile', 'bin/lc.mjs']);
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it('TC-62: age_seconds on a worker-sourced response is derived from file_manifest_updated_at', async () => {
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(pool.query).mockResolvedValueOnce({
      rows: [mockProject(112, {
        repo_path: null,
        file_manifest: ['Makefile'],
        file_manifest_updated_at: new Date(Date.now() - 120_000).toISOString(),
      })],
    });

    const res = await request(app).get('/api/projects/112/files').expect(200);

    expect(res.body.age_seconds).toBeGreaterThanOrEqual(119);
    expect(res.body.age_seconds).toBeLessThan(130);
  });
});
