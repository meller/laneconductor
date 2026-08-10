// server/tests/track-1091-manager-registration.test.mjs
// Track 1091 Phase 2: POST /worker/register accepting type: 'manager'.
//
// A manager worker has no project_id (it isn't "for" any one project), so
// the existing `if (!projectId) return 400` guard must not apply to it —
// but must keep applying unchanged to type: 'project' workers (today's
// default, regression check). Re-registration (e.g. a manager restarting)
// upserts via ON CONFLICT targeting the partial unique index
// (workers_one_manager_per_host) rather than the (project_id, hostname,
// worker_number) constraint the 'project' path uses — a manager's
// project_id is always null, and Postgres treats every NULL as distinct in
// uniqueness checks, so the existing ON CONFLICT target would never match
// for a second manager registration attempt on the same hostname.
//
// Deliberately does NOT test "does the DB reject a genuine second manager"
// here — that's Phase 1's already-verified constraint (real transaction,
// see plan.md), and this endpoint's job for a repeat manager registration
// is to UPDATE the existing row (idempotent restart), not to fail; the
// "already running" rejection is a CLI-level pre-flight check (Phase 2's
// own plan.md notes), not a server-side one.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { app, pool } from '../index.mjs';

vi.mock('../auth.mjs');

vi.mock('pg', () => {
    const query = vi.fn();
    const Pool = vi.fn(() => ({ query, on: vi.fn() }));
    return { default: { Pool }, Pool };
});

describe('POST /worker/register with type: manager', () => {
    beforeEach(() => vi.resetAllMocks());

    it('registers with project_id: null, no 400 for missing project_id', async () => {
        vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ id: 7 }] }); // INSERT ... ON CONFLICT

        const res = await request(app)
            .post('/worker/register')
            .send({ hostname: 'my-machine', pid: 1234, type: 'manager' })
            .expect(200);

        expect(res.body.ok).toBe(true);
        expect(res.body.id).toBe(7);
    });

    it('the INSERT targets the manager partial-unique-index for ON CONFLICT, not (project_id, hostname, worker_number)', async () => {
        vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ id: 7 }] });

        await request(app)
            .post('/worker/register')
            .send({ hostname: 'my-machine', pid: 1234, type: 'manager' })
            .expect(200);

        const [sql, params] = vi.mocked(pool.query).mock.calls[0];
        expect(sql).toMatch(/ON CONFLICT \("?hostname"?\)/);
        expect(sql).toMatch(/WHERE.*type.*=.*'manager'/i);
        expect(sql).toMatch(/VALUES\(NULL/); // project_id is a literal NULL, not a bound param
    });

    it('re-registering the same manager (restart) updates the existing row rather than erroring', async () => {
        // ON CONFLICT DO UPDATE — same query shape as a fresh registration,
        // the DB decides insert-vs-update; the endpoint doesn't special-case it.
        vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ id: 7 }] });

        const res = await request(app)
            .post('/worker/register')
            .send({ hostname: 'my-machine', pid: 5678, type: 'manager' }) // new pid, same hostname — a restart
            .expect(200);

        expect(res.body.ok).toBe(true);
    });

    it('a type: "project" worker (default/omitted) still requires project_id — regression check', async () => {
        const res = await request(app)
            .post('/worker/register')
            .send({ hostname: 'dev-machine', pid: 5000 }) // no type, no project_id
            .expect(400);
        expect(res.body.error).toMatch(/project_id/i);
    });

    it('a type: "project" worker with project_id still uses the existing (project_id, hostname, worker_number) path — regression check', async () => {
        vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] }); // machine_token lookup
        vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ id: 1 }] }); // INSERT

        const res = await request(app)
            .post('/worker/register')
            .send({ hostname: 'dev-machine', pid: 5000, project_id: 1, type: 'project' })
            .expect(200);
        expect(res.body.ok).toBe(true);

        const [sql] = vi.mocked(pool.query).mock.calls[1];
        expect(sql).toMatch(/ON CONFLICT\(project_id, hostname, worker_number\)/);
    });
});
