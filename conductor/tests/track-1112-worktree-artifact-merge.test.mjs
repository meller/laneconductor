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
import { mergeIndexMarkers, copyWorktreeArtifactsToPrimary } from '../services/worktree-artifact-merge.mjs';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

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

  it('does not inject most markers that are missing from the existing (primary) file', () => {
    const existing = '# Track 1: Title\n\n**Lane**: plan\n';
    const artifact = '# Track 1: Title\n\n**Lane**: implement\n**Summary**: brand new summary\n';
    const merged = mergeIndexMarkers(existing, artifact);
    assert.match(merged, /\*\*Lane\*\*: implement/);
    assert.ok(!merged.includes('Summary'), 'must not inject a marker the primary file never had');
  });

  // Track 10020: unlike every other marker, "Waiting for reply" going
  // missing-in-primary is the NORMAL first-occurrence case, not a sign of
  // reshaping the file — a track can legitimately go its whole life
  // without needing it until a dispatched lane action first hits a genuine
  // blocking question. The old "don't inject" behavior silently dropped
  // the exit handler's own correctly-written marker during the
  // worktree-to-primary copy, and the very next syncTrack() call — reading
  // primary's now marker-less file — overwrote the DB back to
  // waiting_for_reply: false, undoing the fix that set it. Caught live on
  // track 1102.
  it('DOES inject "Waiting for reply" even when primary never had it before', () => {
    const existing = '# Track 1: Title\n\n**Lane**: implement\n**Lane Status**: success\n';
    const artifact = '# Track 1: Title\n\n**Lane**: implement\n**Lane Status**: success\n**Waiting for reply**: yes\n';
    const merged = mergeIndexMarkers(existing, artifact);
    assert.match(merged, /\*\*Waiting for reply\*\*:\s*yes/i, 'must inject the marker on its first occurrence, not silently drop it');
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

  // Track 10053 (2026-09-03), UI-confirmed: skipStatusMarkers blocking
  // EVERY Lane Status update — including "running" itself — meant the
  // Kanban card's running-indicator (gates on this exact primary-copy
  // marker) showed "⏳ Queued for automation" for a track with a live
  // worktree, a live process, and commits actively landing, for the
  // track's ENTIRE run. "running" can never be the track-10019 hazard
  // (a REUSED worktree's stale TERMINAL status from a previous cycle) —
  // an exit handler only ever leaves a worktree in a terminal state, so
  // a worktree reading "running" only ever means a run is genuinely in
  // progress right now.
  it('with skipStatusMarkers: true, "running" specifically DOES flow through — it can never be the stale-leftover hazard the flag guards against', () => {
    const existing = '**Lane**: implement\n**Lane Status**: queue\n**Progress**: 0%\n';
    const artifact = '**Lane**: implement\n**Lane Status**: running\n**Progress**: 25%\n';
    const merged = mergeIndexMarkers(existing, artifact, { skipStatusMarkers: true });
    assert.match(merged, /\*\*Lane Status\*\*: running/, 'a live "running" value must reach the primary copy even mid-run, so the UI can show it');
    assert.match(merged, /\*\*Progress\*\*: 25%/);
  });

  it('with skipStatusMarkers: true, "waiting" also flows through (2026-09-03 same-day extension) — a track paused asking for human authorization must not hide behind "queued"', () => {
    const existing = '**Lane**: done\n**Lane Status**: queue\n**Progress**: 70%\n';
    const artifact = '**Lane**: done\n**Lane Status**: waiting\n**Progress**: 70%\n';
    const merged = mergeIndexMarkers(existing, artifact, { skipStatusMarkers: true });
    assert.match(merged, /\*\*Lane Status\*\*: waiting/);
  });

  it('with skipStatusMarkers: true, a TERMINAL status (the real hazard) still does not flow through, even after the "running"/"waiting" exceptions', () => {
    const existing = '**Lane**: plan\n**Lane Status**: running\n';
    for (const stale of ['success', 'failure', 'queue']) {
      const artifact = `**Lane**: plan\n**Lane Status**: ${stale}\n`;
      const merged = mergeIndexMarkers(existing, artifact, { skipStatusMarkers: true });
      assert.match(merged, /\*\*Lane Status\*\*: running/,
        `a stale worktree "${stale}" left over from a previous cycle must not clobber primary's genuine "running" — this is the exact track-10019 incident shape`);
    }
  });

  // Found live 2026-09-05 (tracks 10064/10065/10067): the "running" exception
  // above assumes a worktree can only ever read "running" because a run is
  // genuinely live right now — false for a crashed/restart-orphaned run,
  // where no exit handler ever ran to leave a terminal value behind. Once
  // the orphan-reconciler correctly wrote a terminal status onto primary,
  // this same "running" exception let the worktree's stale copy clobber it
  // right back on the next doc-sync tick, forever. `trustRunningStatus` is
  // the caller's independently-verified signal (its own runningTrackMap, or
  // a live run marker) — without it, "running"/"waiting" must NOT flow
  // through, same as any other value skipStatusMarkers blocks.
  it('with skipStatusMarkers: true AND trustRunningStatus: false, "running" does NOT flow through — a crashed run leaves "running" stale exactly like a terminal value', () => {
    const existing = '**Lane**: implement\n**Lane Status**: failure\n**Progress**: 0%\n';
    const artifact = '**Lane**: implement\n**Lane Status**: running\n**Progress**: 25%\n';
    const merged = mergeIndexMarkers(existing, artifact, { skipStatusMarkers: true, trustRunningStatus: false });
    assert.match(merged, /\*\*Lane Status\*\*: failure/,
      'without independent evidence of a live run, the reconciler\'s own terminal write must survive the next doc-sync pass');
    assert.match(merged, /\*\*Progress\*\*: 25%/, 'non-hazard markers still flow through regardless of trustRunningStatus');
  });

  it('trustRunningStatus defaults to true — existing callers that never pass it see byte-identical behavior to before this fix', () => {
    const existing = '**Lane**: implement\n**Lane Status**: queue\n';
    const artifact = '**Lane**: implement\n**Lane Status**: running\n';
    const merged = mergeIndexMarkers(existing, artifact, { skipStatusMarkers: true });
    assert.match(merged, /\*\*Lane Status\*\*: running/);
  });
});

// Found live 2026-09-04: tracks 1121, 10063 and 10064 all sat on the board
// showing `queue` while their worktrees said `running` with live agent
// processes. mergeIndexMarkers' running/waiting exception (above) was correct
// but never reached — copyWorktreeArtifactsToPrimary's `skipUnchanged` mtime
// gate returned first. The primary index.md has OTHER writers (the FS->DB
// push and DB->FS pull rewrite it every ~10s), so its mtime is essentially
// always newer than the worktree's, which only changes when the agent writes.
// mtime is not a usable "nothing changed" signal for index.md.
describe('copyWorktreeArtifactsToPrimary: index.md escapes a stale-mtime skip', () => {
  function setup(worktreeStatus, primaryStatus) {
    const root = mkdtempSync(join(tmpdir(), 'lc-mtime-'));
    const wt = join(root, 'wt'), primary = join(root, 'primary');
    mkdirSync(join(wt, 'conductor', 'tracks', '9001-t'), { recursive: true });
    mkdirSync(join(primary, 'conductor', 'tracks', '9001-t'), { recursive: true });
    const wtIdx = join(wt, 'conductor', 'tracks', '9001-t', 'index.md');
    const prIdx = join(primary, 'conductor', 'tracks', '9001-t', 'index.md');
    // >=10 lines and >500 bytes, so the shrink guard (lineCount < 10) does not
    // reject the incoming copy and mask what this test is actually asserting.
    const body = '\n\n## Body\n' + Array.from({ length: 14 },
      (_, i) => `line ${i + 1}: real prose so the incoming artifact is not judged suspiciously truncated.`).join('\n') + '\n';
    writeFileSync(wtIdx, `# Track 9001\n\n**Lane**: implement\n**Lane Status**: ${worktreeStatus}\n**Progress**: 40%${body}`);
    writeFileSync(prIdx, `# Track 9001\n\n**Lane**: implement\n**Lane Status**: ${primaryStatus}\n**Progress**: 10%${body}`);
    // The bug's exact shape: primary is NEWER than the worktree.
    const old = new Date(Date.now() - 600000);
    utimesSync(wtIdx, old, old);
    return { wt, primary, prIdx };
  }

  const run = (wt, primary) => copyWorktreeArtifactsToPrimary({
    worktreePath: wt, trackNumber: '9001', isSuccess: false, primaryRoot: primary,
    resolveTrackFolder: () => '9001-t', skipUnchanged: true, skipStatusMarkers: true,
  });

  it('a live "running" reaches primary even though primary has the newer mtime', () => {
    const { wt, primary, prIdx } = setup('running', 'queue');
    run(wt, primary);
    assert.match(readFileSync(prIdx, 'utf8'), /\*\*Lane Status\*\*: running/,
      'an mtime-losing worktree must still be able to report that it is running');
  });

  it('"waiting" reaches primary the same way', () => {
    const { wt, primary, prIdx } = setup('waiting', 'queue');
    run(wt, primary);
    assert.match(readFileSync(prIdx, 'utf8'), /\*\*Lane Status\*\*: waiting/);
  });

  it('a TERMINAL status still does NOT win an mtime-losing race (track-10019 hazard stays blocked)', () => {
    for (const stale of ['success', 'failure', 'queue']) {
      const { wt, primary, prIdx } = setup(stale, 'running');
      run(wt, primary);
      assert.match(readFileSync(prIdx, 'utf8'), /\*\*Lane Status\*\*: running/,
        `a stale worktree "${stale}" must not clobber primary's genuine running`);
    }
  });

  // Found live 2026-09-05 (tracks 10064/10065/10067): a crashed run leaves
  // the worktree's OWN copy reading "running" forever — indistinguishable,
  // by content alone, from a genuinely live one. Once the orphan-reconciler
  // writes a terminal status onto primary, this mtime-loss door must not
  // let that stale "running" back in without independent proof (the
  // caller's trustRunningStatus) that a run is actually still going.
  it('without trustRunningStatus, a stale "running" left by a crashed run does NOT win the mtime-losing race either', () => {
    const { wt, primary, prIdx } = setup('running', 'failure');
    copyWorktreeArtifactsToPrimary({
      worktreePath: wt, trackNumber: '9001', isSuccess: false, primaryRoot: primary,
      resolveTrackFolder: () => '9001-t', skipUnchanged: true, skipStatusMarkers: true, trustRunningStatus: false,
    });
    assert.match(readFileSync(prIdx, 'utf8'), /\*\*Lane Status\*\*: failure/,
      'the reconciler\'s own terminal write must survive when nothing verifies the worktree\'s "running" claim');
  });
});
