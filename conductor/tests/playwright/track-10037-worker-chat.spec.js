// conductor/tests/playwright/track-10037-worker-chat.spec.js
// E2E test: Track 10037 — worker strip active-first ordering + running/last
// track chips, and the worker chat panel sending a real comment through the
// same POST .../comments endpoint the Conversation tab uses (not the old
// worker_dispatch mailbox). Follows the exact pattern established by
// track-10024-worktree-running-transcript.spec.js: seeds real `workers` /
// `tracks` / `track_sessions` rows via direct DB write, drives the real UI,
// cleans up in afterAll.
//
// Deterministic: no LLM calls, no dependence on a live heartbeat worker
// claiming a lane action — fast tier. The synthetic worker row is a fixture
// only (distinct hostname, fake high track numbers) — it never actually
// runs anything, so there's nothing for a real worker to claim or conflict
// with.
//
// Prerequisites:
//   - UI running at localhost:8090 (make ui-start)
//   - API running at localhost:8091 (make api-start), running code that
//     includes this track's changes (restart after pulling them)
//
// Run: npx playwright test conductor/tests/playwright/track-10037-worker-chat.spec.js --project=fast

import { test, expect } from '@playwright/test';
import pg from 'pg';

const DB_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/laneconductor';
const PROJECT_ID = 1; // laneconductor's own project row

if (process.env.PW_BASE_URL) test.use({ baseURL: process.env.PW_BASE_URL });

// Fake track numbers, distinct from other specs' ranges (10018: 19986-19993,
// 1112: 19998/19999, 10024: 19984/19985).
const T_RUNNING = '19972';
const T_LAST = '19971';
const WORKER_HOSTNAME = 'pw-e2e-worker-10037';
const FIXTURE_SESSION_ID = '00000000-0000-4000-8000-000000010037';

test.describe.serial('Track 10037: worker strip running/last-track chips + chat panel', () => {
  let pool;
  let workerId;

  test.beforeAll(async () => {
    pool = new pg.Pool({ connectionString: DB_URL });

    await pool.query(
      `INSERT INTO tracks (project_id, track_number, title, lane_status, lane_action_status)
       VALUES ($1, $2, 'PW 10037 Running', 'implement', 'running'),
              ($1, $3, 'PW 10037 Last Context', 'done', 'success')
       ON CONFLICT (project_id, track_number) DO UPDATE SET lane_status = EXCLUDED.lane_status, title = EXCLUDED.title`,
      [PROJECT_ID, T_RUNNING, T_LAST]
    );

    const { rows } = await pool.query(
      `INSERT INTO workers (project_id, hostname, pid, worker_number, mode, type, status, current_task, last_heartbeat)
       VALUES ($1, $2, 999837, 77, 'sync+poll', 'project', 'busy', $3, NOW())
       ON CONFLICT (project_id, hostname, worker_number) DO UPDATE SET status = EXCLUDED.status, current_task = EXCLUDED.current_task, last_heartbeat = NOW()
       RETURNING id`,
      [PROJECT_ID, WORKER_HOSTNAME, `implement track ${T_RUNNING}`]
    );
    workerId = rows[0].id;

    await pool.query(
      `INSERT INTO track_sessions (track_number, worker_id, claude_session_id, last_used_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (track_number, worker_id) DO UPDATE SET last_used_at = NOW()`,
      [T_LAST, workerId, FIXTURE_SESSION_ID]
    );
  });

  test.afterAll(async () => {
    await pool.query(`DELETE FROM track_sessions WHERE worker_id = $1`, [workerId]);
    await pool.query(`DELETE FROM workers WHERE id = $1`, [workerId]);
    await pool.query(`DELETE FROM tracks WHERE project_id = $1 AND track_number IN ($2, $3)`, [PROJECT_ID, T_RUNNING, T_LAST]);
    await pool.end();
  });

  async function openLanesStripFor(page) {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    const projectSelect = page.getByRole('combobox').first();
    await expect(projectSelect).toBeVisible({ timeout: 10000 });
    await projectSelect.selectOption(String(PROJECT_ID));
    const stripItem = page.locator('[data-testid="worker-strip-item"]', { hasText: WORKER_HOSTNAME });
    await expect(stripItem).toBeVisible({ timeout: 15000 });
    return stripItem;
  }

  test('AC-2: running-track chip shows the track number and deep-dives into it', async ({ page }) => {
    const stripItem = await openLanesStripFor(page);

    await expect(stripItem.getByTestId('worker-running-track-chip')).toContainText(T_RUNNING);
    await stripItem.getByTestId('worker-running-track-chip').click();
    await expect(page.getByRole('heading', { name: 'PW 10037 Running' })).toBeVisible({ timeout: 10000 });
  });

  test('AC-3: last-track chip shows the last-context track and opens chat pre-scoped to it', async ({ page }) => {
    const stripItem = await openLanesStripFor(page);

    await expect(stripItem.getByTestId('worker-last-track-chip')).toContainText(T_LAST);
    await stripItem.getByTestId('worker-last-track-chip').click();

    await expect(page.getByTestId('worker-chat-panel')).toBeVisible();
    await expect(page.getByTestId('worker-chat-track-link')).toContainText(T_LAST);
  });

  test('AC-4 (UI half): sending a message from the chat panel creates a real track_comments row via the comments endpoint', async ({ page }) => {
    const stripItem = await openLanesStripFor(page);
    await stripItem.getByTestId('worker-chat-btn-strip').click();

    await expect(page.getByTestId('worker-chat-panel')).toBeVisible();
    // Default target resolution (no forced track) prefers the running track.
    await expect(page.getByTestId('worker-chat-track-link')).toContainText(T_RUNNING);

    const message = `pw-10037-e2e ${Date.now()}`;
    await page.getByTestId('worker-chat-input').fill(message);
    await page.getByTestId('worker-chat-send').click();

    await expect(page.getByText(message)).toBeVisible({ timeout: 10000 });

    const { rows } = await pool.query(
      `SELECT tc.body, tc.author FROM track_comments tc
       JOIN tracks t ON t.id = tc.track_id
       WHERE t.project_id = $1 AND t.track_number = $2 AND tc.body = $3`,
      [PROJECT_ID, T_RUNNING, message]
    );
    expect(rows.length).toBe(1);
    expect(rows[0].author).toBe('human');
  });
});
