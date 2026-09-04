// Track 10063 Phase 1/2: resolveTrackFolderFs — the shared filesystem-fact
// gatherer every reader (worker, CLI, Collector API) is meant to use instead
// of hand-rolling its own directory scan. Real temp trees, no mocked fs —
// the whole point of this track is that the write lands on the right path.

import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { resolveTrackFolderFs } from '../services/track-folder-fs.mjs';

function makeTracksDir() {
  const root = mkdtempSync(join(tmpdir(), 'lc-10063-'));
  const tracksDir = join(root, 'conductor', 'tracks');
  mkdirSync(tracksDir, { recursive: true });
  return { root, tracksDir };
}

function writeTrack(tracksDir, name, files) {
  const dir = join(tracksDir, name);
  mkdirSync(dir, { recursive: true });
  for (const [file, content] of Object.entries(files)) {
    writeFileSync(join(dir, file), content, 'utf8');
  }
}

test('TC-1: only a prefixed folder exists, nothing registered — resolves it (the case the old server regex could not see)', () => {
  const { root, tracksDir } = makeTracksDir();
  try {
    writeTrack(tracksDir, 'TU-10063-slug', { 'index.md': '# Track TU-10063: x\n' });
    const r = resolveTrackFolderFs({ tracksDir, trackNumber: '10063', metadataPath: join(root, 'conductor', 'tracks-metadata.json') });
    assert.equal(r.folder, 'TU-10063-slug');
    assert.equal(r.matches, 1);
    assert.deepEqual(r.quarantine, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('TC-2: prefixed folder (larger, real content) + bare-numeric duplicate (smaller), nothing registered — content-size tie-break picks the prefixed one', () => {
  const { root, tracksDir } = makeTracksDir();
  try {
    writeTrack(tracksDir, 'TU-10063-slug', {
      'index.md': '# Track TU-10063: x\n'.repeat(20),
      'spec.md': 'spec content\n'.repeat(20),
      'plan.md': 'plan content\n'.repeat(20),
      'conversation.md': 'convo\n'.repeat(20),
    });
    writeTrack(tracksDir, '10063-slug', {
      'index.md': '# Track 10063: x\n',
      'spec.md': 'spec\n',
    });
    const r = resolveTrackFolderFs({ tracksDir, trackNumber: '10063', metadataPath: join(root, 'conductor', 'tracks-metadata.json') });
    assert.equal(r.folder, 'TU-10063-slug');
    assert.deepEqual(r.quarantine, ['10063-slug']);
    assert.equal(r.matches, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('TC-3: same ambiguous tree, but metadata registers the bare-numeric one — registration outranks content size', () => {
  const { root, tracksDir } = makeTracksDir();
  try {
    writeTrack(tracksDir, 'TU-10063-slug', {
      'index.md': '# Track TU-10063: x\n'.repeat(20),
      'spec.md': 'spec content\n'.repeat(20),
    });
    writeTrack(tracksDir, '10063-slug', { 'index.md': '# Track 10063: x\n' });
    const metadataPath = join(root, 'conductor', 'tracks-metadata.json');
    writeFileSync(metadataPath, JSON.stringify({ tracks: { '10063': { folder_path: '10063-slug' } } }), 'utf8');

    const r = resolveTrackFolderFs({ tracksDir, trackNumber: '10063', metadataPath });
    assert.equal(r.folder, '10063-slug');
    assert.deepEqual(r.quarantine, ['TU-10063-slug']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('TC-4: malformed tracks-metadata.json is tolerated — resolves as if unregistered, never throws', () => {
  const { root, tracksDir } = makeTracksDir();
  try {
    writeTrack(tracksDir, 'TU-10063-slug', { 'index.md': '# Track TU-10063: x\n' });
    const metadataPath = join(root, 'conductor', 'tracks-metadata.json');
    writeFileSync(metadataPath, '{ not valid json', 'utf8');

    assert.doesNotThrow(() => {
      const r = resolveTrackFolderFs({ tracksDir, trackNumber: '10063', metadataPath });
      assert.equal(r.folder, 'TU-10063-slug');
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('TC-5: resolveTrackFolderFs applies no effects — both dirs and metadata are untouched after the call', () => {
  const { root, tracksDir } = makeTracksDir();
  try {
    writeTrack(tracksDir, 'TU-10063-slug', {
      'index.md': '# Track TU-10063: x\n'.repeat(20),
      'spec.md': 'spec content\n'.repeat(20),
    });
    writeTrack(tracksDir, '10063-slug', { 'index.md': '# Track 10063: x\n' });
    const metadataPath = join(root, 'conductor', 'tracks-metadata.json');
    const before = JSON.stringify({ tracks: {} });
    writeFileSync(metadataPath, before, 'utf8');

    resolveTrackFolderFs({ tracksDir, trackNumber: '10063', metadataPath });

    assert.ok(existsSync(join(tracksDir, 'TU-10063-slug')));
    assert.ok(existsSync(join(tracksDir, '10063-slug')));
    assert.equal(readFileSync(metadataPath, 'utf8'), before);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
