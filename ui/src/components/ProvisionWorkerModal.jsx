import { useState, useEffect } from 'react';
import { useApi } from '../hooks/useApi.js';
import { MODEL_PRESETS, CLI_ENGINES } from './WorkerModelModal.jsx';
import { CreateManagerWorkerForm } from './CreateManagerWorkerForm.jsx';

const CLOUD_MODE = process.env.VITE_CLOUD_MODE === 'true';

// Track 1089 Phase 6 (redesigned 2026-08-12): start another worker for a
// project, on whichever machine should run it.
//
// No SSH. The dispatch inbox is outbound-polling, so any machine that
// should run workers already has a manager polling from it — and that
// manager can start the worker locally. "Provision on machine X" is
// therefore just "dispatch to X's manager", which needs no inbound network
// path, no credentials, and works through NAT/firewalls. Since a manager
// is a machine-level singleton, picking the manager *is* picking the
// machine — so this form is only two real choices: which machine, which
// project. The manager resolves the project folder itself from its own
// --projects-dir.
export function ProvisionWorkerModal({ projectId, workers = [], onClose, onProvisioned }) {
  const { apiFetch } = useApi();
  const [projects, setProjects] = useState([]);
  const [allWorkers, setAllWorkers] = useState(workers);
  const [selectedProjectId, setSelectedProjectId] = useState(projectId?.toString() || '');
  const [selectedManagerId, setSelectedManagerId] = useState('');
  const [selectedCli, setSelectedCli] = useState('claude');
  // First preset per CLI is the current recommended model — don't hardcode
  // a specific id here, or this silently rots to an old model every time
  // the presets are updated (it was pinned to claude-sonnet-4-5 while the
  // list already led with Sonnet 5).
  const [selectedModel, setSelectedModel] = useState(MODEL_PRESETS.claude[0].id);
  // Default to auto (sync+poll): per-track **Auto Run** (default no) already
  // gates which tracks a worker may pick up unattended, so worker-level mode
  // no longer needs to default to the conservative sync-only — that gate is
  // redundant for "don't run stray tracks" now. Kept as an override for the
  // coarser "pause everything on this worker" case (maintenance/debugging).
  const [selectedMode, setSelectedMode] = useState('sync+poll');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [dispatchResult, setDispatchResult] = useState(null);

  // A manager is a machine-level singleton, so this list is effectively
  // "which of my machines" — one entry per machine that has one running.
  const availableManagers = allWorkers.filter(w => w.status !== 'offline' && w.type === 'manager');
  const selectedProject = projects.find(p => String(p.id) === String(selectedProjectId));

  useEffect(() => {
    loadProjects();
    loadWorkers();
  }, []);

  useEffect(() => {
    if (availableManagers.length > 0 && !selectedManagerId) {
      setSelectedManagerId(String(availableManagers[0].id));
    }
  }, [availableManagers, selectedManagerId]);

  // Worker-reported models when available (track 1099), else static presets.
  const selectedManager = availableManagers.find(w => String(w.id) === String(selectedManagerId));
  const reportedModels = selectedManager?.available_models?.[selectedCli];
  const modelOptions = (reportedModels?.length ? reportedModels : MODEL_PRESETS[selectedCli]) || [];
  const modelsAreLive = !!reportedModels?.length;

  useEffect(() => {
    if (modelOptions.length && !modelOptions.some(m => m.id === selectedModel)) {
      setSelectedModel(modelOptions[0].id);
    }
  }, [selectedCli, modelOptions, selectedModel]);

  async function loadProjects() {
    try {
      const res = await apiFetch('/api/projects');
      if (res.ok) {
        const data = await res.json();
        setProjects(data);
        if (!selectedProjectId && data.length > 0) setSelectedProjectId(data[0].id.toString());
      }
    } catch (err) {
      console.error('Failed to fetch projects:', err);
    }
  }

  async function loadWorkers() {
    try {
      const res = await apiFetch('/api/workers');
      if (res.ok) setAllWorkers(await res.json());
    } catch (err) {
      console.error('Failed to fetch workers:', err);
    }
  }

  async function handleProvision(e) {
    e.preventDefault();
    setError(null);
    setDispatchResult(null);

    if (!selectedProjectId) return setError('Select a project');
    if (!selectedManagerId) return setError('Select a machine (manager worker)');

    setLoading(true);
    try {
      const res = await apiFetch('/api/dispatch/provision-worker', {
        method: 'POST',
        body: JSON.stringify({
          worker_id: Number(selectedManagerId),
          payload: {
            project_name: selectedProject?.name,
            project_id: Number(selectedProjectId),
            // The authoritative path the manager tries first — it only
            // falls back to guessing under its own projects dir if this
            // path doesn't exist on its machine.
            repo_path: selectedProject?.repo_path,
            cli: selectedCli,
            model: selectedModel,
            mode: selectedMode,
          },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to start worker');

      setDispatchResult({ id: data.id, status: 'pending', result: null });
      pollDispatch(data.id);
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  }

  function pollDispatch(dispatchId) {
    let attempts = 0;
    const interval = setInterval(async () => {
      attempts++;
      try {
        const res = await apiFetch(`/api/dispatch/${dispatchId}`);
        if (res.ok) {
          const d = await res.json();
          if (d && d.status !== 'pending' && d.status !== 'claimed') {
            clearInterval(interval);
            setDispatchResult(d);
            setLoading(false);
            onProvisioned?.();
            return;
          }
        }
      } catch { /* transient — retry next tick */ }

      if (attempts >= 15) {
        clearInterval(interval);
        setDispatchResult({ id: dispatchId, status: 'pending', result: 'Still pending — the manager will pick this up on its next heartbeat.' });
        setLoading(false);
        onProvisioned?.();
      }
    }, 1000);
  }

  const statusColor = dispatchResult?.status === 'done'
    ? 'text-green-300 border-green-900/60 bg-green-950/30'
    : dispatchResult?.status === 'failed'
      ? 'text-red-300 border-red-900/60 bg-red-950/30'
      : 'text-blue-300 border-blue-900/60 bg-blue-950/30';

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-start justify-center pt-24 px-4" onClick={onClose}>
      <div className="bg-gray-950 border border-gray-800 rounded-xl w-full max-w-lg shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <div>
            <h2 className="text-white font-semibold text-sm">New Worker</h2>
            <p className="text-[11px] text-gray-500 mt-0.5">Start another worker for a project</p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-200 text-xl leading-none">✕</button>
        </div>

        {availableManagers.length === 0 ? (
          <div className="px-5 py-4 space-y-3">
            <p className="text-sm text-gray-300">
              No manager worker is online. Workers are started by the manager on
              the machine that should run them.
            </p>
            {!CLOUD_MODE && <CreateManagerWorkerForm onCreated={loadWorkers} />}
            <p className="text-xs text-gray-600 pt-1">
              To start one on a <span className="font-semibold">different</span> machine, run this there yourself (no SSH — a manager only ever manages its own machine):
            </p>
            <pre className="text-xs text-gray-300 bg-gray-900 border border-gray-800 rounded-lg p-3 whitespace-pre-wrap">lc worker start --manager --projects-dir &lt;path&gt;</pre>
            <div className="flex justify-end pt-1">
              <button onClick={onClose} className="px-3 py-1.5 text-xs rounded border border-gray-700 text-gray-400 hover:text-gray-200 transition-colors">Close</button>
            </div>
          </div>
        ) : dispatchResult ? (
          <div className="px-5 py-4 space-y-3">
            <p className="text-xs text-gray-400">
              Status: <span className="text-gray-200 font-mono">{dispatchResult.status}</span>
            </p>
            {dispatchResult.result && (
              <pre className={`text-[11px] font-mono whitespace-pre-wrap leading-relaxed border rounded-lg p-3 ${statusColor}`}>
                {dispatchResult.result}
              </pre>
            )}
            <div className="flex justify-end pt-1">
              <button onClick={onClose} className="px-3 py-1.5 text-xs rounded bg-blue-700 hover:bg-blue-600 text-white font-medium transition-colors">Close</button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleProvision} className="px-5 py-4 space-y-4">
            {error && <p className="text-xs text-red-400 bg-red-950/40 border border-red-900/50 rounded-lg px-3 py-2">{error}</p>}

            <div>
              <label className="block text-xs text-gray-500 mb-1">Project</label>
              <select
                value={selectedProjectId}
                onChange={e => setSelectedProjectId(e.target.value)}
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-gray-500"
                data-testid="provision-project-select"
              >
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-xs text-gray-500 mb-1">Machine</label>
              <select
                value={selectedManagerId}
                onChange={e => setSelectedManagerId(e.target.value)}
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-gray-500"
                data-testid="provision-manager-select"
              >
                {availableManagers.map(w => <option key={w.id} value={w.id}>👑 {w.hostname}</option>)}
              </select>
              <p className="text-[10px] text-gray-600 mt-1">
                The manager on this machine starts the worker locally, in its own projects directory.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">CLI</label>
                <select
                  value={selectedCli}
                  onChange={e => setSelectedCli(e.target.value)}
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-gray-500"
                >
                  {CLI_ENGINES.map(c => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
                </select>
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs text-gray-500">Model</label>
                  {modelsAreLive && <span className="text-[9px] text-green-400">✓ live</span>}
                </div>
                <select
                  value={selectedModel}
                  onChange={e => setSelectedModel(e.target.value)}
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-gray-500"
                >
                  {modelOptions.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs text-gray-500 mb-1">Worker mode</label>
              <select
                value={selectedMode}
                onChange={e => setSelectedMode(e.target.value)}
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-gray-500"
                data-testid="provision-mode-select"
              >
                <option value="sync+poll">Auto — picks up Auto Run tracks from the queue</option>
                <option value="sync-only">Manual — file/DB sync only, never runs a track unasked</option>
              </select>
              <p className="text-[10px] text-gray-600 mt-1">
                Auto still only touches tracks with <span className="font-mono">Auto Run: yes</span> — this just controls whether the worker polls for them at all.
              </p>
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={onClose} className="px-3 py-1.5 text-xs rounded border border-gray-700 text-gray-400 hover:text-gray-200 transition-colors">Cancel</button>
              <button
                type="submit"
                disabled={loading || !selectedProjectId || !selectedManagerId}
                className="px-3 py-1.5 text-xs rounded bg-blue-700 hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium transition-colors"
              >
                {loading ? 'Starting…' : 'Start Worker'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
