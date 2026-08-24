// conductor/tests/playwright/track-10024-worktree-running-transcript.spec.js
// E2E test: Track 10024 — a Worktrees panel row in a running state gets a
// clickable "Running…" badge (and its existing #<track> ↗ link) that opens
// TrackDetailPanel for that track WITH the Live Transcript drawer already
// expanded, reusing the existing per-track transcript mechanism (Track 1087
// Phase 4) — no worker join, no new API endpoint. Follows the exact pattern
// established by track-1112-worktree-panel.spec.js / track-10018's spec:
// seeds a real worker.worktrees JSONB row via direct DB write (the heartbeat
// payload's own shape), plus a real `tracks` row so the detail panel's
// header populates, then drives the real UI.
//
// Deterministic: no LLM calls, no dependence on a live heartbeat worker
// claiming a lane action — fast tier.
//
// Prerequisites:
//   - UI running at localhost:8090 (make ui-start)
//   - API running at localhost:8091 (make api-start), running code that
//     includes this track's changes (restart after pulling them)
//
// Run: npx playwright test conductor/tests/playwright/track-10024-worktree-running-transcript.spec.js --project=fast

import { test, expect } from '@playwright/test';
import pg from 'pg';

const DB_URL = process.env.DATABASE_URL || '***REMOVED-SECRET-NEON-CREDENTIAL***:5432/laneconductor';
const PROJECT_ID = 1; // laneconductor's own project row

// PW_BASE_URL lets this spec target an isolated scratch UI/API instance
// (see vite.config.js's SCRATCH_API_PORT) instead of the shared dev
// instance the rest of this repo's fast tier assumes — useful when running
// from a worktree branch whose changes the shared instance doesn't have
// checked out. Defaults to the shared instance, matching every other spec.
if (process.env.PW_BASE_URL) test.use({ baseURL: process.env.PW_BASE_URL });

// Fake track numbers, distinct from track-1112's (19998/19999) and
// track-10018's (19986-19993).
const T_RUNNING = '19985'; // lane_status: running -> should show the clickable badge
const T_IDLE = '19984'; // lane_status: queue -> control, no badge

test.describe.serial('Track 10024: Worktrees panel running-row -> Live Transcript deep link', () => {
  let pool;
  let workerId;
  let originalWorktrees;

  test.beforeAll(async () => {
    pool = new pg.Pool({ connectionString: DB_URL });
    // Prefer the dedicated synthetic fixture worker (see track-10018's spec
    // for why: this dev project has real live workers heartbeating every few
    // seconds, each overwriting its own row's `worktrees` from a real git
    // audit — seeding one of those loses the race before the page loads).
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
        { track: T_RUNNING, title: 'PW Test Running', lane: 'implement', lane_status: 'running', ahead: 1, behind: 0, dirty: 1, class: 'open', merge_mode: 'direct' },
        { track: T_IDLE, title: 'PW Test Idle', lane: 'implement', lane_status: 'queue', ahead: 1, behind: 0, dirty: 0, class: 'open', merge_mode: 'direct' },
      ]),
      workerId,
    ]);

    // Real `tracks` rows so TrackDetailPanel's header (title, lane badge)
    // populates from a real GET, matching how a user would actually arrive.
    await pool.query(
      `INSERT INTO tracks (project_id, track_number, title, lane_status, lane_action_status)
       VALUES ($1, $2, 'PW Test Running', 'implement', 'running'),
              ($1, $3, 'PW Test Idle', 'implement', 'queue')
       ON CONFLICT (project_id, track_number) DO UPDATE SET lane_status = EXCLUDED.lane_status, title = EXCLUDED.title`,
      [PROJECT_ID, T_RUNNING, T_IDLE]
    );
  });

  test.afterAll(async () => {
    await pool.query(`UPDATE workers SET worktrees = $1 WHERE id = $2`, [
      originalWorktrees ? JSON.stringify(originalWorktrees) : null,
      workerId,
    ]);
    await pool.query(`DELETE FROM tracks WHERE project_id = $1 AND track_number IN ($2, $3)`, [PROJECT_ID, T_RUNNING, T_IDLE]);
    await pool.end();
  });

  test('TC-15/16: running row has a clickable badge that opens the track detail with the transcript drawer already visible', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const projectSelect = page.getByRole('combobox').first();
    await expect(projectSelect).toBeVisible({ timeout: 10000 });
    await projectSelect.selectOption('1');

    const worktreesTab = page.getByRole('button', { name: 'Worktrees' });
    await expect(worktreesTab).toBeVisible({ timeout: 10000 });
    await worktreesTab.click();

    // Poll: the panel fetches on a 10s interval, so give it a beat.
    await expect(page.getByText(`#${T_RUNNING}`)).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(`#${T_IDLE}`)).toBeVisible();

    const runningCard = page.locator('[data-testid="worktree-row"]', { hasText: `#${T_RUNNING}` });
    const idleCard = page.locator('[data-testid="worktree-row"]', { hasText: `#${T_IDLE}` });

    // TC-15: badge present on the running row, absent on the idle control row.
    await expect(runningCard.getByTestId('worktree-running-badge')).toBeVisible();
    await expect(idleCard.getByTestId('worktree-running-badge')).not.toBeAttached();

    // TC-16: clicking it opens the track detail slide-over on the right
    // track, with the Live Transcript drawer already visible — no further
    // click needed.
    await runningCard.getByTestId('worktree-running-badge').click();
    await expect(page.getByRole('heading', { name: 'PW Test Running' })).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Live Transcript')).toBeVisible();
  });

  test('TC-17: idle row\'s #<track> ↗ link opens the track detail with the transcript drawer closed', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const projectSelect = page.getByRole('combobox').first();
    await expect(projectSelect).toBeVisible({ timeout: 10000 });
    await projectSelect.selectOption('1');

    const worktreesTab = page.getByRole('button', { name: 'Worktrees' });
    await expect(worktreesTab).toBeVisible({ timeout: 10000 });
    await worktreesTab.click();
    await expect(page.getByText(`#${T_IDLE}`)).toBeVisible({ timeout: 15000 });

    const idleCard = page.locator('[data-testid="worktree-row"]', { hasText: `#${T_IDLE}` });
    await idleCard.getByText(`#${T_IDLE}`, { exact: false }).click();

    // "PW Test Idle" also appears in the still-visible Worktrees card behind
    // the slide-over — scope to the detail panel's own heading.
    await expect(page.getByRole('heading', { name: 'PW Test Idle' })).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Live Transcript')).not.toBeVisible();
  });
});
