import React, { useState, useEffect, useRef } from 'react';
import { useApi } from '../hooks/useApi';
import { resolveMergeMode } from '../../../conductor/services/merge-mode.mjs';
import { getDefaultProviderModel } from '../lib/defaultModel.js';
import { modelsForProvider } from '../lib/modelOptions.js';

// Track 008 Phase 5: silent defaults these Advanced controls start at —
// read from the same resolvers the worker uses at spawn/merge time (not a
// second hardcoded copy) so the toggle's rest position always matches what
// leaving it alone actually produces. resolveMergeMode(null) is the 'pr'
// default with no track row to read from yet; 'branch' is
// resolveWorkspaceMode()'s own row-6 fallback (see workspace-mode.mjs) —
// the modal doesn't have a way to know a project-level override exists
// today (`.laneconductor.json`'s `project.workspace_mode` isn't exposed by
// GET /api/projects — file-only, no DB column), but that's safe rather
// than wrong: an explicit **Workspace** marker always outranks the
// project default in resolveWorkspaceMode's own precedence table, so a
// human's toggle choice here is never silently ignored, just occasionally
// redundant with what the project would have done anyway.
const MERGE_MODE_DEFAULT = resolveMergeMode(null);
const WORKSPACE_MODE_DEFAULT = 'branch';

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

export function NewTrackModal({ projectId, projects, tracks, workers = [], onClose, onCreated, onResumed, initialType = 'feature', initialDescription = '' }) {
  const { apiFetch } = useApi();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState(initialDescription);
  const [type, setType] = useState(initialType);
  const [trackType, setTrackType] = useState('dev');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [selectedProjectId, setSelectedProjectId] = useState(projectId ?? null);
  const [suggestions, setSuggestions] = useState([]);

  // Track 008 Phase 5: Advanced (collapsed-by-default) per-track config.
  const [mergeMode, setMergeMode] = useState(MERGE_MODE_DEFAULT);
  const [workspaceMode, setWorkspaceMode] = useState(WORKSPACE_MODE_DEFAULT);
  const [autoRun, setAutoRun] = useState(false);
  const [modelOverride, setModelOverride] = useState('');

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
  const activeProject = projects?.find(p => p.id === activeProjectId) ?? null;
  // Track 008 Phase 5: the Model dropdown's options — same
  // live-worker-merged-with-registry-presets source TrackDetailPanel.jsx's
  // own per-track model override field already uses (modelOptions.js),
  // scoped to this project's resolved default CLI. A brand-new track has
  // no worker of its own yet, so — like WorkflowSettings.jsx's per-lane
  // model field — this can't be scoped to "the worker that will run it"
  // and instead uses the project's own default provider across all of the
  // project's workers.
  const modelProviderCli = getDefaultProviderModel(activeProject, workers).cli;
  const modelChoices = modelsForProvider(modelProviderCli, workers);

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
      const r = await apiFetch(`/api/projects/${pid}/tracks/${track.track_number}/update`, {
        method: 'POST',
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
      const r = await apiFetch(`/api/projects/${pid}/tracks/${track.track_number}`, {
        method: 'PATCH',
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
      // Track 008 Phase 5: only send an Advanced field when it differs from
      // its own silent default — the server (and trackTemplates()) treat
      // "absent" as "default" for all three, so sending the default value
      // explicitly would just be noise (and, if the server didn't also
      // guard this, would write a pointless marker into index.md).
      const body = { title: title.trim(), description: description.trim(), type, trackType };
      if (mergeMode !== MERGE_MODE_DEFAULT) body.merge_mode = mergeMode;
      if (workspaceMode !== WORKSPACE_MODE_DEFAULT) body.workspace_mode = workspaceMode;
      if (autoRun) body.auto_run = true;
      if (modelOverride) body.model = modelOverride;

      const r = await apiFetch(`/api/projects/${activeProjectId}/tracks`, {
        method: 'POST',
        body: JSON.stringify(body),
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

              {/* Track domain type */}
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-500">Domain</span>
                <div className="flex rounded-lg overflow-hidden border border-gray-700 text-xs">
                  {[
                    { value: 'dev', label: 'Dev' },
                    { value: 'marketing', label: 'Mktg' },
                    { value: 'sales', label: 'Sales' },
                    { value: 'support', label: 'Support' },
                    { value: 'other', label: 'Other' },
                  ].map(opt => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setTrackType(opt.value)}
                      className={`px-2.5 py-1 transition-colors ${trackType === opt.value
                        ? opt.value === 'marketing' ? 'bg-blue-900 text-blue-300'
                          : opt.value === 'sales' ? 'bg-green-900 text-green-300'
                          : opt.value === 'support' ? 'bg-amber-900 text-amber-300'
                          : 'bg-gray-700 text-gray-200'
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
                  data-testid="title-input"
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

              {/* Track 008 Phase 5: per-track config, collapsed by default —
                  none of these four are what most track creations need. */}
              <details className="group">
                <summary data-testid="advanced-toggle" className="text-xs text-gray-500 hover:text-gray-300 cursor-pointer select-none list-none flex items-center gap-1">
                  <span className="transition-transform group-open:rotate-90">▸</span> Advanced
                </summary>
                <div className="mt-2 space-y-3 pl-0.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-500">Merge Mode</span>
                    <div className="flex rounded-lg overflow-hidden border border-gray-700 text-xs">
                      {[
                        { value: 'pr', label: 'PR' },
                        { value: 'direct', label: 'Direct' },
                      ].map(opt => (
                        <button
                          key={opt.value}
                          type="button"
                          data-testid={`merge-mode-${opt.value}`}
                          onClick={() => setMergeMode(opt.value)}
                          className={`px-2.5 py-1 transition-colors ${mergeMode === opt.value
                            ? 'bg-gray-700 text-gray-200'
                            : 'bg-gray-900 text-gray-500 hover:text-gray-300'
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-500">Workspace</span>
                    <div className="flex rounded-lg overflow-hidden border border-gray-700 text-xs">
                      {[
                        { value: 'branch', label: 'Branch' },
                        { value: 'main', label: 'Main' },
                      ].map(opt => (
                        <button
                          key={opt.value}
                          type="button"
                          data-testid={`workspace-mode-${opt.value}`}
                          onClick={() => setWorkspaceMode(opt.value)}
                          className={`px-2.5 py-1 transition-colors ${workspaceMode === opt.value
                            ? 'bg-gray-700 text-gray-200'
                            : 'bg-gray-900 text-gray-500 hover:text-gray-300'
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <label className="flex items-center justify-between cursor-pointer">
                    <span className="text-xs text-gray-500" title="Whether a non-sync-only worker's auto-launch loop may claim this track from the queue.">
                      Auto Run
                    </span>
                    <input
                      type="checkbox"
                      data-testid="auto-run-checkbox"
                      checked={autoRun}
                      onChange={e => setAutoRun(e.target.checked)}
                      className="accent-blue-600"
                    />
                  </label>

                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs text-gray-500 shrink-0">Model</span>
                    <select
                      data-testid="model-select"
                      value={modelOverride}
                      onChange={e => setModelOverride(e.target.value)}
                      className="bg-gray-900 border border-gray-700 rounded-lg px-2 py-1 text-xs text-gray-200 focus:outline-none focus:border-gray-500"
                    >
                      <option value="">Inherit default</option>
                      {modelChoices.map(m => (
                        <option key={m.id} value={m.id}>{m.label}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </details>

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
