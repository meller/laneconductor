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
// The original fix: after queueing, if the project's live workers are ALL
// sync-only, also create a worker_dispatch entry addressed to one of them.
//
// UPDATED by commit 02fedf74 (track AM-10099 item (b) re-confirms this is
// current, intentional behavior — see the "DOES dispatch" test below): a
// dispatch row is now created whenever ANY live project worker exists,
// regardless of mode. Skipping it whenever a sync+poll worker was present
// (the original "deliberately do NOT dispatch" design) assumed that
// worker's own auto-launch polling would always pick the track up on its
// own — an assumption track 10017's **Auto Run** gate broke: a track
// without **Auto Run**: yes is never auto-picked, so an explicit human
// "Run" click produced zero dispatch and the track sat stuck forever
// (confirmed live on tracks 10039/10045). Actual double-execution is still
// prevented downstream, at the git-lock layer (checkAndClaimGitLock /
// spawnCli's `err.selfContention` handling), not by this gate.

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

    // Track AM-10099 item (b): this test previously asserted the OPPOSITE
    // (`dispatched` falsy, no INSERT) under the name "does NOT dispatch
    // when a sync+poll worker exists (queue poller will claim it)". That
    // was this function's ORIGINAL behavior (as `dispatchIfSyncOnly`,
    // gated on `!hasPoller`) — deliberately changed by commit 02fedf74
    // ("fix(ui-api): dispatch bridge must not skip sync+poll workers"),
    // which found the `!hasPoller` gate caused an explicit human "Run"
    // click to silently no-op forever on any track without **Auto Run**:
    // yes (confirmed live on tracks 10039/10045: a sync+poll worker's own
    // auto-launch polling never picks up a non-Auto-Run track, so skipping
    // the dispatch left nothing to ever claim it). That commit's own new
    // regression coverage — track-10047-dispatch-explicit-action.test.mjs's
    // "creates a worker_dispatch row even when a live sync+poll worker is
    // present" — already locks in the corrected behavior; this test was
    // simply never updated to match and so had been silently red since
    // then (masked by this whole file's collection failure — see the
    // execFile mock fix in this same commit). Updated to assert the
    // current, intentional behavior instead of reverting a deliberate,
    // live-incident-driven fix.
    it('DOES dispatch even when a sync+poll worker exists (an explicit human action bypasses the Auto Run gate; see commit 02fedf74)', async () => {
        mockDispatchQueries({
            workers: [
                { id: 42, mode: 'sync-only', type: 'project' },
                { id: 43, mode: 'sync+poll', type: 'project' },
            ],
        });

        const res = await request(app).post('/api/projects/9/tracks/1104/implement').expect(200);
        expect(res.body.ok).toBe(true);
        expect(res.body.dispatched).toBe(true);
        const insert = vi.mocked(pool.query).mock.calls.find(([sql]) => /INSERT INTO worker_dispatch/.test(sql));
        expect(insert).toBeTruthy();
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
