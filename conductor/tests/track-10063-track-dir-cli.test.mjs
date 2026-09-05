// conductor/tests/track-10063-track-dir-cli.test.mjs
// Track 10063 Phase 2 (AC-7): `lc track-dir` must resolve an ambiguous,
// unregistered track number the SAME way the worker does — via
// resolveTrackFolderFs's content-size tie-break — not by falling back to
// decideTrackFolder's own internal alphabetical-order default the way the
// pre-fix CLI did when it called decideTrackFolder directly without
// supplying contentSizeByName.
//
// Spawns the real `lc` CLI against a throwaway project directory. No
// mocking — the point is what actually prints to stdout.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const LC_BIN = join(ROOT, 'bin', 'lc.mjs');

function writeTrack(tracksDir, name, files) {
  const dir = join(tracksDir, name);
  mkdirSync(dir, { recursive: true });
  for (const [file, content] of Object.entries(files)) {
    writeFileSync(join(dir, file), content, 'utf8');
  }
}

test('TC-7: lc track-dir picks the larger, real-content folder on an ambiguous, unregistered track — matching the worker\'s tie-break', () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'lc-10063-cli-'));
  try {
    const tracksDir = join(projectRoot, 'conductor', 'tracks');
    mkdirSync(tracksDir, { recursive: true });

    // Bare-numeric folder sorts FIRST alphabetically ("1" < "T") and is what
    // the pre-fix CLI (decideTrackFolder with no contentSizeByName) picked —
    // wrongly, since it's the near-empty accidental duplicate.
    writeTrack(tracksDir, '10063-slug', { 'index.md': '# Track 10063: x\n' });
    writeTrack(tracksDir, 'TU-10063-slug', {
      'index.md': '# Track TU-10063: x\n'.repeat(20),
      'spec.md': 'spec content\n'.repeat(20),
      'plan.md': 'plan content\n'.repeat(20),
      'conversation.md': 'convo\n'.repeat(20),
    });

    const out = execFileSync('node', [LC_BIN, 'track-dir', '10063'], {
      cwd: projectRoot,
      encoding: 'utf8',
    }).trim();

    assert.equal(out, join('conductor', 'tracks', 'TU-10063-slug'));
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});
