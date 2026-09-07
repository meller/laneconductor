// Track 10069 Phase 1 (REQ-12, REQ-14): instance snapshot + digest.

import { test } from 'node:test';
import assert from 'node:assert';
import { buildInstanceState, buildStateDigest } from '../services/instance-state.mjs';

const PROJECTS = [
  { id: 1, name: 'alpha', repo_path: '/repo/alpha' },
  { id: 2, name: 'beta', repo_path: '/repo/beta' },
];

test('TC-1.1: per-lane track counts match fixtures exactly', () => {
  const tracks = [
    { project_id: 1, track_number: '1', lane: 'implement' },
    { project_id: 1, track_number: '2', lane: 'implement' },
    { project_id: 1, track_number: '3', lane: 'done' },
    { project_id: 2, track_number: '4', lane: 'plan' },
  ];
  const state = buildInstanceState({ projects: PROJECTS, tracks, workers: [] });
  const alpha = state.projects.find(p => p.id === 1);
  const beta = state.projects.find(p => p.id === 2);
  assert.deepEqual(alpha.tracksByLane, { implement: 2, done: 1 });
  assert.deepEqual(beta.tracksByLane, { plan: 1 });
});

test('TC-1.2: worker online boundary matches isWorkerOffline threshold exactly', () => {
  const now = Date.now();
  const insideBoundary = new Date(now - 59_999).toISOString(); // 1s inside 60s window
  const outsideBoundary = new Date(now - 60_001).toISOString(); // 1s outside

  const state = buildInstanceState({
    projects: PROJECTS,
    tracks: [],
    workers: [
      { id: 1, hostname: 'h1', type: 'worker', project_id: 1, last_heartbeat: insideBoundary },
      { id: 2, hostname: 'h2', type: 'worker', project_id: 1, last_heartbeat: outsideBoundary },
    ],
    now,
  });
  assert.equal(state.workers.find(w => w.id === 1).online, true);
  assert.equal(state.workers.find(w => w.id === 2).online, false);
});

test('TC-1.3: empty instance returns a valid snapshot, not a throw', () => {
  const state = buildInstanceState({ projects: [], tracks: [], workers: [] });
  assert.deepEqual(state.projects, []);
  assert.deepEqual(state.workers, []);
  assert.ok(state.generatedAt);
});

test('TC-1.7: digest over a large fixture stays under its stated character budget', () => {
  const bigProjects = Array.from({ length: 50 }, (_, i) => ({ id: i, name: `project-${i}`, repo_path: `/r/${i}` }));
  const bigTracks = Array.from({ length: 50 }, (_, i) => ({ project_id: i % 50, track_number: String(i), lane: 'implement' }));
  const bigWorkers = Array.from({ length: 8 }, (_, i) => ({
    id: i, hostname: `host-${i}`, type: 'worker', project_id: i % 50,
    last_heartbeat: new Date().toISOString(),
  }));
  const state = buildInstanceState({ projects: bigProjects, tracks: bigTracks, workers: bigWorkers });
  const digest = buildStateDigest(state, 900);
  assert.ok(digest.length <= 900, `digest was ${digest.length} chars`);
});

test('digest names lc state --json as the on-demand detail source', () => {
  const state = buildInstanceState({ projects: PROJECTS, tracks: [], workers: [] });
  const digest = buildStateDigest(state);
  assert.ok(digest.includes('lc state --json'));
});
