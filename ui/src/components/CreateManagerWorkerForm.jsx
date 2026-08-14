import { useState, useEffect } from 'react';
import { useApi } from '../hooks/useApi.js';

function guessProjectsDir(projects) {
  const withPath = (projects || []).find(p => p.repo_path);
  if (!withPath) return '';
  const p = withPath.repo_path.replace(/\/+$/, '');
  const idx = p.lastIndexOf('/');
  return idx > 0 ? p.slice(0, idx) : '';
}

// Track 1091 Phase 5b: both ProvisionWorkerModal and NewProjectModal used to
// dead-end into "go run `lc worker start --manager --projects-dir <path>`
// yourself" whenever no manager was online — the New Project flow and the
// provision-on-another-machine flow both need one, but nothing could
// actually start it from the UI. Mirrors the existing "Start Sync Worker"
// button (POST /api/projects/:id/worker/start → `lc start`), just for the
// machine-level manager singleton.
//
// Only rendered outside cloud mode by the callers — this shells out on
// whatever machine the API server itself runs on (see IS_LOCAL_HOST's
// reasoning in WorkersList.jsx), which is the user's own machine in a
// self-hosted local-fs/local-api setup, but would be LaneConductor's own
// hosted server in the CloudApp build.
export function CreateManagerWorkerForm({ onCreated }) {
  const { apiFetch } = useApi();
  const [projectsDir, setProjectsDir] = useState('');
  const [touched, setTouched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null); // { ok: true } | { ok: false, error }

  useEffect(() => {
    apiFetch('/api/projects')
      .then(res => (res.ok ? res.json() : []))
      .then(data => {
        if (!touched) setProjectsDir(guessProjectsDir(data));
      })
      .catch(() => {});
    // Only want this to run once on mount — `touched` is read, not watched,
    // so a user's own edit is never clobbered by a slow-arriving default.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleCreate() {
    setLoading(true);
    setResult(null);
    try {
      const res = await apiFetch('/api/workers/manager/start', {
        method: 'POST',
        body: JSON.stringify({ projectsDir: projectsDir.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to start manager worker');
      setResult({ ok: true });
      onCreated?.();
    } catch (err) {
      setResult({ ok: false, error: err.message });
    }
    setLoading(false);
  }

  return (
    <div className="space-y-2 border border-purple-900/40 bg-purple-950/10 rounded-lg p-3">
      <p className="text-xs text-gray-300">Start a manager on <span className="font-semibold">this machine</span> (where the LaneConductor API is running):</p>
      <label className="block text-[10px] text-gray-500">
        Projects directory <span className="text-gray-600">— where the manager looks for/clones projects</span>
      </label>
      <input
        type="text"
        value={projectsDir}
        onChange={e => { setTouched(true); setProjectsDir(e.target.value); }}
        placeholder="/home/you/Code"
        className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-purple-600 font-mono"
        data-testid="manager-projects-dir-input"
      />
      {result?.ok === false && <p className="text-xs text-red-400">{result.error}</p>}
      {result?.ok === true && <p className="text-xs text-green-400">Manager worker starting — it should appear here in a few seconds.</p>}
      <button
        type="button"
        onClick={handleCreate}
        disabled={loading}
        className="px-3 py-1.5 text-xs rounded bg-purple-700 hover:bg-purple-600 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium transition-colors"
        data-testid="create-manager-worker-btn"
      >
        {loading ? 'Starting…' : '👑 Create Manager Worker'}
      </button>
    </div>
  );
}
