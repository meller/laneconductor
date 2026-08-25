// conductor/tests/playwright/new-track-plan.spec.js
// E2E test: Create a new track in the UI and verify it flows through to the worker
// and back (new track → plan lane → plan:running → plan:success).
//
// Track 10021: self-scoped — this spec brings its own throwaway worker
// (see helpers/scoped-worker.mjs) instead of depending on an ambient
// `lc worker start --sync-and-work`. Run with NO ambient worker running:
//
//   lc worker stop
//   npx playwright test conductor/tests/playwright/new-track-plan.spec.js
//
// Prerequisites:
//   - UI running at localhost:8090 (make ui-start)
//   - API running at localhost:8091 (make api-start)
//   - Ambient worker (lc-worker-start) must be STOPPED, or its own claims
//     will race this spec's assertions (see playwright.config.js).

import { test, expect } from '@playwright/test';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import {
  createTrackViaUI,
  enableAutoRun,
  assertCheckoutSpawnable,
  spawnScopedWorker,
  waitForLaneAction,
  cleanup,
  getTrackByNumber,
  resolveProjectRepoPath,
} from './helpers/scoped-worker.mjs';

const TEST_TITLE = `E2E Test ${Date.now()}`;
const TEST_DESC = 'Automated Playwright e2e — verifies new track flows to worker and back';

test('New Track → Plan: full e2e flow', async ({ page, request }) => {
  test.setTimeout(300000); // up to 5 min for full planning

  let trackNumber = null;
  let trackDir = null;
  let handle = null;

  // Track 10021: resolved once, up front — ui/server/index.mjs writes a
  // just-created track's files under the PROJECT's own DB `repo_path`, not
  // wherever this spec file happens to be running from. When this spec runs
  // from a worktree (as this repo's own lane actions do), those differ.
  // Every helper call below that touches the filesystem needs this same
  // value, not the PROJECT_ROOT default.
  const projectRoot = await resolveProjectRepoPath();

  try {
    // ── Step 1-4: create via UI, capture track_number from the API response ──
    ({ trackNumber, trackDir } = await createTrackViaUI(page, { title: TEST_TITLE, description: TEST_DESC, projectRoot }));
    expect(trackNumber, 'API should return track_number').toBeTruthy();
    expect(trackDir, `No track directory resolved for ${trackNumber}`).toBeTruthy();
    console.log(`✅ Track submitted: track_number=${trackNumber}, dir=${trackDir}`);

    // ── Step 5: verify index.md written on disk ───────────────────────────────
    // The create endpoint (ui/server/index.mjs) writes index.md/plan.md/spec.md
    // synchronously in the same request — no separate intake.md is written by
    // any code path anymore, so this checks the file that's actually produced.
    const indexPath = join(projectRoot, 'conductor/tracks', trackDir, 'index.md');
    expect(existsSync(indexPath), 'index.md should exist').toBeTruthy();
    expect(readFileSync(indexPath, 'utf8'), 'index.md should contain the new track title').toContain(TEST_TITLE);
    console.log('✅ index.md written to disk with title');

    // ── Step 6: verify track in DB with plan:queue ─────────────────────────────
    let track = await getTrackByNumber(trackNumber);
    expect(track, `Track ${trackNumber} not found in API`).toBeTruthy();
    expect(track.lane_status).toBe('plan');
    expect(track.lane_action_status).toBe('queue');
    console.log(`✅ DB: track=${trackNumber} lane=${track.lane_status} action=${track.lane_action_status}`);

    // ── Step 7: track appears in Kanban UI ─────────────────────────────────────
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);
    const card = page.getByText(`#${trackNumber}`).first();
    await expect(card).toBeVisible({ timeout: 15000 });
    console.log(`✅ Track #${trackNumber} card visible in Kanban`);

    // ── Bring our own worker (REQ-2/REQ-3/REQ-5) ───────────────────────────────
    assertCheckoutSpawnable([trackDir], { cwd: projectRoot });
    await enableAutoRun(request, trackNumber, { projectRoot });
    handle = spawnScopedWorker([trackNumber], { projectRoot });
    console.log(`🚀 Spawned scoped worker #${handle.workerNumber} for track ${trackNumber} — log: ${handle.logPath}`);

    // ── Step 8: worker picks up the track (running) ────────────────────────────
    console.log(`Waiting for scoped worker to pick up track ${trackNumber}...`);
    await waitForLaneAction(handle, trackNumber, t => t.lane_action_status === 'running', { timeoutMs: 60000 });
    console.log(`✅ Scoped worker picked up track ${trackNumber} (running)`);

    // ── Step 9: planning completes (plan:success) ──────────────────────────────
    console.log(`Waiting for planning to complete for track ${trackNumber}...`);
    track = await waitForLaneAction(
      handle,
      trackNumber,
      t => t.lane_action_status === 'done' || t.lane_action_result === 'success',
      { timeoutMs: 180000 }
    );
    console.log(`✅ Planning complete: status=${track.lane_action_status} result=${track.lane_action_result}`);

    // ── Step 10: verify spec.md + plan.md on disk ──────────────────────────────
    const specPath = join(projectRoot, 'conductor/tracks', trackDir, 'spec.md');
    const planPath = join(projectRoot, 'conductor/tracks', trackDir, 'plan.md');
    expect(existsSync(specPath), `spec.md missing in ${trackDir}`).toBeTruthy();
    expect(existsSync(planPath), `plan.md missing in ${trackDir}`).toBeTruthy();
    console.log(`✅ spec.md + plan.md created for track ${trackNumber}`);

    // ── Step 11: UI reflects success ──────────────────────────────────────────
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);
    const doneCard = page.getByText(`#${trackNumber}`).first();
    await expect(doneCard).toBeVisible({ timeout: 10000 });
    console.log(`✅ Track ${trackNumber} visible in UI after planning complete`);
  } finally {
    // REQ-6: cleanup runs even when the body throws.
    if (trackNumber) {
      await cleanup(handle, [trackNumber]);
      console.log(`🧹 Cleaned up track ${trackNumber} and its scoped worker`);
    }
  }
});
