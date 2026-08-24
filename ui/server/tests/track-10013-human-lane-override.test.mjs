// server/tests/track-10013-human-lane-override.test.mjs
// Track 10013 Phase 5: POST /track (the file→DB sync a completing lane
// action's file write eventually triggers) must not let a stale run's
// completion overwrite a lane a human has already manually moved the track
// to since that run started.
//
// Observed live: track 8003 was dragged from `plan` to `done` while a
// `plan` dispatch was still finishing. SKILL.md's Transition step now
// carries a prompt-level guard against this (re-read the current Lane
// before overwriting), but that's model compliance, not a guarantee — this
// is the code-level backstop. Signal: `/track/:num/lane` (the drag/button
// endpoint) marks `last_updated_by = 'human'` on every human-driven lane
// change; POST /track's upsert skips its lane_status/lane_action_status
// write whenever the existing row was last touched by a human AND the
// incoming (file-derived) lane_status disagrees with what the human
// already set.
//
// A first version of this guard reset `last_updated_by` back to 'worker'
// on every unguarded sync — including a same-lane "echo" (the human's own
// write, reflected straight back through the file-watcher `/track/:num/lane`
// itself triggers via `syncTrackToFile`). Caught live: staging the exact
// sequence (human PATCH → immediate matching echo sync → later mismatching
// stale-completion sync) showed the echo cleared the flag within
// milliseconds, long before the stale completion arrived minutes later —
// the guard protected nothing. Fixed: only a genuine NEW claim
// (`lane_action_status: 'running'`, written by a lane action's own "claim
// the track immediately" step) clears the flag; a same-lane echo leaves it
// untouched.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { app, pool } from '../index.mjs';

vi.mock('../auth.mjs');

vi.mock('pg', () => {
    const query = vi.fn();
    const Pool = vi.fn(() => ({ query, on: vi.fn() }));
    return { default: { Pool }, Pool };
});

function mockUpsert({ lane_status, last_updated_by, index_content }) {
    const calls = [];
    vi.mocked(pool.query).mockImplementation(async (sql, params) => {
        calls.push([sql, params]);
        if (/SELECT.*lane_status.*FROM tracks/i.test(sql)) {
            return {
                rows: lane_status === undefined
                    ? []
                    : [{ id: 42, lane_status, lane_action_status: 'queue', last_updated_by, index_content: index_content ?? null }],
            };
        }
        if (/INSERT INTO tracks/i.test(sql)) return { rows: [{ id: 42 }], rowCount: 1 };
        if (/SELECT length\(index_content\)/i.test(sql)) return { rows: [{ len: 1 }] };
        return { rows: [] };
    });
    return calls;
}

function postTrack(body) {
    return request(app)
        .post('/track?project_id=1')
        .send({
            project_id: 1, track_number: '8003', title: 'Concurrency A',
            progress_percent: 0,
            ...body,
        });
}

function upsertSql(calls) {
    return calls.find(([sql]) => /INSERT INTO tracks/i.test(sql))?.[0] ?? '';
}

describe('POST /track — human lane override guard (Track 10013 Phase 5)', () => {
    beforeEach(() => vi.resetAllMocks());

    it('keeps the human-set lane when a stale completion tries to write a different one', async () => {
        // Human dragged the track to `done`; a stale `plan` run's completion
        // (lane_action_status: 'success', NOT a claim) now arrives.
        const calls = mockUpsert({ lane_status: 'done', last_updated_by: 'human' });
        await postTrack({ lane_status: 'plan', lane_action_status: 'success' }).expect(200);

        const sql = upsertSql(calls);
        expect(sql).not.toMatch(/lane_status\s*=\s*EXCLUDED\.lane_status/);
        expect(sql).not.toMatch(/lane_action_status\s*=\s*\$/);
        // last_updated_by must stay 'human' — not flipped back to 'worker' — so a
        // second stale sync attempt (e.g. a retry) is still guarded.
        expect(sql).not.toMatch(/last_updated_by\s*=\s*'worker'/);
    });

    it('does NOT clear the human flag on a same-lane echo sync (the bug in the first version of this guard)', async () => {
        // The human's own `/track/:num/lane` write triggers `syncTrackToFile`,
        // which the file-watcher immediately re-syncs back — same lane, not a
        // claim. This must leave last_updated_by alone so the guard is still
        // armed for whatever arrives next.
        const calls = mockUpsert({ lane_status: 'done', last_updated_by: 'human' });
        await postTrack({ lane_status: 'done', lane_action_status: 'success' }).expect(200);

        const sql = upsertSql(calls);
        // Same lane as before — this sync itself is harmless and can proceed...
        expect(sql).toMatch(/lane_status\s*=\s*EXCLUDED\.lane_status/);
        // ...but must NOT reset the flag, since it isn't a claim.
        expect(sql).not.toMatch(/last_updated_by\s*=\s*'worker'/);
    });

    it('exempts a genuine new claim from the guard and clears the flag for future syncs', async () => {
        // Track sits at `done` (human-set). A NEW run explicitly re-runs plan
        // and claims the track — `lane_action_status: 'running'` is the claim
        // signal. This must be allowed through even though it disagrees with
        // the human's lane, and must clear last_updated_by so this run's own
        // eventual completion isn't itself incorrectly guarded.
        const calls = mockUpsert({ lane_status: 'done', last_updated_by: 'human' });
        await postTrack({ lane_status: 'plan', lane_action_status: 'running' }).expect(200);

        const sql = upsertSql(calls);
        expect(sql).toMatch(/lane_status\s*=\s*EXCLUDED\.lane_status/);
        expect(sql).toMatch(/last_updated_by\s*=\s*'worker'/);
    });

    it('applies the lane sync normally when the row was last touched by a worker', async () => {
        const calls = mockUpsert({ lane_status: 'plan', last_updated_by: 'worker' });
        await postTrack({ lane_status: 'implement', lane_action_status: 'queue' }).expect(200);

        const sql = upsertSql(calls);
        expect(sql).toMatch(/lane_status\s*=\s*EXCLUDED\.lane_status/);
    });

    it('applies the lane sync when the human-set lane already agrees with the incoming one', async () => {
        const calls = mockUpsert({ lane_status: 'implement', last_updated_by: 'human' });
        await postTrack({ lane_status: 'implement', lane_action_status: 'success' }).expect(200);

        const sql = upsertSql(calls);
        expect(sql).toMatch(/lane_status\s*=\s*EXCLUDED\.lane_status/);
    });

    it('applies the lane sync for a brand-new track (no existing row)', async () => {
        const calls = mockUpsert({ lane_status: undefined });
        await postTrack({ lane_status: 'plan', lane_action_status: 'queue' }).expect(200);

        const sql = upsertSql(calls);
        expect(sql).toMatch(/lane_status\s*=\s*EXCLUDED\.lane_status/);
    });

    it('does not guard when the incoming payload omits lane_status entirely', async () => {
        const calls = mockUpsert({ lane_status: 'done', last_updated_by: 'human' });
        await postTrack({ lane_status: null, lane_action_status: null }).expect(200);

        const sql = upsertSql(calls);
        // No lane_status in payload → nothing to conflict with → no guard needed,
        // and the existing (unconditional-on-null) behavior of not touching
        // lane_status when null stays exactly as it always has.
        expect(sql).not.toMatch(/lane_status\s*=\s*EXCLUDED\.lane_status/);
    });
});
