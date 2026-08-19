// Track 1110 Phase 6: copyWorktreeArtifactsToPrimary() is the exact logic
// the live exit handler runs to bring a worktree's finished track docs back
// onto the primary checkout — extracted so a startup reconciliation pass
// (for dispatches orphaned by a worker restart) can call the identical,
// already-safety-guarded code path instead of re-deriving a parallel copy.
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, statSync, utimesSync } from 'node:fs';
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

  it('skipUnchanged: does not read or write a file whose worktree mtime is not newer than the primary copy (track 10019 / REQ-9)', () => {
    const planPath = join(worktreePath, 'conductor', 'tracks', '1110-fake-track', 'plan.md');
    const primaryPlanPath = join(primaryRoot, 'conductor', 'tracks', '1110-fake-track', 'plan.md');
    writeFileSync(planPath, '# Plan v1\n');
    writeFileSync(primaryPlanPath, '# Plan v1\n');
    // Make the primary copy's mtime strictly newer than the worktree's,
    // simulating "nothing changed since the last periodic pass".
    const now = Date.now();
    utimesSync(planPath, now / 1000, now / 1000);
    utimesSync(primaryPlanPath, (now + 5000) / 1000, (now + 5000) / 1000);
    const beforeMtime = statSync(primaryPlanPath).mtimeMs;

    const { copied } = copyWorktreeArtifactsToPrimary({
      worktreePath, trackNumber: '1110', isSuccess: false, primaryRoot, resolveTrackFolder, skipUnchanged: true,
    });

    assert.ok(!copied.includes('plan.md'), 'an unchanged file must not be reported as copied');
    assert.equal(statSync(primaryPlanPath).mtimeMs, beforeMtime, 'the primary file must not have been rewritten');
  });

  it('skipUnchanged: still copies a file whose worktree mtime IS newer than the primary copy', () => {
    const planPath = join(worktreePath, 'conductor', 'tracks', '1110-fake-track', 'plan.md');
    const primaryPlanPath = join(primaryRoot, 'conductor', 'tracks', '1110-fake-track', 'plan.md');
    writeFileSync(primaryPlanPath, '# Plan v1\n');
    const now = Date.now();
    utimesSync(primaryPlanPath, now / 1000, now / 1000);
    writeFileSync(planPath, '# Plan v2 — agent updated mid-run\n');
    utimesSync(planPath, (now + 5000) / 1000, (now + 5000) / 1000);

    const { copied } = copyWorktreeArtifactsToPrimary({
      worktreePath, trackNumber: '1110', isSuccess: false, primaryRoot, resolveTrackFolder, skipUnchanged: true,
    });

    assert.ok(copied.includes('plan.md'));
    assert.match(readFileSync(primaryPlanPath, 'utf8'), /Plan v2/);
  });

  it('records a guard-skipped copy in `skipped` with file/reason/sizes (track 10019 / REQ-11)', () => {
    const goodBody = '# Track 1110\n\n**Lane**: implement\n\n## Problem\n' + 'Real content line.\n'.repeat(30);
    writeFileSync(join(primaryRoot, 'conductor', 'tracks', '1110-fake-track', 'index.md'), goodBody);
    writeFileSync(join(worktreePath, 'conductor', 'tracks', '1110-fake-track', 'index.md'), '# Track 1110\n\n**Lane**: implement\n');

    const { copied, skipped } = copyWorktreeArtifactsToPrimary({
      worktreePath, trackNumber: '1110', isSuccess: false, primaryRoot, resolveTrackFolder,
    });

    assert.ok(!copied.includes('index.md'));
    const entry = skipped.find(s => s.file === 'index.md');
    assert.ok(entry, 'a declined copy must be recorded in `skipped`');
    assert.equal(entry.reason, 'suspicious-shrink');
    assert.ok(entry.incomingSize < entry.existingSize);
  });

  it('never touches conversation.md — a human comment in the primary copy must survive a run-end copy (track 10019 / D3 / REQ-10)', () => {
    // Real, live data-loss bug: conversation.md is written by TWO
    // independent writers — the UI/human posts comments straight into the
    // PRIMARY's copy, while the agent appends its own turns to the
    // WORKTREE's copy. Before this fix, ARTIFACTS included
    // 'conversation.md' with a plain full-file copyFileSync — so a human
    // comment posted mid-run landed in primary's copy and was silently
    // overwritten by the worktree's (comment-less) copy the moment the
    // run finished. The shrink guard never caught this: one lost line
    // stays well above its 50%-of-existing-size / 200-byte thresholds.
    const humanComment = '# Conversation: Track 1110\n\n> **human**: please also check the edge case\n';
    writeFileSync(join(primaryRoot, 'conductor', 'tracks', '1110-fake-track', 'conversation.md'), humanComment);
    writeFileSync(
      join(worktreePath, 'conductor', 'tracks', '1110-fake-track', 'conversation.md'),
      '# Conversation: Track 1110\n\n> **claude**: agent-side turn, does not know about the human comment above\n'
    );

    const { copied } = copyWorktreeArtifactsToPrimary({
      worktreePath, trackNumber: '1110', isSuccess: true, primaryRoot, resolveTrackFolder,
    });

    assert.ok(!copied.includes('conversation.md'), 'conversation.md must never be reported as copied — it is not this function\'s file to own');
    const primaryConversation = readFileSync(join(primaryRoot, 'conductor', 'tracks', '1110-fake-track', 'conversation.md'), 'utf8');
    assert.equal(primaryConversation, humanComment, 'the human comment must survive untouched — only the existing .conv-cursor machinery owns this file');
  });
});
