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

  // Track 1102 F21 (2026-08-20): { skipStatusMarkers: true } is what the
  // periodic mid-run doc-sync pass uses — a reused per-cycle worktree's
  // Lane/Lane Status is frozen at the PREVIOUS cycle's terminal value until
  // this cycle's own exit handler runs, so merging it mid-run clobbers the
  // dispatcher's freshly-written "running" marker on primary and causes
  // reconcileActiveDispatch() to close the dispatch out while the real
  // agent process is still alive (live: track 10019's review and
  // quality-gate dispatches). Every other marker has no such hazard and
  // must keep flowing through — that's the whole point of the mid-run pass.
  it('with skipStatusMarkers: true, leaves Lane/Lane Status untouched but still merges Progress/Phase/Summary', () => {
    const existing = '**Lane**: plan\n**Lane Status**: running\n**Progress**: 0%\n**Phase**: old\n**Summary**: old\n';
    const artifact = '**Lane**: plan\n**Lane Status**: success\n**Progress**: 40%\n**Phase**: new\n**Summary**: new\n';
    const merged = mergeIndexMarkers(existing, artifact, { skipStatusMarkers: true });
    assert.match(merged, /\*\*Lane\*\*: plan/);
    assert.match(merged, /\*\*Lane Status\*\*: running/, 'Lane Status must stay at the primary\'s own value, not the stale worktree one');
    assert.match(merged, /\*\*Progress\*\*: 40%/);
    assert.match(merged, /\*\*Phase\*\*: new/);
    assert.match(merged, /\*\*Summary\*\*: new/);
  });

  it('without skipStatusMarkers (default), Lane Status still merges as before — the flag is opt-in, not a behavior change for existing callers', () => {
    const existing = '**Lane**: plan\n**Lane Status**: running\n';
    const artifact = '**Lane**: plan\n**Lane Status**: success\n';
    const merged = mergeIndexMarkers(existing, artifact);
    assert.match(merged, /\*\*Lane Status\*\*: success/);
  });
});
