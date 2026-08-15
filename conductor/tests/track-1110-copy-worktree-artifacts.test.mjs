// Track 1110 Phase 6: copyWorktreeArtifactsToPrimary() is the exact logic
// the live exit handler runs to bring a worktree's finished track docs back
// onto the primary checkout — extracted so a startup reconciliation pass
// (for dispatches orphaned by a worker restart) can call the identical,
// already-safety-guarded code path instead of re-deriving a parallel copy.
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { copyWorktreeArtifactsToPrimary } from '../services/worktree-artifact-merge.mjs';

// Minimal stand-in for laneconductor.sync.mjs's real resolveTrackFolder —
// this test only needs the "find the NNN-slug dir" behavior, not its
// ambiguous-folder quarantine logic.
function resolveTrackFolder(tracksDir, trackNumber) {
  if (!existsSync(tracksDir)) return null;
  const match = readdirSync(tracksDir).find(d => d.startsWith(`${trackNumber}-`));
  return match || null;
}

describe('copyWorktreeArtifactsToPrimary', () => {
  let root, worktreePath, primaryRoot;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'lc-artifact-copy-'));
    worktreePath = join(root, 'worktree');
    primaryRoot = join(root, 'primary');
    mkdirSync(join(worktreePath, 'conductor', 'tracks', '1110-fake-track'), { recursive: true });
    mkdirSync(join(primaryRoot, 'conductor', 'tracks', '1110-fake-track'), { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('merges index.md status markers, full-replaces other artifacts', () => {
    writeFileSync(
      join(worktreePath, 'conductor', 'tracks', '1110-fake-track', 'index.md'),
      '# Track 1110\n\n**Lane**: done\n**Lane Status**: success\n\n## Problem\nWorktree body — should not overwrite primary body.\n'
    );
    writeFileSync(
      join(primaryRoot, 'conductor', 'tracks', '1110-fake-track', 'index.md'),
      '# Track 1110\n\n**Lane**: implement\n**Lane Status**: running\n\n## Problem\nOriginal primary body, must survive.\n'
    );
    writeFileSync(join(worktreePath, 'conductor', 'tracks', '1110-fake-track', 'plan.md'), '# New plan content\n'.repeat(20));

    const { copied } = copyWorktreeArtifactsToPrimary({
      worktreePath, trackNumber: '1110', isSuccess: true, primaryRoot, resolveTrackFolder,
    });

    assert.ok(copied.includes('index.md'));
    assert.ok(copied.includes('plan.md'));
    const mergedIndex = readFileSync(join(primaryRoot, 'conductor', 'tracks', '1110-fake-track', 'index.md'), 'utf8');
    assert.match(mergedIndex, /\*\*Lane\*\*: done/);
    assert.match(mergedIndex, /Original primary body, must survive\./);
    const plan = readFileSync(join(primaryRoot, 'conductor', 'tracks', '1110-fake-track', 'plan.md'), 'utf8');
    assert.match(plan, /New plan content/);
  });

  it('refuses to overwrite with a suspiciously truncated index.md on failure', () => {
    const goodBody = '# Track 1110\n\n**Lane**: implement\n\n## Problem\n' + 'Real content line.\n'.repeat(30);
    writeFileSync(join(primaryRoot, 'conductor', 'tracks', '1110-fake-track', 'index.md'), goodBody);
    writeFileSync(join(worktreePath, 'conductor', 'tracks', '1110-fake-track', 'index.md'), '# Track 1110\n\n**Lane**: implement\n');

    const { copied } = copyWorktreeArtifactsToPrimary({
      worktreePath, trackNumber: '1110', isSuccess: false, primaryRoot, resolveTrackFolder,
    });

    assert.ok(!copied.includes('index.md'), 'must not report a skipped-for-safety file as copied');
    const stillGood = readFileSync(join(primaryRoot, 'conductor', 'tracks', '1110-fake-track', 'index.md'), 'utf8');
    assert.equal(stillGood, goodBody);
  });

  it('creates the primary track dir when it does not exist yet (planning agent created it in the worktree)', () => {
    rmSync(join(primaryRoot, 'conductor', 'tracks', '1110-fake-track'), { recursive: true, force: true });
    writeFileSync(join(worktreePath, 'conductor', 'tracks', '1110-fake-track', 'index.md'), '# Track 1110\n\n**Lane**: plan\n');

    const { copied, destDir } = copyWorktreeArtifactsToPrimary({
      worktreePath, trackNumber: '1110', isSuccess: true, primaryRoot, resolveTrackFolder,
    });

    assert.ok(copied.includes('index.md'));
    assert.ok(existsSync(join(destDir, 'index.md')));
  });

  it('returns nothing when the worktree has no folder for this track', () => {
    const { copied, destDir } = copyWorktreeArtifactsToPrimary({
      worktreePath, trackNumber: '9999', isSuccess: true, primaryRoot, resolveTrackFolder,
    });
    assert.deepEqual(copied, []);
    assert.equal(destDir, null);
  });
});
