import React, { useState, useEffect, useCallback } from 'react';
import { MarkdownRenderer } from './MarkdownRenderer.jsx';
import { WorkersList } from './WorkersList.jsx';
import { useWebSocket } from '../hooks/useWebSocket.js';
import { useApi } from '../hooks/useApi.js';

const TABS = [
  { key: 'product', label: 'Product' },
  { key: 'tech_stack', label: 'Tech Stack' },
  { key: 'product_guidelines', label: 'Guidelines' },
  { key: 'design_language', label: 'Design' },
  { key: 'deployment_stack', label: 'Deployment' },
  { key: 'kpis', label: 'KPIs' },
  { key: 'user_stories', label: 'User Stories' },
  { key: 'quality_gate', label: 'Quality Gate' },
];

// Track 10014 Phase 5: mirrors CONDUCTOR_FILE_MAP's allow-list in
// ui/server/index.mjs's PATCH /api/projects/:id/conductor/:key — the
// dynamically-added `sg_*` styleguide tabs have no allow-listed key, so
// they get no Edit button here. (`workflow` used to be a read-only tab
// here too, duplicating the dedicated WorkflowSettings editor — removed.)
const EDITABLE_KEYS = new Set([
  'product', 'tech_stack', 'product_guidelines', 'design_language',
  'deployment_stack', 'kpis', 'user_stories', 'quality_gate',
]);

export function ConductorPanel({ project, onClose }) {
  const { apiFetch } = useApi();
  const [files, setFiles] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('product');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  // Reset edit state whenever the active tab changes — editing one tab's
  // content shouldn't bleed into another when switching.
  useEffect(() => {
    setEditing(false);
    setSaveError(null);
  }, [tab]);

  const fetchFiles = useCallback(() => {
    if (!project?.id) return;
    setLoading(true);
    apiFetch(`/api/projects/${project.id}/conductor`)
      .then(r => r.ok ? r.json() : Promise.reject(r.statusText))
      .then(data => { setFiles(data); setLoading(false); setError(null); })
      .catch(err => { setError(String(err)); setLoading(false); });
  }, [project?.id]);

  useEffect(() => {
    fetchFiles();
  }, [fetchFiles]);

  const onMessage = useCallback((msg) => {
    if (msg.event === 'conductor:updated' && msg.data?.projectId === project?.id) {
      console.log('[conductor] Live update detected, refreshing files...');
      fetchFiles();
    }
  }, [project?.id, fetchFiles]);

  useWebSocket(onMessage);

  // Compute styleguide tabs dynamically
  const styleguides = files?.code_styleguides
    ? Object.keys(files.code_styleguides)
    : [];

  const allTabs = [
    ...TABS,
    ...styleguides.map(k => ({ key: `sg_${k}`, label: `${k[0].toUpperCase()}${k.slice(1)} Style` })),
  ];

  function getContent(tabKey) {
    if (!files) return null;
    if (tabKey.startsWith('sg_')) return files.code_styleguides?.[tabKey.slice(3)] ?? null;
    return files[tabKey] ?? null;
  }

  function startEditing() {
    setDraft(getContent(tab) ?? '');
    setSaveError(null);
    setEditing(true);
  }

  function cancelEditing() {
    setEditing(false);
    setSaveError(null);
  }

  async function saveEdit() {
    setSaving(true);
    setSaveError(null);
    try {
      const r = await apiFetch(`/api/projects/${project.id}/conductor/${tab}`, {
        method: 'PATCH',
        body: JSON.stringify({ content: draft }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Save failed');
      setFiles(prev => ({ ...prev, [tab]: draft }));
      setEditing(false);
    } catch (err) {
      setSaveError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="border-b border-gray-800 bg-gray-950">
      {/* Panel header */}
      <div className="flex items-center justify-between px-6 py-2 border-b border-gray-800">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-gray-400 font-medium">Project Context</span>
          <span className="text-gray-600">—</span>
          <span className="text-blue-400 font-mono text-xs">{project?.name}</span>
          {project?.repo_path && (
            <span className="text-gray-600 text-xs hidden md:block">{project.repo_path}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {EDITABLE_KEYS.has(tab) && !loading && !error && (
            editing ? (
              <>
                {saveError && <span className="text-[10px] text-red-400">{saveError}</span>}
                <button
                  onClick={cancelEditing}
                  disabled={saving}
                  data-testid="conductor-cancel-btn"
                  className="text-[10px] px-2 py-1 rounded border border-gray-700 text-gray-400 hover:text-gray-200 disabled:opacity-40 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={saveEdit}
                  disabled={saving}
                  data-testid="conductor-save-btn"
                  className="text-[10px] px-2 py-1 rounded bg-blue-700 hover:bg-blue-600 disabled:opacity-40 text-white font-bold transition-colors"
                >
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </>
            ) : (
              <button
                onClick={startEditing}
                data-testid="conductor-edit-btn"
                className="text-[10px] px-2 py-1 rounded border border-gray-700 text-gray-400 hover:text-gray-200 transition-colors"
              >
                Edit
              </button>
            )
          )}
          <button
            onClick={onClose}
            className="text-gray-600 hover:text-gray-300 text-sm"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-0 overflow-x-auto">
        {allTabs.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-xs font-medium whitespace-nowrap transition-colors border-b-2 ${tab === t.key
                ? 'text-white border-blue-500'
                : 'text-gray-500 border-transparent hover:text-gray-300'
              }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Content area */}
      <div className="max-h-80 overflow-y-auto px-6 py-4">
        {loading ? (
          <p className="text-gray-500 text-sm">Loading context files…</p>
        ) : error ? (
          <p className="text-red-400 text-sm">Error: {error}</p>
        ) : editing ? (
          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            data-testid="conductor-edit-textarea"
            rows={16}
            className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-xs font-mono text-gray-200 focus:outline-none focus:border-blue-700 resize-y"
          />
        ) : (
          <MarkdownRenderer content={getContent(tab)} />
        )}
      </div>
    </div>
  );
}
