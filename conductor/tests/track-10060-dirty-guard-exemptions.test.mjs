// Track 10060 Phase 1 (REQ-1): regression lock on the main-mode dirty-checkout
// guard's exemption boundary.
//
// Track 10060 was reported as "the worker's own index.md sync writes wedge the
// guard". Investigation (spec Finding 1) showed that class was ALREADY exempt —
// isWorkerBookkeepingPath has covered conductor/tracks/*/(index|plan|spec|test).md
// since 2026-08-25, nine days before the incident. Nothing asserted it, so a
// future edit could silently reintroduce the reported symptom and send the next
// investigation down the same wrong path. These tests pin the boundary in both
// directions: the four marker files are exempt, conversation.md deliberately is
// not (a human can have real WIP there).

import { test } from 'node:test';
import assert from 'node:assert';
import { findDisqualifyingDirtyPaths, isWorkerBookkeepingPath } from '../services/workspace-mode.mjs';

const OWN = 'conductor/tracks/TU-10060-y/';

test('TC-1: another track\'s index.md never blocks a main-mode spawn', () => {
  assert.deepEqual(
    findDisqualifyingDirtyPaths(['conductor/tracks/TU-10055-x/index.md'], OWN),
    []
  );
});

test('TC-2: another track\'s plan.md, spec.md and test.md are exempt too', () => {
  assert.deepEqual(
    findDisqualifyingDirtyPaths([
      'conductor/tracks/TU-10055-x/plan.md',
      'conductor/tracks/TU-10055-x/spec.md',
      'conductor/tracks/TU-10055-x/test.md',
    ], OWN),
    []
  );
});

test('TC-3: another track\'s conversation.md still disqualifies (deliberate — human WIP lives there)', () => {
  assert.deepEqual(
    findDisqualifyingDirtyPaths(['conductor/tracks/TU-10055-x/conversation.md'], OWN),
    ['conductor/tracks/TU-10055-x/conversation.md']
  );
  assert.equal(isWorkerBookkeepingPath('conductor/tracks/TU-10055-x/conversation.md'), false);
});

test('TC-4: a brand-new track folder expanded per-file by --untracked-files=all is exempt', () => {
  // `git status --porcelain` alone collapses a never-committed directory to one
  // `?? conductor/tracks/TU-10099-new/` line, which matches no per-file regex.
  // The guard passes --untracked-files=all precisely so these four expand and
  // the existing exemptions apply file-by-file.
  assert.deepEqual(
    findDisqualifyingDirtyPaths([
      'conductor/tracks/TU-10099-new/index.md',
      'conductor/tracks/TU-10099-new/spec.md',
      'conductor/tracks/TU-10099-new/plan.md',
      'conductor/tracks/TU-10099-new/test.md',
    ], OWN),
    []
  );
});

test('TC-5: prisma/schema.sql still disqualifies — 10060 changes the messaging, not the classification', () => {
  assert.deepEqual(
    findDisqualifyingDirtyPaths(['prisma/schema.sql'], OWN),
    ['prisma/schema.sql']
  );
});

test('TC-6: the track\'s own folder is filtered out, conversation.md included', () => {
  assert.deepEqual(
    findDisqualifyingDirtyPaths([`${OWN}conversation.md`, `${OWN}index.md`], OWN),
    []
  );
});

test('a mixed list returns only the genuinely disqualifying paths, order preserved', () => {
  assert.deepEqual(
    findDisqualifyingDirtyPaths([
      'conductor/tracks/TU-10055-x/index.md',
      'prisma/schema.sql',
      '.laneconductor.json',
      'conductor/tracks/TU-10055-x/conversation.md',
      'conductor/tracks/file_sync_queue.md',
      'ui/src/App.jsx',
    ], OWN),
    ['prisma/schema.sql', 'conductor/tracks/TU-10055-x/conversation.md', 'ui/src/App.jsx']
  );
});
