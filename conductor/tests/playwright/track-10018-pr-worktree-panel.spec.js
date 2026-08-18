// conductor/tests/playwright/track-10018-pr-worktree-panel.spec.js
// E2E test: Track 10018 Phase 8 — the PR-mode Worktrees panel (badges, PR
// link/status, Create PR/Merge PR dispatch) and the done-lane "Unmerged"
// Kanban card badge. Follows the exact pattern established by
// track-1112-worktree-panel.spec.js: seeds a real worker.worktrees JSONB
// row via direct DB write (the heartbeat payload's own shape — see
// refreshWorktreeSummaryCache() in conductor/laneconductor.sync.mjs), plus
// (for the done-lane badge half) real `tracks` rows, then drives the real
// UI and asserts on real worker_dispatch rows created by clicking real
// buttons.
//
// Deterministic: no LLM calls, no dependence on a live heartbeat worker
// claiming a lane action, no `gh` calls (the panel only ever dispatches —
// creating/merging PRs for real is the worker's job, out of scope here) —
// fast tier.
//
// Prerequisites:
//   - UI running at localhost:8090 (make ui-start)
//   - API running at localhost:8091 (make api-start), running code that
//     includes this track's changes (restart after pulling them)
//
// Run: npx playwright test conductor/tests/playwright/track-10018-pr-worktree-panel.spec.js

import { test, expect } from '@playwright/test';
import pg from 'pg';

const DB_URL = process.env.DATABASE_URL || '***REMOVED-SECRET-NEON-CREDENTIAL***:5432/laneconductor';
const PROJECT_ID = 1; // laneconductor's own project row

// Fake track numbers, distinct from track-1112's own (19998/19999) and from
// any real track in this repo.
const T_MERGE_PR_READY = '19993'; // pr-open, pr_status open, has a PR number → Merge PR enabled
const T_CREATE_PR = '19992'; // pr-open, no pr_number yet → Create PR
const T_CHECKS_FAILED = '19991'; // pr-open, pr_status checks-failed → Merge PR NOT clickable
const T_CONFLICTED = '19990'; // pr-open, pr_status conflicted → Merge PR NOT clickable
const T_DONE_UNMERGED = '19989'; // real `done`-lane track row + a matching mergeable worktree row → Unmerged badge
const T_DONE_FULLY_MERGED = '19988'; // real `done`-lane track row, NO worktree row → no badge

test.describe.serial('Track 10018 Phase 8: PR-mode Worktrees panel + done-lane badge', () => {
  let pool;
  let workerId;
  let originalWorktrees;

  test.beforeAll(async () => {
    pool = new pg.Pool({ connectionString: DB_URL });
    // Prefer the dedicated synthetic fixture worker (hostname
    // 'pw-e2e-worker', a fake PID that nothing actually heartbeats for) —
    // this dev project has multiple REAL live workers heartbeating every
    // few seconds, each overwriting its own row's `worktrees` column from
    // a real git audit; seeding one of those rows loses the race before
    // the page even finishes loading. Falls back to "most recently
    // heartbeated" only when that fixture doesn't exist (a fresh
    // environment without it).
    let { rows } = await pool.query(
      `SELECT id, worktrees FROM workers WHERE project_id = $1 AND hostname = 'pw-e2e-worker' LIMIT 1`,
      [PROJECT_ID]
    );
    if (!rows.length) {
      ({ rows } = await pool.query(
        `SELECT id, worktrees FROM workers WHERE project_id = $1 ORDER BY last_heartbeat DESC LIMIT 1`,
        [PROJECT_ID]
      ));
    }
    if (!rows.length) throw new Error('No registered worker for project 1 — start one first (lc worker start)');
    workerId = rows[0].id;
    originalWorktrees = rows[0].worktrees;

    await pool.query(`UPDATE workers SET worktrees = $1, last_heartbeat = NOW() WHERE id = $2`, [
      JSON.stringify([
        {
          track: T_MERGE_PR_READY, title: 'PW Test PR Ready', lane: 'done', lane_status: 'success',
          ahead: 3, behind: 0, dirty: 0, class: 'pr-open',
          merge_mode: 'pr', pr_number: 501, pr_url: 'https://github.com/example/repo/pull/501', pr_status: 'open',
        },
        {
          track: T_CREATE_PR, title: 'PW Test Needs PR', lane: 'done', lane_status: 'success',
          ahead: 1, behind: 0, dirty: 0, class: 'pr-open',
          merge_mode: 'pr', pr_number: null, pr_url: null, pr_status: null,
        },
        {
          track: T_CHECKS_FAILED, title: 'PW Test Checks Failed', lane: 'done', lane_status: 'success',
          ahead: 2, behind: 0, dirty: 0, class: 'pr-open',
          merge_mode: 'pr', pr_number: 502, pr_url: 'https://github.com/example/repo/pull/502', pr_status: 'checks-failed',
        },
        {
          track: T_CONFLICTED, title: 'PW Test PR Conflicted', lane: 'done', lane_status: 'success',
          ahead: 4, behind: 2, dirty: 0, class: 'pr-open',
          merge_mode: 'pr', pr_number: 503, pr_url: 'https://github.com/example/repo/pull/503', pr_status: 'conflicted',
        },
        {
          track: T_DONE_UNMERGED, title: 'PW Test Done Unmerged', lane: 'done', lane_status: 'success',
          ahead: 1, behind: 0, dirty: 0, class: 'mergeable',
          merge_mode: 'direct', pr_number: null, pr_url: null, pr_status: null,
        },
      ]),
      workerId,
    ]);

    // Real `tracks` rows for the done-lane badge half (Task 5) — the
    // Kanban board renders from the `tracks` table, not the worktrees
    // JSONB alone; GET /api/projects/:id/tracks cross-references the two
    // by track_number (see ui/server/index.mjs's worktreeByTrack map).
    await pool.query(
      `INSERT INTO tracks (project_id, track_number, title, lane_status, lane_action_status)
       VALUES ($1, $2, 'PW Test Done Unmerged', 'done', 'success'),
              ($1, $3, 'PW Test Done Fully Merged', 'done', 'success')
       ON CONFLICT (project_id, track_number) DO UPDATE SET lane_status = 'done', title = EXCLUDED.title`,
      [PROJECT_ID, T_DONE_UNMERGED, T_DONE_FULLY_MERGED]
    );
  });

  test.afterAll(async () => {
    await pool.query(`UPDATE workers SET worktrees = $1 WHERE id = $2`, [
      originalWorktrees ? JSON.stringify(originalWorktrees) : null,
      workerId,
    ]);
    await pool.query(
      `DELETE FROM worker_dispatch WHERE action IN ('merge-pr', 'create-pr') AND track_number = ANY($1)`,
      [[T_MERGE_PR_READY, T_CREATE_PR]]
    );
    await pool.query(`DELETE FROM tracks WHERE project_id = $1 AND track_number = ANY($2)`, [
      PROJECT_ID,
      [T_DONE_UNMERGED, T_DONE_FULLY_MERGED],
    ]);
    await pool.end();
  });

  test('Worktrees panel: pr-open row renders badge, PR link, and status indicator (Task 1)', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const projectSelect = page.getByRole('combobox').first();
    await expect(projectSelect).toBeVisible({ timeout: 10000 });
    await projectSelect.selectOption('1');

    const worktreesTab = page.getByRole('button', { name: 'Worktrees' });
    await expect(worktreesTab).toBeVisible({ timeout: 10000 });
    await worktreesTab.click();

    const row = page.locator('[data-testid="worktree-row"]', { hasText: `#${T_MERGE_PR_READY}` });
    await expect(row).toBeVisible({ timeout: 15000 });

    // Merge-mode badge and pr-open classification.
    await expect(row.getByTestId('merge-mode-badge')).toHaveText('PR');
    await expect(row.getByText('PR Open', { exact: true })).toBeVisible();

    // PR link + live checks indicator.
    const prLink = row.getByTestId('pr-link');
    await expect(prLink).toBeVisible();
    await expect(prLink).toHaveText(/PR #501/);
    await expect(prLink).toHaveAttribute('href', 'https://github.com/example/repo/pull/501');
    await expect(row.getByTestId('pr-status-badge')).toContainText('Checks pending');
  });

  test('Worktrees panel: Merge PR dispatches a real worker_dispatch row (Task 2)', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.getByRole('combobox').first().selectOption('1');
    await page.getByRole('button', { name: 'Worktrees' }).click();

    const row = page.locator('[data-testid="worktree-row"]', { hasText: `#${T_MERGE_PR_READY}` });
    await expect(row).toBeVisible({ timeout: 15000 });

    const mergePrBtn = row.getByTestId('merge-pr-btn');
    await expect(mergePrBtn).toBeEnabled();

    // Armed two-click confirm (see WorktreesPanel.jsx's useArmedConfirm) —
    // first click arms, second (while armed) actually fires the dispatch.
    await mergePrBtn.click();
    await expect(mergePrBtn).toHaveText(/Click again to merge PR/);
    await mergePrBtn.click();

    await expect(async () => {
      const { rows } = await pool.query(
        `SELECT id, worker_id, action, payload, track_number FROM worker_dispatch
         WHERE action = 'merge-pr' AND track_number = $1`,
        [T_MERGE_PR_READY]
      );
      expect(rows.length).toBeGreaterThan(0);
    }).toPass({ timeout: 10000 });
  });

  test('Worktrees panel: Create PR dispatches a real worker_dispatch row (Task 3)', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.getByRole('combobox').first().selectOption('1');
    await page.getByRole('button', { name: 'Worktrees' }).click();

    const row = page.locator('[data-testid="worktree-row"]', { hasText: `#${T_CREATE_PR}` });
    await expect(row).toBeVisible({ timeout: 15000 });

    // A pr-open row with no pr_number yet has no PR link/status indicator —
    // just the rescue action.
    await expect(row.getByTestId('pr-link')).toHaveCount(0);
    const createPrBtn = row.getByTestId('create-pr-btn');
    await expect(createPrBtn).toBeEnabled();
    await createPrBtn.click();

    await expect(async () => {
      const { rows } = await pool.query(
        `SELECT id, worker_id, action, payload, track_number FROM worker_dispatch
         WHERE action = 'create-pr' AND track_number = $1`,
        [T_CREATE_PR]
      );
      expect(rows.length).toBeGreaterThan(0);
    }).toPass({ timeout: 10000 });
  });

  test('Worktrees panel: Merge PR is not clickable when checks have failed or the PR conflicts (Task 4)', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.getByRole('combobox').first().selectOption('1');
    await page.getByRole('button', { name: 'Worktrees' }).click();

    for (const [trackNum, expectedStatusText] of [
      [T_CHECKS_FAILED, 'Checks failed'],
      [T_CONFLICTED, 'Conflicts with main'],
    ]) {
      const row = page.locator('[data-testid="worktree-row"]', { hasText: `#${trackNum}` });
      await expect(row).toBeVisible({ timeout: 15000 });
      await expect(row.getByTestId('pr-status-badge')).toContainText(expectedStatusText);
      // No enabled "Merge PR" button rendered at all for these rows —
      // WorktreeRow.jsx renders a disabled, non-interactive span instead
      // (see `isPrOpen && !canCreatePr && !canMergePr`).
      await expect(row.getByTestId('merge-pr-btn')).toHaveCount(0);
      await expect(row.getByText('Merge PR', { exact: true })).toBeVisible();
    }
  });

  test('Done-lane Kanban card: shows Unmerged badge only for a track with a real unmerged worktree row (Task 5)', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.getByRole('combobox').first().selectOption('1');

    const search = page.getByPlaceholder('Search by title or track #…');
    await expect(search).toBeVisible({ timeout: 10000 });

    // The `done`-lane track whose track_number also appears in the seeded
    // workers.worktrees JSONB (class: 'mergeable') shows the badge.
    await search.fill(T_DONE_UNMERGED);
    const unmergedCard = page.locator('[data-testid="track-card"]', { hasText: `#${T_DONE_UNMERGED}` });
    await expect(unmergedCard).toBeVisible({ timeout: 15000 });
    await expect(unmergedCard.getByText('Unmerged', { exact: true })).toBeVisible();

    // A `done`-lane track with NO matching worktree row shows no badge at
    // all — absence is the "really done" signal (see GET /tracks and
    // TrackCard.jsx's UnmergedBadge).
    await search.fill(T_DONE_FULLY_MERGED);
    const mergedCard = page.locator('[data-testid="track-card"]', { hasText: `#${T_DONE_FULLY_MERGED}` });
    await expect(mergedCard).toBeVisible({ timeout: 15000 });
    await expect(mergedCard.getByText('Unmerged', { exact: true })).toHaveCount(0);
    await expect(mergedCard.getByText('Conflict', { exact: true })).toHaveCount(0);
  });
});
