// server/tests/track-1102-f18-phantom-worker.test.mjs
// Track 1102 F18: the "any live worker for this project" fallback used by
// POST /api/projects/:id/dispatch, POST /api/projects/:id/worktrees/refresh,
// and dispatchIfSyncOnly() (F5/F8/F15's sync-only bridge) must not select a
// Playwright fixture worker over a real one.
//
// Before this fix: `ORDER BY id LIMIT 1` (or, in dispatchIfSyncOnly's case,
// unordered `projectWorkers[0]`) had no way to tell a phantom test worker
// (hostname 'pw-e2e-worker', pid 999999 — worker-identity.spec.js; or pid 0,
// hostname 'e2e-test-host' — track-1033-e2e.spec.js) apart from a real one.
// A phantom heartbeats but never polls a dispatch inbox, so any dispatch
// routed to it sits 'pending'/never-claimed forever with no error anywhere.
// Confirmed live: dispatching track 10019's plan picked worker 1013
// (pid 999999) over real workers 1112/1259 because it had the lowest id.
//
// Track 1102 (merged into this branch 2026-08-25 via main): the
// `/dispatch` route's own fallback query gained an idle-worker preference
// — `ORDER BY (current_task IS NOT NULL), id LIMIT 1` instead of plain
// `ORDER BY id LIMIT 1` — so this file's mock regexes for that specific
// endpoint were updated to match. `/worktrees/refresh` still uses the
// plain form, unchanged.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { app, pool } from '../index.mjs';

vi.mock('../auth.mjs');

vi.mock('pg', () => {
    const query = vi.fn();
    const Pool = vi.fn(() => ({ query, on: vi.fn() }));
    return { default: { Pool }, Pool };
});

const PHANTOM = { id: 1013, hostname: 'pw-e2e-worker', pid: 999999, type: 'project', mode: 'sync-only' };
const PHANTOM_PID0 = { id: 1014, hostname: 'e2e-test-host', pid: 0, type: 'project', mode: 'sync-only' };
const REAL = { id: 1259, hostname: 'dev-machine', pid: 54321, type: 'project', mode: 'sync-only' };

// A mocked pool.query can't run real SQL, so this simulates Postgres
// applying the app's OWN WHERE clause: it only filters candidates if the
// real SQL text sent actually contains the exclusion predicate — so a
// regression that drops the filter from the query makes these tests fail
// (a phantom would win again), not just the dedicated SQL-text test.
function simulateAnyLiveWorkerQuery(sql, rows) {
    const hasPidFilter = /pid\s*!=\s*0/.test(sql);
    const hasHostnameFilter = /NOT LIKE 'pw-e2e-%'/.test(sql);
    return rows
        .filter(w => !hasPidFilter || w.pid !== 0)
        .filter(w => !hasHostnameFilter || !w.hostname || !w.hostname.startsWith('pw-e2e-'))
        .sort((a, b) => a.id - b.id);
}

beforeEach(() => {
    vi.resetAllMocks();
});

describe('POST /api/projects/:id/dispatch — F18 phantom-worker exclusion', () => {
    it('resolves to the real worker, not the lower-id phantom, for refresh-worktrees', async () => {
        let capturedWorkerId = null;
        vi.mocked(pool.query).mockImplementation(async (sql, params) => {
            if (/SELECT owner_uid FROM projects/.test(sql)) return { rows: [{ owner_uid: null }] };
            if (/SELECT id FROM workers WHERE project_id.*ORDER BY \(current_task IS NOT NULL\), id LIMIT 1/s.test(sql)) {
                const survivors = simulateAnyLiveWorkerQuery(sql, [PHANTOM, PHANTOM_PID0, REAL]);
                return { rows: survivors.length ? [{ id: survivors[0].id }] : [] };
            }
            if (/INSERT INTO worker_dispatch/.test(sql)) {
                capturedWorkerId = params[0];
                return { rows: [{ id: 42 }], rowCount: 1 };
            }
            return { rows: [] };
        });

        const res = await request(app)
            .post('/api/projects/9/dispatch')
            .send({ action: 'refresh-worktrees' })
            .expect(200);

        expect(res.body.ok).toBe(true);
        expect(capturedWorkerId).toBe(REAL.id);
    });

    it('the SQL sent excludes pid=0 and the pw-e2e- hostname prefix', async () => {
        let capturedSql = null;
        vi.mocked(pool.query).mockImplementation(async (sql, params) => {
            if (/SELECT owner_uid FROM projects/.test(sql)) return { rows: [{ owner_uid: null }] };
            if (/SELECT id FROM workers WHERE project_id.*ORDER BY \(current_task IS NOT NULL\), id LIMIT 1/s.test(sql)) {
                capturedSql = sql;
                return { rows: [{ id: REAL.id }] };
            }
            if (/INSERT INTO worker_dispatch/.test(sql)) return { rows: [{ id: 42 }], rowCount: 1 };
            return { rows: [] };
        });

        await request(app).post('/api/projects/9/dispatch').send({ action: 'refresh-worktrees' }).expect(200);

        expect(capturedSql).toMatch(/pid\s*!=\s*0/);
        expect(capturedSql).toMatch(/NOT LIKE 'pw-e2e-%'/);
    });
});

describe('POST /api/projects/:id/worktrees/refresh — F18 phantom-worker exclusion', () => {
    it('resolves to the real worker, not the phantom', async () => {
        let capturedWorkerId = null;
        vi.mocked(pool.query).mockImplementation(async (sql, params) => {
            if (/SELECT owner_uid FROM projects/.test(sql)) return { rows: [{ owner_uid: null }] };
            if (/SELECT id FROM workers WHERE project_id.*ORDER BY id LIMIT 1/s.test(sql)) {
                const survivors = simulateAnyLiveWorkerQuery(sql, [PHANTOM, REAL]);
                return { rows: survivors.length ? [{ id: survivors[0].id }] : [] };
            }
            if (/INSERT INTO worker_dispatch/.test(sql)) {
                capturedWorkerId = params[0];
                return { rows: [{ id: 42 }], rowCount: 1 };
            }
            return { rows: [] };
        });

        const res = await request(app).post('/api/projects/9/worktrees/refresh').expect(200);
        expect(res.body.ok).toBe(true);
        expect(capturedWorkerId).toBe(REAL.id);
    });
});
