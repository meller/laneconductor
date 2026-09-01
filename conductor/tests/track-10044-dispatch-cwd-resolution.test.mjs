// Track 10044: the manual-dispatch lane-action handler computed its
// tracksDir as the bare relative literal 'conductor/tracks', resolved
// against whatever cwd the worker process happened to start with. A
// worker process is not guaranteed to start with the primary checkout as
// its cwd — confirmed live 2026-08-30, worker processes spawned from
// inside a track's own worktree (e.g. by that track's own test suite)
// register with the real production collector and can pull real dispatch
// entries. When one does, the claim write ('**Lane Status**: running')
// lands in the WORKTREE's copy of index.md, not the primary checkout's.
//
// The dispatch handler's own DB PATCH still correctly sets
// lane_action_status: 'running' at that moment — but the next routine
// FS->DB sync cycle reads the PRIMARY checkout's index.md (still 'queue',
// since the claim write never touched it) and pushes that stale value
// back into the DB, clobbering the correct 'running' the dispatch handler
// had just set. Board shows 'queue' for the run's whole duration despite
// live PIDs, fresh heartbeats, and growing logs.
//
// Same categorical bug already fixed via resolvePrimaryRepoRoot() at the
// worker-lock path, createWorktree, and elsewhere in this file — the
// dispatch handler was the one outlier still using a bare relative path.

import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';

test('TC-1: dispatch handler resolves tracksDir via resolvePrimaryRepoRoot, not a bare relative path', () => {
  const src = readFileSync('conductor/laneconductor.sync.mjs', 'utf8');

  // Isolate the dispatch handler's own tracksDir declaration (the
  // "Lane action dispatch" section), not the many OTHER correct
  // tracksDir declarations elsewhere in the file (autoLaunchLocalFs,
  // clearStaleClaimMarkers, etc.) which already resolve correctly via a
  // literal relative to a cwd this test isn't exercising.
  const dispatchSection = src.slice(src.indexOf('// Lane action dispatch'), src.indexOf('// Lane action dispatch') + 1500);
  const tracksDirLine = dispatchSection.match(/const tracksDir = [^\n]+/);
  assert.ok(tracksDirLine, 'dispatch handler must declare tracksDir');
  assert.ok(
    !tracksDirLine[0].includes("'conductor/tracks'"),
    `dispatch handler must not use the bare relative literal (the pre-fix bug). Found: ${tracksDirLine[0]}`
  );
  assert.ok(
    dispatchSection.includes('resolvePrimaryRepoRoot(process.cwd())'),
    'dispatch handler must resolve its repo root via resolvePrimaryRepoRoot(process.cwd()) ' +
    'somewhere ahead of the tracksDir declaration, directly or via an intermediate variable'
  );
});

test('TC-2: resolvePrimaryRepoRoot is imported and used consistently across the file', () => {
  const src = readFileSync('conductor/laneconductor.sync.mjs', 'utf8');
  const usages = (src.match(/resolvePrimaryRepoRoot\(process\.cwd\(\)\)/g) || []).length;
  // Established elsewhere (worker-lock ~L208, createWorktree ~L3709, and
  // others) before this fix added one more. A regression that reverts
  // this fix would drop this count by exactly one.
  assert.ok(usages >= 5, `expected at least 5 call sites using the established pattern, found ${usages}`);
});
