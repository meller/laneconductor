// server/tests/track-10046-lane-regression-guard-api.test.mjs
// AM-10046 Finding 1: POST /track (the file->DB sync choke point) had zero
// protection against a stale push regressing a track's lane backwards.
// track-10013's humanGuardActive only protects a HUMAN-set lane; nothing
// protected a lane a worker itself had already legitimately advanced.
//
// Confirmed live 2026-08-31: track 10039 reached done:queue (a real PR-mode
// merge success, committed to the primary checkout's index.md) and then,
// for several seconds, the DB read lane_status='review' before
// self-correcting — with no corresponding transition anywhere in
// workflow.json (done's on_failure stays in 'done', it never targets
// 'review'). Root cause: every worker process watches its own copy of
// conductor/tracks (primary or a worktree) and pushes whatever it reads on
// any file change, with no notion of "is this the most current copy" —
// a worktree that's momentarily behind can race a legitimate later write.
//
// Fix mirrors the worker's own file-level guard (lane-regression-guard.mjs,
// track 10040 REQ-12) at this second, DB-side choke point.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { app, pool } from '../index.mjs';

vi.mock('../auth.mjs');

vi.mock('pg', () => {
    const query = vi.fn();
    const Pool = vi.fn(() => ({ query, on: vi.fn() }));
    return { default: { Pool }, Pool };
});

function mockUpsert({ lane_status, last_updated_by = 'worker' }) {
    const calls = [];
    vi.mocked(pool.query).mockImplementation(async (sql, params) => {
        calls.push([sql, params]);
        if (/SELECT.*lane_status.*FROM tracks/i.test(sql)) {
            return {
                rows: lane_status === undefined
                    ? []
                    : [{ id: 99, lane_status, lane_action_status: 'queue', last_updated_by, index_content: null }],
            };
        }
        if (/INSERT INTO tracks/i.test(sql)) return { rows: [{ id: 99 }], rowCount: 1 };
        if (/SELECT length\(index_content\)/i.test(sql)) return { rows: [{ len: 1 }] };
        return { rows: [] };
    });
    return calls;
}

function postTrack(body) {
    return request(app)
        .post('/track?project_id=1')
        .send({
            project_id: 1, track_number: '10039', title: 'Cloud Workers',
            progress_percent: 0,
            ...body,
        });
}

function upsertSql(calls) {
    return calls.find(([sql]) => /INSERT INTO tracks/i.test(sql))?.[0] ?? '';
}

describe('POST /track — lane-regression guard (Track AM-10046 Finding 1)', () => {
    beforeEach(() => vi.resetAllMocks());

    it('TC-1: reproduces the live incident — refuses a stale sync regressing done back to review', async () => {
        // Track genuinely reached done:queue (a real merge success). A stale
        // sync — reading an out-of-date worktree copy of index.md — now
        // arrives claiming the track is still in review.
        const calls = mockUpsert({ lane_status: 'done' });
        await postTrack({ lane_status: 'review', lane_action_status: 'running' }).expect(200);

        const sql = upsertSql(calls);
        expect(sql).not.toMatch(/lane_status\s*=\s*EXCLUDED\.lane_status/);
        expect(sql).not.toMatch(/lane_action_status\s*=\s*\$13/);
    });

    it('TC-2: refuses any unauthorized backward move (quality-gate back to implement)', async () => {
        const calls = mockUpsert({ lane_status: 'quality-gate' });
        await postTrack({ lane_status: 'implement', lane_action_status: 'success' }).expect(200);

        const sql = upsertSql(calls);
        expect(sql).not.toMatch(/lane_status\s*=\s*EXCLUDED\.lane_status/);
    });

    it('TC-3: still allows ordinary forward progress through the same lanes', async () => {
        const calls = mockUpsert({ lane_status: 'review' });
        await postTrack({ lane_status: 'quality-gate', lane_action_status: 'queue' }).expect(200);

        const sql = upsertSql(calls);
        expect(sql).toMatch(/lane_status\s*=\s*EXCLUDED\.lane_status/);
    });

    it('TC-4: allows an authorized regression (a legitimate on_failure transition)', async () => {
        // A worker's own guarded exit-handler determined THIS run produced
        // the regression (e.g. review's on_failure sending the track back to
        // implement:queue) and explicitly says so.
        const calls = mockUpsert({ lane_status: 'review' });
        await postTrack({
            lane_status: 'implement', lane_action_status: 'queue',
            lane_regression_authorized: true,
        }).expect(200);

        const sql = upsertSql(calls);
        expect(sql).toMatch(/lane_status\s*=\s*EXCLUDED\.lane_status/);
    });

    it('TC-5: allows a genuine new claim re-dispatching an earlier, non-terminal lane', async () => {
        // Someone explicitly re-dispatches an earlier lane (e.g. re-running
        // implement on a track sitting in quality-gate) — a deliberate
        // action, signaled by lane_action_status: 'running'.
        const calls = mockUpsert({ lane_status: 'quality-gate' });
        await postTrack({ lane_status: 'implement', lane_action_status: 'running' }).expect(200);

        const sql = upsertSql(calls);
        expect(sql).toMatch(/lane_status\s*=\s*EXCLUDED\.lane_status/);
    });

    it('TC-6: never allows a non-claim push to move a track OUT of the terminal done lane, even with authorization claimed', async () => {
        // Not a genuine claim (lane_action_status isn't 'running'), so this
        // reaches shouldBlockLaneWrite — whose own done-is-terminal rule is
        // unconditional, ignoring producedByThisRun/authorization entirely.
        const calls = mockUpsert({ lane_status: 'done' });
        await postTrack({
            lane_status: 'review', lane_action_status: 'success',
            lane_regression_authorized: true,
        }).expect(200);

        const sql = upsertSql(calls);
        expect(sql).not.toMatch(/lane_status\s*=\s*EXCLUDED\.lane_status/);
    });

    it('TC-7: also blocks a claim-shaped push out of a worker-set done — the exact incident shape', async () => {
        // This is the confirmed live incident itself: a stale worktree
        // fragment's own genuinely-real "running" snapshot from BEFORE the
        // merge, synced late. last_updated_by defaults to 'worker' (not
        // human), so this does NOT get the track-10013 reopen exemption.
        const calls = mockUpsert({ lane_status: 'done', last_updated_by: 'worker' });
        await postTrack({ lane_status: 'review', lane_action_status: 'running' }).expect(200);

        const sql = upsertSql(calls);
        expect(sql).not.toMatch(/lane_status\s*=\s*EXCLUDED\.lane_status/);
    });

    it('TC-8: still allows a human explicitly reopening a done track via a genuine claim (track 10013 exemption, preserved)', async () => {
        const calls = mockUpsert({ lane_status: 'done', last_updated_by: 'human' });
        await postTrack({ lane_status: 'plan', lane_action_status: 'running' }).expect(200);

        const sql = upsertSql(calls);
        expect(sql).toMatch(/lane_status\s*=\s*EXCLUDED\.lane_status/);
    });
});
