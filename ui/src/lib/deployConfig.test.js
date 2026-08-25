// ui/src/lib/deployConfig.test.js
// Track AM-1119 Phase 2 (Task 1, TC-4): shared deploy.json shape builder —
// must match what ui/server/index.mjs's GET/POST /api/projects/:id/deploy-config
// reads/writes ({ defaultEnvironment, environments: { name: { command, description } } }).

import { describe, it, expect } from 'vitest';
import { buildDeployJson, buildDeploymentStackMd, buildEnvExample, deploymentStepValid } from './deployConfig.js';

describe('deploymentStepValid', () => {
  it('is valid for provider "skip" regardless of environments', () => {
    expect(deploymentStepValid({ provider: 'skip', environments: [] })).toBe(true);
  });

  it('requires at least one environment for a real provider', () => {
    expect(deploymentStepValid({ provider: 'firebase', environments: [] })).toBe(false);
    expect(deploymentStepValid({ provider: 'firebase', environments: ['prod'] })).toBe(true);
  });
});

describe('buildDeployJson', () => {
  it('returns null for provider "skip"', () => {
    expect(buildDeployJson({ provider: 'skip', environments: [], projectName: 'x' })).toBeNull();
  });

  it('returns null when no environments are chosen', () => {
    expect(buildDeployJson({ provider: 'firebase', environments: [], projectName: 'x' })).toBeNull();
  });

  it('matches the deploy-config API shape for firebase + two environments', () => {
    const result = buildDeployJson({ provider: 'firebase', environments: ['prod', 'staging'], projectName: 'Digger Game' });
    expect(result.defaultEnvironment).toBe('prod');
    expect(Object.keys(result.environments)).toEqual(['prod', 'staging']);
    expect(typeof result.environments.prod.command).toBe('string');
    expect(result.environments.prod.command).toMatch(/firebase deploy/);
    expect(result.environments.staging.command).toMatch(/firebase deploy/);
  });

  it('builds a gcloud command for provider gcp', () => {
    const result = buildDeployJson({ provider: 'gcp', environments: ['prod'], projectName: 'Digger Game' });
    expect(result.environments.prod.command).toMatch(/gcloud run deploy/);
  });

  // Track AM-1119 Phase 4 (Task 2): Firebase Hosting's default domain is
  // predictable from the same project id the deploy command assumes;
  // GCP Cloud Run's is not (a hash GCP assigns at deploy time), so it must
  // stay unset here and get resolved from real output instead
  // (conductor/deploy-runner.mjs's resolveDeployedUrl).
  it('sets expected_url for firebase environments, matching the project id the deploy command uses', () => {
    const result = buildDeployJson({ provider: 'firebase', environments: ['prod'], projectName: 'Digger Game' });
    expect(result.environments.prod.expected_url).toBe('https://digger-game-prod.web.app');
    expect(result.environments.prod.command).toContain('digger-game-prod');
  });

  it('does not set expected_url for gcp environments', () => {
    const result = buildDeployJson({ provider: 'gcp', environments: ['prod'], projectName: 'Digger Game' });
    expect(result.environments.prod.expected_url).toBeUndefined();
  });
});

describe('buildDeploymentStackMd', () => {
  it('stubs when provider is skip', () => {
    expect(buildDeploymentStackMd({ provider: 'skip', environments: [], projectName: 'x' })).toMatch(/Not configured/);
  });

  it('lists the provider and every chosen environment', () => {
    const md = buildDeploymentStackMd({ provider: 'firebase', environments: ['prod', 'staging'], projectName: 'Digger Game' });
    expect(md).toMatch(/Firebase Hosting/);
    expect(md).toMatch(/prod/);
    expect(md).toMatch(/staging/);
  });
});

describe('buildEnvExample', () => {
  it('lists FIREBASE_TOKEN for firebase, never a real value', () => {
    const env = buildEnvExample({ provider: 'firebase' });
    expect(env).toMatch(/FIREBASE_TOKEN=/);
    expect(env).not.toMatch(/FIREBASE_TOKEN=.+\n/); // key present with no value
  });

  it('lists GCP vars for gcp', () => {
    const env = buildEnvExample({ provider: 'gcp' });
    expect(env).toMatch(/GOOGLE_APPLICATION_CREDENTIALS=/);
    expect(env).toMatch(/GCP_PROJECT=/);
    expect(env).toMatch(/GCP_REGION=/);
  });

  it('is empty for skip', () => {
    expect(buildEnvExample({ provider: 'skip' })).toBe('');
  });
});
