// ui/src/lib/connectors.test.js
// Track TU-10049 Phase 1 (TC-1..TC-7): connector registry shape,
// buildJiraCollector matching the CLI's collectors[] entry, skip-emission,
// and the mirror-integrity guard between this file and conductor/connectors.mjs.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  CONNECTOR_CATEGORIES,
  DEFAULT_JIRA_TOKEN_ENV,
  buildConnectionsPayload,
  buildJiraCollector,
  connectionsStepValid,
  defaultConnectionsState,
} from './connectors.js';

describe('CONNECTOR_CATEGORIES', () => {
  it('has exactly three categories: source_control, issue_tracker, cloud', () => {
    expect(CONNECTOR_CATEGORIES.map(c => c.id)).toEqual(['source_control', 'issue_tracker', 'cloud']);
  });

  it('each category has exactly one real provider and at least one alternative', () => {
    for (const category of CONNECTOR_CATEGORIES) {
      expect(category.real).toBeTruthy();
      expect(category.real.value).toBeTruthy();
      expect(Array.isArray(category.alternatives)).toBe(true);
      expect(category.alternatives.length).toBeGreaterThan(0);
    }
  });

  it('no alternative is ever the same value as its category\'s real provider (never emitted as selectable)', () => {
    for (const category of CONNECTOR_CATEGORIES) {
      const altValues = category.alternatives.map(a => a.value);
      expect(altValues).not.toContain(category.real.value);
    }
  });
});

describe('buildJiraCollector', () => {
  it('matches the shape lc add-target --type jira writes', () => {
    const result = buildJiraCollector({
      domain: 'acme.atlassian.net',
      email: 'me@acme.com',
      projectKey: 'ACME',
      tokenEnv: 'JIRA_API_TOKEN',
    });
    expect(result).toEqual({
      type: 'jira',
      domain: 'acme.atlassian.net',
      email: 'me@acme.com',
      project_key: 'ACME',
      token_env: 'JIRA_API_TOKEN',
    });
  });

  it('omits unset optional keys rather than writing them as undefined', () => {
    const result = buildJiraCollector({ domain: 'd', email: 'e', projectKey: 'K' });
    expect(Object.keys(result).sort()).toEqual(['domain', 'email', 'project_key', 'type']);
    expect('token' in result).toBe(false);
    expect('token_secret_name' in result).toBe(false);
    expect('token_store_type' in result).toBe(false);
  });

  it('supports gcp-secret token storage instead of token_env', () => {
    const result = buildJiraCollector({
      domain: 'd', email: 'e', projectKey: 'K',
      tokenStoreType: 'gcp-secret', tokenSecretName: 'JIRA_PROD_KEY',
    });
    expect(result.token_store_type).toBe('gcp-secret');
    expect(result.token_secret_name).toBe('JIRA_PROD_KEY');
    expect('token_env' in result).toBe(false);
  });
});

describe('connectionsStepValid', () => {
  it('is always true — the step never blocks Next', () => {
    expect(connectionsStepValid(defaultConnectionsState())).toBe(true);
    expect(connectionsStepValid({
      sourceControl: { provider: 'github' },
      issueTracker: { provider: 'jira', domain: '', email: '', projectKey: '', tokenEnv: '' },
      cloud: { provider: 'gcp', projectId: '', serviceAccount: '' },
    })).toBe(true);
  });
});

describe('buildConnectionsPayload', () => {
  it('emits {provider: "skip"} for every untouched category', () => {
    expect(buildConnectionsPayload(defaultConnectionsState())).toEqual({
      source_control: { provider: 'skip' },
      issue_tracker: { provider: 'skip' },
      cloud: { provider: 'skip' },
    });
  });

  it('builds the full jira issue_tracker block, defaulting tokenEnv when blank', () => {
    const state = defaultConnectionsState();
    state.issueTracker = { provider: 'jira', domain: 'acme.atlassian.net', email: 'me@acme.com', projectKey: 'ACME', tokenEnv: '' };
    const result = buildConnectionsPayload(state);
    expect(result.issue_tracker).toEqual({
      provider: 'jira',
      domain: 'acme.atlassian.net',
      email: 'me@acme.com',
      project_key: 'ACME',
      token_env: DEFAULT_JIRA_TOKEN_ENV,
    });
  });

  it('builds the cloud gcp block', () => {
    const state = defaultConnectionsState();
    state.cloud = { provider: 'gcp', projectId: 'acme-prod', serviceAccount: '' };
    expect(buildConnectionsPayload(state).cloud).toEqual({ provider: 'gcp', project_id: 'acme-prod', service_account: null });
  });

  it('never includes a credential value — only token_env (a name)', () => {
    const state = defaultConnectionsState();
    state.issueTracker = { provider: 'jira', domain: 'd', email: 'e', projectKey: 'K', tokenEnv: 'JIRA_API_TOKEN' };
    const json = JSON.stringify(buildConnectionsPayload(state));
    expect(json).not.toMatch(/"token":/);
    expect(json).toMatch(/"token_env":"JIRA_API_TOKEN"/);
  });
});

describe('mirror integrity: ui/src/lib/connectors.js <-> conductor/connectors.mjs', () => {
  it('are identical below their module header comment blocks', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const uiSrc = readFileSync(join(here, 'connectors.js'), 'utf8');
    const workerSrc = readFileSync(join(here, '../../../conductor/connectors.mjs'), 'utf8');

    const stripHeader = src => {
      const lines = src.split('\n');
      let i = 0;
      while (i < lines.length && (lines[i].startsWith('//') || lines[i].trim() === '')) i++;
      return lines.slice(i).join('\n');
    };

    expect(stripHeader(uiSrc)).toBe(stripHeader(workerSrc));
  });
});
