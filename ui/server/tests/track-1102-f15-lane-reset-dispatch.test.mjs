// server/tests/track-1102-f15-lane-reset-dispatch.test.mjs
// Track 1102 F15: PATCH /track/:num/lane and PATCH /track/:num/reset need
// the same sync-only dispatch bridge that F5 added to
// POST /api/projects/:id/tracks/:num/implement.
//
// Before this fix, both endpoints only set lane_action_status='queue' —
// and a sync-only worker (the default for every wizard-created project)
// never polls the queue; it only serves the dispatch inbox. Net effect:
// dragging a card to a new lane, or any flow that calls /reset, on a
// sync-only project set the queue flag and nothing ever claimed it —
// permanently stuck, identical to F5's original symptom via a different
// entry point.
//
// The original fix: after the lane_status write, if the project's live
// workers are ALL sync-only, also create a worker_dispatch entry addressed
// to one of them — reusing the same helper F5's fix uses (since renamed
// dispatchIfSyncOnly() -> dispatchExplicitAction() by commit 02fedf74,
// which also changed WHEN it dispatches — see the "DOES dispatch even when
// a sync+poll worker exists" tests below).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { app, pool } from '../index.mjs';

vi.mock('pg', () => {
    const query = vi.fn();
    const Pool = vi.fn(() => ({ query, on: vi.fn() }));
    return { default: { Pool }, Pool };
});

beforeEach(() => vi.resetAllMocks());

function mockDispatchQueries({ workers, trackId = 555, laneStatus = 'implement' }) {
    vi.mocked(pool.query).mockImplementation(async (sql) => {
        if (/UPDATE tracks SET/.test(sql) && /RETURNING/.test(sql)) {
            return { rows: [{ id: trackId, track_number: '1104', lane_status: laneStatus }] };
        }
        if (/INSERT INTO track_comments/.test(sql)) return { rows: [], rowCount: 1 };
        if (/UPDATE tracks SET lane_status/.test(sql)) return { rowCount: 1 }; // /reset's UPDATE (no RETURNING)
        if (/FROM workers/.test(sql)) return { rows: workers };
        if (/SELECT id, lane_status FROM tracks/.test(sql)) return { rows: [{ id: trackId, lane_status: laneStatus }] };
        if (/INSERT INTO worker_dispatch/.test(sql)) return { rows: [{ id: 77 }], rowCount: 1 };
        return { rows: [] };
    });
}

describe('PATCH /track/:num/lane — F15 dispatch bridging', () => {
    it('dispatches when the project only has sync-only workers', async () => {
        mockDispatchQueries({ workers: [{ id: 42, mode: 'sync-only', type: 'project' }], laneStatus: 'implement' });

        await request(app)
            .patch('/track/1104/lane?project_id=9')
            .send({ lane_status: 'implement' })
            .expect(200);

        const insert = vi.mocked(pool.query).mock.calls.find(([sql]) => /INSERT INTO worker_dispatch/.test(sql));
        expect(insert).toBeTruthy();
        expect(insert[1][0]).toBe(42);       // worker_id
        expect(insert[1][1]).toBe('1104');   // track_number
        expect(insert[1][2]).toBe('implement'); // action = the track's new lane
    });

    // Track AM-10099 item (b): see track-1102-f5-ui-dispatch.test.mjs's
    // sibling test for the full history — commit 02fedf74 deliberately
    // removed the `!hasPoller` gate this test's original "does NOT
    // dispatch when a sync+poll worker exists" name asserted, because a
    // track without **Auto Run**: yes is never auto-picked by that
    // worker's own polling, silently stranding every explicit "Run"/drag
    // action forever. Updated to match the current, intentional,
    // already-regression-tested (track-10047-dispatch-explicit-action.test.mjs)
    // behavior instead of reverting that fix.
    it('DOES dispatch even when a sync+poll worker exists (see commit 02fedf74)', async () => {
        mockDispatchQueries({
            workers: [
                { id: 42, mode: 'sync-only', type: 'project' },
                { id: 43, mode: 'sync+poll', type: 'project' },
            ],
        });

        await request(app)
            .patch('/track/1104/lane?project_id=9')
            .send({ lane_status: 'implement' })
            .expect(200);

        const insert = vi.mocked(pool.query).mock.calls.find(([sql]) => /INSERT INTO worker_dispatch/.test(sql));
        expect(insert).toBeTruthy();
    });

    it('does NOT dispatch when moving to done (lane_action_status becomes success, not queue)', async () => {
        mockDispatchQueries({ workers: [{ id: 42, mode: 'sync-only', type: 'project' }], laneStatus: 'done' });

        await request(app)
            .patch('/track/1104/lane?project_id=9')
            .send({ lane_status: 'done' })
            .expect(200);

        const insert = vi.mocked(pool.query).mock.calls.find(([sql]) => /INSERT INTO worker_dispatch/.test(sql));
        expect(insert).toBeUndefined();
    });
});

describe('PATCH /track/:num/reset — F15 dispatch bridging', () => {
    it('dispatches when the project only has sync-only workers', async () => {
        mockDispatchQueries({ workers: [{ id: 42, mode: 'sync-only', type: 'project' }], laneStatus: 'plan' });

        await request(app)
            .patch('/track/1104/reset?project_id=9')
            .send({ lane_status: 'plan' })
            .expect(200);

        const insert = vi.mocked(pool.query).mock.calls.find(([sql]) => /INSERT INTO worker_dispatch/.test(sql));
        expect(insert).toBeTruthy();
        expect(insert[1][0]).toBe(42);
        expect(insert[1][1]).toBe('1104');
        expect(insert[1][2]).toBe('plan');
    });

    // Track AM-10099 item (b): same supersession as the /lane describe
    // block above — commit 02fedf74.
    it('DOES dispatch even when a sync+poll worker exists (see commit 02fedf74)', async () => {
        mockDispatchQueries({
            workers: [
                { id: 42, mode: 'sync-only', type: 'project' },
                { id: 43, mode: 'sync+poll', type: 'project' },
            ],
        });

        await request(app)
            .patch('/track/1104/reset?project_id=9')
            .send({ lane_status: 'plan' })
            .expect(200);

        const insert = vi.mocked(pool.query).mock.calls.find(([sql]) => /INSERT INTO worker_dispatch/.test(sql));
        expect(insert).toBeTruthy();
    });
});
