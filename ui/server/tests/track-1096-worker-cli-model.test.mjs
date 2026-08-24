// ui/server/tests/track-1096-worker-cli-model.test.mjs
// Track 1096: Worker CLI Engine and Model Picker API tests

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

// Track 1096 Phase 7: mirrors track-10011-providers.test.mjs's execFile mock
// — POST /api/projects/:id/worker/start now shells out via execFileAsync
// (not execAsync's shell string) when cli/model are present, same
// injection-avoidance rationale as /workers/start-new.
const execFileMock = vi.fn((...callArgs) => {
  const cb = callArgs.find(a => typeof a === 'function');
  if (!cb) return; // see track-1091-manager-start.test.mjs's identical note
  process.nextTick(() => cb(null, { stdout: 'started\n', stderr: '' }));
});

vi.mock('child_process', async importOriginal => {
  const actual = await importOriginal();
  return { ...actual, execFile: (...args) => execFileMock(...args) };
});

vi.mock('../auth.mjs');

vi.mock('pg', () => {
  const query = vi.fn();
  const Pool = vi.fn(() => ({ query, on: vi.fn() }));
  return { default: { Pool }, Pool };
});

import { app, pool } from '../index.mjs';

describe('Track 1096: Worker CLI & Model Config API', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    execFileMock.mockClear();
  });

  describe('POST /api/projects/:id/worker/start', () => {
    it('TC-P7-2: forwards cli/model from the request body into the spawned lc start args', async () => {
      vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ repo_path: '/repo' }] }); // project lookup

      await request(app)
        .post('/api/projects/1/worker/start')
        .send({ cli: 'gemini', model: 'gemini-2.5-pro' })
        .expect(200);

      const [cmd, args] = execFileMock.mock.calls[0];
      expect(cmd).toBe('lc');
      expect(args).toEqual(['start', '--cli', 'gemini', '--model', 'gemini-2.5-pro']);
    });

    it('TC-P7-3: omits --cli/--model entirely when not provided — no regression for the plain Start button', async () => {
      vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ repo_path: '/repo' }] });

      await request(app)
        .post('/api/projects/1/worker/start')
        .send({})
        .expect(200);

      const [cmd, args] = execFileMock.mock.calls[0];
      expect(cmd).toBe('lc');
      expect(args).toEqual(['start']);
    });

    it('rejects an unsupported cli engine', async () => {
      vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ repo_path: '/repo' }] });

      const res = await request(app)
        .post('/api/projects/1/worker/start')
        .send({ cli: 'unsupported-cli' })
        .expect(400);

      expect(res.body.error).toMatch(/Invalid CLI engine/i);
      expect(execFileMock).not.toHaveBeenCalled();
    });
  });

  describe('PATCH /api/workers/:id/config', () => {
    it('updates worker cli and model, and queues set_model dispatch', async () => {
      // 1. SELECT worker check
      vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ id: 5, project_id: 10, type: 'worker' }] });
      // 2. UPDATE workers
      vi.mocked(pool.query).mockResolvedValueOnce({ rowCount: 1 });
      // 3. INSERT worker_dispatch
      vi.mocked(pool.query).mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 42 }] });

      const res = await request(app)
        .patch('/api/workers/5/config')
        .send({ cli: 'gemini', model: 'gemini-2.5-pro' })
        .expect(200);

      expect(res.body).toEqual({ ok: true, worker_id: '5', cli: 'gemini', model: 'gemini-2.5-pro' });
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE workers SET cli = $1, model = $2'),
        ['gemini', 'gemini-2.5-pro', '5']
      );
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO worker_dispatch'),
        ['5', JSON.stringify({ cli: 'gemini', model: 'gemini-2.5-pro' })]
      );
    });

    it('validates cli engine', async () => {
      const res = await request(app)
        .patch('/api/workers/5/config')
        .send({ cli: 'unsupported-cli', model: 'gemini-2.5-pro' })
        .expect(400);

      expect(res.body.error).toMatch(/Invalid CLI engine/i);
    });

    it('returns 404 when worker is not found', async () => {
      vi.mocked(pool.query).mockResolvedValueOnce({ rowCount: 0, rows: [] });

      const res = await request(app)
        .patch('/api/workers/999/config')
        .send({ cli: 'claude', model: 'claude-3-7-sonnet' })
        .expect(404);

      expect(res.body.error).toMatch(/Worker not found/i);
    });
  });

  describe('PATCH /worker/heartbeat with cli & model', () => {
    // Phase 7 Task 7.4 — this route already handled cli/model (verified by
    // reading it during planning), it just had no test. Mirrors the
    // sibling case in track-10011-providers.test.mjs ("PATCH
    // /worker/heartbeat with cli:agy stores cli:antigravity").
    it('updates the stored model on heartbeat', async () => {
      vi.mocked(pool.query).mockResolvedValueOnce({ rowCount: 1 }); // UPDATE workers

      await request(app)
        .patch('/worker/heartbeat')
        .send({ hostname: 'h', pid: 1, project_id: 10, model: 'claude-3-5-haiku' })
        .expect(200);

      expect(pool.query).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining('UPDATE workers SET'),
        expect.arrayContaining(['claude-3-5-haiku'])
      );
    });

    it('leaves stored cli/model untouched when a heartbeat omits them', async () => {
      vi.mocked(pool.query).mockResolvedValueOnce({ rowCount: 1 }); // UPDATE workers

      await request(app)
        .patch('/worker/heartbeat')
        .send({ hostname: 'h', pid: 1, project_id: 10 })
        .expect(200);

      const [queryStr] = vi.mocked(pool.query).mock.calls[0];
      expect(queryStr).not.toMatch(/\bcli\s*=\s*\$/);
      expect(queryStr).not.toMatch(/\bmodel\s*=\s*\$/);
    });
  });

  describe('POST /worker/register with cli & model', () => {
    it('persists cli and model during registration', async () => {
      const mockRegisteredWorker = {
        ok: true,
        machine_token: 'mock-token',
        id: 7
      };
      // 1. SELECT machine_token
      vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ machine_token: 'mock-token' }] });
      // 2. INSERT INTO workers
      vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ id: 7 }] });

      const res = await request(app)
        .post('/worker/register')
        .send({
          project_id: 10,
          hostname: 'worker-node',
          pid: 1234,
          mode: 'sync+poll',
          type: 'worker',
          cli: 'antigravity',
          model: 'gemini-2.5-pro'
        })
        .expect(200);

      expect(res.body.ok).toBe(true);
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO workers'),
        expect.arrayContaining(['antigravity', 'gemini-2.5-pro'])
      );
    });
  });
});
