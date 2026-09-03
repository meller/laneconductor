// conductor/services/wizard-connections.mjs
// Track TU-10049 Phase 5 (spec.md REQ-6): turns the wizard's Connections
// step answers into real artifacts in a newly-scaffolded project — a Jira
// selection becomes a collectors[] entry in .laneconductor.json (the same
// shape `lc add-target --type jira` writes, via buildJiraCollector) plus
// the token env var NAME (never a value) appended to .env.example.
// Extracted out of runCreateProject (conductor/laneconductor.sync.mjs) as
// its own pure-ish function, rather than left inline, so it's testable
// directly against a real temp directory without spawning the full
// manager-worker + mock-CLI harness every other runCreateProject test
// needs (conductor/tests/track-1091-create-project-worker.test.mjs etc.).

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildJiraCollector } from '../connectors.mjs';

/**
 * Writes the Connections step's artifacts into an already-scaffolded
 * project directory. MUST be called after .laneconductor.json has already
 * been written for this project (runCreateProject writes it with the
 * manager's default collectors first) — this function reads that file
 * back and appends to it, rather than constructing its own from scratch,
 * so it never clobbers the manager-derived collectors already there.
 *
 * No-op (returns { wrote: false }) when there is no wizard.connections
 * block (legacy Quick create dispatch) or the issue_tracker category was
 * left on 'skip' — spec.md AC-8 / TC-36 / TC-37.
 */
export function writeWizardConnectionsArtifacts({ targetPath, connections }) {
  const issueTracker = connections?.issue_tracker;
  if (!issueTracker || issueTracker.provider !== 'jira') {
    return { wrote: false };
  }

  const configPath = join(targetPath, '.laneconductor.json');
  const writtenConfig = JSON.parse(readFileSync(configPath, 'utf8'));
  writtenConfig.collectors = writtenConfig.collectors || [];
  const jiraCollector = buildJiraCollector({
    domain: issueTracker.domain,
    email: issueTracker.email,
    projectKey: issueTracker.project_key,
    tokenEnv: issueTracker.token_env,
  });
  writtenConfig.collectors.push(jiraCollector);
  writeFileSync(configPath, JSON.stringify(writtenConfig, null, 2) + '\n');

  const envExamplePath = join(targetPath, '.env.example');
  const existingEnvExample = existsSync(envExamplePath) ? readFileSync(envExamplePath, 'utf8') : '';
  const jiraEnvLine = `# Jira — for the connection configured in the wizard\n${issueTracker.token_env}=\n`;
  if (!existingEnvExample.includes(`${issueTracker.token_env}=`)) {
    writeFileSync(envExamplePath, existingEnvExample ? `${existingEnvExample}\n${jiraEnvLine}` : jiraEnvLine);
  }

  return { wrote: true, jiraCollector };
}
