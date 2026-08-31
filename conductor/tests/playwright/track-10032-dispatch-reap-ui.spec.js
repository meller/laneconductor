// conductor/tests/playwright/track-10032-dispatch-reap-ui.spec.js
// E2E test: Track 10032 — a claim-timeout reap (track 1102 F18's
// reapStaleDispatches()) now writes durable reaped_at/reap_reason columns
// and posts a system ⚠️/❌ comment (this track's Phases 1-2). This spec
// proves the two rendering surfaces actually show it: TrackDetailPanel's
// dispatch history strip (Phase 3), the Inbox's "Needs your input" bucket
// (Phase 2), and CICDView's project-level dispatch history for a
// track_number IS NULL dispatch (Phase 4).
//
// Follows track-1112-worktree-panel.spec.js / track-10024-*.spec.js's
// established pattern: seed real DB rows via direct SQL against project 1's
// own registered worker, drive the real UI, clean up in afterAll.
//
// Deterministic: no LLM calls, no dependence on a live heartbeat worker
// claiming a lane action — fast tier (not added to SLOW_SPECS).
//
// Prerequisites:
//   - UI running at localhost:8090 (make ui-start)
//   - API running at localhost:8091 (make api-start), running code that
//     includes this track's changes (restart after pulling them — the API
//     does not hot-reload, and the reaped_at/reap_reason columns only exist
//     after a boot that ran runMigration() for 011_dispatch_reap.sql)
//
// Run: npx playwright test conductor/tests/playwright/track-10032-dispatch-reap-ui.spec.js --project=fast

import { test, expect } from '@playwright/test';
import pg from 'pg';

const DB_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/laneconductor';
const PROJECT_ID = 1; // laneconductor's own project row

if (process.env.PW_BASE_URL) test.use({ baseURL: process.env.PW_BASE_URL });

// Fake track numbers, distinct from other specs' fixture ranges
// (track-1112: 19998/19999, track-10018: 19986-19993, track-10024: 19984/19985).
const T_REASSIGNED = '19980'; // reap_reason set, status stays 'pending' -> amber ⟳
const T_UNREAPED_CONTROL = '19981'; // ordinary done dispatch -> unchanged ✓ rendering (AC-6)

test.describe.serial('Track 10032: reap outcome surfaced in TrackDetailPanel, Inbox, and CICDView', () => {
  let pool;
  let workerId;
  let reassignedDispatchId;
  let deployDispatchId;
  let deployReassignedDispatchId;

  test.beforeAll(async () => {
    pool = new pg.Pool({ connectionString: DB_URL });
    // Prefer the dedicated synthetic fixture worker (see track-10024's spec
    // for why: real live workers heartbeat every few seconds and would race
    // any seeded worker-scoped state).
    let { rows } = await pool.query(
      `SELECT id FROM workers WHERE project_id = $1 AND hostname = 'pw-e2e-worker' LIMIT 1`,
      [PROJECT_ID]
    );
    if (!rows.length) {
      ({ rows } = await pool.query(
        `SELECT id FROM workers WHERE project_id = $1 ORDER BY last_heartbeat DESC LIMIT 1`,
        [PROJECT_ID]
      ));
    }
    if (!rows.length) throw new Error('No registered worker for project 1 — start one first (lc worker start)');
    workerId = rows[0].id;

    await pool.query(
      `INSERT INTO tracks (project_id, track_number, title, lane_status, lane_action_status)
       VALUES ($1, $2, 'PW Test Reassigned', 'implement', 'queue'),
              ($1, $3, 'PW Test Unreaped Control', 'implement', 'queue')
       ON CONFLICT (project_id, track_number) DO UPDATE SET lane_status = EXCLUDED.lane_status, title = EXCLUDED.title`,
      [PROJECT_ID, T_REASSIGNED, T_UNREAPED_CONTROL]
    );

    // A reassigned-and-reaped dispatch: status stays 'pending', reaped_at/
    // reap_reason set — this is the row that's otherwise indistinguishable
    // from a healthy pending dispatch (the bug this track fixes).
    const reassigned = await pool.query(
      `INSERT INTO worker_dispatch (worker_id, track_number, action, status, created_at, reaped_at, reap_reason)
       VALUES ($1, $2, 'implement', 'pending', NOW() - INTERVAL '10 minutes', NOW(),
               'reassigned from worker 111 to worker 222 after 300s unclaimed')
       RETURNING id`,
      [workerId, T_REASSIGNED]
    );
    reassignedDispatchId = reassigned.rows[0].id;

    // An ordinary, never-reaped dispatch on the control track — proves
    // AC-6's existing rendering is untouched.
    await pool.query(
      `INSERT INTO worker_dispatch (worker_id, track_number, action, status, created_at, result)
       VALUES ($1, $2, 'implement', 'done', NOW() - INTERVAL '5 minutes', 'ok')`,
      [workerId, T_UNREAPED_CONTROL]
    );

    // The Inbox comment a real reap would have posted (Phase 2) — this spec
    // seeds it directly rather than calling reapStaleDispatches() itself,
    // since that path is already covered by the mocked-pool and real-DB
    // supertest suites; this file's job is only to prove it *renders*.
    await pool.query(
      `INSERT INTO track_comments (track_id, author, body, is_replied)
       SELECT id, 'system', '⚠️ Dispatch implement was unclaimed for over 300s — worker 111 appears dead; reassigned to worker 222.', false
       FROM tracks WHERE project_id = $1 AND track_number = $2`,
      [PROJECT_ID, T_REASSIGNED]
    );

    // A reaped, project-level (track_number IS NULL) deploy dispatch —
    // CICDView's DispatchHistory is its only surface (Phase 4); it has no
    // track to comment on. Failed branch (no replacement worker) — keeps
    // the existing red ✗ per Task 3.1, with reap_reason as the text.
    const deploy = await pool.query(
      `INSERT INTO worker_dispatch (worker_id, track_number, action, status, payload, created_at, result, reaped_at, reap_reason)
       VALUES ($1, NULL, 'deploy', 'failed', $2::jsonb, NOW() - INTERVAL '10 minutes',
               'timeout: unclaimed for over 300s and no other live worker was available to reassign to',
               NOW(),
               'timeout: unclaimed for over 300s and no other live worker was available to reassign to')
       RETURNING id`,
      [workerId, JSON.stringify({ environment: 'prod' })]
    );
    deployDispatchId = deploy.rows[0].id;

    // A second project-level dispatch, this time reassigned (still
    // 'pending') — proves CICDView also renders the amber ⟳ case, not just
    // the failed/✗ one above.
    const deployReassigned = await pool.query(
      `INSERT INTO worker_dispatch (worker_id, track_number, action, status, payload, created_at, reaped_at, reap_reason)
       VALUES ($1, NULL, 'deploy', 'pending', $2::jsonb, NOW() - INTERVAL '10 minutes', NOW(),
               'reassigned from worker 111 to worker 222 after 300s unclaimed')
       RETURNING id`,
      [workerId, JSON.stringify({ environment: 'staging' })]
    );
    deployReassignedDispatchId = deployReassigned.rows[0].id;
  });

  test.afterAll(async () => {
    await pool.query(`DELETE FROM worker_dispatch WHERE id = ANY($1::int[])`, [
      [reassignedDispatchId, deployDispatchId, deployReassignedDispatchId].filter(Boolean),
    ]);
    await pool.query(`DELETE FROM worker_dispatch WHERE worker_id = $1 AND track_number = $2`, [workerId, T_UNREAPED_CONTROL]);
    await pool.query(`DELETE FROM tracks WHERE project_id = $1 AND track_number IN ($2, $3)`, [PROJECT_ID, T_REASSIGNED, T_UNREAPED_CONTROL]);
    await pool.end();
  });

  test('TC-4.1/TC-4.3: track detail panel shows the amber reassignment line and leaves an unreaped row unchanged', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const projectSelect = page.getByRole('combobox').first();
    await expect(projectSelect).toBeVisible({ timeout: 10000 });
    await projectSelect.selectOption(String(PROJECT_ID));

    // Open the reassigned track's detail panel from its board card — scoped
    // to [data-testid="track-card"] (TrackCard.jsx) rather than plain text,
    // since the track's own title/number also appear duplicated in the
    // Inbox once it's open (same DOM, overlaid), which makes an unscoped
    // text locator ambiguous.
    const reassignedCard = page.locator('[data-testid="track-card"]', { hasText: 'PW Test Reassigned' });
    await expect(reassignedCard).toBeVisible({ timeout: 10000 });
    await reassignedCard.click();

    await expect(page.getByRole('heading', { name: 'PW Test Reassigned' })).toBeVisible({ timeout: 10000 });

    const reapedRow = page.getByTestId(`dispatch-reaped-${reassignedDispatchId}`);
    await expect(reapedRow).toBeVisible({ timeout: 10000 });
    await expect(reapedRow).toContainText('⟳');
    await expect(reapedRow).toContainText('reassigned from worker 111 to worker 222');

    await page.keyboard.press('Escape');
    await expect(page.getByRole('heading', { name: 'PW Test Reassigned' })).not.toBeVisible({ timeout: 10000 });

    // TC-4.3 (AC-6): control track's ordinary dispatch still renders as
    // '✓ done', with no reaped marker and no data-testid for it.
    const controlCard = page.locator('[data-testid="track-card"]', { hasText: 'PW Test Unreaped Control' });
    await expect(controlCard).toBeVisible({ timeout: 10000 });
    await controlCard.click();

    await expect(page.getByRole('heading', { name: 'PW Test Unreaped Control' })).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('— ok', { exact: false })).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-testid^="dispatch-reaped-"]')).toHaveCount(0);
  });

  test('TC-4.4: the Inbox lists the reassigned track under "Needs your input"', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const projectSelect = page.getByRole('combobox').first();
    await expect(projectSelect).toBeVisible({ timeout: 10000 });
    await projectSelect.selectOption(String(PROJECT_ID));

    await page.getByRole('button', { name: /Inbox/i }).first().click();
    // Scoped to the slide-over itself — the board behind it also renders
    // this same track's title/number on its card, so an unscoped locator
    // would be ambiguous (and, for a click, would resolve to the occluded
    // card instead of the Inbox row).
    const inboxPanel = page.locator('div.fixed.top-0.right-0.h-full.z-50');
    await expect(inboxPanel.getByText('Needs your input')).toBeVisible({ timeout: 10000 });
    await expect(inboxPanel.getByText(`#${T_REASSIGNED}`).first()).toBeVisible();
    await expect(inboxPanel.getByText(/appears dead; reassigned to worker 222/)).toBeVisible();
  });

  test('TC-4.5: CI/CD view shows the reaped marker for a project-level deploy dispatch', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const projectSelect = page.getByRole('combobox').first();
    await expect(projectSelect).toBeVisible({ timeout: 10000 });
    await projectSelect.selectOption(String(PROJECT_ID));

    const cicdTab = page.getByRole('button', { name: /CI\/CD/i });
    await expect(cicdTab).toBeVisible({ timeout: 10000 });
    await cicdTab.click();

    const releaseTab = page.getByRole('button', { name: /Release/i });
    if (await releaseTab.isVisible().catch(() => false)) {
      await releaseTab.click();
    }

    // This fixture's deploy dispatch was seeded with status='failed' (a
    // realistic outcome for a deploy with no replacement worker to
    // reassign to) — Task 3.1's rule keeps the marker red '✗' for a failed
    // row even though reap_reason is set (only a still-pending reassignment
    // gets the amber '⟳'; see the TrackDetailPanel test above for that
    // case). What this asserts is that reap_reason's text — the copy that
    // survives a later PATCH, unlike `result` — actually renders here, the
    // one surface a track_number-less dispatch has at all (AC-4).
    const deployRow = page.getByTestId(`dispatch-reaped-${deployDispatchId}`);
    await expect(deployRow).toBeVisible({ timeout: 10000 });
    await expect(deployRow).toContainText('✗');
    await expect(deployRow).toContainText('timeout: unclaimed for over 300s');

    // The reassigned (still-pending) sibling dispatch — the amber ⟳ case,
    // matching TrackDetailPanel's treatment for the same underlying state.
    const deployReassignedRow = page.getByTestId(`dispatch-reaped-${deployReassignedDispatchId}`);
    await expect(deployReassignedRow).toBeVisible({ timeout: 10000 });
    await expect(deployReassignedRow).toContainText('⟳');
    await expect(deployReassignedRow).toContainText('reassigned from worker 111 to worker 222');
  });
});
