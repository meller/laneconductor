#!/usr/bin/env node
// conductor/tests/track-1110-claim-race.test.mjs
// Track 1110 Phase 1: reproduction — two laneconductor.sync.mjs worker
// processes sharing one project directory can both claim and spawn a CLI
// run for the same queued track.
//
// Root cause (see conductor/tracks/1110-*/spec.md): autoLaunchLocalFs()
// decides to claim a track by reading index.md's Lane Status, THEN writes
// "running" back, THEN spawns — no lock between the read and the write.
// This function backs every mode (the worker's own comment: "Launch
// decisions are always filesystem-based... DB is used only for
// heartbeats and UI sync, not for concurrency control"), so the race is
// reproducible without a DB via two plain local-fs workers.
//
// This test is deliberately probabilistic, run N times, because the race
// depends on OS scheduling/timing. Per systematic-debugging: a repro that
// fails "most of the time" is still real evidence a fix must eliminate —
// asserted as "zero double-claims across N runs" so it is unambiguously
// RED before Track 1110's Phase 2-4 fixes land and GREEN after.
//
// Run: node --test conductor/tests/track-1110-claim-race.test.mjs

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const MOCK_CLI = join(__dirname, 'mock-cli.mjs');
const TMP = join(ROOT, '.test-tmp-claim-race');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function setupProject() {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });

  writeFileSync(join(TMP, '.laneconductor.json'), JSON.stringify({
    mode: 'local-fs',
    project: { name: 'claim-race-test', id: 1, repo_path: TMP, primary: { cli: 'mock', model: 'mock' } },
    collectors: [],
    ui: { port: 8090 },
  }, null, 2));

  mkdirSync(join(TMP, 'conductor/tracks'), { recursive: true });
  writeFileSync(join(TMP, 'conductor/workflow.json'), JSON.stringify({
    global: { total_parallel_limit: 3 },
    defaults: { parallel_limit: 1, max_retries: 1, primary_model: 'mock', on_success: null, on_failure: null },
    lanes: {
      'in-progress': { parallel_limit: 1, max_retries: 1, auto_action: 'implement', on_success: 'review', on_failure: 'in-progress' },
    },
  }, null, 2));
}

function createTrack(num) {
  const dir = join(TMP, 'conductor/tracks', `${num}-race-track`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.md'), [
    `# Track ${num}: Race Track`,
    '',
    '**Lane**: in-progress',
    '**Lane Status**: queue',
    '**Progress**: 0%',
    '',
    '## Problem', 'Test.', '', '## Solution', 'Test.',
  ].join('\n'));
}

function startWorker(claimMarkerPath) {
  const proc = spawn('node', [join(ROOT, 'conductor/laneconductor.sync.mjs')], {
    cwd: TMP,
    env: {
      ...process.env,
      LC_MOCK_CLI: `node ${MOCK_CLI}`,
      MOCK_CLI_DELAY_MS: '3000', // longer than the 5s auto-launch tick's first firing plus margin, so a second worker's tick can still land before this run completes and moves the track out of 'queue'
      MOCK_CLI_CLAIM_MARKER: claimMarkerPath,
    },
    stdio: 'ignore',
  });
  return proc;
}

// Single queued track per run, so every marker entry is necessarily a
// claim of that one track — see mock-cli.mjs's MOCK_CLI_CLAIM_MARKER
// comment for why trackNumber itself isn't part of the marker.
function readClaimPids(markerPath) {
  if (!existsSync(markerPath)) return [];
  return readFileSync(markerPath, 'utf8').trim().split('\n').filter(Boolean);
}

describe('Track 1110 Phase 1: claim-race reproduction', () => {
  after(() => rmSync(TMP, { recursive: true, force: true }));

  it('two worker processes sharing one project directory sometimes double-claim the same track (pre-fix baseline)', async () => {
    const RUNS = 8;
    const markerPath = join(TMP, 'claims.log');
    let doubleClaimCount = 0;
    const perRunClaimants = [];

    for (let run = 0; run < RUNS; run++) {
      setupProject();
      createTrack('501');
      rmSync(markerPath, { force: true });

      const workerA = startWorker(markerPath);
      const workerB = startWorker(markerPath);

      try {
        // Give both workers time to complete at least one auto-launch tick
        // (5s interval) plus the mock CLI's 3s runtime.
        await sleep(6500);

        const claimants = new Set(readClaimPids(markerPath));
        perRunClaimants.push([...claimants]);
        if (claimants.size > 1) doubleClaimCount++;
      } finally {
        workerA.kill('SIGKILL');
        workerB.kill('SIGKILL');
        await sleep(200);
      }
    }

    console.log(`[track-1110] double-claim observed in ${doubleClaimCount}/${RUNS} runs`, perRunClaimants);

    // This assertion is the reproduction: it is EXPECTED TO FAIL against
    // today's autoLaunchLocalFs (proving the race exists) and is expected
    // to pass once Track 1110 Phase 4's atomic claim-file lands. Do not
    // "fix" this test by loosening the threshold — fix the race instead.
    assert.equal(
      doubleClaimCount, 0,
      `expected zero double-claims across ${RUNS} runs, got ${doubleClaimCount} ` +
      `(per-run claimant pids: ${JSON.stringify(perRunClaimants)}) — ` +
      `see conductor/tracks/1110-worker-separation-and-claim-race-safety/spec.md`
    );
  });
});
