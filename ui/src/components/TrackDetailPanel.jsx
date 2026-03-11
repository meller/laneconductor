import React, { useState, useEffect, useRef } from 'react';
import { MarkdownRenderer } from './MarkdownRenderer.jsx';
import { DevServerButton } from './DevServerButton.jsx';

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
  const initialTabSet = useRef(!!initialTab);

  // Fetch track detail
  const fetchDetail = () => {
    fetch(`/api/projects/${projectId}/tracks/${trackNumber}`)
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

  // Poll comments every 2s; auto-switch to Conversation on first load if comments exist
  useEffect(() => {
    async function fetchComments() {
      try {
        const r = await fetch(`/api/projects/${projectId}/tracks/${trackNumber}/comments`);
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
      const r = await fetch(`/api/projects/${projectId}/tracks/${trackNumber}/open-bug`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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

  async function sendComment(textOverride, newLaneStatus, noWake = false) {
    const isEvent = typeof textOverride === 'object' && textOverride !== null;
    const isMissing = textOverride === undefined;
    const bodyStr = isEvent || isMissing ? draft : textOverride;
    const body = bodyStr.trim();

    if (!body || sending) return;
    setSending(true);
    try {
      const r = await fetch(`/api/projects/${projectId}/tracks/${trackNumber}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ author: 'human', body, no_wake: noWake }),
      });
      if (r.ok) {
        const comment = await r.json();
        setComments(prev => [...prev, comment]);
        if (isEvent || isMissing) {
          setDraft('');
        }
      }

      if (typeof newLaneStatus === 'string') {
        const pr = await fetch(`/api/projects/${projectId}/tracks/${trackNumber}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
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

      {/* Panel */}
      <div className="fixed top-0 right-0 h-full w-full max-w-2xl bg-gray-950 border-l border-gray-800 z-50 flex flex-col shadow-2xl">
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
                {/* Dev Server Status */}
                {(detail.lane_status === 'review' || detail.lane_status === 'implement') && (
                  <div className="mt-2 pt-2 border-t border-gray-700 flex items-center gap-2">
                    <span className="text-xs text-gray-600">Dev Server:</span>
                    <DevServerButton projectId={projectId} devUrl={detail.dev_url} />
                  </div>
                )}
              </>
            ) : (
              <div className="text-gray-400 text-sm">Track #{trackNumber}</div>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-200 text-xl leading-none mt-0.5 shrink-0"
          >
            ✕
          </button>
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

            {/* Conversation Actions Toolbar */}
            <div className="px-5 py-2 border-t border-gray-800 bg-gray-900/30 flex items-center justify-between gap-3">
              <span className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">Quick Actions</span>
              <div className="flex gap-2">
                <button
                  onClick={openBug}
                  disabled={sending}
                  title="Report a bug — uses your draft text as the description and adds a regression test to test.md"
                  className="px-2 py-1 rounded border border-red-900/50 bg-red-950/20 text-red-400 text-[10px] font-medium hover:bg-red-900/30 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  Open Bug
                </button>
                <button
                  onClick={() => sendComment(`I can create a feature request for this.`, 'plan')}
                  className="px-2 py-1 rounded border border-blue-900/50 bg-blue-950/20 text-blue-400 text-[10px] font-medium hover:bg-blue-900/30 transition-colors"
                >
                  Open Feature
                </button>
                <button
                  onClick={() => sendComment('> **system**: Brainstorm requested via UI. Read all context files (product.md, tech-stack.md, spec.md, plan.md, test.md) and begin clarifying questions one at a time.')}
                  disabled={detail?.lane === 'done'}
                  title="Start a brainstorm dialogue to deepen spec and plan before implementing"
                  className="px-2 py-1 rounded border border-violet-900/50 bg-violet-950/20 text-violet-400 text-[10px] font-medium hover:bg-violet-900/30 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  Brainstorm
                </button>
              </div>
            </div>

            {/* Input */}
            <div className="border-t border-gray-800 px-5 py-3 flex flex-col gap-2 bg-gray-900/40">
              <textarea
                value={draft}
                onChange={e => setDraft(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Message… (⌘↵ to send)"
                rows={2}
                className="w-full bg-gray-950 border border-gray-800 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-600 resize-none focus:outline-none focus:border-gray-500 shadow-inner"
              />
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => sendComment(undefined, undefined, true)}
                  disabled={!draft.trim() || sending}
                  title="Send as a note (won't trigger automation or wake workers)"
                  className="px-3 py-2 rounded-lg border border-gray-700 text-gray-400 text-sm font-medium hover:bg-gray-800 hover:text-gray-200 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                >
                  Post Note
                </button>
                <button
                  onClick={() => sendComment()}
                  disabled={!draft.trim() || sending}
                  title="Send message and notify workers (⌘↵)"
                  className="px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium shadow-lg shadow-blue-900/20 transition-all flex items-center gap-1.5"
                >
                  <span>Send</span>
                  <span className="text-[10px] opacity-60">⌘↵</span>
                </button>
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
    </>
  );
}
