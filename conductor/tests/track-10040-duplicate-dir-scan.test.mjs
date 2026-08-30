// Track 10040 (Findings 2 + 6): quarantined `_duplicate-*` folders must
// never be scanned as live tracks.
//
// Both failures below were observed live on 2026-08-30 against the real
// worker, not hypothesised:
//
//   1. A `_duplicate-*` folder retaining `**Lane Status**: running` counted
//      toward its lane's parallel_limit forever, so the real track could
//      never be claimed:
//        [local-fs] Lane "implement" at limit 2 (Running: 3, Claimed: 0).
//   2. The auto-launch loop scanned a legacy folder, a concurrent quarantine
//      renamed it, and the spawn then opened the pre-rename path:
//        [local-fs] Failed to spawn track 10040: ENOENT ...
//        'conductor/tracks/10040-manager-stuck-track-healing/index.md'
//
// The shared cause is that every track-dir scan tested only `/\d+/`, which
// `_duplicate-10040-foo` satisfies. These tests pin the predicate that fixes
// it; they fail against the pre-fix bare-regex filter.

import { test } from 'node:test';
import assert from 'node:assert';

// Mirrors isTrackDirName in conductor/laneconductor.sync.mjs. That module
// boots a whole worker on import and exports only normalizeAuthorForComment,
// so the predicate cannot be imported directly (the same constraint track
// 10036's tests hit). Kept in sync by TC-4 below, which asserts the source
// contains no remaining bare-regex scan.
function isTrackDirName(name) {
  return /\d+/.test(name) && !name.startsWith('_duplicate-');
}

test('TC-1: quarantined duplicate is not scanned as a track', () => {
  assert.equal(isTrackDirName('_duplicate-10040-manager-stuck-track-healing'), false);
  assert.equal(isTrackDirName('_duplicate-10036-fix-stale-tracks-metadata-cache'), false);
});

test('TC-2: real track folders still scan, both naming conventions', () => {
  // Current convention (INITIALS-NNN-slug) and legacy (NNN-slug).
  assert.equal(isTrackDirName('AM-10040-manager-stuck-track-healing'), true);
  assert.equal(isTrackDirName('10036-fix-stale-tracks-metadata-cache'), true);
  assert.equal(isTrackDirName('1091-manager-worker-and-new-project-flow'), true);
});

test('TC-3: a quarantined folder cannot burn a parallel_limit slot', () => {
  // Reproduces failure (1): the live counter did
  //   readdirSync(tracksDir).filter(d => /\d+/.test(d))
  // then counted every '**Lane Status**: running' it found.
  const dirs = [
    'AM-10040-manager-stuck-track-healing',      // queued, not running
    '_duplicate-10039-cloud-workers-claude-cloud', // stale 'running' marker
    '_duplicate-10038-widen-bookkeeping-conflict', // stale 'running' marker
  ];
  const running = new Set([
    '_duplicate-10039-cloud-workers-claude-cloud',
    '_duplicate-10038-widen-bookkeeping-conflict',
  ]);

  const preFix = dirs.filter(d => /\d+/.test(d)).filter(d => running.has(d)).length;
  const postFix = dirs.filter(isTrackDirName).filter(d => running.has(d)).length;

  assert.equal(preFix, 2, 'pre-fix filter counts phantom slots (the live bug)');
  assert.equal(postFix, 0, 'post-fix filter counts none');
});

test('TC-4: no bare-regex track-dir scan remains in the worker source', async () => {
  // Guards the duplicated predicate above: if a new scan reintroduces the
  // bare filter, this fails rather than silently regressing.
  const { readFileSync } = await import('node:fs');
  const src = readFileSync('conductor/laneconductor.sync.mjs', 'utf8');
  const bare = src.match(/readdirSync\(tracksDir\)[\s\n]*\.filter\(d => \/\\d\+\/\.test\(d\)\)/g) || [];
  assert.equal(bare.length, 0, `found ${bare.length} un-migrated bare-regex scan(s)`);
  assert.ok(src.includes('function isTrackDirName('), 'helper must exist');
});
