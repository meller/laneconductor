#!/usr/bin/env node
// conductor/tests/session-resilience.test.mjs
// Track 1086 Phase 4: detecting a --resume failure (session pruned/
// corrupted/never existed) so it can be distinguished from an ordinary
// task failure and trigger a fresh-session fallback instead of retrying
// the same doomed --resume forever.
//
// Run: node --test conductor/tests/session-resilience.test.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isResumeFailure } from '../session-resilience-utils.mjs';

describe('isResumeFailure', () => {
  it('detects the real claude CLI error text (verified against the actual binary)', () => {
    const log = 'No conversation found with session ID: 00000000-0000-0000-0000-000000000000\n';
    assert.equal(isResumeFailure(log), true);
  });

  it('is case-insensitive and matches anywhere in a larger log', () => {
    const log = 'Some preamble\n... no conversation found with session id: abc-123 ...\nmore output';
    assert.equal(isResumeFailure(log), true);
  });

  it('returns false for an ordinary task failure', () => {
    const log = 'Error: TypeError: cannot read property foo of undefined\n  at file.js:10';
    assert.equal(isResumeFailure(log), false);
  });

  it('returns false for empty/missing content', () => {
    assert.equal(isResumeFailure(''), false);
    assert.equal(isResumeFailure(null), false);
    assert.equal(isResumeFailure(undefined), false);
  });
});
