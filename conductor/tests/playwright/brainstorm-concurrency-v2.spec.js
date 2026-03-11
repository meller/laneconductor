// conductor/tests/playwright/brainstorm-concurrency-v2.spec.js
import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, appendFileSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '../../..');

// We will use the local filesystem to set up the tracks directly
const TRACKS_DIR = join(PROJECT_ROOT, 'conductor/tracks');

function cleanupTrack(trackNum) {
    const dir = readdirSync(TRACKS_DIR).find(d => d.startsWith(trackNum));
    if (dir) {
        rmSync(join(TRACKS_DIR, dir), { recursive: true, force: true });
    }
}

function createFileSystemTrack(trackNum, title, lane, status, waitingForReply = 'no') {
    const dirName = `${trackNum}-test-${title.toLowerCase().replace(/\s+/g, '-')}`;
    const dirPath = join(TRACKS_DIR, dirName);
    if (!existsSync(dirPath)) mkdirSync(dirPath, { recursive: true });

    const indexContent = `# ${title}\n\n**Lane**: ${lane}\n**Lane Status**: ${status}\n**Waiting for reply**: ${waitingForReply}\n`;
    writeFileSync(join(dirPath, 'index.md'), indexContent);
    writeFileSync(join(dirPath, 'plan.md'), '# Plan\n\n## Phase 1\n- Task 1\n');
    writeFileSync(join(dirPath, 'spec.md'), '# Spec\n\nTest Spec\n');

    return dirPath;
}

test.describe('Brainstorm & Concurrency strict check', () => {
    test.setTimeout(120000);

    test.beforeEach(() => {
        cleanupTrack('991');
        cleanupTrack('992');
    });

    test('Worker pulls only one track and handles brainstorm reply', async ({ page }) => {
        // 1. Create two tracks in 'plan' : 'queue'
        // Track 991: Normal planning
        createFileSystemTrack('991', 'Normal Plan A', 'plan', 'queue');

        // Track 992: Brainstorm B
        const dirB = createFileSystemTrack('992', 'Brainstorm B', 'plan', 'queue', 'yes');
        const convPathB = join(dirB, 'conversation.md');
        writeFileSync(convPathB, '> **human** (brainstorm): What are the core requirements?\n');

        console.log('Tracks 991 and 992 created in filesystem.');

        // 2. Open dashboard to observe
        await page.goto('http://localhost:8090/'); // UI Port

        // Wait for worker to cycle (heartbeat is 5s usually)
        // We expect ONE to stay in 'queue' and ONE to move to 'running'
        // Wait up to 30s for movement

        console.log('Waiting for worker to pick up tracks...');

        const startTime = Date.now();
        let runningCount = 0;
        while (Date.now() - startTime < 40000) {
            // Check status via API for reliability
            const resp = await page.request.get('http://localhost:8091/api/projects/1/tracks');
            const data = await resp.json();
            const tracks = Array.isArray(data) ? data : data.tracks ?? [];

            const t991 = tracks.find(t => t.track_number === '991');
            const t992 = tracks.find(t => t.track_number === '992');

            runningCount = tracks.filter(t => t.lane_action_status === 'running' && t.lane_status === 'plan').length;

            console.log(`Plan Lane Running: ${runningCount} | 991: ${t991?.lane_action_status} | 992: ${t992?.lane_action_status}`);

            if (runningCount > 0) {
                // If we see one running, continue for a bit to ensure it doesn't launch more
                await page.waitForTimeout(5000);
                if (runningCount > 1) {
                    // Oops, over-launched
                    break;
                }
            } else {
                await page.waitForTimeout(5000);
            }
        }

        expect(runningCount, 'Should launch at least one track').toBeGreaterThan(0);
        expect(runningCount, 'Should NOT exceed limit of 1 in plan lane').toBe(1);

        // 3. Verify Brainstorm functionality (Track 992)
        // If 991 started first, we might have to wait for it.
        // But 992 has 'waitingForReply: yes', which currently BYPASSES the limit in my code view.
        // If the user wants strictly 1, I should probably fix northern bypass.

        // Let's see if 992 eventually gets an AI reply.
        console.log('Checking for AI reply in Track 992...');
        const replyStartTime = Date.now();
        let hasReply = false;
        while (Date.now() - replyStartTime < 60000) {
            if (existsSync(convPathB)) {
                const content = readFileSync(convPathB, 'utf8');
                if (content.includes('> **assistant**:')) {
                    hasReply = true;
                    console.log('✅ AI replied to brainstorm message.');
                    break;
                }
            }
            await page.waitForTimeout(5000);
        }
        expect(hasReply, 'AI should reply to brainstorm message').toBeTruthy();

        // 4. Verify Lane (Should remain in plan)
        const respFinal = await page.request.get('http://localhost:8091/api/projects/1/tracks');
        const dataFinal = await respFinal.json();
        const t992Final = (Array.isArray(dataFinal) ? dataFinal : dataFinal.tracks).find(t => t.track_number === '992');
        expect(t992Final.lane_status, 'Track 992 should remain in plan lane').toBe('plan');
    });
});
