// ui/src/lib/workerTaskInfo.test.js
// Track 1087 Phase 6 Task 3: parses worker.current_task (a free-text string
// set by updateWorkerHeartbeat) to decide what WorkerActivityLatch should
// show — a track's live transcript, or a deploy dispatch's raw log.

import { describe, it, expect } from 'vitest';
import { parseWorkerTask, resolveWorkerChatTarget, resolveTargetRunLiveness } from './workerTaskInfo.js';

describe('parseWorkerTask', () => {
  it('returns null for an idle worker (no current_task)', () => {
    expect(parseWorkerTask(null)).toBeNull();
    expect(parseWorkerTask(undefined)).toBeNull();
    expect(parseWorkerTask('')).toBeNull();
  });

  it('extracts a track number from a lane-action task string', () => {
    expect(parseWorkerTask('dispatch-implement track 1087')).toEqual({ kind: 'track', trackNumber: '1087' });
    expect(parseWorkerTask('implement track 9998')).toEqual({ kind: 'track', trackNumber: '9998' });
  });

  it('extracts a dispatch id from a deploy task string', () => {
    expect(parseWorkerTask('deploy prod (dispatch 42)')).toEqual({ kind: 'deploy', dispatchId: '42' });
    expect(parseWorkerTask('deploy staging (dispatch 7)')).toEqual({ kind: 'deploy', dispatchId: '7' });
  });

  // Track 1091 Phase 5: create-project also matches the generic
  // "(dispatch N)" pattern above — it must be distinguished from a real
  // deploy, since DeployLogView's endpoint is project-scoped and a
  // create-project dispatch has no project to scope it to.
  it('extracts a dispatch id from a create-project task string as its own kind, not deploy', () => {
    expect(parseWorkerTask('create-project (dispatch 12)')).toEqual({ kind: 'create-project', dispatchId: '12' });
  });

  it('returns null for an unrecognized task string rather than guessing', () => {
    expect(parseWorkerTask('something unexpected')).toBeNull();
  });
});

// Track 10037 REQ-5/REQ-7: target-track resolution matrix for worker chat.
describe('resolveWorkerChatTarget', () => {
  // Track 10069 REQ-25: a manager's own project_id is null by construction
  // (laneconductor.sync.mjs:1259) and it appears on every project's worker
  // list, so it resolves to the reserved 'manager' pseudo-track scoped to
  // whichever project's board the caller is currently viewing
  // (fallbackProjectId) — never worker.project_id, which is always null.
  it('resolves a manager to the reserved pseudo-track, scoped to fallbackProjectId', () => {
    const worker = { type: 'manager', project_id: null, current_task: 'implement track 42', last_track_number: '41' };
    expect(resolveWorkerChatTarget(worker, 7)).toEqual({ trackNumber: 'manager', projectId: 7, source: 'manager' });
  });

  it('resolves a manager the same way even with no fallbackProjectId available yet', () => {
    const worker = { type: 'manager', project_id: null };
    expect(resolveWorkerChatTarget(worker, null)).toEqual({ trackNumber: 'manager', projectId: null, source: 'manager' });
  });

  it('prefers the running track over the last-context track', () => {
    const worker = {
      type: 'project', project_id: 5, current_task: 'implement track 42',
      last_track_number: '10', last_track_project_id: 5,
    };
    expect(resolveWorkerChatTarget(worker, 1)).toEqual({ trackNumber: '42', projectId: 5, source: 'running' });
  });

  it('falls back to last_track_number when idle', () => {
    const worker = {
      type: 'project', project_id: 5, current_task: null,
      last_track_number: '10', last_track_project_id: 5,
    };
    expect(resolveWorkerChatTarget(worker, 1)).toEqual({ trackNumber: '10', projectId: 5, source: 'last' });
  });

  it('returns null when the worker has neither a running nor a last track', () => {
    const worker = { type: 'project', project_id: 5, current_task: null, last_track_number: null };
    expect(resolveWorkerChatTarget(worker, 1)).toBeNull();
  });

  it('falls back to fallbackProjectId when the worker itself has none', () => {
    const worker = { type: 'project', project_id: null, current_task: null, last_track_number: '10', last_track_project_id: null };
    expect(resolveWorkerChatTarget(worker, 7)).toEqual({ trackNumber: '10', projectId: 7, source: 'last' });
  });

  it('returns null for a null/undefined worker', () => {
    expect(resolveWorkerChatTarget(null, 1)).toBeNull();
    expect(resolveWorkerChatTarget(undefined, 1)).toBeNull();
  });
});

describe('resolveTargetRunLiveness', () => {
  it('returns not live for null or missing target', () => {
    expect(resolveTargetRunLiveness({ target: null })).toEqual({ isLive: false, action: null });
    expect(resolveTargetRunLiveness({ target: { trackNumber: null } })).toEqual({ isLive: false, action: null });
  });

  it('detects live turn from transcript stream state', () => {
    const target = { trackNumber: '42', projectId: 1 };
    const turn = { active: true, activity: 'Thinking…' };
    expect(resolveTargetRunLiveness({ target, turn })).toEqual({ isLive: true, action: 'Thinking…' });
  });

  it('detects live run from a busy worker task on the same track', () => {
    const target = { trackNumber: '42', projectId: 1 };
    const workers = [
      { id: 1, status: 'busy', current_task: 'implement track 42' },
      { id: 2, status: 'idle', current_task: null },
    ];
    expect(resolveTargetRunLiveness({ target, workers })).toEqual({ isLive: true, action: 'implement' });
  });

  it('detects live reply from a manager reply task', () => {
    const target = { trackNumber: 'manager', projectId: 1 };
    const workers = [
      { id: 1, status: 'busy', current_task: 'local-fs-answer track manager' },
    ];
    expect(resolveTargetRunLiveness({ target, workers })).toEqual({ isLive: true, action: 'reply' });
  });

  it('detects live run from track lane_action_status', () => {
    const target = { trackNumber: '42', projectId: 1 };
    const tracks = [
      { track_number: '42', lane_status: 'plan', lane_action_status: 'running' },
    ];
    expect(resolveTargetRunLiveness({ target, tracks })).toEqual({ isLive: true, action: 'plan' });
  });

  it('returns not live for idle target with no active runs', () => {
    const target = { trackNumber: '42', projectId: 1 };
    const workers = [
      { id: 1, status: 'idle', current_task: null },
      { id: 2, status: 'busy', current_task: 'implement track 99' },
    ];
    const tracks = [
      { track_number: '42', lane_status: 'plan', lane_action_status: 'queue' },
    ];
    expect(resolveTargetRunLiveness({ target, workers, tracks })).toEqual({ isLive: false, action: null });
  });
});
