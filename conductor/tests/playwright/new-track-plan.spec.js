// conductor/tests/playwright/new-track-plan.spec.js
// E2E test: Create a new track in the UI and verify it flows through to the worker
// and back (new track → plan lane → plan:running → plan:success).
//
// Prerequisites:
//   - UI running at localhost:8090 (make ui-start)
//   - API running at localhost:8091 (make api-start)
//   - Worker running (make lc-worker-start)
//
// Run: npx playwright test conductor/tests/playwright/new-track-plan.spec.js

import { test, expect } from '@playwright/test';
import { readFileSync, existsSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '../../..');
const INTAKE_PATH = join(PROJECT_ROOT, 'conductor/tracks/intake.md');
const API_URL = 'http://localhost:8091';

const TEST_TITLE = `E2E Test ${Date.now()}`;
const TEST_DESC = 'Automated Playwright e2e — verifies new track flows to worker and back';

async function getTrackByNumber(page, trackNumber) {
  const r = await page.request.get(`${API_URL}/api/projects/1/tracks`);
  const tracks = await r.json();
  return (Array.isArray(tracks) ? tracks : tracks.tracks ?? []).find(t => String(t.track_number) === String(trackNumber)) ?? null;
}

test('New Track → Plan: full e2e flow', async ({ page }) => {
  test.setTimeout(300000); // up to 5 min for full planning

  // ── Step 1: Open New Track modal ──────────────────────────────────────────
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  const newTrackBtn = page.getByTitle(/New Track/i).first();
  await expect(newTrackBtn).toBeVisible({ timeout: 10000 });
  await newTrackBtn.click();

  // ── Step 2: Select laneconductor project in modal dropdown ───────────────────
  const projectSelect = page.getByRole('combobox').first(); // "Select a project..."
  await expect(projectSelect).toBeVisible({ timeout: 5000 });
  // Select by value=1 (laneconductor project ID)
  await projectSelect.selectOption('1');
  console.log('Using project: laneconductor (id=1)');

  // ── Step 3: Fill in title + description ───────────────────────────────────
  const titleInput = page.getByPlaceholder(/Auth middleware|Login fails/i);
  await expect(titleInput).toBeVisible({ timeout: 5000 });
  await titleInput.fill(TEST_TITLE);
  await page.getByPlaceholder(/What problem|Steps to reproduce/i).fill(TEST_DESC);

  // ── Step 4: Submit (capture track_number from API response) ───────────────
  const submitBtn = page.getByRole('button', { name: /Create Track/i });
  await expect(submitBtn).toBeEnabled({ timeout: 5000 });

  // Intercept the POST /api/projects/1/tracks response to get track_number
  const [createResp] = await Promise.all([
    page.waitForResponse(r => r.url().includes('/api/projects/') && r.url().includes('/tracks') && r.request().method() === 'POST', { timeout: 15000 }),
    submitBtn.click(),
  ]);
  const createData = await createResp.json();
  const trackNumber = String(createData.track_number);
  expect(trackNumber, 'API should return track_number').toBeTruthy();
  console.log(`✅ Track submitted: track_number=${trackNumber}`);

  // Wait for modal to close
  await expect(titleInput).not.toBeVisible({ timeout: 10000 });

  // Give API a moment to write intake.md
  await page.waitForTimeout(1500);

  // ── Step 5: Verify intake.md updated on disk ────────────────────────────────
  expect(existsSync(INTAKE_PATH), 'intake.md should exist').toBeTruthy();
  const intakeContent = readFileSync(INTAKE_PATH, 'utf8');
  expect(intakeContent, 'intake.md should contain the new track title').toContain(TEST_TITLE);
  console.log('✅ intake.md updated on disk');

  // ── Step 6: Verify track in DB with plan:queue ─────────────────────────────
  const track = await getTrackByNumber(page, trackNumber);
  expect(track, `Track ${trackNumber} not found in API`).toBeTruthy();
  expect(track.lane_status).toBe('plan');
  expect(track.lane_action_status).toBe('queue');
  console.log(`✅ DB: track=${trackNumber} lane=${track.lane_status} action=${track.lane_action_status}`);

  // ── Step 7: Track appears in Kanban UI ─────────────────────────────────────
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(3000);

  // Look for the track number badge (#1026 style)
  const card = page.getByText(`#${trackNumber}`).first();
  await expect(card).toBeVisible({ timeout: 15000 });
  console.log(`✅ Track #${trackNumber} card visible in Kanban`);

  // ── Step 8: Worker picks up the track (running) ────────────────────────────
  console.log(`Waiting for worker to pick up track ${trackNumber}...`);
  let running = false;
  const runDeadline = Date.now() + 60000;
  while (Date.now() < runDeadline) {
    const t = await getTrackByNumber(page, trackNumber);
    if (t?.lane_action_status === 'running') {
      running = true;
      console.log(`✅ Worker picked up track ${trackNumber} (running)`);
      break;
    }
    await page.waitForTimeout(2000);
  }
  expect(running, 'Worker should pick up track within 60s — is lc-worker-start running?').toBeTruthy();

  // ── Step 9: Planning completes (plan:success) ──────────────────────────────
  console.log(`Waiting for planning to complete for track ${trackNumber}...`);
  let done = false;
  const doneDeadline = Date.now() + 180000;
  while (Date.now() < doneDeadline) {
    const t = await getTrackByNumber(page, trackNumber);
    if (t?.lane_action_status === 'done' || t?.lane_action_result === 'success') {
      done = true;
      console.log(`✅ Planning complete: status=${t.lane_action_status} result=${t.lane_action_result}`);
      break;
    }
    await page.waitForTimeout(3000);
  }
  expect(done, 'Planning should complete within 180s').toBeTruthy();

  // ── Step 10: Verify spec.md + plan.md on disk ──────────────────────────────
  const tracksDir = join(PROJECT_ROOT, 'conductor/tracks');
  const dirs = readdirSync(tracksDir, { withFileTypes: true })
    .filter(d => d.isDirectory() && d.name.startsWith(String(trackNumber)));

  expect(dirs.length, `No track directory for ${trackNumber}`).toBeGreaterThan(0);

  const trackDir = join(tracksDir, dirs[0].name);
  const specPath = join(trackDir, 'spec.md');
  const planPath = join(trackDir, 'plan.md');

  expect(existsSync(specPath), `spec.md missing in ${dirs[0].name}`).toBeTruthy();
  expect(existsSync(planPath), `plan.md missing in ${dirs[0].name}`).toBeTruthy();
  console.log(`✅ spec.md + plan.md created for track ${trackNumber}`);

  // ── Step 11: UI reflects success ──────────────────────────────────────────
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(3000);
  const doneCard = page.getByText(`#${trackNumber}`).first();
  await expect(doneCard).toBeVisible({ timeout: 10000 });
  console.log(`✅ Track ${trackNumber} visible in UI after planning complete`);
});
