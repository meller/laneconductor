#!/usr/bin/env node
// conductor/tests/track-10049-connections-artifacts.test.mjs
// Track TU-10049 Phase 5 (TC-32..TC-37): writeWizardConnectionsArtifacts
// turns a Jira connection chosen on the wizard's Connections step into a
// real collectors[] entry + .env.example line in a scaffolded project,
// without ever writing a credential value, and without disturbing the
// manager-derived collectors already written by runCreateProject.

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeWizardConnectionsArtifacts } from '../services/wizard-connections.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TMP = join(__dirname, '../../.test-tmp-track-10049-connections-artifacts');

function writeBaseConfig(targetPath, extraCollectors = []) {
  writeFileSync(join(targetPath, '.laneconductor.json'), JSON.stringify({
    mode: 'local-api',
    project: { name: 'test-project', repo_path: targetPath, primary: { cli: 'claude' } },
    collectors: extraCollectors,
    ui: { port: 8090 },
  }, null, 2) + '\n');
}

const JIRA_CONNECTION = {
  provider: 'jira',
  domain: 'acme.atlassian.net',
  email: 'me@acme.com',
  project_key: 'ACME',
  token_env: 'JIRA_API_TOKEN',
};

describe('writeWizardConnectionsArtifacts', () => {
  let targetPath;

  beforeEach(() => {
    targetPath = join(TMP, `run-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(targetPath, { recursive: true });
  });

  after(() => {
    rmSync(TMP, { recursive: true, force: true });
  });

  // TC-32
  it('writes a collectors[] entry matching buildJiraCollector\'s shape', () => {
    writeBaseConfig(targetPath);
    const result = writeWizardConnectionsArtifacts({ targetPath, connections: { issue_tracker: JIRA_CONNECTION } });
    assert.equal(result.wrote, true);

    const config = JSON.parse(readFileSync(join(targetPath, '.laneconductor.json'), 'utf8'));
    assert.deepEqual(config.collectors, [{
      type: 'jira',
      domain: 'acme.atlassian.net',
      email: 'me@acme.com',
      project_key: 'ACME',
      token_env: 'JIRA_API_TOKEN',
    }]);
  });

  // TC-33
  it('appends to existing collectors rather than replacing them', () => {
    writeBaseConfig(targetPath, [{ url: 'http://localhost:8091', token: null }]);
    writeWizardConnectionsArtifacts({ targetPath, connections: { issue_tracker: JIRA_CONNECTION } });

    const config = JSON.parse(readFileSync(join(targetPath, '.laneconductor.json'), 'utf8'));
    assert.equal(config.collectors.length, 2);
    assert.deepEqual(config.collectors[0], { url: 'http://localhost:8091', token: null });
    assert.equal(config.collectors[1].type, 'jira');
  });

  // TC-34
  it('names the token variable in .env.example with an empty value', () => {
    writeBaseConfig(targetPath);
    writeWizardConnectionsArtifacts({ targetPath, connections: { issue_tracker: JIRA_CONNECTION } });

    const envExample = readFileSync(join(targetPath, '.env.example'), 'utf8');
    assert.match(envExample, /^JIRA_API_TOKEN=$/m);
  });

  // TC-35
  it('never writes a credential value anywhere in the project tree', () => {
    writeBaseConfig(targetPath);
    const SENTINEL = 'sentinel-should-never-be-written-83fd21';
    // A real token value must never even be passed through this function —
    // it only accepts token_env (a name). Simulate the worst case (a caller
    // accidentally passing a `token` field) and confirm it's still not
    // written anywhere, since buildJiraCollector only reads tokenEnv here.
    writeWizardConnectionsArtifacts({
      targetPath,
      connections: { issue_tracker: { ...JIRA_CONNECTION, token: SENTINEL } },
    });

    const config = readFileSync(join(targetPath, '.laneconductor.json'), 'utf8');
    const envExample = readFileSync(join(targetPath, '.env.example'), 'utf8');
    assert.doesNotMatch(config, new RegExp(SENTINEL));
    assert.doesNotMatch(envExample, new RegExp(SENTINEL));
  });

  // TC-36
  it('is a no-op for a legacy dispatch with no connections key', () => {
    writeBaseConfig(targetPath, [{ url: 'http://localhost:8091', token: null }]);
    const before = readFileSync(join(targetPath, '.laneconductor.json'), 'utf8');
    const result = writeWizardConnectionsArtifacts({ targetPath, connections: undefined });
    assert.equal(result.wrote, false);
    assert.equal(readFileSync(join(targetPath, '.laneconductor.json'), 'utf8'), before);
    assert.equal(existsSync(join(targetPath, '.env.example')), false);
  });

  // TC-37
  it('is a no-op when the issue_tracker category is left on skip', () => {
    writeBaseConfig(targetPath);
    const before = readFileSync(join(targetPath, '.laneconductor.json'), 'utf8');
    const result = writeWizardConnectionsArtifacts({
      targetPath,
      connections: { source_control: { provider: 'github' }, issue_tracker: { provider: 'skip' }, cloud: { provider: 'skip' } },
    });
    assert.equal(result.wrote, false);
    assert.equal(readFileSync(join(targetPath, '.laneconductor.json'), 'utf8'), before);
    assert.equal(existsSync(join(targetPath, '.env.example')), false);
  });

  it('does not duplicate the env var line if .env.example already has it', () => {
    writeBaseConfig(targetPath);
    writeFileSync(join(targetPath, '.env.example'), 'JIRA_API_TOKEN=\n');
    writeWizardConnectionsArtifacts({ targetPath, connections: { issue_tracker: JIRA_CONNECTION } });
    const envExample = readFileSync(join(targetPath, '.env.example'), 'utf8');
    assert.equal((envExample.match(/JIRA_API_TOKEN=/g) || []).length, 1);
  });
});
