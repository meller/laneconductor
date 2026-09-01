#!/usr/bin/env node
// conductor/tests/track-10048-duplicate-folder-double-spawn.test.mjs
// Confirmed live 2026-09-01, track AM-10045: a legacy bare-numbered
// duplicate folder (`10045-...`, pre-dating the modern
// `INITIALS-NNNN-slug` convention) sat alongside its canonical
// `AM-10045-...` folder. isTrackDirName only excludes already-quarantined
// `_duplicate-*` names, so autoLaunchLocalFs's directory scan treated both
// as INDEPENDENT candidates for the SAME track_number. While the
// canonical folder's action was legitimately running (holding the global
// main-mode lock), the next 5s auto-launch tick read the duplicate's
// stale `queue` status, attempted a SECOND spawn for the identical
// track_number, correctly got blocked by that same lock, and — with no
// notion of "I already have a live child running this exact track" —
// escalated to a hard failure after 5 consecutive blocks, incorrectly
// marking an actively-progressing run as permanently failed.
//
// This reproduces the exact folder-pair shape with a real worker process
// and a slow mock CLI (long enough to span several 5s auto-launch ticks),
// asserting the canonical folder's run completes cleanly — never flips to
// `failure` mid-run — and the stale duplicate gets quarantined as a side
// effect of the fix (resolveTrackFolder's own quarantine behavior).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const MOCK_CLI = join(__dirname, 'mock-cli.mjs');
const TMP = join(ROOT, '.test-tmp-track-10048-duplicate-folder');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function readIndex(tracksDir, dirName) {
  const p = join(tracksDir, dirName, 'index.md');
  return existsSync(p) ? readFileSync(p, 'utf8') : null;
}

function getLaneStatus(content) {
  return content?.match(/\*\*Lane Status\*\*:\s*([^\n]+)/i)?.[1]?.trim() ?? null;
}

async function poll(fn, { timeout = 20000, interval = 300, label = '' } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = fn();
    if (result) return result;
    await sleep(interval);
  }
  throw new Error(`poll timeout (${timeout}ms)${label ? ': ' + label : ''}`);
}

function setupProject() {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
  writeFileSync(join(TMP, '.laneconductor.json'), JSON.stringify({
    mode: 'local-fs',
    project: { name: 'test-project', id: 1, repo_path: TMP, primary: { cli: 'mock', model: 'mock' } },
    collectors: [],
    ui: { port: 8090 },
  }, null, 2));
  mkdirSync(join(TMP, 'conductor/tracks'), { recursive: true });
  // Register the canonical (modern INITIALS-NNNN-slug) folder in
  // tracks-metadata.json, matching real production conditions — a track
  // that's had prior successful runs always has this registered (every
  // syncTrack/updateTrackMetadata call writes it). decideTrackFolder
  // (track-folder.mjs) only pattern-matches bare `NNNN-slug` names
  // directly; a prefixed folder is resolved via this registration, not
  // name-matching — so without it, a fresh/never-registered project can't
  // tell the two folders apart at all, which is a real but separate gap
  // from the one this test targets.
  writeFileSync(join(TMP, 'conductor/tracks-metadata.json'), JSON.stringify({
    tracks: { '10048': { folder_path: 'AM-10048-duplicate-folder-race' } },
  }, null, 2));
  writeFileSync(join(TMP, 'conductor/workflow.json'), JSON.stringify({
    global: { total_parallel_limit: 3 },
    defaults: { parallel_limit: 3, max_retries: 1 },
    lanes: {
      plan: { parallel_limit: 3, max_retries: 1, auto_action: 'plan', on_success: 'plan:success', on_failure: 'backlog' },
    },
  }, null, 2));
}

function writeTrackFolder(tracksDir, dirName, { num, laneStatus }) {
  const dir = join(tracksDir, dirName);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.md'), [
    `# Track AM-${num}: Duplicate Folder Race`,
    '',
    '**Lane**: plan',
    `**Lane Status**: ${laneStatus}`,
    '**Progress**: 0%',
    '**Auto Run**: yes',
    '',
    '## Problem', 'Test problem.', '',
    '## Solution', 'Test solution.',
  ].join('\n'));
}

function startWorker(env = {}) {
  const worker = spawn('node', [join(ROOT, 'conductor/laneconductor.sync.mjs')], {
    cwd: TMP,
    env: { ...process.env, LC_MOCK_CLI: `node ${MOCK_CLI}`, LC_SKIP_CWD_NORMALIZATION: '1', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  worker.stdout.on('data', d => process.stdout.write(`[worker] ${d}`));
  worker.stderr.on('data', d => process.stderr.write(`[worker] ${d}`));
  return worker;
}

describe('Track 10048: duplicate track folder must not cause a second concurrent spawn attempt', () => {
  it('canonical AM-10048-... run completes without the legacy 10048-... duplicate causing a false failure', async () => {
    setupProject();
    const tracksDir = join(TMP, 'conductor/tracks');
    // Canonical, modern-convention folder — this is the one that should run.
    writeTrackFolder(tracksDir, 'AM-10048-duplicate-folder-race', { num: '10048', laneStatus: 'queue' });
    // Legacy bare-numbered duplicate — same track_number, stays stuck at
    // `queue` (never claimed, never updated) exactly like the live incident.
    writeTrackFolder(tracksDir, '10048-duplicate-folder-race', { num: '10048', laneStatus: 'queue' });

    // Long enough delay to span several 5s auto-launch ticks before exiting.
    const worker = startWorker({ MOCK_CLI_EXIT_CODE: '0', MOCK_CLI_DELAY_MS: '7000' });
    try {
      await poll(() => {
        const c = readIndex(tracksDir, 'AM-10048-duplicate-folder-race');
        return getLaneStatus(c) === 'running' ? true : null;
      }, { label: 'canonical folder picked up and running', timeout: 45000 });

      // Watch across multiple auto-launch ticks (5s each) while the run is
      // still in flight — this is exactly the window the live incident hit.
      for (let i = 0; i < 3; i++) {
        await sleep(1500);
        const c = readIndex(tracksDir, 'AM-10048-duplicate-folder-race');
        const status = getLaneStatus(c);
        assert.notEqual(status, 'failure', `canonical folder must never flip to failure mid-run (saw it at check ${i})`);
      }

      // Run finishes normally.
      const final = await poll(() => {
        const c = readIndex(tracksDir, 'AM-10048-duplicate-folder-race');
        const s = getLaneStatus(c);
        return (s === 'success' || s === 'queue') ? c : null;
      }, { label: 'canonical folder run completes' });
      assert.notEqual(getLaneStatus(final), 'failure');

      // The duplicate should have been quarantined as a side effect of
      // resolveTrackFolder's own quarantine behavior (track 1119) — proves
      // this is a permanent fix for the folder pair, not just this run.
      const entries = readdirSync(tracksDir);
      const quarantined = entries.some(e => e.startsWith('_duplicate-') && e.includes('10048'));
      assert.ok(quarantined, `expected the legacy duplicate folder to be quarantined; got entries: ${entries.join(', ')}`);
    } finally {
      worker.kill('SIGTERM');
      await sleep(500);
    }
  });
});
