// server/tests/track-1102-f10-worker-deregister.test.mjs
// Track 1102 F10: worker de-registration must not destroy history, and a
// heartbeat for a vanished row must say so.
//
// Observed live (2026-08-12): a second worker process sharing the same
// identity (project, hostname, worker_number 1) exited gracefully; its
// shutdown DELETEd the shared workers row, and worker_dispatch's
// ON DELETE CASCADE erased every dispatch — including the Activity
// panel's whole chat history — out from under the still-running worker.
// The survivor then never reappeared, because PATCH /worker/heartbeat
// returns ok:true even when it matched 0 rows, so the worker's
// "re-register on 404" path never fired: it stayed busy and invisible.
//
// Fixes under test:
//  1. DELETE /worker soft-deregisters (status='offline'), preserving the
//     row and everything cascaded to it.
//  2. PATCH /worker/heartbeat returns 404 when no row matched, so a
//     worker whose row is gone re-registers itself.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { app, pool } from '../index.mjs';

vi.mock('../auth.mjs');

vi.mock('pg', () => {
    const query = vi.fn();
    const Pool = vi.fn(() => ({ query, on: vi.fn() }));
    return { default: { Pool }, Pool };
});

describe('DELETE /worker — F10 soft de-registration', () => {
    beforeEach(() => vi.resetAllMocks());

    it('marks the worker offline instead of deleting the row', async () => {
        vi.mocked(pool.query).mockResolvedValue({ rows: [], rowCount: 1 });

        await request(app)
            .delete('/worker')
            .send({ hostname: 'meller-X1-AI', worker_number: 1, project_id: 1 })
            .expect(200);

        const calls = vi.mocked(pool.query).mock.calls;
        const deleted = calls.find(([sql]) => /DELETE FROM workers/i.test(sql));
        expect(deleted).toBeUndefined();
        const softened = calls.find(([sql]) => /UPDATE workers/i.test(sql) && /offline/i.test(sql));
        expect(softened).toBeTruthy();
    });
});

describe('PATCH /worker/heartbeat — F10 vanished-row detection', () => {
    beforeEach(() => vi.resetAllMocks());

    it('404s when the heartbeat matches no row, so the worker re-registers', async () => {
        vi.mocked(pool.query).mockResolvedValue({ rows: [], rowCount: 0 });

        const res = await request(app)
            .patch('/worker/heartbeat')
            .send({ hostname: 'meller-X1-AI', pid: 420522, project_id: 1, worker_number: 1 })
            .expect(404);
        expect(res.body.error).toMatch(/not registered|not found/i);
    });

    it('still 200s when the row exists', async () => {
        vi.mocked(pool.query).mockResolvedValue({ rows: [], rowCount: 1 });

        await request(app)
            .patch('/worker/heartbeat')
            .send({ hostname: 'meller-X1-AI', pid: 420522, project_id: 1, worker_number: 1 })
            .expect(200);
    });
});
