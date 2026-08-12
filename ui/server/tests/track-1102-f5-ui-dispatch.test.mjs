// server/tests/track-1102-f5-ui-dispatch.test.mjs
// Track 1102 F5: the UI's "run this lane action" endpoint must actually
// make the action run on a sync-only project.
//
// Before this fix, POST /api/projects/:id/tracks/:num/implement only set
// lane_action_status='queue' — and a sync-only worker (the default for
// every wizard-created project, meaning "sync + manual UI operations")
// never polls the queue; it only serves the dispatch inbox. Net effect:
// no UI action could ever run a lane action on a sync-only project.
// Proven live 2026-08-12: dispatching the same action to the same worker
// by hand was claimed in seconds.
//
// The fix: after queueing, if the project's live workers are ALL
// sync-only, also create a worker_dispatch entry addressed to one of
// them. When a sync+poll worker exists we deliberately do NOT dispatch —
// the queue poller will claim it as today, and dispatching too would race
// the same action into running twice.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { app, pool } from '../index.mjs';

vi.mock('../auth.mjs');

vi.mock('pg', () => {
    const query = vi.fn();
    const Pool = vi.fn(() => ({ query, on: vi.fn() }));
    return { default: { Pool }, Pool };
});

// The endpoint PATCHes the collector over HTTP (collectorWrite) before the
// dispatch logic; stub fetch so those calls succeed.
beforeEach(() => {
    vi.resetAllMocks();
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '{}', json: async () => ({ ok: true }) });
});

function mockDispatchQueries({ workers, trackId = 555 }) {
    // 1) live-workers lookup  2) track-id lookup  3) dispatch INSERT
    vi.mocked(pool.query).mockImplementation(async (sql) => {
        if (/FROM workers/.test(sql)) return { rows: workers };
        if (/FROM tracks/.test(sql)) return { rows: [{ id: trackId, lane_status: 'plan' }] };
        if (/INSERT INTO worker_dispatch/.test(sql)) return { rows: [{ id: 77 }], rowCount: 1 };
        return { rows: [] };
    });
}

describe('POST /api/projects/:id/tracks/:num/implement — F5 dispatch bridging', () => {
    it('creates a dispatch when the project only has sync-only workers', async () => {
        mockDispatchQueries({ workers: [{ id: 42, mode: 'sync-only', type: 'project' }] });

        const res = await request(app).post('/api/projects/9/tracks/1104/implement').expect(200);
        expect(res.body.ok).toBe(true);
        expect(res.body.dispatched).toBe(true);

        const insert = vi.mocked(pool.query).mock.calls.find(([sql]) => /INSERT INTO worker_dispatch/.test(sql));
        expect(insert).toBeTruthy();
        expect(insert[1][0]).toBe(42);       // worker_id
        expect(insert[1][1]).toBe('1104');   // track_number
        expect(insert[1][2]).toBe('plan');   // action = the track's current lane
    });

    it('does NOT dispatch when a sync+poll worker exists (queue poller will claim it)', async () => {
        mockDispatchQueries({
            workers: [
                { id: 42, mode: 'sync-only', type: 'project' },
                { id: 43, mode: 'sync+poll', type: 'project' },
            ],
        });

        const res = await request(app).post('/api/projects/9/tracks/1104/implement').expect(200);
        expect(res.body.ok).toBe(true);
        expect(res.body.dispatched).toBeFalsy();
        const insert = vi.mocked(pool.query).mock.calls.find(([sql]) => /INSERT INTO worker_dispatch/.test(sql));
        expect(insert).toBeUndefined();
    });

    it('never dispatches to a manager worker even if it is the only one visible', async () => {
        mockDispatchQueries({ workers: [{ id: 7, mode: 'sync-only', type: 'manager' }] });

        const res = await request(app).post('/api/projects/9/tracks/1104/implement').expect(200);
        expect(res.body.ok).toBe(true);
        expect(res.body.dispatched).toBeFalsy();
        const insert = vi.mocked(pool.query).mock.calls.find(([sql]) => /INSERT INTO worker_dispatch/.test(sql));
        expect(insert).toBeUndefined();
    });

    it('still succeeds (queue only) when the project has no live workers at all', async () => {
        mockDispatchQueries({ workers: [] });
        const res = await request(app).post('/api/projects/9/tracks/1104/implement').expect(200);
        expect(res.body.ok).toBe(true);
        expect(res.body.dispatched).toBeFalsy();
    });
});
