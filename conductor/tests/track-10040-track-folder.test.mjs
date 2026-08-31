// Track 10040 Phase 3 (REQ-15): decideTrackFolder pure tests. Must be
// byte-identical in behavior to laneconductor.sync.mjs's pre-extraction
// resolveTrackFolder (track 1119's quarantine semantics are load-bearing).

import { test } from 'node:test';
import assert from 'node:assert';
import { decideTrackFolder } from '../services/track-folder.mjs';

test('TC-84: both legacy and prefixed present, metadata registers the prefixed one -> canonical + quarantine legacy', () => {
  const r = decideTrackFolder({
    dirNames: ['10040-slug', 'AM-10040-slug'],
    trackNumber: '10040',
    registeredFolder: 'AM-10040-slug',
    registeredExists: true,
  });
  assert.equal(r.folder, 'AM-10040-slug');
  assert.deepEqual(r.quarantine, ['10040-slug']);
  assert.equal(r.metadataUpdate, null); // registered already correct — no metadata rewrite needed
});

test('TC-85: only AM-10040-slug present, no legacy match -> resolves via registered metadata, no quarantine', () => {
  const r = decideTrackFolder({
    dirNames: ['AM-10040-slug', 'AM-9999-other'],
    trackNumber: '10040',
    registeredFolder: 'AM-10040-slug',
    registeredExists: true,
  });
  assert.equal(r.folder, 'AM-10040-slug');
  assert.deepEqual(r.quarantine, []);
});

test('TC-86: only 10040-slug present, nothing registered -> resolves it, no quarantine (common legacy case)', () => {
  const r = decideTrackFolder({
    dirNames: ['10040-slug'],
    trackNumber: '10040',
    registeredFolder: null,
    registeredExists: false,
  });
  assert.equal(r.folder, '10040-slug');
  assert.deepEqual(r.quarantine, []);
});

test('TC-87: multiple legacy matches -> canonical chosen, rest quarantined, metadataUpdate present', () => {
  const r = decideTrackFolder({
    dirNames: ['10040-slug-a', '10040-slug-b'],
    trackNumber: '10040',
    registeredFolder: null,
    registeredExists: false,
  });
  assert.equal(r.folder, '10040-slug-a'); // sorted, first wins when nothing registered
  assert.deepEqual(r.quarantine, ['10040-slug-b']);
  assert.ok(r.metadataUpdate);
  assert.equal(r.metadataUpdate.folder_path, '10040-slug-a');
});

test('TC-88: no I/O — callable with a plain dirNames array, no filesystem at all', () => {
  // The test itself IS the proof: no existsSync/readdirSync import above,
  // and this still produces a correct answer.
  const r = decideTrackFolder({
    dirNames: ['10040-slug'], trackNumber: '10040', registeredFolder: null, registeredExists: false,
  });
  assert.equal(r.folder, '10040-slug');
});

test('unregistered, no match at all -> null, no quarantine', () => {
  const r = decideTrackFolder({
    dirNames: ['AM-9999-other'], trackNumber: '10040', registeredFolder: null, registeredExists: false,
  });
  assert.equal(r.folder, null);
  assert.deepEqual(r.quarantine, []);
});

test('single legacy match, registered points elsewhere but that folder does not exist -> trust the match', () => {
  const r = decideTrackFolder({
    dirNames: ['10040-slug'], trackNumber: '10040', registeredFolder: 'AM-10040-slug', registeredExists: false,
  });
  assert.equal(r.folder, '10040-slug');
  assert.deepEqual(r.quarantine, []);
});
