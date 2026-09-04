// Track 10060 Phase 4 (REQ-7, REQ-8): suggestion-only classification for
// regenerable artifacts.
//
// prisma/schema.sql is a generated Atlas/Prisma dump, written only by
// scripts/atlas-prisma.mjs (called only from scripts/setup-db.mjs). When it
// drifts it is modified, tracked, and not git-ignored — so it matched none of
// classifyHealableDirtyPath's conjunctive conditions and produced no guidance
// at all. The operator got a bare path name and no way to know what dirtied it,
// while every merge in the project stayed halted (spec Finding 2 and 4).
//
// The fix is a suggestion, never an action. `healable` stays false, which is
// the gate the auto_heal apply path keys off — a tool that wedges tracks does
// not earn unattended write access to main just because it learned a new
// filename.

import { test } from 'node:test';
import assert from 'node:assert';
import { classifyHealableDirtyPath, REGENERABLE_ARTIFACTS } from '../services/dirty-path-heal.mjs';

test('TC-18: a modified, tracked prisma/schema.sql yields a suggestion naming how it is regenerated', () => {
  const r = classifyHealableDirtyPath({ path: 'prisma/schema.sql', porcelainStatus: 'M', isGitIgnored: false });
  assert.equal(r.healable, false, 'REQ-7: never healable — that flag is the auto-apply gate');
  assert.equal(r.remedy, null, 'a suggestion is not a remedy; nothing may execute this');
  assert.match(r.suggestion, /node scripts\/atlas-prisma\.mjs/);
  assert.match(r.reason, /regenerable/i);
});

test('TC-19: cloud/schema.sql behaves identically', () => {
  const r = classifyHealableDirtyPath({ path: 'cloud/schema.sql', porcelainStatus: 'M', isGitIgnored: false });
  assert.equal(r.healable, false);
  assert.equal(r.remedy, null);
  assert.match(r.suggestion, /node scripts\/atlas-prisma\.mjs/);
});

test('TC-20: an UNTRACKED file of the same name is not the drift case and gets no suggestion', () => {
  const r = classifyHealableDirtyPath({ path: 'prisma/schema.sql', porcelainStatus: '??', isGitIgnored: false });
  assert.equal(r.healable, false);
  assert.ok(!r.suggestion, 'an untracked schema.sql was never regenerated from the tracked dump');
});

test('TC-21: an unrelated modified tracked file gets neither a heal nor a suggestion', () => {
  const r = classifyHealableDirtyPath({ path: 'ui/src/App.jsx', porcelainStatus: 'M', isGitIgnored: false });
  assert.equal(r.healable, false);
  assert.ok(!r.suggestion);
});

test('TC-22: the existing build-output heal is unchanged — still healable, still an index-only remedy', () => {
  const r = classifyHealableDirtyPath({ path: 'ui/node_modules', porcelainStatus: 'D', isGitIgnored: true });
  assert.equal(r.healable, true);
  assert.match(r.remedy, /^git rm -r --cached ui\/node_modules$/);
});

test('TC-23: the auto_heal apply gate cannot pick up a suggestion-only path', () => {
  // The gate at the guard site is `remedies.length === disqualifying.length`,
  // where `remedies` only collects classifications with healable === true.
  // Reproduced here so the invariant is asserted, not just described.
  const disqualifying = ['prisma/schema.sql'];
  const remedies = disqualifying
    .map(path => classifyHealableDirtyPath({ path, porcelainStatus: 'M', isGitIgnored: false }))
    .filter(c => c.healable);
  assert.equal(remedies.length, 0);
  assert.equal(remedies.length === disqualifying.length && remedies.length > 0, false,
    'REQ-8: a suggestion-only classification must never widen unattended write access to main');
});

test('a regenerable artifact that is ALSO deleted-and-ignored still takes the build-output path only if allowlisted', () => {
  // Ordering guard: the regenerable check must not shadow the existing
  // deleted-from-worktree heal, and vice versa.
  const r = classifyHealableDirtyPath({ path: 'prisma/schema.sql', porcelainStatus: 'D', isGitIgnored: true });
  assert.equal(r.healable, false, 'schema.sql is not on the build-output basename allowlist');
});

test('path traversal is still refused before any regenerable lookup', () => {
  for (const path of ['/etc/passwd', '../../prisma/schema.sql']) {
    const r = classifyHealableDirtyPath({ path, porcelainStatus: 'M', isGitIgnored: false });
    assert.equal(r.healable, false);
    assert.ok(!r.suggestion);
    assert.match(r.reason, /outside the repo/);
  }
});

test('REGENERABLE_ARTIFACTS is frozen and maps every entry to a runnable command string', () => {
  assert.ok(Object.isFrozen(REGENERABLE_ARTIFACTS));
  for (const [path, command] of Object.entries(REGENERABLE_ARTIFACTS)) {
    assert.ok(path.length > 0 && !path.startsWith('/'));
    assert.equal(typeof command, 'string');
    assert.ok(command.length > 0);
  }
});
