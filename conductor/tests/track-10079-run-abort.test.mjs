#!/usr/bin/env node
// conductor/tests/track-10079-run-abort.test.mjs
// Track 10079 Phase 1: unit tests for conductor/services/run-abort.mjs — the
// pure abort-intent/signal helpers backing live turn cancellation. See
// test.md TC-1.1..TC-1.10.
//
// Run: env -u NODE_TEST_CONTEXT node --test conductor/tests/track-10079-run-abort.test.mjs

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync, spawn } from 'node:child_process';
import { buildRunMarker, runMarkerPath } from '../services/run-marker.mjs';
import {
  writeAbortIntent,
  readAbortIntent,
  nextAbortStage,
  getAbortGraceConfig,
  signalRunGroup,
  abortRun,
} from '../services/run-abort.mjs';

describe('run-abort.mjs', () => {
  it('TC-1.1: writeAbortIntent sets the three abort fields and preserves everything else byte-identical', () => {
    const marker = buildRunMarker({
      pid: 111, pgid: 111, workerPid: 222, trackNumber: '10079',
      dispatchId: 5, action: 'implement', command: 'claude',
      now: new Date('2026-09-07T10:00:00.000Z'),
    });
    const now = new Date('2026-09-07T10:05:00.000Z');
    const updated = writeAbortIntent(marker, { requestedBy: 'human', now });
    assert.equal(updated.abort_requested, true);
    assert.equal(updated.abort_requested_at, '2026-09-07T10:05:00.000Z');
    assert.equal(updated.abort_requested_by, 'human');
    for (const key of ['pid', 'pgid', 'worker_pid', 'action', 'command', 'started_at']) {
      assert.equal(updated[key], marker[key], `field ${key} must be preserved`);
    }
  });

  it('TC-1.2: readAbortIntent is null when abort_requested is absent — every pre-existing marker unaffected', () => {
    const marker = buildRunMarker({ pid: 1, pgid: 1, workerPid: 2, trackNumber: '1', command: 'claude' });
    assert.equal(readAbortIntent(marker), null);
  });

  it('TC-1.3: readAbortIntent returns the intent with requester and timestamp', () => {
    const marker = writeAbortIntent(
      buildRunMarker({ pid: 1, pgid: 1, workerPid: 2, trackNumber: '1', command: 'claude' }),
      { requestedBy: 'human', now: new Date('2026-09-07T10:00:00.000Z') }
    );
    assert.deepEqual(readAbortIntent(marker), { requestedAt: '2026-09-07T10:00:00.000Z', requestedBy: 'human' });
  });

  it('TC-1.4: signalRunGroup sends no kill when isPidAlive is false, reason pid-gone', () => {
    let killed = false;
    const marker = { pid: 111, pgid: 111, command: 'claude' };
    const result = signalRunGroup(marker, {
      stage: 'SIGINT',
      isPidAlive: () => false,
      readProcessCommand: () => 'claude',
      kill: () => { killed = true; },
    });
    assert.deepEqual(result, { ok: false, reason: 'pid-gone' });
    assert.equal(killed, false);
  });

  it('TC-1.5: pid reuse — command mismatch refuses the signal (AC-10)', () => {
    let killed = false;
    const marker = { pid: 111, pgid: 111, command: 'claude' };
    const result = signalRunGroup(marker, {
      stage: 'SIGINT',
      isPidAlive: () => true,
      readProcessCommand: () => '/usr/bin/vim notes.txt',
      kill: () => { killed = true; },
    });
    assert.deepEqual(result, { ok: false, reason: 'command-mismatch' });
    assert.equal(killed, false);
  });

  it('TC-1.6: invalid pgid values are all refused without signalling', () => {
    for (const pgid of [0, 1, -3, undefined, '1234']) {
      let killed = false;
      const marker = { pid: 111, pgid, command: 'claude' };
      const result = signalRunGroup(marker, {
        stage: 'SIGINT',
        isPidAlive: () => true,
        readProcessCommand: () => 'claude',
        kill: () => { killed = true; },
      });
      assert.deepEqual(result, { ok: false, reason: 'invalid-pgid' }, `pgid ${JSON.stringify(pgid)} must be refused`);
      assert.equal(killed, false);
    }
  });

  it('TC-1.7: on a live marker, signalRunGroup calls kill with a NEGATIVE first argument', () => {
    let callArgs = null;
    const marker = { pid: 111, pgid: 222, command: 'claude' };
    const result = signalRunGroup(marker, {
      stage: 'SIGTERM',
      isPidAlive: () => true,
      readProcessCommand: () => 'claude --print',
      kill: (...args) => { callArgs = args; },
    });
    assert.deepEqual(result, { ok: true, pid: 111, pgid: 222, signal: 'SIGTERM' });
    assert.deepEqual(callArgs, [-222, 'SIGTERM']);
    assert.ok(callArgs[0] < 0, 'must signal the negated pgid, not the bare pid');
  });

  it('TC-1.8: nextAbortStage escalates null -> SIGINT -> SIGTERM -> SIGKILL, and SIGKILL is terminal', () => {
    assert.equal(nextAbortStage(null), 'SIGINT');
    assert.equal(nextAbortStage(undefined), 'SIGINT');
    assert.equal(nextAbortStage('SIGINT'), 'SIGTERM');
    assert.equal(nextAbortStage('SIGTERM'), 'SIGKILL');
    assert.equal(nextAbortStage('SIGKILL'), 'SIGKILL');
  });

  it('TC-1.9: getAbortGraceConfig honors env overrides, falls back to 5000 defaults', () => {
    const prevSigint = process.env.LC_ABORT_SIGINT_GRACE_MS;
    const prevSigterm = process.env.LC_ABORT_SIGTERM_GRACE_MS;
    try {
      delete process.env.LC_ABORT_SIGINT_GRACE_MS;
      delete process.env.LC_ABORT_SIGTERM_GRACE_MS;
      assert.deepEqual(getAbortGraceConfig(), { sigintGraceMs: 5000, sigtermGraceMs: 5000 });

      process.env.LC_ABORT_SIGINT_GRACE_MS = '250';
      assert.equal(getAbortGraceConfig().sigintGraceMs, 250);
    } finally {
      if (prevSigint === undefined) delete process.env.LC_ABORT_SIGINT_GRACE_MS; else process.env.LC_ABORT_SIGINT_GRACE_MS = prevSigint;
      if (prevSigterm === undefined) delete process.env.LC_ABORT_SIGTERM_GRACE_MS; else process.env.LC_ABORT_SIGTERM_GRACE_MS = prevSigterm;
    }
  });

  describe('abortRun — orchestrator against a real sandbox marker', () => {
    let sandbox;

    before(() => {
      sandbox = mkdtempSync(join(tmpdir(), 'lc-run-abort-'));
      mkdirSync(join(sandbox, 'conductor', '.runs'), { recursive: true });
    });

    after(() => {
      rmSync(sandbox, { recursive: true, force: true });
    });

    it('TC-1.10: refuses a marker whose pid belongs to a real process that has already exited', async () => {
      // Spawn and let it exit so the pid is guaranteed dead (not merely "never existed").
      const child = spawnSync(process.execPath, ['-e', 'process.exit(0)']);
      const deadPid = child.pid;

      const marker = buildRunMarker({
        pid: deadPid, pgid: deadPid, workerPid: process.pid, trackNumber: 'dead',
        command: process.execPath,
      });
      const markerPath = runMarkerPath(sandbox, 'dead');
      writeFileSync(markerPath, JSON.stringify(marker, null, 2), 'utf8');

      let killed = false;
      const result = await abortRun({
        primaryRoot: sandbox,
        trackNumber: 'dead',
        requestedBy: 'human',
        isPidAlive: (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } },
        readProcessCommand: () => process.execPath,
        kill: () => { killed = true; },
      });

      assert.equal(result.ok, false);
      assert.equal(result.reason, 'pid-gone');
      assert.equal(killed, false);
      const onDisk = JSON.parse(readFileSync(markerPath, 'utf8'));
      assert.equal(onDisk.abort_requested, undefined, 'no intent should be written for a refused abort');
    });

    it('abortRun on a live marker writes the intent BEFORE signalling and returns the sent signal', async () => {
      const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true });
      child.unref();
      try {
        const marker = buildRunMarker({
          pid: child.pid, pgid: child.pid, workerPid: process.pid, trackNumber: 'live',
          command: process.execPath,
        });
        const markerPath = runMarkerPath(sandbox, 'live');
        writeFileSync(markerPath, JSON.stringify(marker, null, 2), 'utf8');

        const signals = [];
        const result = await abortRun({
          primaryRoot: sandbox,
          trackNumber: 'live',
          requestedBy: 'human',
          isPidAlive: (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } },
          readProcessCommand: () => process.execPath,
          kill: (pid, sig) => { signals.push([pid, sig]); },
        });

        assert.equal(result.ok, true);
        assert.equal(result.signal, 'SIGINT');
        assert.deepEqual(signals, [[-child.pid, 'SIGINT']]);

        const onDisk = JSON.parse(readFileSync(markerPath, 'utf8'));
        assert.equal(onDisk.abort_requested, true);
        assert.equal(onDisk.abort_requested_by, 'human');
      } finally {
        try { process.kill(child.pid, 'SIGKILL'); } catch { /* already gone */ }
      }
    });

    it('a stale escalation continuation refuses to signal a DIFFERENT run that now occupies the same track number', async () => {
      // Simulates a scheduled escalation firing against a marker that has
      // since been overwritten by a brand-new run (park -> resume ->
      // reclaim, all inside the grace window) — must never touch it.
      const originalMarker = buildRunMarker({
        pid: 111111, pgid: 111111, workerPid: process.pid, trackNumber: 'reused', command: 'node',
      });
      const replacementMarker = buildRunMarker({
        pid: 222222, pgid: 222222, workerPid: process.pid, trackNumber: 'reused', command: 'node',
      });
      const markerPath = runMarkerPath(sandbox, 'reused');
      writeFileSync(markerPath, JSON.stringify(replacementMarker, null, 2), 'utf8');

      let killed = false;
      const result = await abortRun({
        primaryRoot: sandbox,
        trackNumber: 'reused',
        requestedBy: 'human',
        isPidAlive: () => true,
        readProcessCommand: () => 'node',
        kill: () => { killed = true; },
        expectPid: originalMarker.pid,
      });

      assert.deepEqual(result, { ok: false, reason: 'different-run' });
      assert.equal(killed, false);
    });
  });
});
