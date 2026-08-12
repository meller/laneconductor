// conductor/tests/playwright/worker-identity.spec.js
// E2E tests for Track 1033: Worker Identity & API Keys UI
//
// Tests:
//   1. Config panel shows API Keys section
//   2. Generate a new API key — key is shown once in banner
//   3. Generated key appears in key list (prefix only)
//   4. Key can be revoked
//   5. Worker card shows visibility badge
//   6. Clicking visibility badge opens sharing dialog
//   7. Changing visibility updates badge
//
// Prerequisites:
//   - UI running at localhost:8090
//   - API running at localhost:8091
//
// Run: npx playwright test conductor/tests/playwright/worker-identity.spec.js

import { test, expect } from '@playwright/test';

const BASE = 'http://localhost:8090';
const API  = 'http://localhost:8091';

// Track 1100 Phase 2: the three visibility tests below used to guard on
// `GET /api/workers` being non-empty and otherwise skip. That guard was wrong
// in both directions:
//
//   - `/api/workers` is the global list and includes *manager* workers, whose
//     project_id is NULL by design (track 1091). The Workers grid, however,
//     deliberately renders its "No Active Workers" empty state unless a
//     non-manager worker exists (`hasOwnWorkers` in WorkersList.jsx). So on a
//     machine running only a manager — the normal state of this repo — the
//     guard saw 1 worker, declined to skip, and the assertions then failed
//     against an empty state. That is what the 3 known failures were: a stale
//     precondition, NOT an app regression. Verified 2026-08-12 by seeding a
//     project worker and re-running: all 3 pass unchanged.
//   - Even when correct, "skip unless a worker happens to be running" makes
//     these tests ambient-dependent, so they prove nothing on a clean machine.
//
// Fix: seed a dedicated project-scoped worker over the same registration
// endpoint a real worker uses. Deterministic, no skips, no dependence on
// whatever happens to be running locally.
const FIXTURE_HOSTNAME = 'pw-e2e-worker';
const FIXTURE_WORKER_NUMBER = 99;

/** Resolve a project id by name (don't hardcode — ids differ per machine). */
async function resolveProjectId(request, name = 'laneconductor') {
  const r = await request.get(`${API}/api/projects`);
  expect(r.ok(), 'GET /api/projects should succeed').toBeTruthy();
  const projects = await r.json();
  const p = projects.find(x => x.name === name);
  expect(p, `project "${name}" should exist in the collector`).toBeTruthy();
  return p.id;
}

/**
 * Register a project-scoped worker so the Workers grid has a card to render,
 * and force it to a known visibility.
 *
 * Upserts on (project_id, hostname, worker_number), so repeat runs reuse the
 * same row rather than accumulating. It ages out of GET /api/workers' 60s
 * heartbeat-freshness window on its own once the run finishes.
 *
 * The explicit PATCH is NOT redundant with the `visibility` sent below.
 * `POST /worker/register`'s `ON CONFLICT ... DO UPDATE SET` updates status,
 * pid, machine_token, user_uid, mode, cli, model, available_models and
 * last_heartbeat — but *not* `visibility`. So re-registering an existing
 * fixture row silently keeps whatever visibility the previous run left
 * behind. Without this, a run that died between "set Public" and "reset to
 * Private" below wedged the whole fast tier red on every subsequent run,
 * because the first assertion expects Private. That is precisely the
 * failure mode track 1100 exists to remove — a spec failing permanently
 * against unbroken code — so the precondition is enforced, not assumed.
 */
async function seedWorker(request, projectId, visibility = 'private') {
  const r = await request.post(`${API}/worker/register`, {
    data: {
      hostname: FIXTURE_HOSTNAME,
      pid: 999999,
      worker_number: FIXTURE_WORKER_NUMBER,
      project_id: projectId,
      type: 'project',
      mode: 'sync-only',
      visibility,
      cli: 'claude',
      model: 'sonnet',
    },
  });
  expect(r.ok(), 'POST /worker/register should succeed').toBeTruthy();
  const { id } = await r.json();

  const v = await request.patch(`${API}/api/workers/${id}/visibility`, {
    data: { visibility },
  });
  expect(v.ok(), `PATCH /api/workers/${id}/visibility should succeed`).toBeTruthy();
  return id;
}

/** Select a specific project so the Config button becomes visible */
async function selectProject(page, name = 'laneconductor') {
  await page.goto(BASE);
  await page.waitForLoadState('networkidle');
  const sel = page.locator('select').filter({ hasText: 'All Projects' });
  if (await sel.isVisible()) {
    await sel.selectOption({ label: name });
    await page.waitForTimeout(300);
  }
}

/**
 * Switch to the Workers view and return the seeded worker's card.
 * Scoped to FIXTURE_HOSTNAME rather than `.first()` — a manager worker sorts
 * ahead of it alphabetically, and mutating the manager's visibility is both
 * the wrong target and a side effect on real local state.
 */
async function openFixtureWorkerCard(page) {
  const workersTab = page.getByRole('button', { name: /^Workers$/i }).first();
  await expect(workersTab, 'Workers view toggle should be present').toBeVisible({ timeout: 10000 });
  await workersTab.click();

  const card = page.getByTestId('worker-card').filter({ hasText: FIXTURE_HOSTNAME });
  await expect(card, 'seeded worker card should render in the Workers grid').toBeVisible({ timeout: 10000 });
  return card;
}

test.describe('Track 1033: Worker Identity UI', () => {

  test('API Keys section visible in Config panel', async ({ page }) => {
    await selectProject(page);

    // Open config panel via ⚙️ Config button
    const configBtn = page.getByTestId('config-btn');
    await expect(configBtn).toBeVisible({ timeout: 10000 });
    await configBtn.click();

    // API Keys section should be present
    const section = page.getByTestId('api-keys-section');
    await expect(section).toBeVisible({ timeout: 5000 });
    console.log('✅ API Keys section visible in config panel');
  });

  test('Generate API key — shows raw key once in banner', async ({ page }) => {
    await selectProject(page);

    const configBtn = page.getByTestId('config-btn');
    await configBtn.click();

    const section = page.getByTestId('api-keys-section');
    await expect(section).toBeVisible({ timeout: 5000 });

    // Fill in key name and generate
    await page.getByTestId('key-name-input').fill('Playwright Test Key');
    await page.getByTestId('generate-key-btn').click();

    // Banner should appear with the raw key
    const banner = page.getByTestId('generated-key-banner');
    await expect(banner).toBeVisible({ timeout: 5000 });

    const keyText = await banner.textContent();
    expect(keyText).toContain('lc_live_');
    console.log('✅ Generated key shown in banner');

    // Key row should appear in list
    await expect(page.getByTestId('api-key-row').first()).toBeVisible({ timeout: 5000 });
    const rowText = await page.getByTestId('api-key-row').first().textContent();
    expect(rowText).toContain('lc_live_');
    expect(rowText).toContain('Playwright Test Key');
    console.log('✅ Key row visible in list with prefix + name');
  });

  test('Revoke API key removes it from list', async ({ page }) => {
    await selectProject(page);

    const configBtn = page.getByTestId('config-btn');
    await configBtn.click();

    const section = page.getByTestId('api-keys-section');
    await expect(section).toBeVisible({ timeout: 5000 });

    // Generate a key to revoke
    await page.getByTestId('key-name-input').fill('To Be Revoked');
    await page.getByTestId('generate-key-btn').click();
    await expect(page.getByTestId('generated-key-banner')).toBeVisible({ timeout: 5000 });

    // Count rows before revoke
    const rowsBefore = await page.getByTestId('api-key-row').count();

    // Click the last revoke button
    const revokeBtn = page.getByTestId('revoke-key-btn').last();
    await expect(revokeBtn).toBeVisible({ timeout: 3000 });
    await revokeBtn.click();

    // Row count should decrease
    await page.waitForTimeout(1000);
    const rowsAfter = await page.getByTestId('api-key-row').count();
    expect(rowsAfter).toBeLessThan(rowsBefore);
    console.log(`✅ Key revoked — rows: ${rowsBefore} → ${rowsAfter}`);
  });

  test('Worker card shows visibility badge', async ({ page }) => {
    const projectId = await resolveProjectId(page.request);
    await seedWorker(page.request, projectId, 'private');

    await selectProject(page);
    const card = await openFixtureWorkerCard(page);

    const badge = card.getByTestId('worker-sharing-btn');
    await expect(badge).toBeVisible({ timeout: 10000 });
    const badgeText = await badge.textContent();
    expect(['Private', 'Team', 'Public'].some(v => badgeText.includes(v))).toBeTruthy();
    console.log(`✅ Visibility badge visible: "${badgeText.trim()}"`);
  });

  test('Clicking visibility badge opens sharing dialog', async ({ page }) => {
    const projectId = await resolveProjectId(page.request);
    await seedWorker(page.request, projectId, 'private');

    await selectProject(page);
    const card = await openFixtureWorkerCard(page);

    const badge = card.getByTestId('worker-sharing-btn');
    await expect(badge).toBeVisible({ timeout: 10000 });
    await badge.click();

    const dialog = page.getByTestId('worker-visibility-dialog');
    await expect(dialog).toBeVisible({ timeout: 3000 });
    console.log('✅ Sharing dialog opened');

    // All three options should be present
    await expect(page.getByTestId('visibility-option-private')).toBeVisible();
    await expect(page.getByTestId('visibility-option-team')).toBeVisible();
    await expect(page.getByTestId('visibility-option-public')).toBeVisible();
    console.log('✅ All three visibility options visible');
  });

  test('Changing visibility to public updates badge', async ({ page }) => {
    const projectId = await resolveProjectId(page.request);
    await seedWorker(page.request, projectId, 'private');

    await selectProject(page);
    const card = await openFixtureWorkerCard(page);

    const badge = card.getByTestId('worker-sharing-btn');
    await expect(badge).toBeVisible({ timeout: 10000 });
    await expect(badge).toContainText('Private');
    await badge.click();

    // Set to public
    await page.getByTestId('visibility-option-public').click();

    // Check badge now says Public (dialog auto-closes on onUpdated)
    await expect(badge).toContainText('Public', { timeout: 5000 });
    console.log('✅ Visibility badge updated to Public');

    // Reset to private for clean state
    await badge.click();
    await page.getByTestId('visibility-option-private').click();
    await expect(badge).toContainText('Private', { timeout: 5000 });
    console.log('✅ Reset visibility to Private');
  });

});
