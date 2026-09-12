// Track AM-10093 Phase 1/2: reproduces the stale pre-spawn dispatch clobber
// (R1/R2 in spec.md) and pins the fix's wiring into autoLaunchLocalFs.
//
// conductor/laneconductor.sync.mjs boots a whole worker on import (chokidar
// watchers, setIntervals — same constraint documented in
// track-10046-stale-lane-snapshot.test.mjs and
// track-10040-duplicate-dir-scan.test.mjs), so autoLaunchLocalFs itself
// isn't callable in isolation. Real-code coverage here is therefore
// source-level pins against the literal call site, following the same
// established pattern track-10046's suite uses for its own equivalent fix.
// The actual decision LOGIC (revalidateDispatchSnapshot) has full direct
// unit coverage in track-10093-dispatch-revalidation.test.mjs — this file
// verifies that logic is actually wired into the real dispatch path, in
// the right order, not just that it exists somewhere in the file.
//
// Running this file against the pre-fix code: TC-1.1/TC-1.2/TC-2.7/TC-2.8
// all fail (the gate did not exist). After the fix, all pass.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SYNC_SRC = readFileSync(new URL('../laneconductor.sync.mjs', import.meta.url), 'utf8');

function functionBody(name) {
  const start = SYNC_SRC.indexOf(`async function ${name}(`);
  assert.ok(start !== -1, `${name} must exist in laneconductor.sync.mjs`);
  // autoLaunchLocalFs is the last top-level function of its kind before the
  // "Track 1085: Manual Worker Dispatch" section — slice to that marker
  // rather than brace-counting (the file's own style elsewhere).
  const end = SYNC_SRC.indexOf('// ── Track 1085: Manual Worker Dispatch', start);
  assert.ok(end !== -1 && end > start, `could not locate the end of ${name}`);
  return SYNC_SRC.slice(start, end);
}

const AUTO_LAUNCH_SRC = functionBody('autoLaunchLocalFs');

// ── TC-1.1 / TC-1.2 (the core fix): the gate must run, and must run BEFORE
// the spawn ──────────────────────────────────────────────────────────────
test('TC-1.1/TC-1.2: autoLaunchLocalFs revalidates the dispatch snapshot before spawning', () => {
  assert.ok(
    AUTO_LAUNCH_SRC.includes('revalidateDispatchSnapshot('),
    'autoLaunchLocalFs must call revalidateDispatchSnapshot immediately before spawning — otherwise a stale snapshot dispatches the wrong lane action with no check at all (confirmed live, track AM-10089: a stale snapshot dispatched /laneconductor merge for a track a human had just moved to plan)'
  );

  const revalidateIdx = AUTO_LAUNCH_SRC.indexOf('revalidateDispatchSnapshot(');
  const spawnIdx = AUTO_LAUNCH_SRC.indexOf('await spawnCli(');
  assert.ok(revalidateIdx !== -1 && spawnIdx !== -1, 'both call sites must exist');
  assert.ok(revalidateIdx < spawnIdx, 'the revalidation check must run BEFORE spawnCli — checking after the spawn has already happened is useless');
});

test('TC-1.1: a stale dispatch must `continue` rather than fall through to spawnCli', () => {
  const gateSection = AUTO_LAUNCH_SRC.slice(
    AUTO_LAUNCH_SRC.indexOf('revalidateDispatchSnapshot('),
    AUTO_LAUNCH_SRC.indexOf('await spawnCli(')
  );
  assert.ok(gateSection.includes('if (revalidation.stale)'), 'must branch on the stale result');
  assert.ok(gateSection.includes('continue;'), 'a stale dispatch must abandon this candidate and move to the next, not spawn anyway');
});

// ── TC-2.7 / TC-2.8 (REQ-2): abandoning a dispatch must release the claim ──
test('TC-2.7: a stale dispatch in API mode releases the primary claim back to queue', () => {
  const gateSection = AUTO_LAUNCH_SRC.slice(
    AUTO_LAUNCH_SRC.indexOf('if (revalidation.stale)'),
    AUTO_LAUNCH_SRC.indexOf('continue;', AUTO_LAUNCH_SRC.indexOf('if (revalidation.stale)')) + 'continue;'.length
  );
  assert.ok(gateSection.includes("lane_action_status: 'queue'"), 'must PATCH lane_action_status back to queue so the track can be re-evaluated next cycle');
  assert.ok(gateSection.includes('primaryCollector()'), 'must target the primary collector — never fan this release out to non-primary collectors (same rule the existing claim-guard conflict revert follows)');
});

test('TC-2.8: a stale dispatch in local-fs mode releases the file claim', () => {
  const gateSection = AUTO_LAUNCH_SRC.slice(
    AUTO_LAUNCH_SRC.indexOf('if (revalidation.stale)'),
    AUTO_LAUNCH_SRC.indexOf('continue;', AUTO_LAUNCH_SRC.indexOf('if (revalidation.stale)')) + 'continue;'.length
  );
  assert.ok(gateSection.includes('releaseTrackClaim(tracksDir, dir)'), 'must release the OS-level file claim taken earlier in this same iteration, or the track is stranded unclaimable until the claim goes stale');
});

// ── TC-2.9 (REQ-3): the running-claim write must patch a fresh read ───────
test('TC-2.9: the pre-spawn running-claim write reads fresh content, not the stale top-of-loop snapshot', () => {
  const claimWriteSection = AUTO_LAUNCH_SRC.slice(
    AUTO_LAUNCH_SRC.indexOf('if (!waitingForReply) {', AUTO_LAUNCH_SRC.indexOf('await spawnCli(') - 2000),
    AUTO_LAUNCH_SRC.indexOf('await spawnCli(')
  );
  assert.ok(
    claimWriteSection.includes('readIfExists(indexPath)'),
    'the Lane Status: running write must re-read index.md fresh immediately before writing — patching the stale `content` buffer wholesale is exactly the R1 mechanism (see spec.md) that reverts any concurrent edit'
  );
});

// ── TC-2.6 equivalent at the wiring level: revalidation only compares the
// 4 dispatch-relevant fields, sourced from the SAME snapshot values the
// dispatch decision itself used (not a second, independently-computed
// snapshot) ────────────────────────────────────────────────────────────
test('the snapshot passed to revalidateDispatchSnapshot is built from this iteration\'s own already-parsed lane_status/lane_action_status/autoRun/waitingForReply', () => {
  const callSite = AUTO_LAUNCH_SRC.slice(
    AUTO_LAUNCH_SRC.indexOf('revalidateDispatchSnapshot('),
    AUTO_LAUNCH_SRC.indexOf(');', AUTO_LAUNCH_SRC.indexOf('revalidateDispatchSnapshot(')) + 2
  );
  assert.ok(callSite.includes('lane: lane_status'));
  assert.ok(callSite.includes('laneActionStatus: lane_action_status'));
  assert.ok(callSite.includes('autoRun'));
  assert.ok(callSite.includes('waitingForReply'));
});
