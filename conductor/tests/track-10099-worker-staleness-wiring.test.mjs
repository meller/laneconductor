// conductor/tests/track-10099-worker-staleness-wiring.test.mjs
// Track AM-10099 Phase 8 (item f): pins the root-cause fix for why
// classifyWorkerStaleness never fired — checkWorkerCodeStaleness() used
// to be inlined inside reapOrphanedWorkerProcesses(), which returns
// immediately with `if (!isManager) return;`, making the check
// UNREACHABLE for every ordinary project-type worker (the overwhelming
// majority, and the exact kind that suffered the live incident this
// track's spec item (e) documents). Static-analysis style, matching
// track-10093-worker-identity-cap.test.mjs's own convention for pinning
// wiring inside a script with side effects on import.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SYNC_SRC = readFileSync(new URL('../laneconductor.sync.mjs', import.meta.url), 'utf8');

test('AC-20 wiring: checkWorkerCodeStaleness is scheduled OUTSIDE reapOrphanedWorkerProcesses (never manager-gated)', () => {
  const reapFnStart = SYNC_SRC.indexOf('async function reapOrphanedWorkerProcesses()');
  const reapFnEnd = SYNC_SRC.indexOf('\n}\n', reapFnStart);
  assert.ok(reapFnStart !== -1 && reapFnEnd !== -1, 'reapOrphanedWorkerProcesses must exist');
  const reapFnBody = SYNC_SRC.slice(reapFnStart, reapFnEnd);
  assert.ok(reapFnBody.includes('if (!isManager) return;'), 'sanity: the manager-only gate this bug depended on must still be there (orphan-reaping itself IS still manager-only by design)');
  assert.ok(
    !reapFnBody.includes('checkWorkerCodeStaleness'),
    'checkWorkerCodeStaleness must NOT be called from inside reapOrphanedWorkerProcesses (that was the bug) — it must be scheduled independently'
  );

  const staleFnStart = SYNC_SRC.indexOf('async function checkWorkerCodeStaleness(');
  assert.ok(staleFnStart !== -1, 'checkWorkerCodeStaleness must be its own top-level function');
  assert.ok(staleFnStart > reapFnEnd, 'checkWorkerCodeStaleness must be defined after reapOrphanedWorkerProcesses, i.e. genuinely extracted out, not nested inside it');

  // The interval that actually invokes it must not be gated on isManager.
  const intervalIdx = SYNC_SRC.indexOf('checkWorkerCodeStaleness(Array.isArray(workers)');
  assert.ok(intervalIdx !== -1, 'the periodic call site must exist');
  const precedingCode = SYNC_SRC.slice(Math.max(0, intervalIdx - 400), intervalIdx);
  assert.ok(!precedingCode.includes('if (!isManager)'), 'the periodic call site must not be gated on isManager');
});

test('checkWorkerCodeStaleness result feeds the heartbeat body as code_staleness (AC-20: visible somewhere other than .sync.log)', () => {
  const idx = SYNC_SRC.indexOf('code_staleness: latestWorkerStaleness,');
  assert.ok(idx !== -1, 'the heartbeat body must include code_staleness: latestWorkerStaleness (always sent, so it self-clears once current again)');
});
