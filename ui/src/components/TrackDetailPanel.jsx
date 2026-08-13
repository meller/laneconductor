import React, { useState, useEffect, useRef, useCallback } from 'react';
import { MarkdownRenderer } from './MarkdownRenderer.jsx';
import { DevServerButton } from './DevServerButton.jsx';
import { TranscriptView } from './TranscriptView.jsx';
import { useApi } from '../hooks/useApi';
import { useWebSocket } from '../hooks/useWebSocket.js';
import { createTranscriptState, reduceStreamEvent } from '../lib/streamTranscript.js';

const CONTENT_TABS = [
  { key: 'index', label: 'Overview' },
  { key: 'plan', label: 'Plan' },
  { key: 'spec', label: 'Spec' },
  { key: 'test', label: 'Tests' },
];

const LANE_BADGE = {
  plan: 'bg-indigo-900 text-indigo-300',
  backlog: 'bg-gray-700 text-gray-300',
  implement: 'bg-blue-900 text-blue-300',
  review: 'bg-amber-900 text-amber-300',
  'quality-gate': 'bg-purple-900 text-purple-300',
  done: 'bg-green-900 text-green-300',
};

// Track 1085: the only actions the API will accept a dispatch for — it
// validates action === track.lane_status, so a track sitting in 'backlog'
// or 'done' has no valid action to dispatch at all.
const DISPATCHABLE_LANES = ['plan', 'implement', 'review', 'quality-gate'];
const WORKER_OFFLINE_MS = 60_000;

function isWorkerOffline(worker) {
  if (!worker?.last_heartbeat) return true;
  return Date.now() - new Date(worker.last_heartbeat).getTime() > WORKER_OFFLINE_MS;
}

const AUTHOR_STYLES = {
  human: { label: 'You', dot: 'bg-gray-400', body: 'bg-gray-800 text-gray-200' },
  claude: { label: 'Claude', dot: 'bg-orange-400', body: 'bg-orange-950/40 text-gray-200 border border-orange-900/50' },
  gemini: { label: 'Gemini', dot: 'bg-blue-400', body: 'bg-blue-950/40 text-gray-200 border border-blue-900/50' },
};

function timeAgo(dateStr) {
  const s = Math.floor((Date.now() - new Date(dateStr)) / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

function CommentBubble({ comment }) {
  const style = AUTHOR_STYLES[comment.author] ?? AUTHOR_STYLES.human;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5 text-xs text-gray-500">
        <span className={`w-1.5 h-1.5 rounded-full ${style.dot}`} />
        <span className="font-medium text-gray-400">{style.label}</span>
        <span>{timeAgo(comment.created_at)}</span>
      </div>
      <div className={`rounded-lg px-3 py-2 text-sm leading-relaxed ${style.body}`}>
        {comment.body}
      </div>
    </div>
  );
}

export function TrackDetailPanel({ projectId, trackNumber, initialTab, onClose }) {
  const { apiFetch } = useApi();
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState(initialTab ?? 'plan');
  const [comments, setComments] = useState([]);
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState('');
  const bottomRef = useRef(null);
  const logsEndRef = useRef(null);
  const pollRef = useRef(null);
  const detailPollRef = useRef(null);
  const [showNewTrack, setShowNewTrack] = useState(false);
  const initialTabSet = useRef(!!initialTab);
  // Track 1084 Phase 4: assignee control
  const [members, setMembers] = useState([]);
  const [assigneeSaving, setAssigneeSaving] = useState(false);
  // Track 1085 Phase 4: manual dispatch — "Run on worker" control + history
  const [projectWorkers, setProjectWorkers] = useState([]);
  const [selectedWorkerId, setSelectedWorkerId] = useState('');
  const [dispatching, setDispatching] = useState(false);
  const [dispatchHistory, setDispatchHistory] = useState([]);
  // Track 1112 Phase 7: this track's own worktree row (if any), secondary/
  // detail-level view of the same data WorktreesPanel lists project-wide.
  const [worktreeRow, setWorktreeRow] = useState(null);
  const [mergingWorktree, setMergingWorktree] = useState(false);
  // Track 1087 Phase 4: live session transcript drawer
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [transcriptState, setTranscriptState] = useState(() => createTranscriptState());
  const transcriptEndRef = useRef(null);
  // Auto-expand once per viewing session (first live event after opening
  // this track) — armed again whenever the track changes, but not re-armed
  // after that so a manual collapse (REQ-4: "user can collapse manually at
  // any time") isn't immediately fought by the next tool-call event.
  const autoExpandArmedRef = useRef(true);

  // Fetch track detail
  const fetchDetail = () => {
    apiFetch(`/api/projects/${projectId}/tracks/${trackNumber}`)
      .then(r => r.ok ? r.json() : Promise.reject(r.statusText))
      .then(data => { setDetail(data); setLoading(false); })
      .catch(err => { setError(String(err)); setLoading(false); });
  };

  useEffect(() => {
    setLoading(true);
    fetchDetail();
    // Poll detail every 3s if panel is open
    detailPollRef.current = setInterval(fetchDetail, 3000);
    return () => clearInterval(detailPollRef.current);
  }, [projectId, trackNumber]);

  // Track 1087 Phase 4 Task 4: reconstruct transcript history from the full
  // JSONL log on load, before subscribing to live WS events below.
  useEffect(() => {
    setTranscriptState(createTranscriptState());
    autoExpandArmedRef.current = true;
    apiFetch(`/api/projects/${projectId}/tracks/${trackNumber}/transcript`)
      .then(r => r.ok ? r.json() : { events: [] })
      .then(({ events }) => {
        setTranscriptState((events || []).reduce(reduceStreamEvent, createTranscriptState()));
      })
      .catch(() => { });
  }, [projectId, trackNumber]);

  // Track 1087 Phase 4 Task 2: live continuation over the same WebSocket
  // the rest of the app already uses (Phase 2's notifyApi -> broadcast
  // relay) — filtered to events for the track currently being viewed.
  const onTranscriptWsMessage = useCallback((msg) => {
    if (msg.event !== 'session:event') return;
    if (String(msg.data?.trackNumber) !== String(trackNumber)) return;
    setTranscriptState(prev => reduceStreamEvent(prev, msg.data.event));
    if (autoExpandArmedRef.current) {
      autoExpandArmedRef.current = false;
      setTranscriptOpen(true);
    }
  }, [trackNumber]);
  useWebSocket(onTranscriptWsMessage);

  // Scroll transcript drawer to bottom as new blocks arrive
  useEffect(() => {
    if (transcriptOpen) transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcriptState, transcriptOpen]);

  // Track 1084 Phase 4: project members for the assignee dropdown. Empty in
  // local-api mode (no auth, no multi-user concept) — the control degrades
  // gracefully to a read-only note in that case, same as worker-pins/
  // worker_permissions already do elsewhere in this app.
  useEffect(() => {
    apiFetch(`/api/projects/${projectId}/members`)
      .then(r => r.ok ? r.json() : [])
      .then(setMembers)
      .catch(() => setMembers([]));
  }, [projectId]);

  async function setAssignee(uid) {
    setAssigneeSaving(true);
    try {
      const r = await apiFetch(`/api/projects/${projectId}/tracks/${trackNumber}/assignee`, {
        method: 'PATCH',
        body: JSON.stringify({ assignee_uid: uid || null }),
      });
      if (r.ok) fetchDetail();
    } catch { }
    setAssigneeSaving(false);
  }

  // Track 1085 Phase 4: workers registered to this project, for the "Run on
  // worker" dropdown. Unlike the assignee list, this isn't auth-gated — a
  // worker is visible regardless of who (if anyone) owns it, since in a
  // no-auth (local-api) deployment every worker's user_uid is null anyway.
  useEffect(() => {
    apiFetch(`/api/projects/${projectId}/workers`)
      .then(r => r.ok ? r.json() : [])
      .then(setProjectWorkers)
      .catch(() => setProjectWorkers([]));
  }, [projectId]);

  const fetchDispatchHistory = () => {
    if (!detail?.id) return;
    apiFetch(`/api/tracks/${detail.id}/dispatch`)
      .then(r => r.ok ? r.json() : [])
      .then(setDispatchHistory)
      .catch(() => setDispatchHistory([]));
  };

  useEffect(() => {
    if (!detail?.id) return;
    fetchDispatchHistory();
    const id = setInterval(fetchDispatchHistory, 4000);
    return () => clearInterval(id);
  }, [detail?.id]);

  // Track 1112 Phase 7: find this track's own row out of the project-wide
  // worktree list — same endpoint WorktreesPanel uses, just filtered down
  // to one track here. Absent (null) is a normal state (no worktree, or
  // fully merged already) — the strip renders nothing in that case.
  const fetchWorktreeRow = () => {
    apiFetch(`/api/projects/${projectId}/worktrees`)
      .then(r => r.ok ? r.json() : [])
      .then(rows => setWorktreeRow((rows || []).find(r => r.track === String(trackNumber)) ?? null))
      .catch(() => setWorktreeRow(null));
  };

  useEffect(() => {
    fetchWorktreeRow();
    const id = setInterval(fetchWorktreeRow, 10000);
    return () => clearInterval(id);
  }, [projectId, trackNumber]);

  async function handleMergeWorktree() {
    setMergingWorktree(true);
    try {
      const res = await apiFetch(`/api/projects/${projectId}/dispatch`, {
        method: 'POST',
        body: JSON.stringify({ action: 'merge-worktree', payload: { track_number: String(trackNumber) } }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || await res.text());
      fetchWorktreeRow();
      fetchDispatchHistory();
    } catch (err) {
      alert(`Failed to dispatch merge: ${err.message}`);
    } finally {
      setMergingWorktree(false);
    }
  }

  // Default the worker dropdown to one of the resolved assignee's own
  // workers (workers.user_uid, track 1084) when possible, falling back to
  // the first idle worker, then just the first worker in the list.
  useEffect(() => {
    if (!detail || projectWorkers.length === 0 || selectedWorkerId) return;
    const assignee = detail.assignee_uid ?? detail.created_by_uid;
    const ownWorker = assignee ? projectWorkers.find(w => w.user_uid === assignee) : null;
    const idleWorker = projectWorkers.find(w => w.status !== 'busy' && !isWorkerOffline(w));
    setSelectedWorkerId(String((ownWorker ?? idleWorker ?? projectWorkers[0]).id));
  }, [detail, projectWorkers]);

  async function dispatchRunNow(action) {
    if (!detail?.id || !selectedWorkerId) return;
    setDispatching(true);
    try {
      const r = await apiFetch(`/api/tracks/${detail.id}/dispatch`, {
        method: 'POST',
        body: JSON.stringify({ worker_id: parseInt(selectedWorkerId), action }),
      });
      if (r.ok) fetchDispatchHistory();
      else {
        const { error } = await r.json().catch(() => ({}));
        alert(`Dispatch failed: ${error || r.statusText}`);
      }
    } catch (err) {
      alert(`Dispatch failed: ${err.message}`);
    }
    setDispatching(false);
  }

  // Poll comments every 2s; auto-switch to Conversation on first load if comments exist
  useEffect(() => {
    async function fetchComments() {
      try {
        const r = await apiFetch(`/api/projects/${projectId}/tracks/${trackNumber}/comments`);
        if (!r.ok) return;
        const data = await r.json();
        setComments(data);
        if (!initialTabSet.current && data.length > 0) {
          setTab('conversation');
          initialTabSet.current = true;
        }
      } catch { }
    }
    fetchComments();
    pollRef.current = setInterval(fetchComments, 2000);
    return () => clearInterval(pollRef.current);
  }, [projectId, trackNumber]);

  // Scroll to bottom when comments change and Conversation tab is active
  useEffect(() => {
    if (tab === 'conversation') {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [comments, tab]);

  useEffect(() => {
    if (tab === 'logs') {
      logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [detail?.last_log_tail, tab]);

  // Close on Escape
  useEffect(() => {
    const handler = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  async function openBug() {
    const description = draft.trim() || undefined;
    setSending(true);
    try {
      const r = await apiFetch(`/api/projects/${projectId}/tracks/${trackNumber}/open-bug`, {
        method: 'POST',
        body: JSON.stringify({ description }),
      });
      if (r.ok) {
        const data = await r.json();
        if (data.comment) setComments(prev => [...prev, data.comment]);
        setDraft('');
        fetchDetail();
      }
    } catch { }
    setSending(false);
  }

  async function sendComment(textOverride, newLaneStatus, noWake = false, command = undefined) {
    const isEvent = typeof textOverride === 'object' && textOverride !== null;
    const isMissing = textOverride === undefined;
    const bodyStr = isEvent || isMissing ? draft : textOverride;
    const body = bodyStr.trim();

    if (!body && !command && !newLaneStatus && sending) return;
    setSending(true);
    try {
      const r = await apiFetch(`/api/projects/${projectId}/tracks/${trackNumber}/comments`, {
        method: 'POST',
        body: JSON.stringify({ author: 'human', body: body || `Triggering ${command}...`, no_wake: noWake, command }),
      });
      if (r.ok) {
        const comment = await r.json();
        setComments(prev => [...prev, comment]);
        if (isEvent || isMissing || textOverride === bodyStr) {
          setDraft('');
        }
      }

      if (typeof newLaneStatus === 'string') {
        const pr = await apiFetch(`/api/projects/${projectId}/tracks/${trackNumber}`, {
          method: 'PATCH',
          body: JSON.stringify({ lane_status: newLaneStatus }),
        });
        if (pr.ok) {
          fetchDetail();
        }
      }
    } catch { }
    setSending(false);
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) sendComment();
  }

  const allTabs = [
    ...CONTENT_TABS,
    { key: 'conversation', label: `Conversation${comments.length ? ` (${comments.length})` : ''}` },
    { key: 'logs', label: 'Logs' },
  ];

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/60 z-40" onClick={onClose} />

      {/* Panel (+ Track 1087 Phase 4: collapsible transcript drawer, docked to its left) */}
      <div className="fixed top-0 right-0 h-full z-50 flex flex-row shadow-2xl">
        {transcriptOpen && (
          <div className="h-full w-96 bg-gray-950 border-l border-gray-800 flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 shrink-0">
              <span className="text-xs font-semibold text-gray-300 uppercase tracking-wider">Live Transcript</span>
              <button
                onClick={() => setTranscriptOpen(false)}
                title="Collapse transcript"
                className="text-gray-500 hover:text-gray-200 text-sm leading-none"
              >
                ✕
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-3 py-3">
              <TranscriptView blocks={transcriptState.blocks} />
              <div ref={transcriptEndRef} />
            </div>
          </div>
        )}
        <div className="h-full w-full max-w-2xl bg-gray-950 border-l border-gray-800 flex flex-col">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-gray-800">
          <div>
            {detail ? (
              <>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-mono text-gray-500">#{detail.track_number}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${LANE_BADGE[detail.lane_status] ?? LANE_BADGE.backlog}`}>
                    {detail.lane_status}
                  </span>
                  <span className="text-xs text-gray-500">{detail.progress_percent ?? 0}%</span>
                </div>
                <h2 className="text-base font-semibold text-white">{detail.title}</h2>
                {detail.current_phase && (
                  <p className="text-xs text-gray-500 mt-0.5">{detail.current_phase}</p>
                )}
                {/* Track 1084: Assignee control */}
                <div className="mt-2 flex items-center gap-2">
                  <span className="text-xs text-gray-600">Assignee:</span>
                  {members.length > 0 ? (
                    <select
                      value={detail.assignee_uid ?? ''}
                      disabled={assigneeSaving}
                      onChange={e => setAssignee(e.target.value)}
                      className="text-xs bg-gray-900 border border-gray-700 rounded px-1.5 py-0.5 text-gray-300 disabled:opacity-50"
                    >
                      <option value="">
                        {detail.created_by_uid ? `(default) ${detail.created_by_uid}` : '(unassigned)'}
                      </option>
                      {members.map(m => (
                        <option key={m.user_uid} value={m.user_uid}>{m.user_uid}</option>
                      ))}
                    </select>
                  ) : (
                    <span className="text-xs text-gray-500" title="Assignment is a multi-user (remote-api) feature — no project members to choose from here">
                      {detail.assignee_uid ?? detail.created_by_uid ?? 'unassigned'}
                    </span>
                  )}
                </div>
                {/* Track 1085 Phase 4: manual dispatch — "Run on worker" */}
                {DISPATCHABLE_LANES.includes(detail.lane_status) && projectWorkers.length > 0 && (
                  <div className="mt-2 flex items-center gap-2">
                    <span className="text-xs text-gray-600">Run on worker:</span>
                    <select
                      value={selectedWorkerId}
                      disabled={dispatching}
                      onChange={e => setSelectedWorkerId(e.target.value)}
                      className="text-xs bg-gray-900 border border-gray-700 rounded px-1.5 py-0.5 text-gray-300 disabled:opacity-50"
                    >
                      {projectWorkers.map(w => (
                        <option key={w.id} value={w.id}>
                          {w.hostname}#{w.worker_number ?? 1}{isWorkerOffline(w) ? ' (offline)' : ''}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() => dispatchRunNow(detail.lane_status)}
                      disabled={dispatching || !selectedWorkerId || isWorkerOffline(projectWorkers.find(w => String(w.id) === selectedWorkerId))}
                      title={`Run ${detail.lane_status} now on this worker, outside the normal queue`}
                      className="text-xs px-2 py-0.5 rounded border border-blue-800/70 text-blue-400 hover:bg-blue-900/30 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {dispatching ? 'Dispatching…' : `Run ${detail.lane_status} now`}
                    </button>
                  </div>
                )}
                {dispatchHistory.length > 0 && (
                  <div className="mt-1.5 flex flex-col gap-0.5">
                    {dispatchHistory.slice(0, 3).map(d => (
                      <div key={d.id} className="text-[10px] text-gray-500 flex items-center gap-1.5">
                        <span className={
                          d.status === 'done' ? 'text-green-500' :
                            d.status === 'failed' ? 'text-red-500' :
                              d.status === 'claimed' ? 'text-blue-400' : 'text-yellow-500'
                        }>
                          {d.status === 'done' ? '✓' : d.status === 'failed' ? '✗' : '•'}
                        </span>
                        <span>{d.action}</span>
                        <span className="text-gray-600">{new Date(d.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        {d.result && <span className="text-gray-600 truncate" title={d.result}>— {d.result}</span>}
                      </div>
                    ))}
                  </div>
                )}
                {/* Dev Server Status */}
                {(detail.lane_status === 'review' || detail.lane_status === 'implement') && (
                  <div className="mt-2 pt-2 border-t border-gray-700 flex items-center gap-2">
                    <span className="text-xs text-gray-600">Dev Server:</span>
                    <DevServerButton projectId={projectId} devUrl={detail.dev_url} />
                  </div>
                )}
                {/* Track 1112 Phase 7: inline worktree strip — secondary,
                    detail-level view of the same data WorktreesPanel lists
                    project-wide. Nothing renders when this track has no
                    worktree row (no worktree, or already fully merged). */}
                {worktreeRow && (
                  <div className="mt-2 pt-2 border-t border-gray-700 flex items-center gap-2 flex-wrap" data-testid="track-worktree-strip">
                    <span className="text-xs text-gray-600">Worktree:</span>
                    <span className="text-[10px] font-mono text-gray-400">
                      ahead {worktreeRow.ahead ?? '—'} / behind {worktreeRow.behind ?? '—'} / dirty {worktreeRow.dirty ?? '—'}
                    </span>
                    <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border ${worktreeRow.class === 'stranded' ? 'bg-red-950/40 text-red-300 border-red-800/80' :
                      worktreeRow.class === 'conflicted' ? 'bg-amber-950/40 text-amber-300 border-amber-800/80' :
                        worktreeRow.class === 'mergeable' ? 'bg-green-950/40 text-green-300 border-green-800/80' :
                          'bg-gray-900 text-gray-400 border-gray-800'
                      }`}>
                      {worktreeRow.class}
                    </span>
                    {(worktreeRow.class === 'mergeable' || worktreeRow.class === 'stranded') && (
                      <button
                        onClick={handleMergeWorktree}
                        disabled={mergingWorktree}
                        data-testid="track-merge-to-main-btn"
                        className="text-[10px] px-2 py-0.5 border border-green-800/60 bg-green-950/30 text-green-300 hover:bg-green-900/40 disabled:opacity-50 rounded font-bold uppercase tracking-wider transition-colors"
                      >
                        {mergingWorktree ? 'Merging…' : 'Merge to main'}
                      </button>
                    )}
                  </div>
                )}
              </>
            ) : (
              <div className="text-gray-400 text-sm">Track #{trackNumber}</div>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {/* Track 1087 Phase 4: live session transcript toggle */}
            <button
              onClick={() => setTranscriptOpen(o => !o)}
              title={transcriptOpen ? 'Hide live session transcript' : 'Show live session transcript'}
              className={`text-xs px-2 py-1 rounded border font-medium transition-colors ${transcriptOpen
                  ? 'border-orange-800/70 bg-orange-950/40 text-orange-300'
                  : 'border-gray-700 text-gray-400 hover:bg-gray-800 hover:text-gray-200'
                }`}
            >
              Transcript
            </button>
            <button
              onClick={onClose}
              className="text-gray-500 hover:text-gray-200 text-xl leading-none mt-0.5 shrink-0"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-800 overflow-x-auto">
          {allTabs.map(t => (
            <button
              key={t.key}
              onClick={() => { setTab(t.key); initialTabSet.current = true; }}
              className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors ${tab === t.key
                ? 'text-white border-b-2 border-blue-500'
                : 'text-gray-500 hover:text-gray-300'
                }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        {tab === 'conversation' ? (
          <div className="flex flex-col flex-1 min-h-0">
            {/* Comment list */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              {comments.length === 0 ? (
                <p className="text-gray-600 text-sm italic text-center pt-8">
                  No messages yet. Start the conversation below.
                </p>
              ) : (
                comments.map(c => <CommentBubble key={c.id} comment={c} />)
              )}
              <div ref={bottomRef} />
            </div>

            {/* Input */}
            <div className="border-t border-gray-800 px-5 py-3 flex flex-col gap-3 bg-gray-900/40">
              <textarea
                value={draft}
                onChange={e => setDraft(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Message… (⌘↵ to send)"
                rows={2}
                className="w-full bg-gray-950 border border-gray-800 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-600 resize-none focus:outline-none focus:border-gray-500 shadow-inner"
              />
              <div className="flex flex-wrap items-center justify-between gap-y-3">
                <div className="flex gap-2">
                  <button
                    onClick={openBug}
                    disabled={sending}
                    title="Report a bug — uses your draft text as the description and adds a regression test to test.md"
                    className="px-2 py-1 rounded border border-red-900/50 bg-red-950/20 text-red-400 text-[10px] font-medium hover:bg-red-900/40 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    Bug
                  </button>
                  <button
                    onClick={() => sendComment(undefined, undefined, false, 'brainstorm')}
                    disabled={sending}
                    title="Start a brainstorm dialogue"
                    className="px-2 py-1 rounded border border-violet-900/50 bg-violet-950/20 text-violet-400 text-[10px] font-medium hover:bg-violet-900/40 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    Brainstorm
                  </button>
                  <button
                    onClick={() => sendComment(undefined, 'plan', false, 'replan')}
                    disabled={sending}
                    title="Move back to planning to refine spec or plan"
                    className="px-2 py-1 rounded border border-indigo-900/50 bg-indigo-950/20 text-indigo-400 text-[10px] font-medium hover:bg-indigo-900/40 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    Replan
                  </button>
                  <button
                    onClick={() => setShowNewTrack(true)}
                    title="Open a new related track using draft text"
                    className="px-2 py-1 rounded border border-emerald-900/50 bg-emerald-950/20 text-emerald-400 text-[10px] font-medium hover:bg-emerald-900/40 transition-colors"
                  >
                    + New Track
                  </button>
                </div>

                <div className="flex gap-2 ml-auto">
                  <button
                    onClick={() => sendComment(undefined, undefined, true)}
                    disabled={!draft.trim() || sending}
                    title="Send as a note (won't trigger automation or wake workers)"
                    className="px-3 py-2 rounded-lg border border-gray-700 text-gray-400 text-[11px] font-medium hover:bg-gray-800 hover:text-gray-200 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                  >
                    Post Note
                  </button>
                  <button
                    onClick={() => sendComment()}
                    disabled={!draft.trim() || sending}
                    title="Send message and notify workers (⌘↵)"
                    className="px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-[11px] font-medium shadow-lg shadow-blue-900/20 transition-all flex items-center gap-1.5"
                  >
                    <span>Send</span>
                    <span className="text-[10px] opacity-60">⌘↵</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : tab === 'logs' ? (
          <div className="flex-1 overflow-y-auto px-5 py-4 bg-gray-900/50">
            {detail?.last_log_tail ? (
              <>
                <pre className="text-[11px] font-mono text-gray-400 whitespace-pre-wrap leading-relaxed">
                  {typeof detail.last_log_tail === 'string' ? detail.last_log_tail : JSON.stringify(detail.last_log_tail, null, 2)}
                </pre>
                <div ref={logsEndRef} />
              </>
            ) : (
              <p className="text-gray-600 text-sm italic pt-4">No logs available yet for this track.</p>
            )}
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto px-5 py-4">
            {loading ? (
              <div className="text-gray-500 text-sm">Loading…</div>
            ) : error ? (
              <div className="text-red-400 text-sm">Error: {error}</div>
            ) : tab === 'test' && !detail?.test ? (
              <p className="text-gray-600 text-sm italic pt-4">Tests not yet defined — run <code className="font-mono text-gray-500">/laneconductor plan {trackNumber}</code> to scaffold test.md.</p>
            ) : (
              <MarkdownRenderer content={detail?.[tab]} />
            )}
          </div>
        )}
        </div>
      </div>

      {showNewTrack && (
        <NewTrackModal
          projectId={projectId}
          projects={[]} // Passed from parent usually, but we might need to handle this
          tracks={[]} // Ideally we have all tracks for matching
          initialDescription={draft}
          onClose={() => setShowNewTrack(false)}
          onCreated={() => {
            setShowNewTrack(false);
            setDraft('');
          }}
        />
      )}
    </>
  );
}
