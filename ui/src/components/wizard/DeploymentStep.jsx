import React from 'react';

// Track AM-1119 Phase 1: Step 4 — deployment provider choice. This step
// intentionally does NOT check real credentials yet (that's Phase 2,
// REQ-2/TC-5: a worker-side gcloud/firebase auth check via a dedicated
// endpoint) — for now it collects intent so Launch has something to hand
// the manager worker. "Skip for now" keeps deployment fully optional, per
// spec.md's "skip" provider option.
const PROVIDERS = [
  { value: 'firebase', label: 'Firebase Hosting' },
  { value: 'gcp', label: 'GCP Cloud Run' },
  { value: 'skip', label: "Skip — I'll configure this later" },
];

export function DeploymentStep({ value, onChange }) {
  const { provider, environments } = value;

  function set(patch) {
    onChange({ ...value, ...patch });
  }

  function toggleEnv(env) {
    const next = environments.includes(env)
      ? environments.filter(e => e !== env)
      : [...environments, env];
    set({ environments: next });
  }

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-xs text-gray-500 mb-1">Deployment provider</label>
        <div className="space-y-1.5">
          {PROVIDERS.map(opt => (
            <label key={opt.value} className="flex items-center gap-2 text-sm text-gray-300">
              <input
                type="radio"
                name="deploy-provider"
                checked={provider === opt.value}
                onChange={() => set({ provider: opt.value })}
              />
              {opt.label}
            </label>
          ))}
        </div>
      </div>

      {provider !== 'skip' && (
        <div>
          <label className="block text-xs text-gray-500 mb-1">Environments</label>
          <div className="flex gap-3 text-xs text-gray-400">
            {['prod', 'staging'].map(env => (
              <label key={env} className="flex items-center gap-1.5">
                <input type="checkbox" checked={environments.includes(env)} onChange={() => toggleEnv(env)} />
                {env}
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function deploymentStepValid(value) {
  return value.provider === 'skip' || value.environments.length > 0;
}
