#!/usr/bin/env node
// conductor/tests/track-10099-startup-tdz-crashes.test.mjs
// Track AM-10099 Phase 11 Task 5 (item n): two TDZ ("Cannot access '<x>'
// before initialization") crashes fire on every real worker start, caught
// live in this track's own log during the planning pass. Both are the
// same class track 1114 already fixed once for `cachedMainBranch` — a
// `const` declared late in this single top-to-bottom module, reached by
// code that runs before the top-level evaluator gets there.
//
// Root cause (traced by source line, not guessed): the module has a
// top-level `await upsertWorker();` partway through the file. Two things
// scheduled BEFORE that line — `setTimeout(refreshFileManifestCache, 0)`
// and, inside upsertWorker's own body, a fire-and-forgotten
// `reconcileOrphanedDispatches()` call issued right after upsertWorker's
// own internal `await post(...)` resolves — both run while the top-level
// await is still suspended, i.e. BEFORE the module's synchronous
// evaluation has reached `const gitExec = ...` / `const activeDispatch =
// ...` further down the file. Track 1114's `setTimeout(fn, 0)` remedy is
// already applied to refreshFileManifestCache and still fails, because a
// top-level `await` — not just a plain macrotask boundary — sits between
// the schedule point and the declarations.
//
// Uses the sanctioned real-worker-spawn helper from Phase 1
// (conductor/tests/helpers/isolated-worker.mjs) since this is a
// module-evaluation-order bug only reproducible by actually running the
// file — importing it directly is not an option (side effects on import,
// same reason every other test in this suite avoids that).
//
// Run: node --test conductor/tests/track-10099-startup-tdz-crashes.test.mjs

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeSandbox, cleanupSandbox, startIsolatedWorker, stopWorker } from './helpers/isolated-worker.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SYNC_SRC_PATH = join(__dirname, '../laneconductor.sync.mjs');

// ── Deterministic source-level pin ──────────────────────────────────────────
// The live-spawn test below is a best-effort reproduction of a genuine
// macrotask/network-timing race — it may or may not trigger on any given
// run/machine, which is exactly why the *mechanism* also needs a
// deterministic guard: both declarations must appear, by source line
// number, before the top-level `await upsertWorker();` line. This is the
// actual structural property the fix establishes, and unlike the live
// race it can be checked reliably every run.
describe('source-level pin: TDZ-prone declarations precede the top-level await (item n)', () => {
  const src = readFileSync(SYNC_SRC_PATH, 'utf8');
  const lines = src.split('\n');
  const lineOf = (re) => lines.findIndex(l => re.test(l));

  const awaitUpsertLine = lineOf(/^await upsertWorker\(\);/);
  const gitExecLine = lineOf(/^const gitExec = /);
  const activeDispatchLine = lineOf(/^const activeDispatch = new Map\(\);/);

  it('sanity: all three anchors are found', () => {
    assert.notEqual(awaitUpsertLine, -1, 'top-level `await upsertWorker();` must still exist under this exact spelling');
    assert.notEqual(gitExecLine, -1);
    assert.notEqual(activeDispatchLine, -1);
  });

  it('const gitExec is declared before the top-level await upsertWorker()', () => {
    assert.ok(
      gitExecLine < awaitUpsertLine,
      `gitExec declared at line ${gitExecLine + 1}, but the top-level await is at line ${awaitUpsertLine + 1} — anything reachable before that await (the file-manifest setTimeout(0) tick, or code inside upsertWorker itself) can observe gitExec in its TDZ.`
    );
  });

  it('const activeDispatch is declared before the top-level await upsertWorker()', () => {
    assert.ok(
      activeDispatchLine < awaitUpsertLine,
      `activeDispatch declared at line ${activeDispatchLine + 1}, but the top-level await is at line ${awaitUpsertLine + 1} — upsertWorker's own post-registration reconcileOrphanedDispatches() call can observe activeDispatch in its TDZ.`
    );
  });
});

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// A refusing port (isolated-worker.mjs's own default) makes
// upsertWorker()'s `await post(url, token, '/worker/register', ...)`
// throw immediately — before `myWorkerId` is ever set, so
// reconcileOrphanedDispatches() (the activeDispatch TDZ site) is never
// even reached, and the race this test exists to catch cannot fire. A
// REAL collector that actually answers /worker/register is required to
// let upsertWorker run its full body past that await, same as the real
// incident (this project's own local-api collector, not a refusing port).
function startMockCollector() {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [join(__dirname, 'mock-collector.mjs')], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    proc.stdout.on('data', d => {
      out += d.toString();
      const m = out.match(/MOCK_COLLECTOR_PORT=(\d+)/);
      if (m) resolve({ proc, port: parseInt(m[1], 10) });
    });
    proc.on('error', reject);
    setTimeout(() => reject(new Error('mock-collector startup timeout')), 5000);
  });
}

describe('worker startup — no TDZ crash (Track AM-10099 Phase 11, item n)', () => {
  let sandbox;
  let worker;
  let collector;

  after(async () => {
    if (worker) await stopWorker(worker);
    if (collector) collector.proc.kill();
    if (sandbox) cleanupSandbox(sandbox);
  });

  it('a real worker start logs no "Cannot access ... before initialization" error', async () => {
    collector = await startMockCollector();
    sandbox = makeSandbox('tdz-startup');
    worker = await startIsolatedWorker({ sandbox, collectorPort: collector.port });
    await worker.waitForServingRoot();
    // Give the two known early-firing call sites (the file-manifest
    // setTimeout(0) tick, and upsertWorker's post-registration
    // reconcileOrphanedDispatches) a moment to actually run.
    await sleep(1500);

    const out = worker.getOutput();
    assert.ok(
      !out.includes("Cannot access 'gitExec' before initialization"),
      `refreshFileManifestCache's gitExec TDZ crash reproduced. Output:\n${out}`
    );
    assert.ok(
      !out.includes("Cannot access 'activeDispatch' before initialization"),
      `reconcileOrphanedDispatches' activeDispatch TDZ crash reproduced. Output:\n${out}`
    );
  });
});
