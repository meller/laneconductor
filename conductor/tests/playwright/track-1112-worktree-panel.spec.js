// conductor/tests/playwright/track-1112-worktree-panel.spec.js
// E2E test: the Worktrees panel (Phase 7) — seeds a real worker.worktrees
// row via direct DB write (the heartbeat payload's own shape), navigates
// the real UI, and asserts the panel renders it and that clicking
// "Merge to main" creates a real worker_dispatch row.
//
// Deterministic: no LLM calls, no dependence on a live heartbeat worker
// claiming a lane action — fast tier.
//
// Prerequisites:
//   - UI running at localhost:8090 (make ui-start)
//   - API running at localhost:8091 (make api-start), running code that
//     includes this track's changes (restart after pulling them)
//
// Run: npx playwright test conductor/tests/playwright/track-1112-worktree-panel.spec.js

import { test, expect } from '@playwright/test';
import pg from 'pg';

const API_URL = process.env.TEST_API_URL || 'http://localhost:8091';
const DB_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/laneconductor';
const PROJECT_ID = 1; // laneconductor's own project row

// Track 1100 Gap 4 (2026-08-20): this used to grab whichever worker row was
// most recently heartbeated (`ORDER BY last_heartbeat DESC LIMIT 1`) and
// mutate ITS `worktrees` column directly. On a machine with real ambient
// workers (this repo's normal state — see Gap 2's investigation), that could
// grab a real worker rather than a test fixture: a live worker's own 5s
// heartbeat can overwrite the injected test data before the UI assertion
// runs (a genuine race, reproduced live), and `afterAll`'s "restore" would
// then stomp that real worker's actual current worktrees with a stale
// pre-test snapshot. Fixed the way worker-identity.spec.js's seedWorker()
// already does it: register a dedicated fixture worker this test fully
// owns, keyed by a per-process-unique hostname so concurrent invocations
// can't collide with each other either.
const FIXTURE_HOSTNAME = `pw-e2e-worktree-panel-${process.pid}`;
// The worktrees panel intentionally aggregates ACROSS every worker/host for
// the project (that's the feature — see the fetchWorktreeRows comment in
// ui/server/index.mjs), so a unique hostname alone isn't enough: two
// concurrent runs each seeding a card titled "#19999" both show up in the
// SAME aggregated panel, and `getByText('#19999')` then matches two
// elements. The fake track numbers need to be run-unique too.
const TRACK_MERGEABLE = `1${String(process.pid).slice(-5).padStart(5, '0')}`;
const TRACK_STRANDED = `2${String(process.pid).slice(-5).padStart(5, '0')}`;

test.describe.serial('Track 1112 Phase 7: Worktrees panel', () => {
  let pool;
  let workerId;

  test.beforeAll(async ({ request }) => {
    pool = new pg.Pool({ connectionString: DB_URL });

    const reg = await request.post(`${API_URL}/worker/register`, {
      data: {
        hostname: FIXTURE_HOSTNAME,
        pid: 999998,
        worker_number: 98,
        project_id: PROJECT_ID,
        type: 'project',
        mode: 'sync-only',
        visibility: 'private',
        cli: 'claude',
        model: 'sonnet',
      },
    });
    expect(reg.ok(), 'POST /worker/register should succeed').toBeTruthy();
    ({ id: workerId } = await reg.json());

    await pool.query(`UPDATE workers SET worktrees = $1, last_heartbeat = NOW() WHERE id = $2`, [
      JSON.stringify([
        { track: TRACK_MERGEABLE, title: 'PW Test Mergeable', lane: 'done', lane_status: 'success', ahead: 1, behind: 0, dirty: 0, class: 'mergeable' },
        { track: TRACK_STRANDED, title: 'PW Test Stranded', lane: 'quality-gate', lane_status: 'queue', ahead: 2, behind: 5, dirty: null, class: 'stranded' },
      ]),
      workerId,
    ]);
  });

  test.afterAll(async () => {
    // Delete outright rather than "restore" — this row is a fixture this
    // test created wholesale, not a real worker it borrowed, so there's no
    // prior state to put back.
    await pool.query(`DELETE FROM workers WHERE id = $1`, [workerId]);
    await pool.query(`DELETE FROM worker_dispatch WHERE action = 'merge-worktree' AND track_number = $1`, [TRACK_MERGEABLE]);
    await pool.end();
  });

  test('renders seeded rows with correct classification, and merge dispatches a real worker_dispatch row', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const projectSelect = page.getByRole('combobox').first();
    await expect(projectSelect).toBeVisible({ timeout: 10000 });
    await projectSelect.selectOption('1');

    const worktreesTab = page.getByRole('button', { name: 'Worktrees' });
    await expect(worktreesTab).toBeVisible({ timeout: 10000 });
    await worktreesTab.click();

    // Scoped to each seeded card rather than page-wide `getByText` — under
    // concurrent invocations (each with their own unique TRACK_MERGEABLE/
    // TRACK_STRANDED, but the SAME generic "Mergeable"/"Stranded" badge
    // text), a page-wide locator for the badge text alone would match one
    // element per concurrent run and fail strict mode, even though each
    // run's own card is correct.
    const mergeableCard = page.locator('[data-testid="worktree-row"]', { hasText: `#${TRACK_MERGEABLE}` });
    const strandedCard = page.locator('[data-testid="worktree-row"]', { hasText: `#${TRACK_STRANDED}` });

    // Poll: the panel fetches on a 10s interval, so give it a beat.
    await expect(mergeableCard).toBeVisible({ timeout: 15000 });
    await expect(strandedCard).toBeVisible();
    // exact: true matters — "Mergeable" (the badge) is otherwise a substring
    // match of "PW Test Mergeable" (the seeded title) too.
    await expect(mergeableCard.getByText('Mergeable', { exact: true })).toBeVisible();
    await expect(strandedCard.getByText('Stranded', { exact: true })).toBeVisible();

    // The mergeable row's card should have an enabled "Merge to main" button.
    const mergeBtn = mergeableCard.getByTestId('merge-to-main-btn');
    await expect(mergeBtn).toBeEnabled();
    await mergeBtn.click();

    // Real API round-trip: a worker_dispatch row must actually exist now.
    await expect(async () => {
      const { rows } = await pool.query(
        `SELECT id, worker_id, action, payload FROM worker_dispatch WHERE action = 'merge-worktree' AND track_number = $1`,
        [TRACK_MERGEABLE]
      );
      expect(rows.length).toBeGreaterThan(0);
    }).toPass({ timeout: 10000 });
  });
});
