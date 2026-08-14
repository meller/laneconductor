import React, { useState, useEffect, useRef } from 'react';
import { useApi } from '../hooks/useApi';
import { CreateManagerWorkerForm } from './CreateManagerWorkerForm.jsx';

const CLOUD_MODE = process.env.VITE_CLOUD_MODE === 'true';

// Track 1091 Phase 4. Form-style (spec.md REQ-5, resolved 2026-08-10):
// dispatch is fire-and-poll, not turn-by-turn, so a conversational flow
// mirroring the CLI's interactive brainstorm would need new plumbing a
// form doesn't. Collects the same answers upfront into one
// scaffold_context blob, matching conductor/.setup-scaffold-context.json's
// shape, and dispatches once on submit.

function buildScaffoldContext({ name, hasExistingCode, purpose, techStack, kpis }) {
  const parts = [`Project purpose: ${purpose.trim()}`];
  if (techStack.trim()) parts.push(`Tech stack: ${techStack.trim()}`);
  if (kpis.trim()) parts.push(`Success metrics / KPIs: ${kpis.trim()}`);
  return {
    project: { name: name.trim(), has_existing_code: hasExistingCode },
    brainstorm_summary: parts.join('\n'),
  };
}

export function NewProjectModal({ managerWorkers, knownHostnames = [], onClose, onCreated }) {
  const { apiFetch } = useApi();
  const [name, setName] = useState('');
  const [repoType, setRepoType] = useState('path'); // 'path' | 'git'
  const [repoValue, setRepoValue] = useState('');
  const [hasExistingCode, setHasExistingCode] = useState(true);
  const [purpose, setPurpose] = useState('');
  const [techStack, setTechStack] = useState('');
  const [kpis, setKpis] = useState('');
  const [workerId, setWorkerId] = useState(managerWorkers[0]?.id ?? null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [dispatch, setDispatch] = useState(null); // { id, status, result }

  const nameRef = useRef(null);
  const pollRef = useRef(null);

  useEffect(() => { nameRef.current?.focus(); }, []);

  useEffect(() => {
    const handler = e => { if (e.key === 'Escape' && !dispatch) onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose, dispatch]);

  useEffect(() => {
    // Repo source type defaults has_existing_code sensibly, still overridable.
    setHasExistingCode(repoType === 'path');
  }, [repoType]);

  useEffect(() => {
    if (!dispatch || dispatch.status === 'done' || dispatch.status === 'failed') return;
    pollRef.current = setInterval(async () => {
      try {
        const r = await apiFetch(`/api/dispatch/${dispatch.id}`);
        if (!r.ok) return;
        const data = await r.json();
        setDispatch(data);
        if (data.status === 'done') onCreated?.();
      } catch { /* transient — retry next tick */ }
    }, 2000);
    return () => clearInterval(pollRef.current);
  }, [dispatch, apiFetch, onCreated]);

  const valid = name.trim() && repoValue.trim() && purpose.trim() && workerId;

  async function handleSubmit(e) {
    e.preventDefault();
    if (!valid) return;
    setSubmitting(true);
    setError(null);
    try {
      const payload = {
        repo_source: { type: repoType, value: repoValue.trim() },
        scaffold_context: buildScaffoldContext({ name, hasExistingCode, purpose, techStack, kpis }),
      };
      const r = await apiFetch('/api/dispatch/create-project', {
        method: 'POST',
        body: JSON.stringify({ worker_id: workerId, payload }),
      });
      const data = await r.json();
      if (r.ok) {
        setDispatch({ id: data.id, status: 'pending', result: null });
      } else {
        setError(data.error ?? 'Failed to dispatch create-project');
      }
    } catch (err) {
      setError(err.message);
    }
    setSubmitting(false);
  }

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-start justify-center pt-24 px-4" onClick={dispatch ? undefined : onClose}>
      <div
        className="bg-gray-950 border border-gray-800 rounded-xl w-full max-w-lg shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <h2 className="text-white font-semibold text-sm">New Project</h2>
          {!dispatch && (
            <button onClick={onClose} className="text-gray-500 hover:text-gray-200 text-xl leading-none">✕</button>
          )}
        </div>

        {dispatch ? (
          <div className="px-5 py-4 space-y-3">
            <p className="text-xs text-gray-400">
              Status: <span className="text-gray-200 font-mono">{dispatch.status}</span>
            </p>
            {dispatch.result && (
              <pre className="text-xs text-gray-300 bg-gray-900 border border-gray-800 rounded-lg p-3 whitespace-pre-wrap">
                {dispatch.result}
              </pre>
            )}
            {(dispatch.status === 'pending' || dispatch.status === 'claimed') && (
              <p className="text-xs text-gray-500">Scaffolding project… this can take a minute.</p>
            )}
            <div className="flex justify-end pt-1">
              <button
                onClick={onClose}
                disabled={dispatch.status !== 'done' && dispatch.status !== 'failed'}
                className="px-3 py-1.5 text-xs rounded bg-blue-700 hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        ) : managerWorkers.length === 0 ? (
          <div className="px-5 py-4 space-y-3">
            <p className="text-sm text-gray-300">
              No manager worker is available. A manager is a machine-level
              singleton — start one on whichever of your machines should
              host new projects:
            </p>
            {!CLOUD_MODE && <CreateManagerWorkerForm />}
            {knownHostnames.length > 0 && (
              <div>
                <p className="text-xs text-gray-500 mb-1">
                  {knownHostnames.length === 1
                    ? 'Known machine (no manager registered yet):'
                    : 'Known machines (none have a manager registered yet):'}
                </p>
                <ul className="text-xs text-gray-300 space-y-0.5">
                  {knownHostnames.map(h => <li key={h} className="font-mono">{h}</li>)}
                </ul>
              </div>
            )}
            <p className="text-xs text-gray-600 pt-1">
              To start one on a <span className="font-semibold">different</span> machine, run this there yourself:
            </p>
            <pre className="text-xs text-gray-300 bg-gray-900 border border-gray-800 rounded-lg p-3">lc worker start --manager --projects-dir &lt;path&gt;</pre>
            <div className="flex justify-end pt-1">
              <button onClick={onClose} className="px-3 py-1.5 text-xs rounded border border-gray-700 text-gray-400 hover:text-gray-200 transition-colors">
                Close
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="px-5 py-4 space-y-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Project name <span className="text-gray-600">(required)</span></label>
              <input
                ref={nameRef}
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="e.g. My New App"
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-gray-500"
              />
            </div>

            <div>
              <label className="block text-xs text-gray-500 mb-1">Repo source</label>
              <div className="flex rounded-lg overflow-hidden border border-gray-700 text-xs w-fit mb-2">
                {[{ value: 'path', label: 'Existing local path' }, { value: 'git', label: 'Git URL to clone' }].map(opt => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setRepoType(opt.value)}
                    className={`px-3 py-1 transition-colors ${repoType === opt.value ? 'bg-blue-900 text-blue-300' : 'bg-gray-900 text-gray-500 hover:text-gray-300'}`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <input
                type="text"
                value={repoValue}
                onChange={e => setRepoValue(e.target.value)}
                placeholder={repoType === 'path' ? '/home/you/Code/my-new-app' : 'git@github.com:you/my-new-app.git'}
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-gray-500"
              />
              <label className="flex items-center gap-1.5 mt-1.5 text-xs text-gray-500">
                <input type="checkbox" checked={hasExistingCode} onChange={e => setHasExistingCode(e.target.checked)} />
                This already has code (unchecked = brand new project)
              </label>
            </div>

            <div>
              <label className="block text-xs text-gray-500 mb-1">What does it do? Who's it for? <span className="text-gray-600">(required)</span></label>
              <textarea
                value={purpose}
                onChange={e => setPurpose(e.target.value)}
                rows={2}
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 resize-none focus:outline-none focus:border-gray-500"
              />
            </div>

            <div>
              <label className="block text-xs text-gray-500 mb-1">Tech stack <span className="text-gray-600">(optional)</span></label>
              <input
                type="text"
                value={techStack}
                onChange={e => setTechStack(e.target.value)}
                placeholder="e.g. Next.js, Postgres, Tailwind"
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-gray-500"
              />
            </div>

            <div>
              <label className="block text-xs text-gray-500 mb-1">Success metrics / KPIs <span className="text-gray-600">(optional)</span></label>
              <input
                type="text"
                value={kpis}
                onChange={e => setKpis(e.target.value)}
                placeholder="e.g. 500 signups by Q2"
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-gray-500"
              />
            </div>

            {managerWorkers.length > 1 && (
              <div>
                <label className="block text-xs text-gray-500 mb-1">Manager worker</label>
                <select
                  value={workerId ?? ''}
                  onChange={e => setWorkerId(Number(e.target.value))}
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-gray-500"
                >
                  {managerWorkers.map(w => (
                    <option key={w.id} value={w.id}>{w.hostname}</option>
                  ))}
                </select>
              </div>
            )}

            {error && <p className="text-xs text-red-400">{error}</p>}

            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={onClose} className="px-3 py-1.5 text-xs rounded border border-gray-700 text-gray-400 hover:text-gray-200 transition-colors">
                Cancel
              </button>
              <button
                type="submit"
                disabled={!valid || submitting}
                className="px-3 py-1.5 text-xs rounded bg-blue-700 hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium transition-colors"
              >
                {submitting ? 'Dispatching…' : 'Create Project'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
