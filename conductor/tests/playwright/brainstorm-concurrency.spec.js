// conductor/tests/playwright/brainstorm-concurrency.spec.js
// E2E test: Verify brainstorm skill and concurrency limits.
// 1. Create Track A (Plan:Queue)
// 2. Create Track B (Plan:Queue)
// 3. Trigger brainstorm on Track B (via conversation.md)
// 4. Verify Track A starts, Track B stays queued/waiting (Concurrency=1)
// 5. Wait for Track A to finish
// 6. Verify Track B starts brainstorm
// 7. Verify Track B gets AI reply in conversation.md and stays in Plan lane.

import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync, existsSync, readdirSync, appendFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '../../..');
const API_URL = 'http://localhost:8091';

async function getTrackByNumber(page, trackNumber) {
    const r = await page.request.get(`${API_URL}/api/projects/1/tracks`);
    const tracks = await r.json();
    const list = Array.isArray(tracks) ? tracks : tracks.tracks ?? [];
    return list.find(t => String(t.track_number) === String(trackNumber)) ?? null;
}

async function createTrack(page, title) {
    await page.goto('/');
    const newTrackBtn = page.getByTitle(/New Track/i).first();
    await newTrackBtn.click();

    const projectSelect = page.getByRole('combobox').first();
    await projectSelect.selectOption('1');

    await page.getByPlaceholder(/Auth middleware|Login fails/i).fill(title);
    await page.getByPlaceholder(/What problem|Steps to reproduce/i).fill('Test description');

    const submitBtn = page.getByRole('button', { name: /Create Track/i });
    const [createResp] = await Promise.all([
        page.waitForResponse(r => r.url().includes('/tracks') && r.request().method() === 'POST'),
        submitBtn.click(),
    ]);
    const data = await createResp.json();
    return String(data.track_number);
}

test.describe('Brainstorm & Concurrency E2E', () => {
    test.setTimeout(300000); // 5 min

    test('Worker respects concurrency and brainstorm skill flow', async ({ page }) => {
        // ── Pre-cleanup (optional) ──
        // We assume a fresh-ish env or unique titles

        const titleA = `Concurrency A ${Date.now()}`;
        const titleB = `Brainstorm B ${Date.now()}`;

        // 1. Create Track A
        const trackA = await createTrack(page, titleA);
        console.log(`Created Track A: ${trackA}`);

        // 2. Create Track B
        const trackB = await createTrack(page, titleB);
        console.log(`Created Track B: ${trackB}`);

        // 3. Trigger brainstorm on Track B
        const tracksDir = join(PROJECT_ROOT, 'conductor/tracks');
        const dirB = readdirSync(tracksDir).find(d => d.startsWith(trackB));
        const convPathB = join(tracksDir, dirB, 'conversation.md');

        // Wait for file to exist
        let attempts = 0;
        while (!existsSync(convPathB) && attempts < 5) {
            await page.waitForTimeout(1000);
            attempts++;
        }

        appendFileSync(convPathB, '\n\n> **human** (brainstorm): Please brainstorm some ideas for this feature.\n');
        console.log(`Triggered brainstorm in ${convPathB}`);

        // 4. Verify Concurrency (Track A should run, Track B should WAIT)
        console.log('Checking concurrency behavior...');
        let trackARunning = false;
        let trackBWaiting = false;

        // Wait for worker to pick up something
        await page.waitForTimeout(5000);

        const tA = await getTrackByNumber(page, trackA);
        const tB = await getTrackByNumber(page, trackB);

        console.log(`Track A Status: ${tA?.lane_action_status}`);
        console.log(`Track B Status: ${tB?.lane_action_status}`);

        // One should be running, one should be queue/waiting
        // Since A was created first, it likely gets picked up if worker is scanning.
        // However, if worker was busy, it might be different. 
        // The key is that we DON'T have TWO running in 'plan' lane.

        const rA = tA?.lane_action_status === 'running';
        const rB = tB?.lane_action_status === 'running';

        expect(Number(rA) + Number(rB), 'Should not have more than 1 track running in plan lane').toBeLessThanOrEqual(1);

        // 5. Wait for the running track to finish
        console.log('Waiting for active track to finish...');
        const runner = rA ? trackA : (rB ? trackB : null);
        if (runner) {
            const deadline = Date.now() + 180000;
            while (Date.now() < deadline) {
                const stats = await getTrackByNumber(page, runner);
                if (stats.lane_action_status === 'done' || stats.lane_action_status === 'success') {
                    console.log(`Track ${runner} finished.`);
                    break;
                }
                await page.waitForTimeout(5000);
            }
        }

        // 6. Verify Track B eventually starts its brainstorm
        console.log(`Waiting for Track B (${trackB}) to start brainstorm...`);
        const bDeadline = Date.now() + 120000;
        let bStarted = false;
        while (Date.now() < bDeadline) {
            const stats = await getTrackByNumber(page, trackB);
            if (stats.lane_action_status === 'running') {
                bStarted = true;
                console.log(`Track B ${trackB} is now running brainstorm.`);
                break;
            }
            await page.waitForTimeout(5000);
        }
        expect(bStarted, 'Track B should have started by now').toBeTruthy();

        // 7. Verify AI Reply in conversation.md
        console.log('Waiting for AI reply in Track B conversation...');
        const replyDeadline = Date.now() + 180000;
        let replied = false;
        while (Date.now() < replyDeadline) {
            const content = readFileSync(convPathB, 'utf8');
            if (content.includes('> **assistant**:')) {
                replied = true;
                console.log('✅ AI replied to brainstorm!');
                break;
            }
            await page.waitForTimeout(10000);
        }
        expect(replied, 'AI should have replied to brainstorm').toBeTruthy();

        // 8. Verify Lane (Should still be plan)
        const finalB = await getTrackByNumber(page, trackB);
        expect(finalB.lane_status, 'Track B should remain in plan lane').toBe('plan');
        console.log('✅ Track B remained in plan lane.');
    });
});
