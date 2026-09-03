// conductor/tests/track-10049-jira-auth.test.mjs
// Track TU-10049 Phase 2 (Task 2.2): jiraProjectExists/resolveJiraToken
// extracted out of bin/lc.mjs into conductor/services/jira-auth.mjs so the
// Collector API's credential-status endpoint reuses the exact same check
// `lc add-target --type jira` already relies on, instead of a second copy.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { resolveJiraToken } from '../services/jira-auth.mjs';

describe('resolveJiraToken', () => {
  test('prefers a set env var over a plain token', () => {
    process.env.TEST_JIRA_TOKEN_10049 = 'from-env';
    try {
      assert.equal(resolveJiraToken('TEST_JIRA_TOKEN_10049', 'plain-token', null, null), 'from-env');
    } finally {
      delete process.env.TEST_JIRA_TOKEN_10049;
    }
  });

  test('falls back to a plain token when the named env var is unset', () => {
    assert.equal(resolveJiraToken('UNSET_VAR_10049', 'plain-token', null, null), 'plain-token');
  });

  test('returns null when nothing resolves', () => {
    assert.equal(resolveJiraToken(undefined, undefined, undefined, undefined), null);
  });

  test('returns null (not a throw) when gcp-secret lookup fails', () => {
    assert.equal(resolveJiraToken(undefined, undefined, 'nonexistent-secret-10049', 'gcp-secret'), null);
  });
});
