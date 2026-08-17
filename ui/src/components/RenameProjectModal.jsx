import React, { useState, useRef, useEffect } from 'react';
import { useApi } from '../hooks/useApi';

export function RenameProjectModal({ project, onClose, onRenamed }) {
  const { apiFetch } = useApi();
  const [name, setName] = useState(project.name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const inputRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); inputRef.current?.select(); }, []);

  useEffect(() => {
    const handler = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const valid = name.trim().length > 0;

  async function handleSubmit(e) {
    e.preventDefault();
    if (!valid || saving) return;
    setSaving(true);
    setError(null);
    try {
      const r = await apiFetch(`/api/projects/${project.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: name.trim() }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Rename failed');
      onRenamed?.();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-start justify-center pt-24 px-4" onClick={onClose}>
      <div
        className="bg-gray-950 border border-gray-800 rounded-xl w-full max-w-sm shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <h2 className="text-white font-semibold text-sm">Rename Project</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-200 text-xl leading-none">✕</button>
        </div>
        <form onSubmit={handleSubmit} className="px-5 py-4 space-y-3">
          <input
            ref={inputRef}
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            data-testid="rename-input"
            className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-gray-500"
          />
          {error && <p className="text-xs text-red-400">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="px-3 py-1.5 text-xs rounded border border-gray-700 text-gray-400 hover:text-gray-200 transition-colors">
              Cancel
            </button>
            <button
              type="submit"
              disabled={!valid || saving}
              data-testid="rename-submit"
              className="px-3 py-1.5 text-xs rounded bg-blue-700 hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium transition-colors"
            >
              {saving ? 'Saving…' : 'Rename'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
