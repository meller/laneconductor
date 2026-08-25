// conductor/tests/playwright/brainstorm-concurrency-v2.spec.js
//
// Track 10021: self-scoped. This spec creates its fixture tracks directly on
// the filesystem (hardcoded 991/992, unlike the UI-driven v1/new-track-plan
// specs — that's the "v2" difference, kept because it exercises the
// fs-created-track path distinctly from the UI-created one), then brings its
// own throwaway worker (helpers/scoped-worker.mjs) instead of requiring an
// external `lc worker start --sync-and-work --only-tracks 991,992 --once` to
// be started by hand. Run with NO ambient worker running:
//
//   lc worker stop
//   npx playwright test conductor/tests/playwright/brainstorm-concurrency-v2.spec.js

import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'fs';
import { join } from 'path';
import {
  assertCheckoutSpawnable,
  spawnScopedWorker,
  waitForLaneAction,
  cleanup,
  getTrackByNumber,
  resolveTrackDir,
  resolveProjectRepoPath,
} from './helpers/scoped-worker.mjs';

// Track 10021: discovered live — laneconductor.sync.mjs ALWAYS redirects
// itself to the primary checkout when launched from a worktree (main-mode
// dispatch only ever operates there — see its own "which is not the
// primary checkout — running from X instead" startup log line), regardless
// of the `cwd` spawnScopedWorker passes it. Writing these fixtures under
// this spec file's own on-disk location (a worktree, when this track's own
// implement run executes from one) put them somewhere the worker would
// never look: it long-since chdir'd itself back to the primary checkout by
// the time it evaluates --once's "any scoped work left" check, found
// nothing there, and exited 1 immediately ("no queued or running track
// matched") without ever touching the fixtures. Every filesystem-touching
// call in this file resolves and uses the SAME primary-checkout path the
// worker will end up using (resolveProjectRepoPath), not a PROJECT_ROOT
// constant derived from this file's own location.
//
// Also: 991/992 are long-lived fixture track
// numbers with real DB rows going back to 2026-08-12. Deleting only the
// directory (as this used to) leaves a stale DB row behind; a freshly
// spawned worker's own startup DB→FS sync then pushes that stale
// lane_status/auto_run straight back onto the just-written fixture file
// before the worker's chokidar watcher reacts to the fresh write — the
// fixture silently reverts to backlog/auto_run:false and is never claimed.
// Deleting the DB row too closes that race: no stale row, nothing to push.
async function cleanupTrack(tracksDir, trackNum) {
    const dir = readdirSync(tracksDir).find(d => d.startsWith(trackNum));
    if (dir) {
        rmSync(join(tracksDir, dir), { recursive: true, force: true });
    }
    await fetch(`http://127.0.0.1:8091/api/projects/1/tracks/${trackNum}`, { method: 'DELETE' }).catch(() => {});
}

function createFileSystemTrack(tracksDir, trackNum, title, lane, status, waitingForReply = 'no') {
    const dirName = `${trackNum}-test-${title.toLowerCase().replace(/\s+/g, '-')}`;
    const dirPath = join(tracksDir, dirName);
    if (!existsSync(dirPath)) mkdirSync(dirPath, { recursive: true });

    // Track 10021 F1: auto_run defaults false and a worker (scoped or
    // ambient) will never claim a track without it — a track created
    // straight on the filesystem (no API call) needs the marker written
    // directly, since there's no PATCH .../auto-run round trip to do it.
    const indexContent = `# ${title}\n\n**Lane**: ${lane}\n**Lane Status**: ${status}\n**Waiting for reply**: ${waitingForReply}\n**Auto Run**: yes\n`;
    writeFileSync(join(dirPath, 'index.md'), indexContent);
    writeFileSync(join(dirPath, 'plan.md'), '# Plan\n\n## Phase 1\n- Task 1\n');
    writeFileSync(join(dirPath, 'spec.md'), '# Spec\n\nTest Spec\n');

    return dirPath;
}

test.describe('Brainstorm & Concurrency strict check', () => {
    test.setTimeout(120000);

    let tracksDir;

    test.beforeEach(async () => {
        const projectRoot = await resolveProjectRepoPath();
        tracksDir = join(projectRoot, 'conductor/tracks');
        await cleanupTrack(tracksDir, '991');
        await cleanupTrack(tracksDir, '992');
    });

    test('Worker pulls only one track and handles brainstorm reply', async ({ page }) => {
        let handle = null;
        const projectRoot = await resolveProjectRepoPath();

        try {
            // 1. Create two tracks in 'plan' : 'queue'
            // Track 991: Normal planning
            createFileSystemTrack(tracksDir, '991', 'Normal Plan A', 'plan', 'queue');

            // Track 992: Brainstorm B
            const dirB = createFileSystemTrack(tracksDir, '992', 'Brainstorm B', 'plan', 'queue', 'yes');
            const convPathB = join(dirB, 'conversation.md');
            writeFileSync(convPathB, '> **human** (brainstorm): What are the core requirements?\n');

            console.log('Tracks 991 and 992 created in filesystem.');

            // 2. Open dashboard to observe
            await page.goto('http://localhost:8090/'); // UI Port

            // ── Bring our own worker, scoped to BOTH hardcoded tracks ─────────────
            const dirA991 = resolveTrackDir(projectRoot, '991');
            const dirB992 = resolveTrackDir(projectRoot, '992');
            assertCheckoutSpawnable([dirA991, dirB992], { cwd: projectRoot });
            handle = spawnScopedWorker(['991', '992'], { projectRoot });
            console.log(`🚀 Spawned scoped worker #${handle.workerNumber} for tracks 991, 992 — log: ${handle.logPath}`);

            // 3. Wait for the worker to pick up exactly one of them (concurrency=1)
            console.log('Waiting for worker to pick up tracks...');

            const startTime = Date.now();
            let runningCount = 0;
            while (Date.now() - startTime < 40000) {
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
                    if (handle.proc.exitCode !== null && handle.proc.exitCode !== 0) {
                        throw new Error(`scoped worker exited early (code ${handle.proc.exitCode}) before either track started running`);
                    }
                    await page.waitForTimeout(5000);
                }
            }

            expect(runningCount, 'Should launch at least one track').toBeGreaterThan(0);
            expect(runningCount, 'Should NOT exceed limit of 1 in plan lane').toBe(1);

            // 4. Verify Brainstorm functionality (Track 992)
            console.log('Checking for AI reply in Track 992...');
            const replyStartTime = Date.now();
            let hasReply = false;
            while (Date.now() - replyStartTime < 60000) {
                if (existsSync(convPathB)) {
                    const content = readFileSync(convPathB, 'utf8');
                    if (/> \*\*(claude|gemini)\*\*:/.test(content)) {
                        hasReply = true;
                        console.log('✅ AI replied to brainstorm message.');
                        break;
                    }
                }
                await page.waitForTimeout(5000);
            }
            expect(hasReply, 'AI should reply to brainstorm message').toBeTruthy();

            // 5. Verify Lane (Should remain in plan)
            const t992Final = await getTrackByNumber('992');
            expect(t992Final.lane_status, 'Track 992 should remain in plan lane').toBe('plan');
        } finally {
            // REQ-6/F6: kill the scoped worker; the beforeEach of the next run
            // (or a manual cleanupTrack call here) removes the fixture dirs.
            if (handle) await cleanup(handle, []);
            await cleanupTrack(tracksDir, '991');
            await cleanupTrack(tracksDir, '992');
        }
    });
});
