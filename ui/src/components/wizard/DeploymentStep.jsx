import React, { useEffect, useState } from 'react';
import { useApi } from '../../hooks/useApi.js';
import { DEPLOY_PROVIDERS, DEPLOY_ENVIRONMENT_OPTIONS, deploymentStepValid } from '../../lib/deployConfig.js';

export { deploymentStepValid };

// Track AM-1119 Phase 2: provider choice + credential status (REQ-2, TC-4,
// TC-5). Provider list and env defaults come from ui/src/lib/deployConfig.js
// (Task 1) so the wizard, DeployPanel's config editor, and the worker's
// runCreateProject artifact writer share one shape. Credential status is a
// non-blocking warning only — Launch is never gated on it (TC-5): a solo
// founder may configure gcloud/firebase auth after Launch, before the
// generated deploy track actually runs.
export function DeploymentStep({ value, onChange, workerId }) {
  const { apiFetch } = useApi();
  const { provider, environments } = value;
  const [credStatus, setCredStatus] = useState(null); // { status: 'verified'|'NOT CONFIGURED', detail } | 'checking' | null
  const [credError, setCredError] = useState(null);

  useEffect(() => {
    if (provider === 'skip' || !workerId) {
      setCredStatus(null);
      setCredError(null);
      return;
    }
    let cancelled = false;
    setCredStatus('checking');
    setCredError(null);
    apiFetch(`/api/workers/${workerId}/deploy-credentials?provider=${provider}`)
      .then(async r => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
        return r.json();
      })
      .then(d => { if (!cancelled) setCredStatus(d); })
      .catch(err => { if (!cancelled) { setCredStatus(null); setCredError(err.message); } });
    return () => { cancelled = true; };
  }, [provider, workerId]);

  function set(patch) {
    onChange({ ...value, ...patch });
  }

  function toggleEnv(env) {
    const next = environments.includes(env)
      ? environments.filter(e => e !== env)
      : [...environments, env];
    set({ environments: next });
  }

  const verified = credStatus && credStatus !== 'checking' && credStatus.status === 'verified';
  const notConfigured = credStatus && credStatus !== 'checking' && credStatus.status !== 'verified';

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-xs text-gray-500 mb-1">Deployment provider</label>
        <div className="space-y-1.5">
          {DEPLOY_PROVIDERS.map(opt => (
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
        <>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Environments</label>
            <div className="flex gap-3 text-xs text-gray-400">
              {DEPLOY_ENVIRONMENT_OPTIONS.map(env => (
                <label key={env} className="flex items-center gap-1.5">
                  <input type="checkbox" checked={environments.includes(env)} onChange={() => toggleEnv(env)} />
                  {env}
                </label>
              ))}
            </div>
          </div>

          <div data-testid="deploy-credential-status" className="text-xs">
            {credStatus === 'checking' && <span className="text-gray-500">Checking {provider} credentials…</span>}
            {verified && <span className="text-emerald-400">✅ verified{credStatus.detail ? ` (${credStatus.detail})` : ''}</span>}
            {notConfigured && (
              <span className="text-amber-400">
                ⚠️ NOT CONFIGURED — Launch will still proceed; configure {provider} credentials on the worker machine before the deploy track runs.
              </span>
            )}
            {credError && <span className="text-gray-500">Credential check unavailable: {credError}</span>}
          </div>
        </>
      )}
    </div>
  );
}
