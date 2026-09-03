import React, { useEffect, useState } from 'react';
import { useApi } from '../../hooks/useApi.js';
import { CONNECTOR_CATEGORIES, DEFAULT_JIRA_TOKEN_ENV, connectionsStepValid } from '../../lib/connectors.js';

export { connectionsStepValid };

// Track TU-10049 Phase 3: source control / issue tracker / cloud pickers
// for the App Creator wizard's Connections step (spec.md REQ-1/REQ-2).
// Modeled directly on DeploymentStep.jsx's credential-status pattern —
// same checking/verified/NOT-CONFIGURED badge, same non-blocking posture
// (Launch is never gated on any of this — REQ-5). Disabled alternatives
// (GitLab, Linear, AWS, ...) render from CONNECTOR_CATEGORIES with the
// "— FFU" suffix already baked into their label data (Phase 1) — never
// selectable, native `disabled` prevents both click and keyboard selection.
//
// `showCategories` narrows which categories render — AM-1121's marketing
// kind has no repo to connect and no cloud project to bill (that track's
// own finding, re-applied here per spec.md REQ-1: marketing shows the
// issue-tracker picker only).
export function ConnectionsStep({ value, onChange, workerId, repoUrl, showCategories = ['source_control', 'issue_tracker', 'cloud'] }) {
  function set(categoryKey, patch) {
    onChange({ ...value, [categoryKey]: { ...value[categoryKey], ...patch } });
  }

  const categories = CONNECTOR_CATEGORIES.filter(c => showCategories.includes(c.id));

  return (
    <div className="space-y-4">
      {categories.map(category => {
        if (category.id === 'source_control') {
          return (
            <SourceControlCategory
              key={category.id}
              category={category}
              value={value.sourceControl}
              onChange={patch => set('sourceControl', patch)}
              workerId={workerId}
              repoUrl={repoUrl}
            />
          );
        }
        if (category.id === 'issue_tracker') {
          return (
            <IssueTrackerCategory
              key={category.id}
              category={category}
              value={value.issueTracker}
              onChange={patch => set('issueTracker', patch)}
              workerId={workerId}
            />
          );
        }
        return (
          <CloudCategory
            key={category.id}
            category={category}
            value={value.cloud}
            onChange={patch => set('cloud', patch)}
            workerId={workerId}
          />
        );
      })}
    </div>
  );
}

function ProviderPicker({ category, providerValue, onSelect, name }) {
  return (
    <div>
      <label className="block text-xs text-gray-500 mb-1">{category.label}</label>
      <div className="space-y-1.5" data-testid={`connections-${category.id}`}>
        <label className="flex items-center gap-2 text-sm text-gray-300">
          <input type="radio" name={name} checked={providerValue === 'skip'} onChange={() => onSelect('skip')} />
          Skip — configure later
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-300">
          <input
            type="radio"
            name={name}
            checked={providerValue === category.real.value}
            onChange={() => onSelect(category.real.value)}
            data-testid={`connections-real-${category.id}`}
          />
          {category.real.label}
        </label>
        {category.alternatives.map(alt => (
          <label key={alt.value} className="flex items-center gap-2 text-sm text-gray-600 cursor-not-allowed">
            <input type="radio" name={name} checked={false} disabled data-testid={`connections-alt-${category.id}-${alt.value}`} />
            {alt.label}
          </label>
        ))}
      </div>
    </div>
  );
}

function CredentialBadge({ status, error, remediation }) {
  const verified = status && status !== 'checking' && status.status === 'verified';
  const notConfigured = status && status !== 'checking' && status.status !== 'verified';
  return (
    <div data-testid="connections-credential-status" className="text-xs">
      {status === 'checking' && <span className="text-gray-500">Checking credentials…</span>}
      {verified && <span className="text-emerald-400">✅ verified{status.detail ? ` (${status.detail})` : ''}</span>}
      {notConfigured && (
        <span className="text-amber-400">
          ⚠️ NOT CONFIGURED{status.detail ? ` — ${status.detail}` : ''}
          {remediation ? ` — ${remediation}` : ''}
        </span>
      )}
      {error && <span className="text-gray-500">Credential check unavailable: {error}</span>}
    </div>
  );
}

function SourceControlCategory({ category, value, onChange, workerId, repoUrl }) {
  const { apiFetch } = useApi();
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (value.provider !== 'github' || !workerId) {
      setStatus(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setStatus('checking');
    setError(null);
    apiFetch(`/api/workers/${workerId}/credentials?provider=github`)
      .then(async r => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
        return r.json();
      })
      .then(d => { if (!cancelled) setStatus(d); })
      .catch(err => { if (!cancelled) { setStatus(null); setError(err.message); } });
    return () => { cancelled = true; };
  }, [value.provider, workerId]);

  return (
    <div className="space-y-2" data-testid="connections-category-source_control">
      <ProviderPicker category={category} providerValue={value.provider} onSelect={p => onChange({ provider: p })} name="connections-source-control" />
      {value.provider === 'github' && (
        <div className="space-y-1.5 pl-1">
          {repoUrl && repoUrl.trim() && (
            <p className="text-[11px] text-gray-500" data-testid="connections-github-repo">
              Connecting <span className="text-gray-400">{repoUrl.trim()}</span>
            </p>
          )}
          <CredentialBadge status={status} error={error} remediation="run gh auth login on the worker machine" />
        </div>
      )}
    </div>
  );
}

function IssueTrackerCategory({ category, value, onChange, workerId }) {
  const { apiFetch } = useApi();
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);

  // Debounced: domain/email/projectKey/tokenEnv are free-text inputs — a
  // credential check per keystroke would spam the endpoint (spec.md
  // Task 3.3 / TC-24).
  useEffect(() => {
    if (value.provider !== 'jira' || !workerId) {
      setStatus(null);
      setError(null);
      return;
    }
    if (!value.domain.trim() || !value.email.trim() || !value.projectKey.trim()) {
      setStatus(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setStatus('checking');
    setError(null);
    const timer = setTimeout(() => {
      const params = new URLSearchParams({
        provider: 'jira',
        domain: value.domain.trim(),
        email: value.email.trim(),
        project_key: value.projectKey.trim(),
        token_env: value.tokenEnv.trim() || DEFAULT_JIRA_TOKEN_ENV,
      });
      apiFetch(`/api/workers/${workerId}/credentials?${params.toString()}`)
        .then(async r => {
          if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
          return r.json();
        })
        .then(d => { if (!cancelled) setStatus(d); })
        .catch(err => { if (!cancelled) { setStatus(null); setError(err.message); } });
    }, 400);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [value.provider, value.domain, value.email, value.projectKey, value.tokenEnv, workerId]);

  return (
    <div className="space-y-2" data-testid="connections-category-issue_tracker">
      <ProviderPicker category={category} providerValue={value.provider} onSelect={p => onChange({ provider: p })} name="connections-issue-tracker" />
      {value.provider === 'jira' && (
        <div className="space-y-1.5 pl-1">
          <input
            type="text"
            value={value.domain}
            onChange={e => onChange({ domain: e.target.value })}
            placeholder="acme.atlassian.net"
            data-testid="connections-jira-domain"
            className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-gray-500"
          />
          <input
            type="text"
            value={value.email}
            onChange={e => onChange({ email: e.target.value })}
            placeholder="you@company.com"
            data-testid="connections-jira-email"
            className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-gray-500"
          />
          <input
            type="text"
            value={value.projectKey}
            onChange={e => onChange({ projectKey: e.target.value })}
            placeholder="Project key (e.g. ACME)"
            data-testid="connections-jira-project-key"
            className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-gray-500"
          />
          <input
            type="text"
            value={value.tokenEnv}
            onChange={e => onChange({ tokenEnv: e.target.value })}
            placeholder={DEFAULT_JIRA_TOKEN_ENV}
            data-testid="connections-jira-token-env"
            className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-gray-500"
          />
          <p className="text-[11px] text-gray-500">
            Name of the environment variable holding the Jira API token — never the token itself.
            See <span className="text-gray-400">lc add-target-mapping</span> to configure lane→status mapping afterward.
          </p>
          <CredentialBadge status={status} error={error} />
        </div>
      )}
    </div>
  );
}

function CloudCategory({ category, value, onChange, workerId }) {
  const { apiFetch } = useApi();
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (value.provider !== 'gcp' || !workerId) {
      setStatus(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setStatus('checking');
    setError(null);
    apiFetch(`/api/workers/${workerId}/credentials?provider=gcp`)
      .then(async r => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
        return r.json();
      })
      .then(d => { if (!cancelled) setStatus(d); })
      .catch(err => { if (!cancelled) { setStatus(null); setError(err.message); } });
    return () => { cancelled = true; };
  }, [value.provider, workerId]);

  return (
    <div className="space-y-2" data-testid="connections-category-cloud">
      <ProviderPicker category={category} providerValue={value.provider} onSelect={p => onChange({ provider: p })} name="connections-cloud" />
      {value.provider === 'gcp' && (
        <div className="space-y-1.5 pl-1">
          <input
            type="text"
            value={value.projectId}
            onChange={e => onChange({ projectId: e.target.value })}
            placeholder="GCP project id"
            data-testid="connections-gcp-project-id"
            className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-gray-500"
          />
          <input
            type="text"
            value={value.serviceAccount}
            onChange={e => onChange({ serviceAccount: e.target.value })}
            placeholder="Service account email (optional)"
            data-testid="connections-gcp-service-account"
            className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-gray-500"
          />
          <CredentialBadge status={status} error={error} remediation="run gcloud auth login on the worker machine" />
        </div>
      )}
    </div>
  );
}
