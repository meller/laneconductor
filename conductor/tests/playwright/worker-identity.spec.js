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
    // Only run if a worker is active
    const r = await page.request.get(`${API}/api/workers`);
    const workers = await r.json();
    if (!workers || workers.length === 0) {
      test.skip(true, 'No active workers — skipping visibility badge test');
      return;
    }

    await selectProject(page);

    // Navigate to the Workers tab (ConductorPanel or sidebar)
    const workersTab = page.getByRole('button', { name: /Workers/i }).first();
    if (await workersTab.isVisible()) await workersTab.click();

    const badge = page.getByTestId('worker-sharing-btn').first();
    await expect(badge).toBeVisible({ timeout: 10000 });
    const badgeText = await badge.textContent();
    expect(['Private', 'Team', 'Public'].some(v => badgeText.includes(v))).toBeTruthy();
    console.log(`✅ Visibility badge visible: "${badgeText.trim()}"`);
  });

  test('Clicking visibility badge opens sharing dialog', async ({ page }) => {
    const r = await page.request.get(`${API}/api/workers`);
    const workers = await r.json();
    if (!workers || workers.length === 0) {
      test.skip(true, 'No active workers — skipping dialog test');
      return;
    }

    await selectProject(page);

    const workersTab = page.getByRole('button', { name: /Workers/i }).first();
    if (await workersTab.isVisible()) await workersTab.click();

    const badge = page.getByTestId('worker-sharing-btn').first();
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
    const r = await page.request.get(`${API}/api/workers`);
    const workers = await r.json();
    if (!workers || workers.length === 0) {
      test.skip(true, 'No active workers — skipping visibility change test');
      return;
    }

    await selectProject(page);

    const workersTab = page.getByRole('button', { name: /Workers/i }).first();
    if (await workersTab.isVisible()) await workersTab.click();

    const badge = page.getByTestId('worker-sharing-btn').first();
    await expect(badge).toBeVisible({ timeout: 10000 });
    await badge.click();

    // Set to public
    await page.getByTestId('visibility-option-public').click();
    await page.waitForTimeout(500);

    // Check badge now says Public (dialog auto-closes on onUpdated)
    const updatedBadge = page.getByTestId('worker-sharing-btn').first();
    await expect(updatedBadge).toContainText('Public', { timeout: 5000 });
    console.log('✅ Visibility badge updated to Public');

    // Reset to private for clean state
    await updatedBadge.click();
    await page.getByTestId('visibility-option-private').click();
    await page.waitForTimeout(300);
    console.log('✅ Reset visibility to Private');
  });

});
