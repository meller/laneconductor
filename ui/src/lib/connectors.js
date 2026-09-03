// Track TU-10049: single source of truth for the App Creator wizard's
// Connections step — the three provider categories (source control, issue
// tracker, cloud), each with one real/selectable provider plus named,
// disabled "FFU" alternatives (spec.md REQ-2), and the payload/collector
// shape builders the step and the worker both need. Mirrored byte-for-byte
// in conductor/connectors.mjs for worker-side use (runCreateProject), same
// pattern as ui/src/lib/deployConfig.js <-> conductor/deployConfig.mjs —
// the sync worker runs standalone via node conductor/laneconductor.sync.mjs
// and can't import ui/src directly. Keep both copies in sync when editing
// either one.

export const SKIP_PROVIDER = 'skip';

export const CONNECTOR_CATEGORIES = [
  {
    id: 'source_control',
    label: 'Source control',
    real: { value: 'github', label: 'GitHub' },
    alternatives: [
      { value: 'gitlab', label: 'GitLab' },
      { value: 'bitbucket', label: 'Bitbucket' },
      { value: 'azure-devops', label: 'Azure DevOps' },
    ],
  },
  {
    id: 'issue_tracker',
    label: 'Issue tracker',
    real: { value: 'jira', label: 'Jira' },
    alternatives: [
      { value: 'linear', label: 'Linear' },
      { value: 'asana', label: 'Asana' },
      { value: 'github-issues', label: 'GitHub Issues' },
      { value: 'shortcut', label: 'Shortcut' },
    ],
  },
  {
    id: 'cloud',
    label: 'Cloud',
    real: { value: 'gcp', label: 'GCP' },
    alternatives: [
      { value: 'aws', label: 'AWS' },
      { value: 'azure', label: 'Azure' },
      { value: 'cloudflare', label: 'Cloudflare' },
    ],
  },
];

export const DEFAULT_JIRA_TOKEN_ENV = 'JIRA_API_TOKEN';

export function defaultConnectionsState() {
  return {
    sourceControl: { provider: SKIP_PROVIDER },
    issueTracker: {
      provider: SKIP_PROVIDER,
      domain: '',
      email: '',
      projectKey: '',
      tokenEnv: DEFAULT_JIRA_TOKEN_ENV,
    },
    cloud: { provider: SKIP_PROVIDER, projectId: '', serviceAccount: '' },
  };
}

// The Connections step never blocks Next (spec.md REQ-1) — every category
// defaults to, and may stay at, 'skip'.
export function connectionsStepValid() {
  return true;
}

// Builds the exact collectors[] entry shape `lc add-target --type jira`
// writes (bin/lc.mjs ~L3092: { type, domain, email, project_key, token_env,
// token, token_store_type, token_secret_name }) — reused, not reinvented,
// per spec.md's Existing Machinery table. Optional keys are omitted rather
// than written as `undefined` so the entry serializes cleanly to JSON.
export function buildJiraCollector({ domain, email, projectKey, tokenEnv, tokenStoreType, tokenSecretName, token }) {
  return {
    type: 'jira',
    domain,
    email,
    project_key: projectKey,
    ...(tokenEnv ? { token_env: tokenEnv } : {}),
    ...(tokenStoreType ? { token_store_type: tokenStoreType } : {}),
    ...(tokenSecretName ? { token_secret_name: tokenSecretName } : {}),
    ...(token ? { token } : {}),
  };
}

// Maps wizard Connections state to the wizard.connections dispatch block
// (spec.md REQ-6). Never includes a credential value — issue_tracker
// carries token_env (an env var NAME), never a token (spec.md REQ-3).
export function buildConnectionsPayload(connections) {
  const { sourceControl, issueTracker, cloud } = connections;

  const source_control = sourceControl.provider === 'github'
    ? { provider: 'github' }
    : { provider: SKIP_PROVIDER };

  const issue_tracker = issueTracker.provider === 'jira'
    ? {
        provider: 'jira',
        domain: issueTracker.domain.trim(),
        email: issueTracker.email.trim(),
        project_key: issueTracker.projectKey.trim(),
        token_env: issueTracker.tokenEnv.trim() || DEFAULT_JIRA_TOKEN_ENV,
      }
    : { provider: SKIP_PROVIDER };

  const cloudPayload = cloud.provider === 'gcp'
    ? {
        provider: 'gcp',
        project_id: cloud.projectId.trim(),
        service_account: cloud.serviceAccount.trim() || null,
      }
    : { provider: SKIP_PROVIDER };

  return { source_control, issue_tracker, cloud: cloudPayload };
}
