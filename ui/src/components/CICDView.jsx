import { useState, useEffect, useCallback } from 'react';
import { useApi } from '../hooks/useApi.js';
import { DeployLogView } from './DeployLogView.jsx';
import { MarkdownRenderer } from './MarkdownRenderer.jsx';

// ─── Deploy Release Panel ─────────────────────────────────────────────────────

export function DeployPanel({ projectId, workers = [] }) {
  const { apiFetch } = useApi();

  const [deployEnvironments, setDeployEnvironments] = useState([]);
  const [deployWorkerId, setDeployWorkerId]         = useState('');
  const [deployEnv, setDeployEnv]                   = useState('');
  const [deploySource, setDeploySource]             = useState('head'); // 'head' | 'build'
  const [builds, setBuilds]                         = useState([]);
  const [selectedBuildId, setSelectedBuildId]       = useState('');
  const [showNotes, setShowNotes]                   = useState(false);
  const [deploying, setDeploying]                   = useState(false);
  const [lastDispatch, setLastDispatch]             = useState(null);

  // Load environments & builds when project changes
  useEffect(() => {
    if (!projectId) { setDeployEnvironments([]); setBuilds([]); return; }
    apiFetch(`/api/projects/${projectId}/deploy-environments`)
      .then(r => r.ok ? r.json() : { environments: [], defaultEnvironment: null })
      .then(d => {
        const envs = d.environments || [];
        setDeployEnvironments(envs);
        if (d.defaultEnvironment && envs.includes(d.defaultEnvironment)) setDeployEnv(d.defaultEnvironment);
        else if (envs.length > 0) setDeployEnv(envs[0]);
      })
      .catch(() => setDeployEnvironments([]));

    apiFetch(`/api/projects/${projectId}/builds`)
      .then(r => r.ok ? r.json() : { builds: [] })
      .then(d => {
        const list = d.builds || [];
        setBuilds(list);
        if (list.length > 0) setSelectedBuildId(list[0].id);
      })
      .catch(() => setBuilds([]));
  }, [projectId]);

  // Auto-select first idle worker
  useEffect(() => {
    if (!deployWorkerId && workers.length > 0) {
      const idle = workers.find(w => w.status !== 'busy');
      setDeployWorkerId(String((idle ?? workers[0]).id));
    }
  }, [workers]);

  useEffect(() => {
    if (!deployEnv && deployEnvironments.length > 0) setDeployEnv(deployEnvironments[0]);
  }, [deployEnvironments]);

  const selectedBuild = builds.find(b => b.id === selectedBuildId) || builds[0];

  async function dispatch(action, extraPayload = {}) {
    if (!projectId || !deployWorkerId) return;
    setDeploying(true);
    try {
      const payload = { environment: deployEnv, ...extraPayload };
      if (action === 'deploy' && deploySource === 'build' && selectedBuildId) {
        payload.buildId = selectedBuildId;
      }
      const res = await apiFetch(`/api/projects/${projectId}/dispatch`, {
        method: 'POST',
        body: JSON.stringify({ worker_id: parseInt(deployWorkerId), action, payload }),
      });
      if (res.ok) {
        setLastDispatch({ action, env: deployEnv, ts: new Date() });
        setShowNotes(false);
      } else {
        const { error } = await res.json().catch(() => ({}));
        alert(`Dispatch failed: ${error || res.statusText}`);
      }
    } catch (err) {
      alert(`Dispatch failed: ${err.message}`);
    }
    setDeploying(false);
  }

  if (!projectId) return null;

  const noEnvs = deployEnvironments.length === 0;
  const noWorkers = workers.length === 0;

  return (
    <div className="flex flex-col gap-4 p-5 bg-gray-900/60 border border-gray-800 rounded-xl shadow-lg">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-800 pb-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-gray-200">🚀 Deploy Release</span>
          {noEnvs && (
            <span className="text-[10px] text-amber-400 bg-amber-950/30 border border-amber-800/50 px-2 py-0.5 rounded">
              No environments — configure in ⚙️ Config
            </span>
          )}
        </div>

        {/* HEAD vs Build toggle */}
        <div className="flex items-center bg-gray-950 p-0.5 rounded-lg border border-gray-800">
          <button
            onClick={() => setDeploySource('head')}
            className={`text-xs font-semibold px-3 py-1 rounded-md transition-all ${deploySource === 'head' ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-400 hover:text-gray-200'}`}
          >
            Workspace HEAD
          </button>
          <button
            onClick={() => setDeploySource('build')}
            className={`text-xs font-semibold px-3 py-1 rounded-md transition-all flex items-center gap-1.5 ${deploySource === 'build' ? 'bg-purple-600 text-white shadow-sm' : 'text-gray-400 hover:text-gray-200'}`}
          >
            Build Artifact
            {builds.length > 0 && (
              <span className={`text-[10px] px-1.5 rounded-full font-bold ${deploySource === 'build' ? 'bg-purple-800 text-purple-100' : 'bg-gray-800 text-gray-400'}`}>
                {builds.length}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Controls row */}
      <div className="flex items-end gap-3 flex-wrap bg-gray-950/80 p-3 rounded-lg border border-gray-800/80">
        {/* Environment */}
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Environment</label>
          {noEnvs ? (
            <span className="text-xs text-gray-600 italic px-2 py-1.5">—</span>
          ) : (
            <select
              value={deployEnv}
              disabled={deploying}
              onChange={e => setDeployEnv(e.target.value)}
              className="text-xs bg-gray-900 border border-gray-700 rounded-lg px-2.5 py-1.5 text-gray-200 focus:outline-none focus:border-blue-500 disabled:opacity-50"
            >
              {deployEnvironments.map(env => <option key={env} value={env}>{env}</option>)}
            </select>
          )}
        </div>

        {/* Worker */}
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Sync Worker</label>
          {noWorkers ? (
            <span className="text-xs text-gray-600 italic px-2 py-1.5">No workers</span>
          ) : (
            <select
              value={deployWorkerId}
              disabled={deploying}
              onChange={e => setDeployWorkerId(e.target.value)}
              className="text-xs bg-gray-900 border border-gray-700 rounded-lg px-2.5 py-1.5 text-gray-200 focus:outline-none focus:border-blue-500 disabled:opacity-50"
            >
              {workers.map(w => (
                <option key={w.id} value={w.id}>{w.hostname}#{w.worker_number ?? 1}</option>
              ))}
            </select>
          )}
        </div>

        {/* Build artifact dropdown */}
        {deploySource === 'build' && (
          <div className="flex flex-col gap-1 flex-1 min-w-[200px]">
            <label className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Target Build Artifact</label>
            {builds.length > 0 ? (
              <select
                value={selectedBuildId}
                disabled={deploying}
                onChange={e => setSelectedBuildId(e.target.value)}
                className="text-xs bg-gray-900 border border-purple-800/60 rounded-lg px-2.5 py-1.5 text-purple-200 focus:outline-none focus:border-purple-500 disabled:opacity-50 font-mono"
              >
                {builds.map(b => {
                  const dateFmt = new Date(b.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
                  return (
                    <option key={b.id} value={b.id}>
                      {b.id} — git:{b.git?.shortCommit || 'no-commit'} ({dateFmt})
                    </option>
                  );
                })}
              </select>
            ) : (
              <div className="text-xs text-amber-400 italic bg-amber-950/20 border border-amber-900/40 rounded-lg px-3 py-1.5">
                No builds found. Run <code className="font-mono">lc build</code> first.
              </div>
            )}
          </div>
        )}

        {/* Action buttons */}
        <div className="flex items-center gap-2 ml-auto">
          <button
            onClick={() => dispatch('build', { createdBy: 'UI User' })}
            disabled={deploying || noWorkers}
            className="text-xs px-3 py-1.5 rounded-lg border border-gray-700 bg-gray-900 text-gray-300 hover:border-gray-600 hover:text-white font-medium transition-colors flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            🔨 Build New
          </button>

          <button
            onClick={() => dispatch('build_and_deploy', { createdBy: 'UI User' })}
            disabled={deploying || noWorkers || noEnvs}
            className="text-xs px-3 py-1.5 rounded-lg border border-purple-700/80 bg-purple-950/60 text-purple-200 hover:bg-purple-900/80 font-medium transition-colors flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            ⚡ Build &amp; Deploy
          </button>

          {deploySource === 'build' && selectedBuild && (
            <button
              onClick={() => setShowNotes(v => !v)}
              className={`text-xs px-3 py-1.5 rounded-lg border font-medium transition-colors ${showNotes ? 'bg-purple-950/80 border-purple-700 text-purple-300' : 'bg-gray-900 border-gray-700 text-gray-300 hover:border-gray-600'}`}
            >
              {showNotes ? 'Hide Notes' : '📋 Release Notes'}
            </button>
          )}

          <button
            onClick={() => dispatch('deploy')}
            disabled={deploying || noWorkers || noEnvs || (deploySource === 'build' && !selectedBuildId)}
            className={`text-xs font-bold px-4 py-1.5 rounded-lg shadow-md transition-all flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed ${deploySource === 'build' ? 'bg-purple-600 hover:bg-purple-500 text-white shadow-purple-900/30' : 'bg-blue-600 hover:bg-blue-500 text-white shadow-blue-900/30'}`}
          >
            {deploying ? 'Dispatching…' : `Deploy to ${deployEnv || 'Env'}`}
          </button>
        </div>
      </div>

      {/* Last dispatch confirmation */}
      {lastDispatch && (
        <div className="text-[11px] text-green-400 bg-green-950/20 border border-green-900/30 rounded-lg px-3 py-2 flex items-center gap-2">
          ✓ <strong>{lastDispatch.action}</strong> dispatched to <strong>{lastDispatch.env}</strong> at {lastDispatch.ts.toLocaleTimeString()}
          <button onClick={() => setLastDispatch(null)} className="ml-auto text-green-700 hover:text-green-500 transition-colors">✕</button>
        </div>
      )}

      {/* Release Notes Panel */}
      {deploySource === 'build' && selectedBuild && showNotes && (
        <div className="flex flex-col gap-3 bg-gray-950 border border-purple-900/40 rounded-xl p-4">
          <div className="flex items-center justify-between border-b border-gray-800 pb-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-purple-400 font-mono">{selectedBuild.id}</span>
              {selectedBuild.git?.branch && (
                <span className="text-[10px] px-2 py-0.5 rounded bg-gray-900 border border-gray-800 text-gray-400 font-mono">🌿 {selectedBuild.git.branch}</span>
              )}
              {selectedBuild.git?.shortCommit && (
                <span className="text-[10px] px-2 py-0.5 rounded bg-gray-900 border border-gray-800 text-gray-400 font-mono"># {selectedBuild.git.shortCommit}</span>
              )}
            </div>
            <span className="text-[10px] text-gray-500">
              Built by <span className="text-gray-300 font-medium">{selectedBuild.createdBy || 'Worker'}</span> at {new Date(selectedBuild.createdAt).toLocaleString()}
            </span>
          </div>
          {selectedBuild.tracks?.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Tracks:</span>
              {selectedBuild.tracks.map(t => (
                <span key={t} className="text-[10px] px-2 py-0.5 rounded bg-blue-950 text-blue-300 border border-blue-800/80 font-mono">#{t}</span>
              ))}
            </div>
          )}
          <div className="bg-gray-900/70 border border-gray-800/80 rounded-lg p-3 max-h-60 overflow-y-auto">
            <MarkdownRenderer content={selectedBuild.summary?.markdown || selectedBuild.summary?.text || 'No AI release notes available for this build.'} />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Dispatch History ─────────────────────────────────────────────────────────

function DispatchHistory({ projectId }) {
  const { apiFetch } = useApi();
  const [history, setHistory] = useState([]);
  const [selectedId, setSelectedId] = useState(null);

  const fetchHistory = useCallback(() => {
    if (!projectId) return;
    apiFetch(`/api/projects/${projectId}/dispatch`)
      .then(r => r.ok ? r.json() : [])
      .then(setHistory)
      .catch(() => {});
  }, [projectId]);

  useEffect(() => {
    fetchHistory();
    const id = setInterval(fetchHistory, 5000);
    return () => clearInterval(id);
  }, [fetchHistory]);

  if (!history.length) return (
    <div className="flex flex-col items-center justify-center p-10 border border-dashed border-gray-800 rounded-xl bg-gray-900/20 gap-3">
      <span className="text-3xl opacity-20">📋</span>
      <p className="text-gray-500 text-sm">No deployments dispatched yet.</p>
    </div>
  );

  return (
    <div className="flex flex-col gap-2">
      {history.map(d => {
        const bId = d.payload?.buildId || d.payload?.build_id;
        const env = d.payload?.environment;
        const createdBy = d.payload?.createdBy;
        const workerLabel = d.worker_hostname ? `${d.worker_hostname}#${d.worker_number ?? 1}` : `worker #${d.worker_id}`;
        const isSelected = selectedId === d.id;
        const statusClass = d.status === 'done' ? 'text-green-400' : d.status === 'failed' ? 'text-red-400' : d.status === 'claimed' ? 'text-blue-400 animate-pulse' : 'text-yellow-400';
        const statusSymbol = d.status === 'done' ? '✓' : d.status === 'failed' ? '✗' : '•';
        const statusTitle = d.status === 'done' ? 'Completed' : d.status === 'failed' ? 'Failed' : d.status === 'claimed' ? 'In Progress' : 'Pending';

        return (
          <div key={d.id} className="flex flex-col bg-gray-950 border border-gray-800 rounded-lg p-3 gap-2 hover:border-gray-700 transition-colors">
            <div className="flex items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                <span className={`font-bold ${statusClass}`} title={`Status: ${statusTitle}`}>{statusSymbol}</span>
                <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-gray-900 border border-gray-800 text-gray-300">{d.action}</span>
                {env && (
                  <span className="text-[10px] font-mono text-emerald-300 bg-emerald-950/40 border border-emerald-800/60 px-1.5 py-0.5 rounded flex items-center gap-1" title={`Target Environment: ${env}`}>
                    <span>🌐</span><span>env:{env}</span>
                  </span>
                )}
                {bId ? (
                  <span className="text-[10px] font-mono text-purple-300 bg-purple-950/50 border border-purple-800/60 px-1.5 py-0.5 rounded truncate max-w-[160px] flex items-center gap-1" title={`Build: ${bId}`}>
                    <span>📦</span><span>{bId}</span>
                  </span>
                ) : (d.action === 'deploy' || d.action === 'build_and_deploy') ? (
                  <span className="text-[10px] font-mono text-blue-300 bg-blue-950/50 border border-blue-800/60 px-1.5 py-0.5 rounded flex items-center gap-1" title="Workspace HEAD (live code)">
                    <span>🌿</span><span>HEAD</span>
                  </span>
                ) : null}
                <span className="text-[10px] font-mono text-gray-500 bg-gray-900 border border-gray-800 px-1.5 py-0.5 rounded flex items-center gap-1" title={`Worker: ${workerLabel}`}>
                  <span>🖥️</span><span>{workerLabel}</span>
                </span>
                {createdBy && <span className="text-[10px] text-gray-600 italic">by {createdBy}</span>}
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {d.result && <span className="text-gray-400 truncate max-w-[160px] text-[10px]" title={d.result}>{d.result}</span>}
                <span className="text-[10px] text-gray-500">{new Date(d.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                <button
                  onClick={() => setSelectedId(isSelected ? null : d.id)}
                  className={`text-[10px] font-mono px-2 py-0.5 rounded border transition-colors ${isSelected ? 'bg-purple-950 border-purple-700 text-purple-200' : 'bg-gray-900 border-gray-700 text-gray-300 hover:text-white hover:border-gray-500'}`}
                >
                  {isSelected ? '✕ Hide Log' : '📋 Log'}
                </button>
              </div>
            </div>
            {isSelected && (
              <div className="mt-1 bg-gray-900/90 border border-gray-800 rounded-lg p-3 max-h-56 overflow-y-auto">
                <DeployLogView projectId={projectId} dispatchId={d.id} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Deploy Stack Card ────────────────────────────────────────────────────────
// Reads deployment_stack from conductor_files (synced to DB by laneconductor.sync.mjs)

function DeployStackCard({ projectId, refreshKey }) {
  const { apiFetch } = useApi();
  const [stack, setStack] = useState(null);   // raw markdown string or null
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!projectId) return;
    setLoading(true);
    apiFetch(`/api/projects/${projectId}/conductor`)
      .then(r => r.ok ? r.json() : {})
      .then(d => { setStack(d?.deployment_stack || null); setLoading(false); })
      .catch(() => setLoading(false));
  }, [projectId, refreshKey]);

  // Parse the markdown into sections for structured display
  const sections = stack ? parseDeployStack(stack) : null;

  if (loading) return null;

  if (!sections) {
    return (
      <div className="flex items-center gap-3 bg-gray-900/60 border border-gray-800 rounded-xl px-4 py-3 text-xs text-gray-500">
        <span>📄</span>
        <span>No deployment stack configured yet. Use <strong className="text-gray-300">Setup</strong> to generate one, or run <code className="bg-gray-800 px-1 rounded">lc setup-deploy</code> in your project.</span>
      </div>
    );
  }

  return (
    <div className="bg-gray-950 border border-gray-800 rounded-xl overflow-hidden shadow">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800/60">
        <div className="flex items-center gap-2.5">
          <span className="text-sm">📋</span>
          <span className="text-xs font-bold text-gray-200">Current Deployment Stack</span>
          <span className="text-[10px] text-gray-500">from conductor/deployment-stack.md</span>
        </div>
        <span className="text-[10px] px-2 py-0.5 rounded bg-green-900/30 border border-green-800/40 text-green-400 font-mono">synced</span>
      </div>
      {/* Sections grid */}
      <div className="grid grid-cols-2 gap-px bg-gray-800/40 text-xs">
        {sections.map((sec, i) => (
          <div key={i} className="bg-gray-950 px-4 py-3 space-y-1.5">
            <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500">{sec.heading}</div>
            {sec.lines.map((line, j) => (
              <div key={j} className="text-gray-300 leading-relaxed font-mono text-[11px] whitespace-pre-wrap break-all">{line}</div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function parseDeployStack(md) {
  // Extract ## sections from the markdown
  const sections = [];
  let current = null;
  for (const raw of md.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('## ')) {
      if (current && current.lines.length > 0) sections.push(current);
      current = { heading: line.slice(3).trim(), lines: [] };
    } else if (current && line && !line.startsWith('#')) {
      // Strip markdown list bullets and backticks for display
      const clean = line.replace(/^[-*] /, '').replace(/`/g, '');
      current.lines.push(clean);
    }
  }
  if (current && current.lines.length > 0) sections.push(current);
  return sections.length > 0 ? sections : null;
}

// ─── Deploy Config Section ────────────────────────────────────────────────────

const PRESET_TEMPLATES = {
  prod_staging: { label: 'Production & Staging', config: { defaultEnvironment: 'production', environments: { production: { command: 'bash scripts/deploy.sh production', description: 'Production AWS/Cloud stack' }, staging: { command: 'bash scripts/deploy.sh staging', description: 'Staging preview environment' } } } },
  single_prod:  { label: 'Single Production Stack', config: { defaultEnvironment: 'production', environments: { production: { command: 'npm run deploy', description: 'Production build & deploy' } } } },
  vercel_cloud: { label: 'Vercel / Cloud CI', config: { defaultEnvironment: 'production', environments: { production: { command: 'vercel --prod', description: 'Vercel production release' }, preview: { command: 'vercel', description: 'Vercel preview deployment' } } } },
};

function DeployConfigSection({ projectId, deployConfig, onChange }) {
  const { apiFetch } = useApi();
  const [newEnvName, setNewEnvName] = useState('');
  const [newEnvCommand, setNewEnvCommand] = useState('');
  const [newEnvDescription, setNewEnvDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [notification, setNotification] = useState(null);
  const [open, setOpen] = useState(true);

  useEffect(() => {
    if (notification) { const t = setTimeout(() => setNotification(null), 3500); return () => clearTimeout(t); }
  }, [notification]);

  // deployConfig is now owned by parent — no local fetch needed
  async function save() {
    setSaving(true);
    try {
      const r = await apiFetch(`/api/projects/${projectId}/deploy-config`, { method: 'POST', body: JSON.stringify(deployConfig) });
      if (!r.ok) throw new Error(await r.text());
      setNotification({ type: 'success', message: 'Deployment config saved!' });
    } catch (err) {
      setNotification({ type: 'error', message: 'Save failed: ' + err.message });
    }
    setSaving(false);
  }

  function handleAddEnvironment(e) {
    e.preventDefault();
    const name = newEnvName.trim(), cmd = newEnvCommand.trim();
    if (!name || !cmd) return;
    const updated = {
      ...deployConfig,
      ...(Object.keys(deployConfig.environments || {}).length === 0 && !deployConfig.defaultEnvironment ? { defaultEnvironment: name } : {}),
      environments: { ...(deployConfig.environments || {}), [name]: { command: cmd, ...(newEnvDescription.trim() ? { description: newEnvDescription.trim() } : {}) } },
    };
    onChange(updated);
    setNewEnvName(''); setNewEnvCommand(''); setNewEnvDescription('');
  }

  function handleDelete(envName) {
    const next = { ...deployConfig, environments: { ...(deployConfig.environments || {}) } };
    delete next.environments[envName];
    if (deployConfig.defaultEnvironment === envName) delete next.defaultEnvironment;
    onChange(next);
  }

  function handleSetDefault(envName) {
    onChange(deployConfig.defaultEnvironment === envName
      ? (({ defaultEnvironment, ...rest }) => rest)(deployConfig)
      : { ...deployConfig, defaultEnvironment: envName });
  }

  function handleUpdateEnv(envName, updates) {
    const cur = deployConfig.environments?.[envName] || {};
    const next = { ...cur, ...updates };
    if (updates.commands) delete next.command; else if (updates.command !== undefined) delete next.commands;
    onChange({ ...deployConfig, environments: { ...(deployConfig.environments || {}), [envName]: next } });
  }

  const inputCls = 'w-full bg-gray-900 border border-gray-700 text-xs text-white p-1.5 rounded focus:outline-none focus:border-blue-600';
  const labelCls = 'block text-[10px] text-gray-500 font-bold uppercase mb-1';
  const envEntries = Object.entries(deployConfig?.environments || {});

  return (
    <div className="bg-gray-950 border border-gray-800 rounded-xl shadow-lg overflow-hidden">
      {/* Header */}
      <button onClick={() => setOpen(v => !v)} className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-gray-900/40 transition-colors">
        <div className="flex items-center gap-3">
          <span className="text-sm font-bold text-gray-200">⚙️ Deployment Config</span>
          <span className="text-[10px] text-gray-500">conductor/deploy.json</span>
          {envEntries.length > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-400 font-mono">{envEntries.length} env{envEntries.length !== 1 ? 's' : ''}</span>}
        </div>
        <span className="text-gray-600 text-xs">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="px-5 pb-5 space-y-4 border-t border-gray-800/60">
          {/* Default env + Presets */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-gray-900/60 border border-gray-800 rounded-lg p-3 mt-4">
            <div className="flex items-center gap-3">
              <div>
                <label className="text-[10px] text-gray-400 font-bold uppercase block">Default Environment</label>
                <span className="text-[10px] text-gray-500">Auto-selected in Deploy dispatches</span>
              </div>
              <select
                value={deployConfig?.defaultEnvironment || ''}
                onChange={e => { const v = e.target.value; onChange(v ? { ...deployConfig, defaultEnvironment: v } : (({ defaultEnvironment, ...r }) => r)(deployConfig)); }}
                className="bg-gray-900 border border-gray-700 text-xs text-white px-2 py-1 rounded focus:outline-none focus:border-blue-500 font-mono"
              >
                <option value="">(None)</option>
                {envEntries.map(([n]) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mr-1">Presets:</span>
              {Object.entries(PRESET_TEMPLATES).map(([key, tpl]) => (
                <button key={key} type="button" onClick={() => setDeployConfig(tpl.config)}
                  className="px-2 py-1 text-[10px] bg-gray-900 hover:bg-gray-800 text-gray-300 hover:text-white border border-gray-700 rounded transition-colors">
                  + {tpl.label}
                </button>
              ))}
            </div>
          </div>

          {/* Env list */}
          {envEntries.length === 0 ? (
            <div className="border border-dashed border-gray-800 rounded-lg p-4 text-center">
              <p className="text-xs text-gray-500">No environments configured. Add one below or apply a preset.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {envEntries.map(([envName, envData]) => (
                <div key={envName} className="bg-gray-900 border border-gray-800 rounded-lg p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-blue-400 font-mono">{envName}</span>
                      {deployConfig?.defaultEnvironment === envName ? (
                        <span className="px-1.5 py-0.5 text-[9px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40 rounded uppercase">Default</span>
                      ) : (
                        <button type="button" onClick={() => handleSetDefault(envName)} className="text-[10px] text-gray-500 hover:text-amber-300 transition-colors">Set as Default</button>
                      )}
                    </div>
                    <button type="button" onClick={() => handleDelete(envName)} className="text-[10px] text-red-500 hover:text-red-300 font-bold uppercase transition-colors">Delete</button>
                  </div>
                  <div className="grid grid-cols-1 gap-2">
                    <div>
                      <label className={labelCls}>Command(s)</label>
                      <textarea rows={2} value={Array.isArray(envData.commands) ? envData.commands.map(c => typeof c === 'string' ? c : c.command).join('\n') : envData.command || ''}
                        onChange={e => { const lines = e.target.value.split('\n').filter(l => l.trim()); lines.length > 1 ? handleUpdateEnv(envName, { commands: lines }) : handleUpdateEnv(envName, { command: e.target.value }); }}
                        className={`${inputCls} font-mono`} placeholder="e.g. bash scripts/deploy.sh prod" />
                    </div>
                    <div>
                      <label className={labelCls}>Description (optional)</label>
                      <input type="text" value={envData.description || ''} onChange={e => handleUpdateEnv(envName, { description: e.target.value })} className={inputCls} placeholder="e.g. Production AWS stack" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Add form */}
          <form onSubmit={handleAddEnvironment} className="pt-3 border-t border-gray-800/60 space-y-3">
            <h4 className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">Add Environment</h4>
            <div className="grid grid-cols-3 gap-3">
              <div><label className={labelCls}>Name</label><input type="text" value={newEnvName} onChange={e => setNewEnvName(e.target.value)} placeholder="e.g. staging" className={inputCls} /></div>
              <div><label className={labelCls}>Command</label><input type="text" value={newEnvCommand} onChange={e => setNewEnvCommand(e.target.value)} placeholder="e.g. bash deploy.sh staging" className={inputCls} /></div>
              <div><label className={labelCls}>Description</label><input type="text" value={newEnvDescription} onChange={e => setNewEnvDescription(e.target.value)} placeholder="e.g. Staging server" className={inputCls} /></div>
            </div>
            <div className="flex justify-end">
              <button type="submit" disabled={!newEnvName.trim() || !newEnvCommand.trim()}
                className="px-3 py-1.5 bg-blue-700 hover:bg-blue-600 disabled:opacity-50 text-white text-xs font-bold rounded-lg transition-colors">
                + Add Environment
              </button>
            </div>
          </form>

          {/* Save */}
          <div className="flex items-center justify-between pt-2 border-t border-gray-800/60">
            {notification && (
              <span className={`text-xs font-medium ${notification.type === 'success' ? 'text-green-400' : 'text-red-400'}`}>{notification.message}</span>
            )}
            <button onClick={save} disabled={saving} className="ml-auto px-4 py-1.5 bg-blue-700 hover:bg-blue-600 disabled:opacity-50 text-white text-xs font-bold rounded-lg transition-colors">
              {saving ? 'Saving…' : 'Save Config'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Deploy Script Builder ────────────────────────────────────────────────────

const PROVIDERS = [
  { id: 'gcp',    label: 'Google Cloud (GCP)', icon: '☁️',  color: 'blue'   },
  { id: 'aws',    label: 'AWS',                icon: '🟠',  color: 'orange' },
  { id: 'vercel', label: 'Vercel',             icon: '▲',   color: 'gray'   },
  { id: 'fly',    label: 'Fly.io',             icon: '🪁',  color: 'purple' },
  { id: 'custom', label: 'Custom / Other',     icon: '🔧',  color: 'gray'   },
];

const DB_OPTIONS = {
  gcp:    ['None', 'Cloud SQL (Postgres)', 'Cloud SQL (MySQL)', 'Firestore', 'AlloyDB'],
  aws:    ['None', 'RDS (Postgres)', 'RDS (MySQL)', 'DynamoDB', 'Aurora Serverless'],
  vercel: ['None', 'Supabase', 'PlanetScale', 'Neon', 'Vercel Postgres'],
  fly:    ['None', 'Fly Postgres', 'Supabase', 'External Postgres'],
  custom: ['None', 'Postgres', 'MySQL', 'MongoDB', 'Other'],
};

const SECRETS_OPTIONS = {
  gcp:    ['GCP Secret Manager', 'Application Default Credentials (ADC)', '.env file (CI injected)'],
  aws:    ['AWS Secrets Manager', 'AWS SSM Parameter Store', '.env file (CI injected)'],
  vercel: ['Vercel Environment Variables', '.env file (CI injected)'],
  fly:    ['Fly Secrets', '.env file (CI injected)'],
  custom: ['.env file (CI injected)', 'Vault', 'Dotenv'],
};

function generateDeployScript({ provider, db, secrets, envs, projectName }) {
  const lines = ['#!/usr/bin/env bash', 'set -euo pipefail', ''];
  lines.push(`# deploy.sh — generated by LaneConductor CI/CD Builder`);
  lines.push(`# Project: ${projectName || 'my-project'}`);
  lines.push(`# Provider: ${provider}  |  DB: ${db}  |  Secrets: ${secrets}`);
  lines.push('');
  lines.push('ENV="${1:-production}"');
  lines.push('');

  // Provider auth
  if (provider === 'gcp') {
    lines.push('# ── GCP Auth ──────────────────────────────────────────────────');
    lines.push('if [ -n "${GOOGLE_APPLICATION_CREDENTIALS:-}" ]; then');
    lines.push('  gcloud auth activate-service-account --key-file="$GOOGLE_APPLICATION_CREDENTIALS"');
    lines.push('fi');
    lines.push('gcloud config set project "${GCP_PROJECT:?GCP_PROJECT is required}"');
  } else if (provider === 'aws') {
    lines.push('# ── AWS Auth ──────────────────────────────────────────────────');
    lines.push('export AWS_DEFAULT_REGION="${AWS_REGION:-us-east-1}"');
    lines.push('aws sts get-caller-identity > /dev/null   # verify credentials');
  } else if (provider === 'vercel') {
    lines.push('# ── Vercel Auth ───────────────────────────────────────────────');
    lines.push('export VERCEL_TOKEN="${VERCEL_TOKEN:?VERCEL_TOKEN is required}"');
  } else if (provider === 'fly') {
    lines.push('# ── Fly Auth ──────────────────────────────────────────────────');
    lines.push('export FLY_API_TOKEN="${FLY_API_TOKEN:?FLY_API_TOKEN is required}"');
  }
  lines.push('');

  // DB migration hint
  if (db && db !== 'None') {
    lines.push('# ── Database Migrations ───────────────────────────────────────');
    if (db.includes('Postgres') || db.includes('SQL') || db.includes('AlloyDB') || db.includes('Aurora') || db.includes('Neon') || db.includes('Planet') || db.includes('Supabase')) {
      lines.push('echo "Running DB migrations for $ENV..."');
      lines.push('# npx prisma migrate deploy   # or: npm run db:migrate');
    } else {
      lines.push('# Add migration command here for: ' + db);
    }
    lines.push('');
  }

  // Secrets
  if (secrets.includes('Secret Manager') || secrets.includes('SSM') || secrets.includes('Vault')) {
    lines.push('# ── Secrets ───────────────────────────────────────────────────');
    lines.push('# Secrets are fetched at runtime via ' + secrets);
    lines.push('# Ensure service account has read access');
    lines.push('');
  }

  // Per-env deploy
  lines.push('# ── Deploy ────────────────────────────────────────────────────');
  lines.push('echo "Deploying to $ENV..."');
  lines.push('');
  if (provider === 'gcp') {
    lines.push('case "$ENV" in');
    for (const env of envs) {
      lines.push(`  ${env})`);
      lines.push(`    gcloud run deploy ${projectName || 'app'}-${env} \\`);
      lines.push(`      --region "\${GCP_REGION:-us-central1}" \\`);
      lines.push(`      --source . --allow-unauthenticated`);
      lines.push(`    ;;`);
    }
    lines.push('  *) echo "Unknown environment: $ENV"; exit 1 ;;');
    lines.push('esac');
  } else if (provider === 'aws') {
    lines.push('case "$ENV" in');
    for (const env of envs) {
      lines.push(`  ${env})`);
      lines.push(`    # Replace with your ECS/Lambda/Elastic Beanstalk deploy command`);
      lines.push(`    aws ecs update-service --cluster ${env} --service ${projectName || 'app'} --force-new-deployment`);
      lines.push(`    ;;`);
    }
    lines.push('  *) echo "Unknown environment: $ENV"; exit 1 ;;');
    lines.push('esac');
  } else if (provider === 'vercel') {
    lines.push('if [ "$ENV" = "production" ]; then');
    lines.push('  vercel --prod --token "$VERCEL_TOKEN"');
    lines.push('else');
    lines.push('  vercel --token "$VERCEL_TOKEN"');
    lines.push('fi');
  } else if (provider === 'fly') {
    lines.push(`flyctl deploy --remote-only --app ${projectName || 'app'}-"$ENV"');`);
  } else {
    lines.push('# Custom deploy command — edit this section:');
    for (const env of envs) {
      lines.push(`# ENV=${env}: `);
    }
    lines.push('echo "Deploy complete: $ENV"');
  }

  lines.push('');
  lines.push('echo "✅ Deploy complete: $ENV"');
  return lines.join('\n');
}

function DeployScriptBuilder({ projectId, onSaved }) {
  const { apiFetch } = useApi();
  const [step, setStep] = useState(0); // 0=provider, 1=db, 2=secrets, 3=envs, 4=preview
  const [provider, setProvider] = useState('');
  const [db, setDb] = useState('None');
  const [secrets, setSecrets] = useState('');
  const [envs, setEnvs] = useState(['production', 'staging']);
  const [newEnv, setNewEnv] = useState('');
  const [projectName, setProjectName] = useState('');
  const [script, setScript] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Load project name
  useEffect(() => {
    if (!projectId) return;
    apiFetch(`/api/projects/${projectId}/config`)
      .then(r => r.ok ? r.json() : {})
      .then(d => { if (d?.name) setProjectName(d.name); })
      .catch(() => {});
  }, [projectId]);

  function reset() { setStep(0); setProvider(''); setDb('None'); setSecrets(''); setEnvs(['production', 'staging']); setScript(''); setSaved(false); }

  function advance() {
    if (step === 3) {
      setScript(generateDeployScript({ provider, db, secrets, envs, projectName }));
      setStep(4);
    } else {
      setStep(s => s + 1);
    }
  }

  async function saveToProject() {
    setSaving(true);
    try {
      // Save the deploy.sh content via API
      await apiFetch(`/api/projects/${projectId}/deploy-script`, {
        method: 'POST',
        body: JSON.stringify({ script, provider, db, secrets, environments: envs }),
      });
      // Build the new config and persist it
      const envMap = {};
      for (const e of envs) envMap[e] = { command: `bash scripts/deploy.sh ${e}`, description: `${provider} ${e} deployment` };
      const newConfig = { environments: envMap, defaultEnvironment: envs[0] || 'production' };
      await apiFetch(`/api/projects/${projectId}/deploy-config`, {
        method: 'POST',
        body: JSON.stringify(newConfig),
      });
      setSaved(true);
      // Notify parent so Config tab reflects the new environments
      onSaved?.(newConfig);
    } catch (err) {
      alert('Save failed: ' + err.message);
    }
    setSaving(false);
  }

  function downloadScript() {
    const blob = new Blob([script], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'deploy.sh'; a.click();
    URL.revokeObjectURL(url);
  }

  const canAdvance = step === 0 ? !!provider : step === 1 ? true : step === 2 ? !!secrets : step === 3 ? envs.length > 0 : false;
  const dbOpts = DB_OPTIONS[provider] || [];
  const secretsOpts = SECRETS_OPTIONS[provider] || [];
  const btnBase = 'px-3 py-1.5 text-xs font-bold rounded-lg transition-colors';
  const stepLabels = ['☁️ Provider', '🗄 Database', '🔐 Secrets', '🌐 Environments', '📄 Preview'];

  return (
    <div className="bg-gray-950 border border-gray-800 rounded-xl shadow-lg overflow-hidden">
      {/* Step indicator */}
      <div className="flex items-center gap-1 px-5 pt-4 pb-3 border-b border-gray-800/60 overflow-x-auto">
        {stepLabels.map((label, i) => (
          <div key={i} className="flex items-center gap-1 flex-shrink-0">
            <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold transition-all
              ${i === step ? 'bg-blue-600 text-white' : i < step ? 'bg-green-900/50 text-green-400 border border-green-800/50' : 'bg-gray-900 text-gray-600 border border-gray-800'}`}>
              {i < step ? '✓' : i + 1} {label}
            </div>
            {i < stepLabels.length - 1 && <span className="text-gray-700 text-xs">›</span>}
          </div>
        ))}
      </div>
      <div className="px-5 py-5 space-y-4">
            {/* Step 0: Provider */}
            {step === 0 && (
              <div className="space-y-3">
                <p className="text-xs text-gray-400">Select your cloud deployment target:</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {PROVIDERS.map(p => (
                    <button key={p.id} onClick={() => { setProvider(p.id); setDb('None'); setSecrets(SECRETS_OPTIONS[p.id]?.[0] || ''); }}
                      className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border text-xs font-semibold transition-all text-left
                        ${provider === p.id ? 'bg-blue-900/50 border-blue-600 text-blue-200 shadow-lg shadow-blue-950/40' : 'bg-gray-900 border-gray-700 text-gray-300 hover:border-gray-600 hover:text-white'}`}>
                      <span className="text-base">{p.icon}</span>
                      <span>{p.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Step 1: Database */}
            {step === 1 && (
              <div className="space-y-3">
                <p className="text-xs text-gray-400">Select your database (or None):</p>
                <div className="grid grid-cols-2 gap-2">
                  {dbOpts.map(opt => (
                    <button key={opt} onClick={() => setDb(opt)}
                      className={`px-3 py-2.5 rounded-lg border text-xs font-semibold transition-all text-left
                        ${db === opt ? 'bg-blue-900/50 border-blue-600 text-blue-200' : 'bg-gray-900 border-gray-700 text-gray-300 hover:border-gray-600 hover:text-white'}`}>
                      {opt === 'None' ? '🚫 ' : '🗄 '}{opt}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Step 2: Secrets */}
            {step === 2 && (
              <div className="space-y-3">
                <p className="text-xs text-gray-400">How are secrets managed?</p>
                <div className="grid grid-cols-1 gap-2">
                  {secretsOpts.map(opt => (
                    <button key={opt} onClick={() => setSecrets(opt)}
                      className={`px-3 py-2.5 rounded-lg border text-xs font-semibold transition-all text-left
                        ${secrets === opt ? 'bg-blue-900/50 border-blue-600 text-blue-200' : 'bg-gray-900 border-gray-700 text-gray-300 hover:border-gray-600 hover:text-white'}`}>
                      🔐 {opt}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Step 3: Environments */}
            {step === 3 && (
              <div className="space-y-3">
                <p className="text-xs text-gray-400">Define deployment environments (order = priority):</p>
                <div className="flex flex-wrap gap-2">
                  {envs.map((e, i) => (
                    <div key={e} className="flex items-center gap-1.5 bg-gray-900 border border-gray-700 rounded-lg px-2.5 py-1.5">
                      <span className="text-xs font-mono text-blue-300">{e}</span>
                      {i === 0 && <span className="text-[9px] bg-amber-900/40 border border-amber-800/50 text-amber-400 px-1 rounded uppercase">default</span>}
                      <button onClick={() => setEnvs(envs.filter((_, j) => j !== i))} className="text-gray-600 hover:text-red-400 text-xs leading-none ml-1">✕</button>
                    </div>
                  ))}
                </div>
                <form onSubmit={e => { e.preventDefault(); const v = newEnv.trim().toLowerCase().replace(/\s+/g, '-'); if (v && !envs.includes(v)) { setEnvs([...envs, v]); setNewEnv(''); } }}>
                  <div className="flex gap-2">
                    <input value={newEnv} onChange={e => setNewEnv(e.target.value)} placeholder="e.g. qa, preview, canary"
                      className="flex-1 bg-gray-900 border border-gray-700 text-xs text-white p-1.5 rounded focus:outline-none focus:border-blue-600" />
                    <button type="submit" disabled={!newEnv.trim()} className="px-3 py-1.5 bg-blue-700 hover:bg-blue-600 disabled:opacity-40 text-white text-xs font-bold rounded-lg transition-colors">
                      + Add
                    </button>
                  </div>
                </form>
              </div>
            )}

            {/* Step 4: Preview */}
            {step === 4 && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="text-[10px] bg-gray-900 border border-gray-700 px-2 py-1 rounded font-mono text-gray-300">☁️ {PROVIDERS.find(p => p.id === provider)?.label}</span>
                    {db !== 'None' && <span className="text-[10px] bg-gray-900 border border-gray-700 px-2 py-1 rounded font-mono text-gray-300">🗄 {db}</span>}
                    <span className="text-[10px] bg-gray-900 border border-gray-700 px-2 py-1 rounded font-mono text-gray-300">🔐 {secrets}</span>
                    <span className="text-[10px] bg-gray-900 border border-gray-700 px-2 py-1 rounded font-mono text-gray-300">🌐 {envs.join(', ')}</span>
                  </div>
                  <button onClick={reset} className="text-[10px] text-gray-500 hover:text-gray-300 transition-colors">↩ Start over</button>
                </div>

                <div className="relative">
                  <div className="absolute top-2 right-2 flex gap-1.5 z-10">
                    <button onClick={downloadScript} className="text-[10px] px-2 py-1 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded text-gray-300 transition-colors">
                      ⬇ Download
                    </button>
                    <button onClick={() => navigator.clipboard?.writeText(script)} className="text-[10px] px-2 py-1 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded text-gray-300 transition-colors">
                      📋 Copy
                    </button>
                  </div>
                  <pre className="bg-gray-900 border border-gray-800 rounded-lg p-4 text-[11px] text-green-300 font-mono overflow-x-auto overflow-y-auto max-h-80 leading-relaxed whitespace-pre">
                    {script}
                  </pre>
                </div>

                <div className="flex items-center gap-3 pt-1">
                  {saved ? (
                    <span className="text-xs text-green-400 font-semibold">✓ Saved — switching to Config tab…</span>
                  ) : (
                    <button onClick={saveToProject} disabled={saving}
                      className="px-4 py-1.5 bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white text-xs font-bold rounded-lg transition-colors flex items-center gap-1.5">
                      {saving ? '⏳ Saving…' : '💾 Save to Project'}
                    </button>
                  )}
                  <button onClick={downloadScript} className={`${btnBase} bg-gray-900 border border-gray-700 text-gray-300 hover:text-white hover:border-gray-600`}>
                    ⬇ Download deploy.sh
                  </button>
                </div>
              </div>
            )}

            {/* Step nav */}
            {step < 4 && (
              <div className="flex items-center justify-between pt-3 border-t border-gray-800/60">
                <button onClick={() => step > 0 ? setStep(s => s - 1) : reset()}
                  className={`${btnBase} bg-gray-900 border border-gray-700 text-gray-300 hover:text-white hover:border-gray-600`}>
                  {step === 0 ? 'Reset' : '← Back'}
                </button>
                <button onClick={advance} disabled={!canAdvance}
                  className={`${btnBase} bg-blue-700 hover:bg-blue-600 disabled:opacity-40 text-white`}>
                  {step === 3 ? '⚡ Generate Script' : 'Next →'}
                </button>
              </div>
            )}
          </div>
    </div>
  );
}

// ─── Main CI/CD View ──────────────────────────────────────────────────────────

const CICD_TABS = [
  { id: 'setup',   label: '🛠 Setup',   desc: 'Build your deploy.sh' },
  { id: 'config',  label: '⚙️ Config',  desc: 'Manage environments' },
  { id: 'release', label: '🚀 Release', desc: 'Dispatch & history' },
];

export function CICDView({ projectId, workers = [] }) {
  const { apiFetch } = useApi();
  const [hasStack, setHasStack] = useState(null);
  const [activeTab, setActiveTab] = useState(null);
  const [stackRefreshKey, setStackRefreshKey] = useState(0);
  const [deployConfig, setDeployConfig] = useState({ environments: {} });

  useEffect(() => {
    if (!projectId) return;
    Promise.all([
      apiFetch(`/api/projects/${projectId}/deploy-config`).then(r => r.ok ? r.json() : null),
      apiFetch(`/api/projects/${projectId}/conductor`).then(r => r.ok ? r.json() : {}),
    ]).then(([cfg, conductor]) => {
      if (cfg?.environments) setDeployConfig(cfg);
      const stack = !!conductor?.deployment_stack;
      setHasStack(stack);
      setActiveTab(stack ? 'release' : 'setup');
    }).catch(() => { setHasStack(false); setActiveTab('setup'); });
  }, [projectId]);

  if (!projectId) return (
    <div className="flex items-center justify-center h-64 text-gray-600 text-sm">Select a project to view CI/CD.</div>
  );

  if (activeTab === null) return (
    <div className="flex items-center justify-center h-64 text-gray-600 text-sm">Loading…</div>
  );

  const hasEnvs = Object.keys(deployConfig?.environments || {}).length > 0;

  return (
    <div className="flex flex-col gap-0 max-w-4xl mx-auto">
      {/* Tab bar */}
      <div className="flex items-end gap-0 border-b border-gray-800 mb-6">
        {CICD_TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex flex-col items-start px-5 py-3 text-xs font-semibold border-b-2 transition-all
              ${activeTab === tab.id
                ? 'border-blue-500 text-white bg-gray-900/60'
                : 'border-transparent text-gray-500 hover:text-gray-300 hover:border-gray-700'}`}
          >
            <span>{tab.label}</span>
            <span className={`text-[10px] font-normal mt-0.5 ${activeTab === tab.id ? 'text-gray-400' : 'text-gray-600'}`}>{tab.desc}</span>
          </button>
        ))}
        {/* Env count badge always visible */}
        {hasEnvs && (
          <span className="ml-auto self-center mr-2 text-[10px] px-2 py-0.5 rounded bg-gray-800 border border-gray-700 text-gray-400 font-mono">
            {Object.keys(deployConfig.environments).length} env{Object.keys(deployConfig.environments).length !== 1 ? 's' : ''} configured
          </span>
        )}
      </div>

      {/* Tab: Setup — wizard generates deploy.sh and populates config */}
      {activeTab === 'setup' && (
        <DeployScriptBuilder
          projectId={projectId}
          onSaved={(newConfig) => {
            setDeployConfig(newConfig);
            setStackRefreshKey(k => k + 1); // force DeployStackCard to re-fetch
            setActiveTab('config');
          }}
        />
      )}

      {/* Tab: Config — stack summary + environment editor */}
      {activeTab === 'config' && (
        <div className="flex flex-col gap-5">
          <DeployStackCard projectId={projectId} refreshKey={stackRefreshKey} />
          <DeployConfigSection
            projectId={projectId}
            deployConfig={deployConfig}
            onChange={setDeployConfig}
          />
        </div>
      )}

      {/* Tab: Release — dispatch using configured envs + view history */}
      {activeTab === 'release' && (
        <div className="flex flex-col gap-6">
          {!hasEnvs && (
            <div className="flex items-center gap-3 bg-amber-950/20 border border-amber-800/40 rounded-xl px-4 py-3 text-xs text-amber-300">
              <span>⚠️</span>
              <span>No environments configured. Go to <button onClick={() => setActiveTab('setup')} className="underline font-semibold hover:text-amber-200">Setup</button> to generate a deploy script, or <button onClick={() => setActiveTab('config')} className="underline font-semibold hover:text-amber-200">Config</button> to add environments manually.</span>
            </div>
          )}
          <DeployPanel projectId={projectId} workers={workers} />
          <div className="flex flex-col gap-3">
            <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500 px-0.5">Deployment Dispatch History</span>
            <DispatchHistory projectId={projectId} />
          </div>
        </div>
      )}
    </div>
  );
}

