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

test.describe.serial('Track 1112 Phase 7: Worktrees panel', () => {
  let pool;
  let workerId;
  let originalWorktrees;

  test.beforeAll(async () => {
    pool = new pg.Pool({ connectionString: DB_URL });
    // Reuse this project's own registered worker rather than inserting a
    // fake one — worker rows have several NOT NULL/FK constraints (hostname
    // uniqueness, machine_token) that aren't this test's concern.
    const { rows } = await pool.query(
      `SELECT id, worktrees FROM workers WHERE project_id = $1 ORDER BY last_heartbeat DESC LIMIT 1`,
      [PROJECT_ID]
    );
    if (!rows.length) throw new Error('No registered worker for project 1 — start one first (lc worker start)');
    workerId = rows[0].id;
    originalWorktrees = rows[0].worktrees;

    await pool.query(`UPDATE workers SET worktrees = $1, last_heartbeat = NOW() WHERE id = $2`, [
      JSON.stringify([
        { track: '19999', title: 'PW Test Mergeable', lane: 'done', lane_status: 'success', ahead: 1, behind: 0, dirty: 0, class: 'mergeable' },
        { track: '19998', title: 'PW Test Stranded', lane: 'quality-gate', lane_status: 'queue', ahead: 2, behind: 5, dirty: null, class: 'stranded' },
      ]),
      workerId,
    ]);
  });

  test.afterAll(async () => {
    await pool.query(`UPDATE workers SET worktrees = $1 WHERE id = $2`, [
      originalWorktrees ? JSON.stringify(originalWorktrees) : null,
      workerId,
    ]);
    await pool.query(`DELETE FROM worker_dispatch WHERE action = 'merge-worktree' AND track_number = '19999'`);
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

    // Poll: the panel fetches on a 10s interval, so give it a beat.
    await expect(page.getByText('#19999')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('#19998')).toBeVisible();
    // exact: true matters — "Mergeable" (the badge) is otherwise a substring
    // match of "PW Test Mergeable" (the seeded title) too.
    await expect(page.getByText('Mergeable', { exact: true })).toBeVisible();
    await expect(page.getByText('Stranded', { exact: true })).toBeVisible();

    // The mergeable row's card should have an enabled "Merge to main" button.
    const mergeableCard = page.locator('[data-testid="worktree-row"]', { hasText: '#19999' });
    const mergeBtn = mergeableCard.getByTestId('merge-to-main-btn');
    await expect(mergeBtn).toBeEnabled();
    await mergeBtn.click();

    // Real API round-trip: a worker_dispatch row must actually exist now.
    await expect(async () => {
      const { rows } = await pool.query(
        `SELECT id, worker_id, action, payload FROM worker_dispatch WHERE action = 'merge-worktree' AND track_number = '19999'`
      );
      expect(rows.length).toBeGreaterThan(0);
    }).toPass({ timeout: 10000 });
  });
});
