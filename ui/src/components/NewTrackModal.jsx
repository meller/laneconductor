import React, { useState, useEffect, useRef } from 'react';

function matchingTracks(title, type, tracks, activeProjectId) {
  if (title.trim().length < 3) return [];
  const minLen = type === 'bug' ? 2 : 3;
  const words = title.toLowerCase().split(/\s+/).filter(w => w.length >= minLen);
  if (words.length === 0) return [];
  return tracks
    .filter(t =>
      t.lane_status !== 'done' &&
      (t.project_id === activeProjectId || !t.project_id) &&
      words.some(w => t.title.toLowerCase().includes(w) || (type === 'bug' && t.content_summary?.toLowerCase().includes(w)))
    )
    .slice(0, 3);
}

export function NewTrackModal({ projectId, projects, tracks, onClose, onCreated, onResumed, initialType = 'feature', initialDescription = '' }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState(initialDescription);
  const [type, setType] = useState(initialType);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [selectedProjectId, setSelectedProjectId] = useState(projectId ?? null);
  const [suggestions, setSuggestions] = useState([]);

  const titleRef = useRef(null);

  // Focus title input on mount
  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  // Close on Escape
  useEffect(() => {
    const handler = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const activeProjectId = selectedProjectId ?? projectId;

  // Debounced suggestion matching
  useEffect(() => {
    const timer = setTimeout(() => {
      setSuggestions(matchingTracks(title, type, tracks, activeProjectId));
    }, 500);
    return () => clearTimeout(timer);
  }, [title, type, tracks, activeProjectId]);

  async function handleAddToTrack(track) {
    const pid = track.project_id ?? activeProjectId;
    setSubmitting(true);
    setError(null);
    try {
      const r = await fetch(`/api/projects/${pid}/tracks/${track.track_number}/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim(), description: description.trim() }),
      });
      if (r.ok) {
        onCreated?.();
        onClose();
      } else {
        const data = await r.json();
        setError(data.error ?? 'Failed to update track');
      }
    } catch (err) {
      setError(err.message);
    }
    setSubmitting(false);
  }

  // Resumable tracks for the selected project (plan, backlog or review, not done)
  const resumable = tracks.filter(t =>
    (t.project_id === activeProjectId || (!t.project_id && activeProjectId === projectId)) &&
    (t.lane_status === 'plan' || t.lane_status === 'backlog' || t.lane_status === 'review')
  );

  async function handleResume(track) {
    const pid = track.project_id ?? activeProjectId;
    try {
      const r = await fetch(`/api/projects/${pid}/tracks/${track.track_number}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lane_status: 'implement' }),
      });
      if (r.ok) {
        onResumed?.();
        onClose();
      }
    } catch (err) {
      console.error('Resume failed:', err);
    }
  }

  async function handleCreate(e) {
    e.preventDefault();
    if (!title.trim() || !activeProjectId) return;
    setSubmitting(true);
    setError(null);
    try {
      const r = await fetch(`/api/projects/${activeProjectId}/tracks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim(), description: description.trim(), type }),
      });
      if (r.ok) {
        await r.json();
        onCreated?.();
        onClose();
      } else {
        const data = await r.json();
        setError(data.error ?? 'Failed to create track');
      }
    } catch (err) {
      setError(err.message);
    }
    setSubmitting(false);
  }

  const LANE_BADGE = {
    plan: 'bg-indigo-900 text-indigo-300',
    backlog: 'bg-gray-700 text-gray-300',
    implement: 'bg-blue-900 text-blue-300',
    review: 'bg-amber-900 text-amber-300',
    'quality-gate': 'bg-purple-900 text-purple-300',
    done: 'bg-green-900 text-green-300',
  };

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/70 z-50 flex items-start justify-center pt-24 px-4" onClick={onClose}>
        <div
          className="bg-gray-950 border border-gray-800 rounded-xl w-full max-w-lg shadow-2xl"
          onClick={e => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
            <div className="flex items-center gap-2">
              <img src="/logo.png" alt="" className="h-5 w-auto grayscale opacity-50" />
              <h2 className="text-white font-semibold text-sm">New Track</h2>
            </div>
            <button
              onClick={onClose}
              className="text-gray-500 hover:text-gray-200 text-xl leading-none"
            >
              ✕
            </button>
          </div>

          <div className="px-5 py-4 space-y-5">
            {/* Project selector — only when no project is pre-selected */}
            {!projectId && (
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">Project</label>
                <select
                  value={selectedProjectId ?? ''}
                  onChange={e => setSelectedProjectId(Number(e.target.value) || null)}
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-gray-500"
                >
                  <option value="">Select a project…</option>
                  {projects.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Resume section */}
            {activeProjectId && resumable.length > 0 && (
              <div>
                <p className="text-xs text-gray-400 mb-2 font-medium">Resume a track?</p>
                <div className="space-y-1.5 max-h-40 overflow-y-auto">
                  {resumable.map(track => (
                    <button
                      key={track.id}
                      onClick={() => handleResume(track)}
                      className="w-full text-left flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg bg-gray-900 border border-gray-800 hover:border-gray-600 hover:bg-gray-800 transition-colors"
                    >
                      <div className="min-w-0">
                        <span className="text-xs font-mono text-gray-500 mr-1.5">#{track.track_number}</span>
                        <span className="text-sm text-gray-200">{track.title}</span>
                        {track.current_phase && (
                          <p className="text-xs text-gray-500 mt-0.5 truncate">{track.current_phase}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${LANE_BADGE[track.lane_status] ?? LANE_BADGE.backlog}`}>
                          {track.lane_status}
                        </span>
                        <span className="text-xs text-blue-400">→ Start</span>
                      </div>
                    </button>
                  ))}
                </div>
                <div className="mt-4 border-t border-gray-800" />
              </div>
            )}

            {/* Smart suggestions — matching existing tracks */}
            {suggestions.length > 0 && title.trim().length >= 3 && (
              <div>
                <p className="text-xs text-amber-400 mb-2 font-medium">💡 Might belong in an existing track:</p>
                <div className="space-y-1.5">
                  {suggestions.map(track => (
                    <div
                      key={track.id}
                      className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg bg-gray-900 border border-amber-900/50"
                    >
                      <div className="min-w-0">
                        <span className="text-xs font-mono text-gray-500 mr-1.5">#{track.track_number}</span>
                        <span className="text-sm text-gray-200">{track.title}</span>
                      </div>
                      <button
                        type="button"
                        disabled={submitting}
                        onClick={() => handleAddToTrack(track)}
                        className="shrink-0 text-xs px-2 py-1 rounded bg-amber-900/60 text-amber-300 hover:bg-amber-800 transition-colors disabled:opacity-40"
                      >
                        Add to this →
                      </button>
                    </div>
                  ))}
                </div>
                <div className="mt-3 border-t border-gray-800" />
              </div>
            )}

            {/* Create new section */}
            <form onSubmit={handleCreate} className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs text-gray-400 font-medium">Create new track</p>
                <div className="flex rounded-lg overflow-hidden border border-gray-700 text-xs">
                  {[
                    { value: 'feature', label: '✦ Feature' },
                    { value: 'bug', label: '⚠ Bug' },
                  ].map(opt => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setType(opt.value)}
                      className={`px-3 py-1 transition-colors ${type === opt.value
                        ? opt.value === 'bug'
                          ? 'bg-red-900 text-red-300'
                          : 'bg-blue-900 text-blue-300'
                        : 'bg-gray-900 text-gray-500 hover:text-gray-300'
                        }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs text-gray-500 mb-1">Title <span className="text-gray-600">(required)</span></label>
                <input
                  ref={titleRef}
                  type="text"
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  placeholder={type === 'bug' ? 'e.g. Login fails on Safari' : 'e.g. Auth middleware'}
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-gray-500"
                />
              </div>

              <div>
                <label className="block text-xs text-gray-500 mb-1">
                  {type === 'bug' ? 'Steps to reproduce / context' : 'Description'}{' '}
                  <span className="text-gray-600">(optional)</span>
                </label>
                <textarea
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  placeholder={type === 'bug' ? 'Steps to reproduce, expected vs actual behaviour' : 'What problem does this track solve?'}
                  rows={2}
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-600 resize-none focus:outline-none focus:border-gray-500"
                />
              </div>

              {error && (
                <p className="text-xs text-red-400">{error}</p>
              )}

              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-3 py-1.5 text-xs rounded border border-gray-700 text-gray-400 hover:text-gray-200 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!title.trim() || !activeProjectId || submitting}
                  className="px-3 py-1.5 text-xs rounded bg-blue-700 hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium transition-colors"
                >
                  {submitting ? 'Creating…' : 'Create Track'}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </>
  );
}
