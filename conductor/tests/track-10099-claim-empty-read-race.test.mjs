#!/usr/bin/env node
// conductor/tests/track-10099-claim-empty-read-race.test.mjs
// Track AM-10099 Phase 11 Task 1 (item k): regression for the strongest
// identified candidate behind this track's own live index.md truncation
// (13 lines -> 2 lines, primary checkout, 2026-09-18 — see spec.md's
// "Addendum — planning pass 2026-09-18" for the full incident writeup).
//
// autoLaunchLocalFs's pre-spawn claim write used
// `readIfExists(indexPath) ?? content` to prefer a fresh disk read over
// its stale top-of-loop snapshot. `??` only falls back on null/undefined,
// not on an empty string — and `readIfExists` returns `''` (not null)
// whenever the file exists but reads back empty, which is reachable any
// time a concurrent writer's `fs.writeFileSync` (O_TRUNC-then-write, not
// atomic) is observed mid-truncation by this read. When that race hits,
// the old code built the claim write from `''`, and — because
// `updateHeader`'s fallback branch only APPENDS the one marker it was
// asked to set — the file ends up holding just `**Lane Status**: running`
// with every other marker gone.
//
// This does not claim to be a byte-exact reproduction of the observed
// incident (which also still had a `**Lane**: plan` line this isolated
// unit doesn't produce) — see plan.md Phase 11 Task 1 for that honesty
// note. It IS a real, independently confirmed defect in the exact claim
// hot path a `plan`-lane auto-queue dispatch runs through, of the same
// class `updateIndexMDFromDB` already had to guard against once before
// (its own `fileExists && !content.trim()` check). Fixing this closes one
// concrete mechanism by which the incident's failure MODE (full-content
// loss down to one marker) can occur, even though the exact writer chain
// for the observed incident itself remains not fully pinned down.
//
// Run: node --test conductor/tests/track-10099-claim-empty-read-race.test.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveFreshContentForClaim } from '../claim-scope.mjs';

const FULL_CONTENT = [
  '# Track AM-10099: Release readiness',
  '',
  '**Lane**: implement',
  '**Lane Status**: queue',
  '**Progress**: 90%',
  '**Type**: dev',
  '**Author**: AM',
].join('\n') + '\n';

describe('resolveFreshContentForClaim (Track AM-10099 Phase 11, item k)', () => {
  it('uses the fresh read when it has real content', () => {
    const fresh = FULL_CONTENT.replace('queue', 'running');
    const result = resolveFreshContentForClaim(fresh, 'SHOULD_NOT_BE_USED');
    assert.equal(result, fresh);
  });

  it('REGRESSION: falls back to the stale snapshot when the fresh read is an empty string, not just null/undefined', () => {
    // This is exactly what `readIfExists()` returns for a file that exists
    // but was read back empty (the O_TRUNC race) — NOT null. The old
    // `readIfExists(indexPath) ?? content` line silently kept '' here,
    // because `??` treats '' as a legitimate value, not a fallback trigger.
    const result = resolveFreshContentForClaim('', FULL_CONTENT);
    assert.equal(result, FULL_CONTENT, 'an empty fresh read must fall back to the full snapshot, not silently win');
    assert.notEqual(result, '', 'must never resolve to empty content — this is the exact mechanism that produced a 2-marker-only index.md');
  });

  it('also falls back on whitespace-only reads (same race, different byte count)', () => {
    const result = resolveFreshContentForClaim('   \n\n  ', FULL_CONTENT);
    assert.equal(result, FULL_CONTENT);
  });

  it('still falls back to the snapshot when the fresh read is genuinely null (file missing)', () => {
    const result = resolveFreshContentForClaim(null, FULL_CONTENT);
    assert.equal(result, FULL_CONTENT);
  });

  it('demonstrates the pre-fix failure mode via updateHeader, for documentation', () => {
    // The same updateHeader shape used at the real call site in
    // autoLaunchLocalFs — shown here to make the downstream consequence of
    // the bug concrete, not just the fallback-selection logic above.
    const updateHeader = (content, header, value) => {
      const regex = new RegExp(`\\*\\*${header}\\*\\*:\\s*[^\\n]+`, 'i');
      if (regex.test(content)) return content.replace(regex, `**${header}**: ${value}`);
      return content.trim() + `\n**${header}**: ${value}\n`;
    };

    // Pre-fix: `'' ?? FULL_CONTENT` evaluates to '' (the bug).
    const preFixFreshForClaim = '' ?? FULL_CONTENT;
    const preFixResult = updateHeader(preFixFreshForClaim, 'Lane Status', 'running');
    assert.equal(preFixResult, '\n**Lane Status**: running\n', 'documents the pre-fix content-loss shape');
    assert.ok(!preFixResult.includes('**Author**'), 'pre-fix: every other marker is gone');

    // Post-fix: the guarded helper prevents this.
    const postFixFreshForClaim = resolveFreshContentForClaim('', FULL_CONTENT);
    const postFixResult = updateHeader(postFixFreshForClaim, 'Lane Status', 'running');
    assert.ok(postFixResult.includes('**Author**: AM'), 'post-fix: markers survive the same race');
    assert.ok(postFixResult.includes('**Lane Status**: running'), 'post-fix: the claim itself still lands');
  });
});
