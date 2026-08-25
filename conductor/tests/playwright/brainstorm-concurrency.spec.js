// conductor/tests/playwright/brainstorm-concurrency.spec.js
// E2E test: Verify brainstorm skill and concurrency limits.
// 1. Create Track A (Plan:Queue)
// 2. Create Track B (Plan:Queue)
// 3. Trigger brainstorm on Track B (via conversation.md)
// 4. Scope ONE self-owned worker to BOTH tracks — verify exactly one runs
//    at a time in the plan lane (parallel_limit: 1)
// 5. Wait for both to finish
// 6. Verify Track B got an AI reply in conversation.md and stayed in the plan lane
//
// Track 10021: self-scoped and hermetic. Scoping one worker to exactly these
// two tracks (rather than depending on an ambient `--sync-and-work` worker
// that can claim ANY queued track) means the concurrency assertion below
// means what it claims — no other in-flight track can be claimed into the
// count. Run with NO ambient worker running:
//
//   lc worker stop
//   npx playwright test conductor/tests/playwright/brainstorm-concurrency.spec.js

import { test, expect } from '@playwright/test';
import { readFileSync, appendFileSync } from 'fs';
import { join } from 'path';
import {
  createTrackViaUI,
  enableAutoRun,
  assertCheckoutSpawnable,
  spawnScopedWorker,
  waitForLaneAction,
  cleanup,
  getTrackByNumber,
  resolveTrackDir,
  resolveProjectRepoPath,
} from './helpers/scoped-worker.mjs';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

test.describe('Brainstorm & Concurrency E2E', () => {
  test.setTimeout(300000); // 5 min

  test('Worker respects concurrency and brainstorm skill flow', async ({ page, request }) => {
    const titleA = `Concurrency A ${Date.now()}`;
    const titleB = `Brainstorm B ${Date.now()}`;

    let trackA = null, trackB = null, dirA = null, dirB = null, handle = null;

    // Track 10021: resolved once — see the identical note in
    // new-track-plan.spec.js. The UI/API writes a just-created track's
    // files under the project's DB `repo_path`, not wherever this spec
    // happens to be running from; every filesystem-touching call below
    // needs this value threaded through, not the PROJECT_ROOT default.
    //
    // TEST_PROJECT_ID (optional, same convention as track-1033-sharing.spec.js):
    // point at an isolated project instead of the default — see the
    // identical note in new-track-plan.spec.js.
    const projectId = process.env.TEST_PROJECT_ID ? parseInt(process.env.TEST_PROJECT_ID, 10) : undefined;
    const projectRoot = await resolveProjectRepoPath({ projectId });

    try {
      // ── 1-2: Create both tracks via the helper ────────────────────────────────
      ({ trackNumber: trackA, trackDir: dirA } = await createTrackViaUI(page, { title: titleA, description: 'Test description A', projectId, projectRoot }));
      console.log(`Created Track A: ${trackA} (${dirA})`);

      ({ trackNumber: trackB, trackDir: dirB } = await createTrackViaUI(page, { title: titleB, description: 'Test description B', projectId, projectRoot }));
      console.log(`Created Track B: ${trackB} (${dirB})`);

      // ── 3: Trigger brainstorm on Track B ──────────────────────────────────────
      const convPathB = join(projectRoot, 'conductor/tracks', dirB, 'conversation.md');
      appendFileSync(convPathB, '\n\n> **human**: Please brainstorm some ideas for this feature.\n');
      console.log(`Triggered brainstorm in ${convPathB}`);

      // ── Bring our own worker, scoped to BOTH tracks (REQ-8) ───────────────────
      // A closed set — nothing else queued can be claimed into it, so the
      // concurrency assertion below is hermetic instead of racing whatever
      // else happens to be in flight.
      assertCheckoutSpawnable([dirA, dirB], { cwd: projectRoot });
      await enableAutoRun(request, trackA, { projectId, projectRoot });
      await enableAutoRun(request, trackB, { projectId, projectRoot });
      handle = spawnScopedWorker([trackA, trackB], { projectRoot });
      console.log(`🚀 Spawned scoped worker #${handle.workerNumber} for tracks ${trackA}, ${trackB} — log: ${handle.logPath}`);

      // ── 4: Exactly one of A/B runs in the plan lane at the observation point ──
      console.log('Waiting for the scoped worker to pick up a track...');
      let running = null;
      const pickupDeadline = Date.now() + 60000;
      while (Date.now() < pickupDeadline && !running) {
        const [tA, tB] = await Promise.all([getTrackByNumber(trackA, { projectId }), getTrackByNumber(trackB, { projectId })]);
        const rA = tA?.lane_action_status === 'running';
        const rB = tB?.lane_action_status === 'running';
        if (rA || rB) {
          // Track 10021: tightened from toBeLessThanOrEqual(1) — with the set
          // closed to exactly these two tracks, precisely one must be running
          // here, not merely "at most one".
          expect(Number(rA) + Number(rB), 'Exactly one of A/B should be running under parallel_limit:1').toBe(1);
          running = rA ? trackA : trackB;
          break;
        }
        await sleep(2000);
      }
      expect(running, 'Scoped worker should have picked up a track within 60s').toBeTruthy();
      console.log(`✅ Track ${running} is running — concurrency held at exactly 1`);

      // ── 5: Wait for the running track to finish, then the other ───────────────
      await waitForLaneAction(handle, running, t => t.lane_action_status === 'done' || t.lane_action_result === 'success', { timeoutMs: 180000, projectId });
      console.log(`Track ${running} finished.`);

      const other = running === trackA ? trackB : trackA;
      console.log(`Waiting for track ${other} to reach its terminal state...`);
      await waitForLaneAction(handle, other, t => t.lane_action_status === 'done' || t.lane_action_result === 'success', { timeoutMs: 180000, projectId });
      console.log(`Track ${other} finished.`);

      // ── 6: Verify AI reply landed in Track B's conversation.md ────────────────
      console.log('Checking for AI reply in Track B conversation...');
      const content = readFileSync(convPathB, 'utf8');
      expect(/> \*\*(claude|gemini)\*\*:/.test(content), 'AI should have replied to brainstorm').toBeTruthy();
      console.log('✅ AI replied to brainstorm!');

      // Verify Lane (Should still be plan)
      const finalB = await getTrackByNumber(trackB, { projectId });
      expect(finalB.lane_status, 'Track B should remain in plan lane').toBe('plan');
      console.log('✅ Track B remained in plan lane.');
    } finally {
      // REQ-6/F6: cleanup runs even when the body throws, and leaves no
      // residue (no leftover directory for either track number).
      const nums = [trackA, trackB].filter(Boolean);
      if (nums.length) {
        await cleanup(handle, nums, { projectId, projectRoot });
        for (const n of nums) {
          expect(resolveTrackDir(projectRoot, n), `Track ${n} directory should be gone after cleanup`).toBeNull();
        }
        console.log('🧹 Cleaned up tracks and scoped worker — no residue left');
      }
    }
  });
});
