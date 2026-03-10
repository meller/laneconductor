import React, { useState, useEffect, useCallback } from 'react';
import { MarkdownRenderer } from './MarkdownRenderer.jsx';
import { WorkersList } from './WorkersList.jsx';
import { useWebSocket } from '../hooks/useWebSocket.js';

const TABS = [
  { key: 'product', label: 'Product' },
  { key: 'tech_stack', label: 'Tech Stack' },
  { key: 'workflow', label: 'Workflow' },
  { key: 'product_guidelines', label: 'Guidelines' },
  { key: 'quality_gate', label: 'Quality Gate' },
];

export function ConductorPanel({ project, onClose }) {
  const [files, setFiles] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('product');

  const fetchFiles = useCallback(() => {
    if (!project?.id) return;
    setLoading(true);
    fetch(`/api/projects/${project.id}/conductor`)
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
        <button
          onClick={onClose}
          className="text-gray-600 hover:text-gray-300 text-sm"
        >
          ✕
        </button>
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
        ) : (
          <MarkdownRenderer content={getContent(tab)} />
        )}
      </div>
    </div>
  );
}
