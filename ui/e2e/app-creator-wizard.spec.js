// ui/e2e/app-creator-wizard.spec.js
// Track AM-1119 Phase 6 (Task 1, TC-15): full wizard walk-through in a real
// browser → Launch → FollowBuildView visible with the generated track list.
//
// Mocks the API at the network layer (page.route) rather than running a
// live Collector/Postgres — this spec proves the UI's own navigation,
// validation, and payload-shape contract, the same thing the mock-collector
// pattern in conductor/tests/ proves for the worker side (see
// track-1119-phase3-track-generation.test.mjs for that half).

import { test, expect } from '@playwright/test';

const NEW_PROJECT_PATH = '/home/you/Code/digger-game';
const MANAGER_WORKER = { id: 1, hostname: 'test-machine', type: 'manager', project_id: null, status: 'idle', last_heartbeat: new Date().toISOString() };

test('wizard walk-through → Launch → FollowBuildView shows the generated track list', async ({ page }) => {
  let dispatchStatus = 'pending';
  const dispatchCalls = [];

  await page.route('**/api/**', async (route) => {
    const { pathname } = new URL(route.request().url());
    const method = route.request().method();

    if (pathname === '/api/projects' && method === 'GET') {
      const body = dispatchStatus === 'done'
        ? [{ id: 99, name: 'Digger Game', repo_path: NEW_PROJECT_PATH, app_url: null }]
        : [];
      return route.fulfill({ json: body });
    }
    if (pathname === '/api/tracks' && method === 'GET') return route.fulfill({ json: [] });
    if (pathname === '/api/tracks/waiting' && method === 'GET') return route.fulfill({ json: [] });
    if (pathname === '/api/workers' && method === 'GET') return route.fulfill({ json: [MANAGER_WORKER] });

    if (pathname === '/api/dispatch/create-project' && method === 'POST') {
      dispatchCalls.push(route.request().postDataJSON());
      dispatchStatus = 'pending';
      // Real create-project is async (scaffold, deploy config, track
      // generation all happen before the worker reports back) — simulate
      // that gap instead of resolving instantly, so the test also proves
      // the modal's "scaffolding…" interim state renders.
      setTimeout(() => { dispatchStatus = 'done'; }, 500);
      return route.fulfill({ json: { ok: true, id: 555 } });
    }
    if (pathname === '/api/dispatch/555' && method === 'GET') {
      return route.fulfill({
        json: {
          id: 555,
          status: dispatchStatus,
          result: dispatchStatus === 'done'
            ? `Created at ${NEW_PROJECT_PATH}\nGenerated tracks: AM-1000-app-skeleton, AM-1001-core-feature-dig-for-ore, AM-1002-deploy-to-firebase-hosting`
            : null,
        },
      });
    }
    if (pathname === '/api/projects/99/tracks' && method === 'GET') {
      return route.fulfill({
        json: [
          { track_number: '1000', title: 'App Skeleton', lane_status: 'implement', waiting_for_reply: false },
          { track_number: '1001', title: 'Core Feature: Dig for ore, avoid hazards', lane_status: 'plan', waiting_for_reply: false },
          { track_number: '1002', title: 'Deploy to Firebase Hosting', lane_status: 'plan', waiting_for_reply: false },
        ],
      });
    }

    // Credential-status check, websocket-adjacent polling, anything else
    // this spec doesn't care about — harmless default so unrelated app
    // startup requests don't fail the whole page load.
    return route.fulfill({ json: [] });
  });

  await page.goto('/');

  await page.getByTitle('New Project').click();
  await page.getByText('Guided wizard').click();

  // Step 1: Basics
  await page.getByPlaceholder('e.g. Digger Game').fill('Digger Game');
  await page.getByPlaceholder('/home/you/Code/digger-game').fill(NEW_PROJECT_PATH);
  await page.getByTestId('wizard-next-button').click();

  // Step 2: Product
  await page.getByPlaceholder(/2D digging\/mining game/).fill('Dig for ore, avoid hazards');
  await page.getByTestId('wizard-next-button').click();

  // Step 3: Design & Stack — optional, skip
  await page.getByTestId('wizard-next-button').click();

  // Step 4: Connections (Track TU-10049) — optional, skip
  await expect(page.getByTestId('connections-source_control')).toBeVisible();
  await page.getByTestId('wizard-next-button').click();

  // Step 5: Deployment — Firebase Hosting + prod
  await page.getByText('Firebase Hosting').click();
  await page.getByText('prod', { exact: true }).click();
  await page.getByTestId('wizard-next-button').click();

  // Step 6: Review & Launch
  await expect(page.getByText(/Dig for ore, avoid hazards/)).toBeVisible();
  await page.getByTestId('wizard-next-button').click(); // Launch

  // Interim "scaffolding…" state before the mocked dispatch resolves.
  await expect(page.getByText(/Scaffolding project/i)).toBeVisible();

  // FollowBuildView takes over once the dispatch resolves done.
  await expect(page.getByTestId('follow-build-view')).toBeVisible({ timeout: 5000 });
  await expect(page.getByTestId('follow-build-track-1000')).toContainText('App Skeleton');
  await expect(page.getByTestId('follow-build-track-1002')).toContainText('Deploy to Firebase Hosting');

  expect(dispatchCalls).toHaveLength(1);
  expect(dispatchCalls[0].payload.repo_source).toEqual({ type: 'path', value: NEW_PROJECT_PATH });
  expect(dispatchCalls[0].payload.wizard.deployment).toEqual({ provider: 'firebase', environments: ['prod'] });
  expect(dispatchCalls[0].payload.scaffold_context.project.name).toBe('Digger Game');
});
