// conductor/tests/track-10064-config-root.test.mjs
// Track 10064 Phase 1 (REQ-1/REQ-2/REQ-3): pure unit tests for
// resolveConfigRoot — no git repo or process spawn needed for these.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveConfigRoot } from '../services/config-root.mjs';

test('TC-1: resolves to the primary root when cwd is a linked worktree', () => {
  const root = resolveConfigRoot({
    cwd: '/repo/.worktrees/10064',
    isManager: false,
    resolvePrimaryRepoRoot: () => '/repo',
  });
  assert.equal(root, '/repo');
});

test('TC-2: falls back to cwd when the resolver throws (not inside a git repo)', () => {
  const root = resolveConfigRoot({
    cwd: '/tmp/some-sandbox',
    isManager: false,
    resolvePrimaryRepoRoot: () => { throw new Error('not a git repo'); },
  });
  assert.equal(root, '/tmp/some-sandbox');
});

test('a manager worker is never redirected, even if a primary would resolve', () => {
  const root = resolveConfigRoot({
    cwd: '/some/arbitrary/cwd',
    isManager: true,
    resolvePrimaryRepoRoot: () => '/repo',
  });
  assert.equal(root, '/some/arbitrary/cwd');
});

test('cwd already the primary is returned unchanged', () => {
  const root = resolveConfigRoot({
    cwd: '/repo',
    isManager: false,
    resolvePrimaryRepoRoot: () => '/repo',
  });
  assert.equal(root, '/repo');
});
