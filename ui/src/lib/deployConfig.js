// Track AM-1119 Phase 2 (Task 1): single source of truth for the App
// Creator wizard's Deployment step — provider list, environment defaults,
// and the conductor/deploy.json shape. Mirrored byte-for-byte in
// conductor/deployConfig.mjs for worker-side use (runCreateProject), same
// pattern as conductor/providers.mjs — the sync worker runs standalone via
// node conductor/laneconductor.sync.mjs and can't import ui/src directly.
// Keep both copies in sync when editing either one.

export const DEPLOY_PROVIDERS = [
  { value: 'firebase', label: 'Firebase Hosting' },
  { value: 'gcp', label: 'GCP Cloud Run' },
  { value: 'skip', label: "Skip — I'll configure this later" },
];

export const DEPLOY_ENVIRONMENT_OPTIONS = ['prod', 'staging'];

export function deploymentStepValid(value) {
  return value.provider === 'skip' || value.environments.length > 0;
}

function projectSlug(projectName) {
  return (projectName || 'app').trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'app';
}

function deployCommandFor({ provider, env, projectName }) {
  const slug = projectSlug(projectName);
  if (provider === 'firebase') return `firebase deploy --only hosting --project ${slug}-${env}`;
  if (provider === 'gcp') return `gcloud run deploy ${slug}-${env} --source . --region us-central1`;
  return '';
}

// Track AM-1119 Phase 4 (Task 2): Firebase Hosting's default domain is a
// deterministic function of the Firebase project id — `<project-id>.web.app`
// — unlike GCP Cloud Run, whose URL includes a hash GCP assigns at deploy
// time and can only be read from real `gcloud run deploy` output. Since
// `deployCommandFor` already assumes `<slug>-<env>` as that project id (the
// same assumption `lc setup-deploy` requires the user to have already
// provisioned — see spec.md's Out of Scope), the Hosting URL that command
// will actually produce is knowable up front. Returns null for gcp/skip —
// nothing predictable to fill in; deploy-runner.mjs parses those from
// output instead.
function expectedUrlFor({ provider, env, projectName }) {
  if (provider !== 'firebase') return null;
  return `https://${projectSlug(projectName)}-${env}.web.app`;
}

// Same shape read/written by GET/POST /api/projects/:id/deploy-config
// (ui/server/index.mjs): { defaultEnvironment, environments: { name: { command, description } } }.
// `expected_url` is an additive field beyond what that route validates —
// only conductor/deploy-runner.mjs's URL resolution (Phase 4) reads it.
// Returns null for provider 'skip' or no environments chosen — nothing to write.
export function buildDeployJson({ provider, environments, projectName }) {
  if (provider === 'skip' || !environments || environments.length === 0) return null;

  const providerLabel = DEPLOY_PROVIDERS.find(p => p.value === provider)?.label || provider;
  const envs = {};
  for (const env of environments) {
    const expectedUrl = expectedUrlFor({ provider, env, projectName });
    envs[env] = {
      command: deployCommandFor({ provider, env, projectName }),
      description: `${providerLabel} — ${env}`,
      ...(expectedUrl ? { expected_url: expectedUrl } : {}),
    };
  }
  return { defaultEnvironment: environments[0], environments: envs, provider };
}

export function buildDeploymentStackMd({ provider, environments, projectName }) {
  if (provider === 'skip' || !environments || environments.length === 0) {
    return '# Deployment Stack\n\nNot configured. Run `lc setup-deploy`.\n';
  }
  const providerLabel = DEPLOY_PROVIDERS.find(p => p.value === provider)?.label || provider;
  const envLines = environments.map(env => `- **${env}**: ${deployCommandFor({ provider, env, projectName })}`).join('\n');
  return `# Deployment Stack

## Provider
- **Deployment Platform**: ${providerLabel}

## Environments
${envLines}

## Deploy Command
Run \`lc deploy <env>\` for any environment listed above.
`;
}

// Required CI env var names only, never actual values — matches the
// pattern the /laneconductor setup-deploy generate skill command uses.
export function buildEnvExample({ provider }) {
  if (provider === 'firebase') {
    return '# Firebase — for CI; locally use `firebase login` (Application Default Credentials)\nFIREBASE_TOKEN=\n';
  }
  if (provider === 'gcp') {
    return '# GCP\nGOOGLE_APPLICATION_CREDENTIALS=\nGCP_PROJECT=\nGCP_REGION=\n';
  }
  return '';
}
