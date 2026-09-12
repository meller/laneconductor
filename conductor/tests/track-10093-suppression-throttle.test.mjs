// Track AM-10093 Phase 6: unit coverage for the suppression log throttle,
// plus wiring pins confirming the release/skip LOGIC (not just the log
// line) runs unconditionally on every cycle — only the log line itself is
// rate-limited.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSuppressionLogThrottle } from '../services/suppression-log-throttle.mjs';

const SYNC_SRC = readFileSync(new URL('../laneconductor.sync.mjs', import.meta.url), 'utf8');

// TC-6.1
test('TC-6.1: the first occurrence of a key always logs', () => {
  const throttle = createSuppressionLogThrottle({ intervalMs: 60000, now: () => 1000 });
  assert.equal(throttle.shouldLog('10093:dispatch:Lane'), true);
});

// TC-6.2
test('TC-6.2: repeated suppressions for the same key within the interval log only once', () => {
  let t = 0;
  const throttle = createSuppressionLogThrottle({ intervalMs: 60000, now: () => t });
  assert.equal(throttle.shouldLog('10093:dispatch:Lane'), true);
  t = 1000; // 1s later, well within the 60s interval
  assert.equal(throttle.shouldLog('10093:dispatch:Lane'), false);
  t = 30000;
  assert.equal(throttle.shouldLog('10093:dispatch:Lane'), false);
});

test('logging resumes once the interval has elapsed', () => {
  let t = 0;
  const throttle = createSuppressionLogThrottle({ intervalMs: 60000, now: () => t });
  assert.equal(throttle.shouldLog('k'), true);
  t = 60001;
  assert.equal(throttle.shouldLog('k'), true);
});

test('different keys are throttled independently (a track hitting two suppression paths still gets a line for each kind)', () => {
  let t = 0;
  const throttle = createSuppressionLogThrottle({ intervalMs: 60000, now: () => t });
  assert.equal(throttle.shouldLog('10093:dispatch:Lane'), true);
  assert.equal(throttle.shouldLog('10093:db-pull:mtime_advanced_since_pull_decision'), true, 'a different suppression kind for the same track must not be suppressed by the first');
});

test('different tracks are throttled independently', () => {
  let t = 0;
  const throttle = createSuppressionLogThrottle({ intervalMs: 60000, now: () => t });
  assert.equal(throttle.shouldLog('10093:dispatch:Lane'), true);
  assert.equal(throttle.shouldLog('10089:dispatch:Lane'), true);
});

// TC-6.3
test('TC-6.3: no suppression path appends to conversation.md (the log throttle is the only mitigation, per track 10040\'s "stale process spamming conversation.md" rule)', () => {
  const dispatchSection = SYNC_SRC.slice(
    SYNC_SRC.indexOf('if (revalidation.stale) {'),
    SYNC_SRC.indexOf('continue;', SYNC_SRC.indexOf('if (revalidation.stale) {'))
  );
  assert.ok(!dispatchSection.includes('conversation.md'), 'a stale dispatch must never write to conversation.md — see track 10040\'s existing rule against a stale process spamming it');

  const pullSection = SYNC_SRC.slice(
    SYNC_SRC.indexOf('if (pullGuardDecision.skip) {'),
    SYNC_SRC.indexOf('} else {', SYNC_SRC.indexOf('if (pullGuardDecision.skip) {'))
  );
  assert.ok(!pullSection.includes('conversation.md'));
});

// ── Wiring pins: the throttle guards the LOG line only, never the release/
// skip logic itself ────────────────────────────────────────────────────
test('the dispatch-abandon release logic (releaseTrackClaim / patch queue) is NOT inside the throttle\'s if-block — it must run every cycle regardless of whether this cycle logs', () => {
  const staleBlockStart = SYNC_SRC.indexOf('if (revalidation.stale) {');
  const continueIdx = SYNC_SRC.indexOf('continue;', staleBlockStart);
  const staleBlock = SYNC_SRC.slice(staleBlockStart, continueIdx);
  const throttleIfStart = staleBlock.indexOf('if (suppressionLogThrottle.shouldLog(');
  const throttleIfEnd = staleBlock.indexOf('\n      }', throttleIfStart) + '\n      }'.length;
  const afterThrottleBlock = staleBlock.slice(throttleIfEnd);
  assert.ok(afterThrottleBlock.includes('releaseTrackClaim(tracksDir, dir)'), 'the release-claim call must be OUTSIDE the throttle\'s if-block');
  assert.ok(afterThrottleBlock.includes("lane_action_status: 'queue'"), 'the primary release-patch must be OUTSIDE the throttle\'s if-block');
});

test('laneconductor.sync.mjs uses one shared suppressionLogThrottle instance for both suppression sites', () => {
  assert.ok(SYNC_SRC.includes('const suppressionLogThrottle = createSuppressionLogThrottle();'));
  const usages = SYNC_SRC.match(/suppressionLogThrottle\.shouldLog\(/g) || [];
  assert.equal(usages.length, 2, 'both the dispatch-revalidation and DB-pull suppression sites must route through the same shared throttle instance');
});
