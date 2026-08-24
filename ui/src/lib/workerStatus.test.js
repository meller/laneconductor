// ui/src/lib/workerStatus.test.js
// Reproduces the live bug (2026-08-13, track 1112 dogfood session):
// TrackDetailPanel's dispatch dropdown defaulted to an offline worker
// whenever the project's real worker was busy, because the fallback chain
// had no offline check on its last resort (`?? workers[0]`).
import { describe, it, expect } from 'vitest';
import { isWorkerOffline, selectDefaultWorker } from './workerStatus.js';

const NOW = Date.now();
const recent = new Date(NOW - 5_000).toISOString();
const stale = new Date(NOW - 5 * 60_000).toISOString();

describe('isWorkerOffline', () => {
  it('treats a worker with no heartbeat as offline', () => {
    expect(isWorkerOffline({})).toBe(true);
  });

  it('treats a recent heartbeat as online', () => {
    expect(isWorkerOffline({ last_heartbeat: recent })).toBe(false);
  });

  it('treats a heartbeat older than 60s as offline', () => {
    expect(isWorkerOffline({ last_heartbeat: stale })).toBe(true);
  });
});

describe('selectDefaultWorker', () => {
  it('prefers an online worker over a busy one is wrong — busy-but-online beats offline', () => {
    const offlineManager = { id: 1110, status: 'idle', last_heartbeat: stale };
    const busyProjectWorker = { id: 1112, status: 'busy', last_heartbeat: recent };
    // Array order deliberately puts the offline worker first, matching the
    // real API response order that triggered the bug.
    const workers = [offlineManager, busyProjectWorker];
    expect(selectDefaultWorker(workers, null).id).toBe(1112);
  });

  it('prefers an idle online worker over a busy online worker', () => {
    const busy = { id: 1, status: 'busy', last_heartbeat: recent };
    const idle = { id: 2, status: 'idle', last_heartbeat: recent };
    expect(selectDefaultWorker([busy, idle], null).id).toBe(2);
  });

  it('prefers the assignee\'s own worker when it is online', () => {
    const other = { id: 1, status: 'idle', user_uid: 'user-a', last_heartbeat: recent };
    const own = { id: 2, status: 'idle', user_uid: 'user-b', last_heartbeat: recent };
    expect(selectDefaultWorker([other, own], 'user-b').id).toBe(2);
  });

  it('skips the assignee\'s own worker if it is offline, in favor of any online worker', () => {
    const ownOffline = { id: 1, status: 'idle', user_uid: 'user-b', last_heartbeat: stale };
    const otherOnline = { id: 2, status: 'idle', user_uid: 'user-a', last_heartbeat: recent };
    expect(selectDefaultWorker([ownOffline, otherOnline], 'user-b').id).toBe(2);
  });

  it('falls back to the first worker only when nothing is online', () => {
    const a = { id: 1, status: 'idle', last_heartbeat: stale };
    const b = { id: 2, status: 'idle', last_heartbeat: stale };
    expect(selectDefaultWorker([a, b], null).id).toBe(1);
  });

  it('returns null for an empty worker list', () => {
    expect(selectDefaultWorker([], null)).toBeNull();
  });

  it('prefers an idle online project worker over an idle online manager', () => {
    // Reproduces the real live case: GET /api/projects/:id/workers
    // deliberately includes the manager alongside the project's own
    // worker, and the manager can be genuinely online (fresh heartbeat)
    // at the same time — array order alone must not decide the winner.
    const manager = { id: 1110, type: 'manager', status: 'idle', last_heartbeat: recent };
    const project = { id: 1112, type: 'project', status: 'idle', last_heartbeat: recent };
    expect(selectDefaultWorker([manager, project], null).id).toBe(1112);
  });

  it('falls back to the manager only when it is the sole worker registered', () => {
    const manager = { id: 1110, type: 'manager', status: 'idle', last_heartbeat: recent };
    expect(selectDefaultWorker([manager], null).id).toBe(1110);
  });
});
