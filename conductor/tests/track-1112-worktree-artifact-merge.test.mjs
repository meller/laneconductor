// Track 1112 dogfood incident (2026-08-14): found live — a track's review
// passed and moved to quality-gate inside its worktree, but the primary
// checkout kept showing `review` indefinitely. Root cause: the merge step
// that copies a worktree's index.md status back onto the primary checkout's
// copy deliberately excluded Lane/Lane Status, on the incorrect assumption
// that something else already wrote them there. mergeIndexMarkers() is the
// fix's core behavior, extracted so it's testable without spinning up the
// whole spawnCli exit-handler flow.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mergeIndexMarkers } from '../services/worktree-artifact-merge.mjs';

describe('mergeIndexMarkers', () => {
  it('merges Lane and Lane Status from the worktree artifact onto the primary copy', () => {
    const existing = '# Track 1112: Title\n\n**Lane**: review\n**Lane Status**: running\n**Progress**: 100%\n\n## Problem\nLots of real prose here.\n';
    const artifact = '# Track 1112: Title\n\n**Lane**: quality-gate\n**Lane Status**: queue\n**Progress**: 100%\n\n## Problem\nWorktree copy of the same prose.\n';
    const merged = mergeIndexMarkers(existing, artifact);
    assert.match(merged, /\*\*Lane\*\*: quality-gate/);
    assert.match(merged, /\*\*Lane Status\*\*: queue/);
  });

  it('preserves the primary copy\'s own body/structure — only markers change', () => {
    const existing = '# Track 1112: Title\n\n**Lane**: review\n**Lane Status**: running\n\n## Problem\nOriginal problem text unique to main.\n\n## Phases\n- [x] Phase 1\n';
    const artifact = '# Track 1112: Title\n\n**Lane**: quality-gate\n**Lane Status**: queue\n';
    const merged = mergeIndexMarkers(existing, artifact);
    assert.match(merged, /Original problem text unique to main\./);
    assert.match(merged, /- \[x\] Phase 1/);
  });

  it('still merges Progress/Phase/Summary/Waiting for reply (regression: prior behavior)', () => {
    const existing = '**Lane**: review\n**Progress**: 50%\n**Phase**: old phase\n**Summary**: old summary\n**Waiting for reply**: yes\n';
    const artifact = '**Lane**: review\n**Progress**: 100%\n**Phase**: new phase\n**Summary**: new summary\n**Waiting for reply**: no\n';
    const merged = mergeIndexMarkers(existing, artifact);
    assert.match(merged, /\*\*Progress\*\*: 100%/);
    assert.match(merged, /\*\*Phase\*\*: new phase/);
    assert.match(merged, /\*\*Summary\*\*: new summary/);
    assert.match(merged, /\*\*Waiting for reply\*\*: no/);
  });

  it('does not inject a marker that is missing from the existing (primary) file', () => {
    const existing = '# Track 1: Title\n\n**Lane**: plan\n';
    const artifact = '# Track 1: Title\n\n**Lane**: implement\n**Waiting for reply**: no\n';
    const merged = mergeIndexMarkers(existing, artifact);
    assert.match(merged, /\*\*Lane\*\*: implement/);
    assert.ok(!merged.includes('Waiting for reply'), 'must not inject a marker the primary file never had');
  });

  it('leaves the existing marker untouched when the artifact has no value for it', () => {
    const existing = '**Lane**: review\n**Summary**: keep me\n';
    const artifact = '**Lane**: quality-gate\n';
    const merged = mergeIndexMarkers(existing, artifact);
    assert.match(merged, /\*\*Summary\*\*: keep me/);
  });

  it('does not confuse **Lane** with **Lane Status** (prefix collision check)', () => {
    const existing = '**Lane**: review\n**Lane Status**: running\n';
    const artifact = '**Lane**: quality-gate\n**Lane Status**: queue\n';
    const merged = mergeIndexMarkers(existing, artifact);
    // Exactly one Lane line and one Lane Status line, each with the new value.
    assert.equal((merged.match(/\*\*Lane\*\*: quality-gate/g) || []).length, 1);
    assert.equal((merged.match(/\*\*Lane Status\*\*: queue/g) || []).length, 1);
  });
});
