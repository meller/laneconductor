import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { app, pool, resolveAssignee, resolvePinnedWorkers, resolveAssigneeWorkerStatus } from '../index.mjs';

// Mock auth module — uses server/__mocks__/auth.mjs (no GCP calls, no gRPC)
vi.mock('../auth.mjs');

// Mock pg
vi.mock('pg', () => {
    const query = vi.fn();
    const Pool = vi.fn(() => ({
        query,
        on: vi.fn(),
    }));
    return {
        default: { Pool },
        Pool: Pool
    };
});

describe('resolveAssignee', () => {
    it('prefers explicit assignee_uid', () => {
        const track = { assignee_uid: 'dev-a', created_by_uid: 'dev-b' };
        const project = { owner_uid: 'dev-c' };
        expect(resolveAssignee(track, project)).toBe('dev-a');
    });

    it('falls back to created_by_uid when assignee_uid is null', () => {
        const track = { assignee_uid: null, created_by_uid: 'dev-b' };
        const project = { owner_uid: 'dev-c' };
        expect(resolveAssignee(track, project)).toBe('dev-b');
    });

    it('falls back to project.owner_uid when both track fields are null', () => {
        const track = { assignee_uid: null, created_by_uid: null };
        const project = { owner_uid: 'dev-c' };
        expect(resolveAssignee(track, project)).toBe('dev-c');
    });

    it('returns null when nothing resolves (local-fs/no-auth deployments)', () => {
        const track = { assignee_uid: null, created_by_uid: null };
        const project = { owner_uid: null };
        expect(resolveAssignee(track, project)).toBeNull();
    });
});

describe('resolvePinnedWorkers (user_uid-based ownership)', () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    it('returns [] without querying when userUid is null', async () => {
        const rows = await resolvePinnedWorkers(pool, 1, null);
        expect(rows).toEqual([]);
        expect(pool.query).not.toHaveBeenCalled();
    });

    it('queries workers by project_id and user_uid', async () => {
        const workerRows = [{ id: 5, user_uid: 'dev-a' }];
        vi.mocked(pool.query).mockResolvedValueOnce({ rows: workerRows });
        const rows = await resolvePinnedWorkers(pool, 1, 'dev-a');
        expect(rows).toEqual(workerRows);
        expect(pool.query).toHaveBeenCalledWith(
            'SELECT * FROM workers WHERE project_id = $1 AND user_uid = $2',
            [1, 'dev-a']
        );
    });
});

describe('resolveAssigneeWorkerStatus', () => {
    const now = new Date('2026-08-08T12:00:00Z');

    it('returns null when the assignee has no workers', () => {
        expect(resolveAssigneeWorkerStatus([], now)).toBeNull();
    });

    it('returns "busy" when any fresh worker is busy', () => {
        const workers = [
            { status: 'idle', last_heartbeat: new Date('2026-08-08T11:59:30Z') },
            { status: 'busy', last_heartbeat: new Date('2026-08-08T11:59:50Z') },
        ];
        expect(resolveAssigneeWorkerStatus(workers, now)).toBe('busy');
    });

    it('returns "idle" when fresh workers exist but none are busy', () => {
        const workers = [
            { status: 'idle', last_heartbeat: new Date('2026-08-08T11:59:30Z') },
        ];
        expect(resolveAssigneeWorkerStatus(workers, now)).toBe('idle');
    });

    it('returns "offline" when every worker\'s heartbeat is stale', () => {
        const workers = [
            { status: 'busy', last_heartbeat: new Date('2026-08-08T11:00:00Z') },
        ];
        expect(resolveAssigneeWorkerStatus(workers, now)).toBe('offline');
    });

    it('ignores a stale busy worker in favor of a fresh idle one', () => {
        const workers = [
            { status: 'busy', last_heartbeat: new Date('2026-08-08T11:00:00Z') }, // stale
            { status: 'idle', last_heartbeat: new Date('2026-08-08T11:59:55Z') }, // fresh
        ];
        expect(resolveAssigneeWorkerStatus(workers, now)).toBe('idle');
    });
});

describe('GET /api/projects/:id/tracks — assignee_worker_status', () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    it('attaches assignee_worker_status resolved from the assignee\'s own workers', async () => {
        vi.mocked(pool.query)
            .mockResolvedValueOnce({
                rows: [
                    { id: 1, track_number: '001', assignee_uid: 'dev-a', created_by_uid: null, owner_uid: null },
                    { id: 2, track_number: '002', assignee_uid: null, created_by_uid: null, owner_uid: null },
                ],
            })
            .mockResolvedValueOnce({
                rows: [{ id: 9, user_uid: 'dev-a', status: 'busy', last_heartbeat: new Date().toISOString() }],
            });

        const res = await request(app).get('/api/projects/1/tracks').expect(200);

        expect(res.body[0].assignee_worker_status).toBe('busy');
        expect(res.body[1].assignee_worker_status).toBeNull();
    });

    it('is null for every track when no track resolves an assignee (no-auth deployments)', async () => {
        vi.mocked(pool.query).mockResolvedValueOnce({
            rows: [{ id: 1, track_number: '001', assignee_uid: null, created_by_uid: null, owner_uid: null }],
        });

        const res = await request(app).get('/api/projects/1/tracks').expect(200);

        expect(res.body[0].assignee_worker_status).toBeNull();
        // No second query needed when there's nobody to look workers up for
        expect(pool.query).toHaveBeenCalledTimes(1);
    });
});

describe('GET /api/projects/:id/claimable-tracks — assignee gating (Phase 5)', () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    it('claims only the assignee\'s own worker, leaves other developers\' tracks and unassigned tracks alone', async () => {
        // Two developers, two workers, three queued tracks: one assigned to
        // dev-a, one assigned to dev-b, one with no assignee at all.
        vi.mocked(pool.query)
            .mockResolvedValueOnce({ rows: [{ owner_uid: null }] }) // project lookup
            .mockResolvedValueOnce({
                rows: [
                    { track_number: '001', assignee_uid: 'dev-a', created_by_uid: null },
                    { track_number: '002', assignee_uid: 'dev-b', created_by_uid: null },
                    { track_number: '003', assignee_uid: null, created_by_uid: null },
                ],
            }) // queued tracks
            .mockResolvedValueOnce({ rows: [{ id: 10, user_uid: 'dev-a' }] }) // dev-a's own workers
            .mockResolvedValueOnce({ rows: [{ id: 20, user_uid: 'dev-b' }] }); // dev-b's own workers

        // Calling as worker id 10 — registered under dev-a's identity
        const res = await request(app)
            .get('/api/projects/1/claimable-tracks')
            .query({ worker_id: 10 })
            .expect(200);

        expect(res.body.claimable).toEqual(['001', '003']);
    });

    it('falls back to open-claim when the assignee has no workers registered at all', async () => {
        vi.mocked(pool.query)
            .mockResolvedValueOnce({ rows: [{ owner_uid: null }] })
            .mockResolvedValueOnce({ rows: [{ track_number: '001', assignee_uid: 'dev-a', created_by_uid: null }] })
            .mockResolvedValueOnce({ rows: [] }); // dev-a has never registered a worker

        const res = await request(app)
            .get('/api/projects/1/claimable-tracks')
            .query({ worker_id: 999 })
            .expect(200);

        expect(res.body.claimable).toEqual(['001']);
    });

    it('requires worker_id', async () => {
        const res = await request(app).get('/api/projects/1/claimable-tracks').expect(400);
        expect(res.body.error).toMatch(/worker_id/);
    });
});

describe('PATCH /api/projects/:id/tracks/:num/assignee — reassignment (Phase 5 Task 4)', () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    it('updates tracks.assignee_uid, which changes who claimable-tracks resolves as owner', async () => {
        vi.mocked(pool.query).mockResolvedValueOnce({ rowCount: 1 });

        const res = await request(app)
            .patch('/api/projects/1/tracks/001/assignee')
            .send({ assignee_uid: 'dev-b' })
            .expect(200);

        expect(res.body.ok).toBe(true);
        expect(pool.query).toHaveBeenCalledWith(
            'UPDATE tracks SET assignee_uid = $1 WHERE project_id = $2 AND track_number = $3',
            ['dev-b', '1', '001']
        );
    });

    it('reassigning mid-queue changes which worker is eligible to claim the track', async () => {
        // Track 001 starts assigned to dev-a (worker 10); after reassignment to
        // dev-b (worker 20), worker 10 should no longer see it as claimable and
        // worker 20 should.
        const trackAssignedToA = { track_number: '001', assignee_uid: 'dev-a', created_by_uid: null };
        const trackAssignedToB = { track_number: '001', assignee_uid: 'dev-b', created_by_uid: null };

        vi.mocked(pool.query)
            .mockResolvedValueOnce({ rows: [{ owner_uid: null }] })
            .mockResolvedValueOnce({ rows: [trackAssignedToA] })
            .mockResolvedValueOnce({ rows: [{ id: 10, user_uid: 'dev-a' }] });
        const before = await request(app).get('/api/projects/1/claimable-tracks').query({ worker_id: 20 }).expect(200);
        expect(before.body.claimable).toEqual([]); // worker 20 (dev-b) can't claim dev-a's track

        vi.mocked(pool.query)
            .mockResolvedValueOnce({ rows: [{ owner_uid: null }] })
            .mockResolvedValueOnce({ rows: [trackAssignedToB] })
            .mockResolvedValueOnce({ rows: [{ id: 20, user_uid: 'dev-b' }] });
        const after = await request(app).get('/api/projects/1/claimable-tracks').query({ worker_id: 20 }).expect(200);
        expect(after.body.claimable).toEqual(['001']); // now claimable by worker 20
    });
});
