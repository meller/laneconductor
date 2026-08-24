import React, { useState, useRef, useEffect } from 'react';
import { useApi } from '../hooks/useApi';

export function DeleteProjectModal({ project, onClose, onDeleted }) {
  const { apiFetch } = useApi();
  const [confirmText, setConfirmText] = useState('');
  const [deleteLocalFiles, setDeleteLocalFiles] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState(null);
  const inputRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    const handler = e => { if (e.key === 'Escape' && !deleting) onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose, deleting]);

  const matches = confirmText === project.name;

  async function handleDelete() {
    if (!matches || deleting) return;
    setDeleting(true);
    setError(null);
    try {
      const body = deleteLocalFiles ? { deleteLocalFiles: true } : {};
      const r = await apiFetch(`/api/projects/${project.id}`, {
        method: 'DELETE',
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Delete failed');
      onDeleted?.(project.id);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-start justify-center pt-24 px-4" onClick={deleting ? undefined : onClose}>
      <div
        className="bg-gray-950 border border-red-900/50 rounded-xl w-full max-w-md shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <h2 className="text-red-400 font-semibold text-sm">Delete Project</h2>
          {!deleting && <button onClick={onClose} className="text-gray-500 hover:text-gray-200 text-xl leading-none">✕</button>}
        </div>

        <div className="px-5 py-4 space-y-4">
          <p className="text-xs text-gray-400">
            This removes <span className="text-white font-semibold">{project.name}</span> from
            LaneConductor — its tracks, workers, and history — permanently and irreversibly.
          </p>

          <div>
            <label className="block text-xs text-gray-500 mb-1">
              Type <span className="text-gray-300 font-mono">{project.name}</span> to confirm
            </label>
            <input
              ref={inputRef}
              type="text"
              value={confirmText}
              onChange={e => setConfirmText(e.target.value)}
              data-testid="delete-confirm-input"
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-red-700"
            />
          </div>

          <label className="flex items-start gap-2 text-xs text-gray-400 cursor-pointer">
            <input
              type="checkbox"
              checked={deleteLocalFiles}
              onChange={e => setDeleteLocalFiles(e.target.checked)}
              data-testid="delete-local-files-checkbox"
              className="mt-0.5 w-3 h-3 accent-red-600"
            />
            <span>
              Also delete <code className="text-gray-500">conductor/</code> and{' '}
              <code className="text-gray-500">.laneconductor.json</code> from disk
              <span className="block text-gray-600 mt-0.5">
                Does not touch git — no branch or commit is removed, only LaneConductor's own files.
              </span>
            </span>
          </label>

          {error && <p className="text-xs text-red-400">{error}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} disabled={deleting} className="px-3 py-1.5 text-xs rounded border border-gray-700 text-gray-400 hover:text-gray-200 disabled:opacity-40 transition-colors">
              Cancel
            </button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={!matches || deleting}
              data-testid="delete-submit"
              className="px-3 py-1.5 text-xs rounded bg-red-700 hover:bg-red-600 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium transition-colors"
            >
              {deleting ? 'Deleting…' : 'Delete Project'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
