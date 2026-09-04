// Track 10060 Phase 2 (REQ-2,3,4,5): the primary defect.
//
// When POST /track/:num/prespawn-block fails — which it does on any database
// where ui/server/migrations/013_track_10040_prespawn_block.sql was never
// applied, and nothing applies those automatically — handlePreSpawnBlock used
// to hardcode countBefore = 0. That pins every block at first-of-streak
// forever: escalation to done:failure becomes structurally unreachable and a
// permanently-wedged track retries and re-warns indefinitely. These tests
// cover the filesystem sibling-counter fallback that makes escalation
// reachable in every mode.

import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, mkdirSync, existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  readAndIncrementBlockCount,
  resetBlockCount,
  resolveBlockCountBefore,
  formatCounterBackendWarning,
  COUNTER_BACKEND_MIGRATION_PATH,
} from '../services/prespawn-block-counter.mjs';
import { decidePreSpawnBlockOutcome, BLOCK_KINDS } from '../services/prespawn-block.mjs';

function makeTrackDir() {
  const root = mkdtempSync(join(tmpdir(), 'lc-10060-'));
  const tracksDir = join(root, 'conductor', 'tracks');
  const trackDirName = 'TU-10060-x';
  mkdirSync(join(tracksDir, trackDirName), { recursive: true });
  return { root, tracksDir, trackDirName };
}

test('TC-7: five consecutive same-kind blocks return countBefore 0,1,2,3,4 and leave the file at 5', () => {
  const { root, tracksDir, trackDirName } = makeTrackDir();
  try {
    const seen = [];
    for (let i = 0; i < 5; i++) {
      seen.push(readAndIncrementBlockCount(tracksDir, trackDirName, BLOCK_KINDS.DIRTY_CHECKOUT));
    }
    assert.deepEqual(seen, [0, 1, 2, 3, 4]);
    assert.equal(readFileSync(join(tracksDir, trackDirName, '.prespawn-block-count'), 'utf8'), '5');
    assert.equal(readFileSync(join(tracksDir, trackDirName, '.prespawn-block-kind'), 'utf8'), BLOCK_KINDS.DIRTY_CHECKOUT);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('TC-8: a cause change resets the streak (REQ-3, same semantics as the local-fs path)', () => {
  const { root, tracksDir, trackDirName } = makeTrackDir();
  try {
    readAndIncrementBlockCount(tracksDir, trackDirName, BLOCK_KINDS.DIRTY_CHECKOUT);
    readAndIncrementBlockCount(tracksDir, trackDirName, BLOCK_KINDS.DIRTY_CHECKOUT);
    const third = readAndIncrementBlockCount(tracksDir, trackDirName, BLOCK_KINDS.MAIN_MODE_LOCK);
    assert.equal(third, 0, 'a different kind starts a new streak');
    assert.equal(readFileSync(join(tracksDir, trackDirName, '.prespawn-block-kind'), 'utf8'), BLOCK_KINDS.MAIN_MODE_LOCK);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('TC-9: fallback counts 0..4 produce warn, silent, silent, silent, escalate — exactly two comments', () => {
  const actions = [0, 1, 2, 3, 4].map(countBefore =>
    decidePreSpawnBlockOutcome({ kind: BLOCK_KINDS.DIRTY_CHECKOUT, countBefore, threshold: 5 }).action
  );
  assert.deepEqual(actions, ['warn', 'silent', 'silent', 'silent', 'escalate']);
  assert.equal(actions.filter(a => a !== 'silent').length, 2);
});

test('TC-10: with the collector rejecting, five consecutive blocks still reach escalate', async () => {
  const { root, tracksDir, trackDirName } = makeTrackDir();
  try {
    const recordViaApi = async () => { throw new Error('500 Internal Server Error'); };
    const actions = [];
    for (let i = 0; i < 5; i++) {
      const { countBefore, source } = await resolveBlockCountBefore({
        useApi: true, recordViaApi, tracksDir, trackDirName, kind: BLOCK_KINDS.DIRTY_CHECKOUT,
      });
      assert.equal(source, 'fs-fallback');
      actions.push(decidePreSpawnBlockOutcome({ kind: BLOCK_KINDS.DIRTY_CHECKOUT, countBefore, threshold: 5 }).action);
    }
    assert.deepEqual(actions, ['warn', 'silent', 'silent', 'silent', 'escalate']);
    assert.notEqual(actions.filter(a => a === 'warn').length, 5, 'the old failing-open behaviour warned five times and never escalated');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('TC-11: collector rejecting with no track folder stays at first-of-streak and does not throw', async () => {
  const recordViaApi = async () => { throw new Error('500 Internal Server Error'); };
  for (let i = 0; i < 3; i++) {
    const { countBefore, source } = await resolveBlockCountBefore({
      useApi: true, recordViaApi, tracksDir: null, trackDirName: null, kind: BLOCK_KINDS.DIRTY_CHECKOUT,
    });
    assert.equal(countBefore, 0, 'there is nowhere safe to persist a count — first-of-streak is the only honest answer');
    assert.equal(source, 'none');
  }
});

test('TC-12: counter-backend failure is greppable, names the unapplied migration, and is gated to once per streak', async () => {
  const { root, tracksDir, trackDirName } = makeTrackDir();
  try {
    const recordViaApi = async () => { throw new Error('500 Internal Server Error'); };
    const warned = [];
    for (let i = 0; i < 3; i++) {
      const { countBefore, source, backendError } = await resolveBlockCountBefore({
        useApi: true, recordViaApi, tracksDir, trackDirName, kind: BLOCK_KINDS.DIRTY_CHECKOUT,
      });
      // This is the caller's gating rule, asserted here as the contract:
      // report once, at the head of the streak, never every cycle.
      if (source === 'fs-fallback' && countBefore === 0) {
        warned.push(formatCounterBackendWarning(backendError));
      }
    }
    assert.equal(warned.length, 1, 'exactly one report per streak');
    assert.match(warned[0], /prespawn-counter-backend-unavailable/);
    assert.match(warned[0], new RegExp(COUNTER_BACKEND_MIGRATION_PATH.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(warned[0], /500 Internal Server Error/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('TC-13: a successful spawn resets the fallback counter, so the next block is a fresh warn', async () => {
  const { root, tracksDir, trackDirName } = makeTrackDir();
  try {
    const recordViaApi = async () => { throw new Error('500'); };
    for (let i = 0; i < 3; i++) {
      await resolveBlockCountBefore({ useApi: true, recordViaApi, tracksDir, trackDirName, kind: BLOCK_KINDS.DIRTY_CHECKOUT });
    }
    resetBlockCount(tracksDir, trackDirName);
    assert.equal(existsSync(join(tracksDir, trackDirName, '.prespawn-block-count')), false);
    assert.equal(existsSync(join(tracksDir, trackDirName, '.prespawn-block-kind')), false);

    const { countBefore } = await resolveBlockCountBefore({ useApi: true, recordViaApi, tracksDir, trackDirName, kind: BLOCK_KINDS.DIRTY_CHECKOUT });
    assert.equal(decidePreSpawnBlockOutcome({ kind: BLOCK_KINDS.DIRTY_CHECKOUT, countBefore, threshold: 5 }).action, 'warn');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a working collector is used verbatim and never touches the filesystem counter', async () => {
  const { root, tracksDir, trackDirName } = makeTrackDir();
  try {
    const recordViaApi = async () => ({ count: 4 });
    const { countBefore, source } = await resolveBlockCountBefore({
      useApi: true, recordViaApi, tracksDir, trackDirName, kind: BLOCK_KINDS.DIRTY_CHECKOUT,
    });
    assert.equal(countBefore, 3, 'the API reports the count AFTER this block; countBefore is one less');
    assert.equal(source, 'api');
    assert.equal(existsSync(join(tracksDir, trackDirName, '.prespawn-block-count')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('local-fs mode uses the filesystem counter directly, without an API call', async () => {
  const { root, tracksDir, trackDirName } = makeTrackDir();
  try {
    const recordViaApi = async () => { throw new Error('must not be called in local-fs mode'); };
    const { countBefore, source } = await resolveBlockCountBefore({
      useApi: false, recordViaApi, tracksDir, trackDirName, kind: BLOCK_KINDS.DIRTY_CHECKOUT,
    });
    assert.equal(countBefore, 0);
    assert.equal(source, 'fs');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a corrupt count file is treated as a fresh streak rather than crashing the guard', () => {
  const { root, tracksDir, trackDirName } = makeTrackDir();
  try {
    writeFileSync(join(tracksDir, trackDirName, '.prespawn-block-count'), 'not-a-number', 'utf8');
    writeFileSync(join(tracksDir, trackDirName, '.prespawn-block-kind'), BLOCK_KINDS.DIRTY_CHECKOUT, 'utf8');
    assert.equal(readAndIncrementBlockCount(tracksDir, trackDirName, BLOCK_KINDS.DIRTY_CHECKOUT), 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('resetBlockCount is a no-op when there is no track folder', () => {
  assert.doesNotThrow(() => resetBlockCount(null, null));
});
