import React, { useState, useEffect, useRef } from 'react';

const LANE_BADGE = {
  plan: 'bg-indigo-900 text-indigo-300',
  backlog: 'bg-gray-700 text-gray-300',
  implement: 'bg-blue-900 text-blue-300',
  review: 'bg-amber-900 text-amber-300',
  'quality-gate': 'bg-purple-900 text-purple-300',
  done: 'bg-green-900 text-green-300',
};

const AUTHOR_STYLES = {
  human: { dot: 'bg-gray-400', label: 'You' },
  claude: { dot: 'bg-orange-400', label: 'Claude' },
  gemini: { dot: 'bg-blue-400', label: 'Gemini' },
};

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const s = Math.floor((Date.now() - new Date(dateStr)) / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

function InboxRow({ item, showProject, onSelect, onDismiss }) {
  const author = AUTHOR_STYLES[item.last_comment_author] ?? AUTHOR_STYLES.human;
  const badge = LANE_BADGE[item.lane_status] ?? LANE_BADGE.backlog;
  const preview = (item.last_comment_body ?? '').slice(0, 120);
  const truncated = (item.last_comment_body ?? '').length > 120;

  return (
    <div className="group relative w-full hover:bg-gray-800/60 transition-colors border-b border-gray-800/50 last:border-0">
      <button
        onClick={() => onSelect(item.project_id, item.track_number)}
        className="w-full text-left px-4 py-3 pr-12"
      >
        <div className="flex items-start justify-between gap-2 mb-1">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-xs font-mono text-gray-500 shrink-0">#{item.track_number}</span>
            <span className="text-sm font-medium text-gray-200 truncate">{item.title}</span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full shrink-0 font-medium ${badge}`}>
              {item.lane_status}
            </span>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {item.unreplied_count > 0 && (
              <span className="text-[10px] font-bold bg-orange-600 text-white rounded-full px-1.5 py-0.5 min-w-[18px] text-center">
                {item.unreplied_count}
              </span>
            )}
            <span className="text-[10px] text-gray-600">{timeAgo(item.last_comment_at)}</span>
          </div>
        </div>

        {showProject && item.project_name && (
          <div className="text-[10px] font-mono text-blue-500 font-bold uppercase tracking-tight mb-1">
            {item.project_name}
          </div>
        )}

        <div className="flex items-start gap-1.5">
          <span className={`w-1.5 h-1.5 rounded-full mt-1 shrink-0 ${author.dot}`} />
          <p className="text-xs text-gray-500 leading-relaxed">
            <span className="text-gray-400 font-medium">{author.label}:</span>{' '}
            {preview}{truncated && '…'}
          </p>
        </div>
      </button>

      <button
        onClick={(e) => {
          e.stopPropagation();
          onDismiss(item.project_id, item.track_number);
        }}
        className="absolute right-4 top-1/2 -translate-y-1/2 p-2 text-gray-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
        title="Dismiss from inbox"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 6h18"></path>
          <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path>
          <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path>
        </svg>
      </button>
    </div>
  );
}

export function InboxPanel({ projectId, onSelectTrack, onClose }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const pollRef = useRef(null);

  const fetchInbox = async () => {
    try {
      const url = projectId
        ? `/api/inbox?project_id=${projectId}`
        : '/api/inbox';
      const r = await fetch(url);
      if (!r.ok) return;
      const data = await r.json();
      setItems(data);
    } catch { }
    setLoading(false);
  };

  const handleDismiss = async (projId, trackNum) => {
    try {
      const r = await fetch(`/api/projects/${projId}/tracks/${trackNum}/dismiss`, {
        method: 'POST'
      });
      if (r.ok) {
        // Optimistic update
        setItems(prev => prev.filter(item => !(item.project_id === projId && item.track_number === trackNum)));
      }
    } catch (err) {
      console.error('Failed to dismiss inbox item:', err);
    }
  };

  useEffect(() => {
    setLoading(true);
    fetchInbox();
    pollRef.current = setInterval(fetchInbox, 5000);
    return () => clearInterval(pollRef.current);
  }, [projectId]);

  // Close on Escape
  useEffect(() => {
    const handler = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const showProject = !projectId;

  const awaitingReply = items.filter(i => i.unreplied_count > 0);
  const awaitingAI = items.filter(i => i.human_needs_reply);

  const isEmpty = awaitingReply.length === 0 && awaitingAI.length === 0;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/60 z-40" onClick={onClose} />

      {/* Panel */}
      <div className="fixed top-0 right-0 h-full w-full max-w-md bg-gray-950 border-l border-gray-800 z-50 flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <div>
            <h2 className="text-base font-semibold text-white">Inbox</h2>
            <p className="text-xs text-gray-500">Active conversations across tracks</p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-200 text-xl leading-none"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center h-32 text-gray-600 text-sm">
              Loading…
            </div>
          ) : isEmpty ? (
            <div className="flex items-center justify-center h-32">
              <p className="text-gray-600 text-sm italic">No active conversations</p>
            </div>
          ) : (
            <>
              {awaitingReply.length > 0 && (
                <div>
                  <div className="px-4 pt-3 pb-1">
                    <span className="text-[10px] uppercase tracking-wider font-bold text-orange-400">
                      Awaiting your reply
                    </span>
                  </div>
                  {awaitingReply.map(item => (
                    <InboxRow
                      key={item.track_id}
                      item={item}
                      showProject={showProject}
                      onSelect={onSelectTrack}
                      onDismiss={handleDismiss}
                    />
                  ))}
                </div>
              )}

              {awaitingAI.length > 0 && (
                <div>
                  <div className="px-4 pt-3 pb-1">
                    <span className="text-[10px] uppercase tracking-wider font-bold text-blue-400">
                      Awaiting AI
                    </span>
                  </div>
                  {awaitingAI.map(item => (
                    <InboxRow
                      key={item.track_id}
                      item={item}
                      showProject={showProject}
                      onSelect={onSelectTrack}
                      onDismiss={handleDismiss}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
