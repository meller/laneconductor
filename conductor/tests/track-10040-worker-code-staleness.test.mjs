// Track 10040 Phase 2 (REQ-11, Finding 4): classifyWorkerStaleness pure
// module tests. Staleness is measured against the INSTALL DIR's HEAD
// (spec D5), never a managed project's repo — a worker's code lives at
// the install path, not in any project it manages.

import { test } from 'node:test';
import assert from 'node:assert';
import { classifyWorkerStaleness } from '../services/worker-code-staleness.mjs';

test('TC-76: commits since workerSha touched laneconductor.sync.mjs -> critical', () => {
  const r = classifyWorkerStaleness({
    workerSha: 'aaa', headSha: 'bbb', commitsBehind: 2,
    touchedFiles: ['conductor/laneconductor.sync.mjs', 'README.md'],
  });
  assert.equal(r.severity, 'critical');
  assert.equal(r.stale, true);
});

test('TC-77: commits touch only unrelated files, commitsBehind under threshold -> never critical', () => {
  const r = classifyWorkerStaleness({
    workerSha: 'aaa', headSha: 'bbb', commitsBehind: 3, maxCommitsBehind: 20,
    touchedFiles: ['ui/src/App.jsx', 'README.md'],
  });
  assert.notEqual(r.severity, 'critical');
  assert.ok(['current', 'stale'].includes(r.severity));
});

test('TC-78: commitsBehind exceeds threshold with no dependency-file touches -> stale', () => {
  const r = classifyWorkerStaleness({
    workerSha: 'aaa', headSha: 'bbb', commitsBehind: 50, maxCommitsBehind: 20,
    touchedFiles: ['README.md'],
  });
  assert.equal(r.severity, 'stale');
  assert.equal(r.stale, true);
});

test('TC-79: workerSha === headSha -> current, not stale', () => {
  const r = classifyWorkerStaleness({ workerSha: 'aaa', headSha: 'aaa', commitsBehind: 0, touchedFiles: [] });
  assert.equal(r.severity, 'current');
  assert.equal(r.stale, false);
});

test('TC-80: a touched file under conductor/services/ is also critical (not just the main file)', () => {
  const r = classifyWorkerStaleness({
    workerSha: 'aaa', headSha: 'bbb', commitsBehind: 1,
    touchedFiles: ['conductor/services/lane-regression-guard.mjs'],
  });
  assert.equal(r.severity, 'critical');
});

test('a touched conductor/constants.mjs is also critical', () => {
  const r = classifyWorkerStaleness({
    workerSha: 'aaa', headSha: 'bbb', commitsBehind: 1,
    touchedFiles: ['conductor/constants.mjs'],
  });
  assert.equal(r.severity, 'critical');
});

test('within threshold and no touched loaded files -> current', () => {
  const r = classifyWorkerStaleness({
    workerSha: 'aaa', headSha: 'bbb', commitsBehind: 5, maxCommitsBehind: 20,
    touchedFiles: ['docs/README.md'],
  });
  assert.equal(r.severity, 'current');
  assert.equal(r.stale, false);
});
