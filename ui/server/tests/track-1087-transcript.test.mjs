// server/tests/track-1087-transcript.test.mjs
// Track 1087 Phase 4 Task 4: on track detail panel load, reconstruct the
// transcript from the full JSONL log file (not just the truncated
// last_log_tail) before subscribing to live WS events.
//
// GET /api/projects/:id/tracks/:num/transcript finds the most recent
// conductor/logs/*-<trackNumber>-<timestamp>.log file for this project
// (repo_path is already read directly off disk elsewhere in this file for
// the same local-api co-location assumption — see e.g. GET
// /api/projects/:id/conductor), parses each line as JSON, and returns the
// events array. The client re-runs them through the same
// streamTranscript.js reducer used for live events (Phase 3), so there is
// only one reducer implementation, not a duplicated server-side one.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { app, pool } from '../index.mjs';
import * as fs from 'fs';

vi.mock('../auth.mjs');

vi.mock('fs', () => ({
    readFileSync: vi.fn(),
    readdirSync: vi.fn(),
    existsSync: vi.fn(),
    statSync: vi.fn(),
}));

vi.mock('pg', () => {
    const query = vi.fn();
    const Pool = vi.fn(() => ({ query, on: vi.fn() }));
    return { default: { Pool }, Pool };
});

describe('GET /api/projects/:id/tracks/:num/transcript', () => {
    beforeEach(() => vi.resetAllMocks());

    it('returns 404 when the project does not exist', async () => {
        vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] });
        const res = await request(app).get('/api/projects/999/tracks/1087/transcript').expect(404);
        expect(res.body.error).toMatch(/project/i);
    });

    it('returns an empty events array when repo_path does not exist on disk', async () => {
        vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ repo_path: '/nope' }] });
        vi.mocked(fs.existsSync).mockReturnValue(false);
        const res = await request(app).get('/api/projects/1/tracks/1087/transcript').expect(200);
        expect(res.body.events).toEqual([]);
    });

    it('returns an empty events array when no log files match this track', async () => {
        vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ repo_path: '/r' }] });
        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readdirSync).mockReturnValue(['dispatch-implement-1099-111.log']);
        const res = await request(app).get('/api/projects/1/tracks/1087/transcript').expect(200);
        expect(res.body.events).toEqual([]);
    });

    it('parses JSONL lines from the matching log file into an events array', async () => {
        vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ repo_path: '/r' }] });
        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readdirSync).mockReturnValue(['dispatch-implement-1087-111.log']);
        vi.mocked(fs.statSync).mockReturnValue({ mtimeMs: 111 });
        vi.mocked(fs.readFileSync).mockReturnValue(
            '{"type":"assistant","message":{"id":"m1","content":[{"type":"text","text":"hi"}]}}\n{"type":"result","is_error":false}\n'
        );

        const res = await request(app).get('/api/projects/1/tracks/1087/transcript').expect(200);
        expect(res.body.events).toEqual([
            { type: 'assistant', message: { id: 'm1', content: [{ type: 'text', text: 'hi' }] } },
            { type: 'result', is_error: false },
        ]);
    });

    it('picks the most recently modified matching log file when several exist', async () => {
        vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ repo_path: '/r' }] });
        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readdirSync).mockReturnValue([
            'dispatch-implement-1087-100.log',
            'dispatch-implement-1087-200.log',
        ]);
        vi.mocked(fs.statSync).mockImplementation((p) => ({
            mtimeMs: String(p).includes('-200.log') ? 200 : 100,
        }));
        vi.mocked(fs.readFileSync).mockReturnValue('{"type":"result","is_error":false}\n');

        await request(app).get('/api/projects/1/tracks/1087/transcript').expect(200);
        expect(fs.readFileSync).toHaveBeenCalledWith(
            expect.stringContaining('dispatch-implement-1087-200.log'),
            'utf8'
        );
    });

    it('does not match a track number that is a substring of another (108 vs 1087)', async () => {
        vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ repo_path: '/r' }] });
        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readdirSync).mockReturnValue(['dispatch-implement-1087-111.log']);

        const res = await request(app).get('/api/projects/1/tracks/108/transcript').expect(200);
        expect(res.body.events).toEqual([]);
    });

    it('skips malformed/non-JSON lines without failing the request (non-Claude CLI logs)', async () => {
        vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ repo_path: '/r' }] });
        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readdirSync).mockReturnValue(['auto-implement-1087-111.log']);
        vi.mocked(fs.statSync).mockReturnValue({ mtimeMs: 111 });
        vi.mocked(fs.readFileSync).mockReturnValue(
            'plain text log line, not JSON\n{"type":"result","is_error":false}\n'
        );

        const res = await request(app).get('/api/projects/1/tracks/1087/transcript').expect(200);
        expect(res.body.events).toEqual([{ type: 'result', is_error: false }]);
    });
});
