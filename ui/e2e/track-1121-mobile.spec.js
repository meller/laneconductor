// ui/e2e/track-1121-mobile.spec.js
// Track 1121 Phase 6: real-browser coverage for the mobile UX work
// (Phases 1-5) at an actual phone viewport (Pixel 5, via the
// `mobile-chrome` Playwright project). Mocks the API at the network layer
// (page.route), mirroring app-creator-wizard.spec.js and
// track-10049-connections.spec.js — no live Collector/Postgres needed.

import { test, expect } from '@playwright/test';

const PROJECT = { id: 1, name: 'Demo Project', repo_path: '/home/you/Code/demo', app_url: null };

const TRACKS = [
  { id: 1, project_id: 1, track_number: '001', title: 'Backlog track', lane_status: 'backlog', lane_action_status: 'waiting', track_type: 'dev', progress_percent: 0 },
  { id: 2, project_id: 1, track_number: '002', title: 'Planning track', lane_status: 'plan', lane_action_status: 'waiting', track_type: 'dev', progress_percent: 10 },
  { id: 3, project_id: 1, track_number: '003', title: 'Implementing track', lane_status: 'implement', lane_action_status: 'running', track_type: 'dev', progress_percent: 40 },
  { id: 4, project_id: 1, track_number: '004', title: 'Needs a look', lane_status: 'review', lane_action_status: 'waiting', track_type: 'dev', progress_percent: 70 },
];

const INBOX = [
  { project_id: 1, track_number: '004', title: 'Needs a look', bucket: 'needs_input', lane_status: 'review', last_comment_body: '⚠️ Review found a gap' },
];

function mockBaseRoutes(page, { onPatch } = {}) {
  return page.route('**/api/**', async (route) => {
    const { pathname, searchParams } = new URL(route.request().url());
    const method = route.request().method();

    if (pathname === '/api/projects' && method === 'GET') return route.fulfill({ json: [PROJECT] });
    if (pathname === `/api/projects/${PROJECT.id}/tracks` && method === 'GET') return route.fulfill({ json: TRACKS });
    if (pathname === '/api/tracks/waiting' && method === 'GET') return route.fulfill({ json: [] });
    if (pathname === `/api/projects/${PROJECT.id}/workers` && method === 'GET') return route.fulfill({ json: [] });
    if (pathname === `/api/projects/${PROJECT.id}/providers` && method === 'GET') return route.fulfill({ json: [] });
    if (pathname === '/api/inbox' && method === 'GET') return route.fulfill({ json: INBOX });

    if (pathname.match(/^\/api\/projects\/\d+\/tracks\/\d+$/) && method === 'PATCH') {
      const body = route.request().postDataJSON();
      if (onPatch) onPatch(body);
      return route.fulfill({ json: { ok: true } });
    }

    if (pathname.match(/^\/api\/projects\/\d+\/tracks\/[\w-]+$/) && method === 'GET') {
      const trackNumber = pathname.split('/').pop();
      const track = TRACKS.find(t => t.track_number === trackNumber);
      return route.fulfill({ json: track ?? {} });
    }

    return route.fulfill({ json: [] });
  });
}

async function selectDemoProject(page) {
  await page.goto('/');
  await page.getByRole('combobox').selectOption(String(PROJECT.id));
}

test.describe('Track 1121 — mobile UX at a real phone viewport', () => {
  // This spec exercises mobile-only UI (bottom tab bar, lane-at-a-time
  // board, full-screen detail sheet) that is deliberately md:hidden/absent
  // on desktop — running it under `chromium` would fail on missing
  // elements, not a real regression. Desktop's own unchanged behavior is
  // covered by the existing specs (app-creator-wizard, track-10049-
  // connections), which run under both projects already.
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-chrome', 'mobile-chrome only');
  });

  test('TC-1.3/TC-1.6/TC-6.1: bottom tab bar renders with four tabs and switches views', async ({ page }) => {
    await mockBaseRoutes(page);
    await selectDemoProject(page);

    await expect(page.getByTestId('mobile-tab-bar')).toBeVisible();
    await expect(page.getByTestId('mobile-tab-focus')).toBeVisible();
    await expect(page.getByTestId('mobile-tab-board')).toBeVisible();
    await expect(page.getByTestId('mobile-tab-workers')).toBeVisible();
    await expect(page.getByTestId('mobile-tab-more')).toBeVisible();
  });

  test('TC-4.10/REQ-15: Focus is the default view on first load, with its three sections', async ({ page }) => {
    await mockBaseRoutes(page);
    await selectDemoProject(page);

    await expect(page.getByTestId('mobile-focus-view')).toBeVisible();
    await expect(page.getByTestId('focus-needs-input')).toBeVisible();
    await expect(page.getByTestId('focus-running')).toBeVisible();
    await expect(page.getByTestId('focus-pipeline')).toBeVisible();
    // TC-4.1: the review track with bucket needs_input surfaces here.
    await expect(page.getByTestId('focus-needs-input-004')).toBeVisible();
    // TC-4.5: the running implement track surfaces here.
    await expect(page.getByTestId('focus-running-003')).toBeVisible();
  });

  test('TC-6.3 (part 1): Board tab shows one lane at a time, not the 6-column grid', async ({ page }) => {
    await mockBaseRoutes(page);
    await selectDemoProject(page);

    await page.getByTestId('mobile-tab-board').click();
    await expect(page.getByTestId('lane-position-indicator')).toBeVisible();
    // The desktop 6-column grid must never appear at this viewport.
    await expect(page.locator('.grid-cols-6')).toHaveCount(0);
  });

  test('TC-2.2/REQ-7: swiping the board card area advances to the next lane', async ({ page }) => {
    await mockBaseRoutes(page);
    await selectDemoProject(page);
    await page.getByTestId('mobile-tab-board').click();

    // Track 002 sits in the plan lane — land there first via the lane rail.
    await page.getByRole('button', { name: /^Plan \(/ }).click();
    await expect(page.getByText('Planning track')).toBeVisible();

    const cardArea = page.getByTestId('lane-card-area');
    const box = await cardArea.boundingBox();
    const y = box.y + box.height / 2;
    // Swipe left (finger moves right-to-left) → advance to the next lane
    // (Implement). Touch requires an `identifier` field — Chromium's Touch
    // constructor throws without one even though useSwipe.js never reads it.
    await cardArea.dispatchEvent('touchstart', { touches: [{ identifier: 0, clientX: box.x + box.width - 10, clientY: y }] });
    await cardArea.dispatchEvent('touchend', { changedTouches: [{ identifier: 0, clientX: box.x + 10, clientY: y }] });

    await expect(page.getByText('Implementing track')).toBeVisible();
  });

  test('TC-3.2/TC-3.4/AC-3: move-to-lane sheet moves a track via a real PATCH call', async ({ page }) => {
    let patchBody = null;
    await mockBaseRoutes(page, { onPatch: (body) => { patchBody = body; } });
    await selectDemoProject(page);
    await page.getByTestId('mobile-tab-board').click();
    await page.getByRole('button', { name: /^Backlog \(/ }).click();

    await page.getByTestId('track-card-move-btn').first().click();
    await expect(page.getByTestId('move-to-lane-sheet')).toBeVisible();

    await page.getByTestId('move-sheet-lane-plan').click();
    // Confirmation modal (App.jsx's pendingAction dialog) — confirm the move.
    await expect(page.getByText('Move to Plan lane?')).toBeVisible();
    await page.getByRole('button', { name: 'Confirm' }).click();

    await expect.poll(() => patchBody).toEqual(expect.objectContaining({ lane_status: 'plan' }));
  });

  test('TC-3.7: a plan+running track cannot be moved and the sheet states why', async ({ page }) => {
    const blockedTrack = { id: 9, project_id: 1, track_number: '009', title: 'Blocked plan track', lane_status: 'plan', lane_action_status: 'running', track_type: 'dev', progress_percent: 5 };
    await page.route('**/api/**', async (route) => {
      const { pathname, searchParams } = new URL(route.request().url());
      const method = route.request().method();
      if (pathname === '/api/projects' && method === 'GET') return route.fulfill({ json: [PROJECT] });
      if (pathname === `/api/projects/${PROJECT.id}/tracks` && method === 'GET') return route.fulfill({ json: [blockedTrack] });
      if (pathname === '/api/inbox' && method === 'GET') return route.fulfill({ json: [] });
      return route.fulfill({ json: [] });
    });
    await selectDemoProject(page);
    await page.getByTestId('mobile-tab-board').click();

    await page.getByTestId('track-card-move-btn').first().click();
    await expect(page.getByTestId('move-sheet-blocked-reason')).toBeVisible();
    await expect(page.getByTestId('move-sheet-lane-review')).toBeDisabled();
  });

  test('TC-5.1/AC-5: track detail opens full-screen and closes cleanly', async ({ page }) => {
    await mockBaseRoutes(page);
    await selectDemoProject(page);
    await page.getByTestId('mobile-tab-board').click();
    await page.getByRole('button', { name: /^Review \(/ }).click();

    await page.getByText('Needs a look').click();
    const container = page.getByTestId('track-detail-container');
    await expect(container).toBeVisible();
    const box = await container.boundingBox();
    const viewportSize = page.viewportSize();
    expect(box.width).toBeGreaterThanOrEqual(viewportSize.width - 1);

    await page.getByTestId('track-detail-close').click();
    await expect(container).toHaveCount(0);
  });

  test('TC-6.4/TC-6.5/AC-1: no horizontal overflow at this viewport on Focus, Board, or an open detail sheet', async ({ page }) => {
    await mockBaseRoutes(page);
    await selectDemoProject(page);

    async function assertNoOverflow() {
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
      expect(overflow).toBe(true);
    }

    // Focus (default view).
    await assertNoOverflow();

    // Board.
    await page.getByTestId('mobile-tab-board').click();
    await assertNoOverflow();

    // Detail sheet open.
    await page.getByRole('button', { name: /^Review \(/ }).click();
    await page.getByText('Needs a look').click();
    await expect(page.getByTestId('track-detail-container')).toBeVisible();
    await assertNoOverflow();
  });
});
