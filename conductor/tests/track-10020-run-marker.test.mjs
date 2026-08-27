#!/usr/bin/env node
// conductor/tests/track-10020-run-marker.test.mjs
// Track 10020 Phase 1: unit tests for conductor/services/run-marker.mjs —
// the pure path/serialize/liveness helpers backing the persistent
// cross-process run marker. See test.md TC-1.1..TC-1.8.
//
// Run: node --test conductor/tests/track-10020-run-marker.test.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  runMarkerPath,
  buildRunMarker,
  parseRunMarker,
  isRunMarkerLive,
} from '../services/run-marker.mjs';

describe('run-marker.mjs', () => {
  it('TC-1.1: runMarkerPath joins primary root, conductor/.runs, and <track>.json', () => {
    assert.equal(runMarkerPath('/repo', '10020'), '/repo/conductor/.runs/10020.json');
  });

  it('TC-1.2: buildRunMarker round-trips through JSON.stringify -> parseRunMarker', () => {
    const now = new Date('2026-08-27T10:00:00.000Z');
    const marker = buildRunMarker({
      pid: 123456,
      pgid: 123456,
      workerPid: 99887,
      trackNumber: '10020',
      dispatchId: 1588,
      action: 'quality-gate',
      command: 'claude',
      now,
    });
    const parsed = parseRunMarker(JSON.stringify(marker));
    assert.deepEqual(parsed, {
      pid: 123456,
      pgid: 123456,
      worker_pid: 99887,
      track_number: '10020',
      dispatch_id: 1588,
      action: 'quality-gate',
      command: 'claude',
      started_at: '2026-08-27T10:00:00.000Z',
    });
  });

  it('TC-1.3: parseRunMarker returns null on truncated/malformed JSON without throwing', () => {
    assert.equal(parseRunMarker('{ truncated'), null);
  });

  it('TC-1.3b: parseRunMarker returns null on a well-formed but pid-less object', () => {
    assert.equal(parseRunMarker('{}'), null);
  });

  it('TC-1.4: isRunMarkerLive is live when pid alive and command matches', () => {
    const marker = { pid: 111, command: 'claude' };
    const result = isRunMarkerLive(marker, {
      isPidAlive: () => true,
      readProcessCommand: () => 'claude --print --resume abc123',
    });
    assert.deepEqual(result, { live: true });
  });

  it('TC-1.5: isRunMarkerLive is not live when pid is gone, without consulting readProcessCommand', () => {
    let readProcessCommandCalled = false;
    const marker = { pid: 111, command: 'claude' };
    const result = isRunMarkerLive(marker, {
      isPidAlive: () => false,
      readProcessCommand: () => { readProcessCommandCalled = true; return 'claude'; },
    });
    assert.deepEqual(result, { live: false, reason: 'pid-gone' });
    assert.equal(readProcessCommandCalled, false);
  });

  it('TC-1.6: isRunMarkerLive detects pid reuse via command mismatch', () => {
    const marker = { pid: 111, command: 'claude' };
    const result = isRunMarkerLive(marker, {
      isPidAlive: () => true,
      readProcessCommand: () => '/usr/bin/vim notes.txt',
    });
    assert.deepEqual(result, { live: false, reason: 'command-mismatch' });
  });

  it('TC-1.7: isRunMarkerLive fails open (not live) when the command cannot be read at all', () => {
    const marker = { pid: 111, command: 'claude' };
    const result = isRunMarkerLive(marker, {
      isPidAlive: () => true,
      readProcessCommand: () => null,
    });
    assert.deepEqual(result, { live: false, reason: 'command-unreadable' });
  });

  it('TC-1.8: isRunMarkerLive(null, ...) is not live and does not throw', () => {
    assert.doesNotThrow(() => {
      const result = isRunMarkerLive(null, {
        isPidAlive: () => { throw new Error('should not be called'); },
        readProcessCommand: () => { throw new Error('should not be called'); },
      });
      assert.deepEqual(result, { live: false });
    });
  });
});
