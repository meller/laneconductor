import React, { useState, useEffect, useRef } from 'react';
import { useApi } from '../hooks/useApi.js';
import { LANES } from './KanbanBoard.jsx';

// Track 1121 Phase 4: the mobile home screen. On a phone the job is
// monitoring autonomous agents, not re-planning, so this leads with what's
// blocked and what's running rather than the full board.
//
// "Needs your input" reads GET /api/inbox's own `bucket` field — the same
// endpoint and classification InboxPanel.jsx already uses (track 10012).
// This intentionally does NOT re-derive severity from comment text; a
// second classifier here would drift from the server's the moment either
// one changes. The `?? item.bucket` fallback below only covers an inbox
// response missing the field entirely (mirrors InboxPanel's own defensive
// fallback) — it never overrides a bucket the server actually sent.
function bucketOf(item) {
  return item.bucket ?? 'recent_activity';
}

export function MobileFocusView({ projectId, tracks, onSelectTrack, onGoToLane }) {
  const { apiFetch } = useApi();
  const [inboxItems, setInboxItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const pollRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    async function fetchInbox() {
      try {
        const url = projectId ? `/api/inbox?project_id=${projectId}` : '/api/inbox';
        const r = await apiFetch(url);
        if (!r.ok || cancelled) return;
        const data = await r.json();
        if (!cancelled) setInboxItems(data);
      } catch {
        // keep last-known items on a transient fetch failure
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    setLoading(true);
    fetchInbox();
    pollRef.current = setInterval(fetchInbox, 5000);
    return () => { cancelled = true; clearInterval(pollRef.current); };
  }, [projectId]);

  const needsInput = inboxItems.filter(i => bucketOf(i) === 'needs_input' || bucketOf(i) === 'awaiting_ai');
  const running = (tracks || []).filter(t => t.lane_action_status === 'running');
  const pipeline = LANES.map(lane => ({
    ...lane,
    count: (tracks || []).filter(t => t.lane_status === lane.id).length,
  }));

  return (
    <div className="flex flex-col gap-6" data-testid="mobile-focus-view">
      <section data-testid="focus-needs-input">
        <h2 className="text-xs font-semibold text-gray-300 uppercase tracking-wider mb-2">
          Needs your input
        </h2>
        {loading ? (
          <p className="text-xs text-gray-600">Loading…</p>
        ) : needsInput.length === 0 ? (
          <p className="text-xs text-gray-600 italic" data-testid="focus-needs-input-empty">
            Nothing needs you right now.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {needsInput.map(item => (
              <button
                key={`${item.project_id}-${item.track_number}`}
                onClick={() => onSelectTrack(item.project_id, item.track_number, { conversation: true })}
                data-testid={`focus-needs-input-${item.track_number}`}
                className="text-left rounded-lg border border-amber-800/50 bg-amber-900/10 px-3 py-2.5 min-h-11"
              >
                <div className="flex items-center gap-2 text-xs">
                  <span className="font-mono text-gray-500">#{item.track_number}</span>
                  <span className="text-gray-200 font-medium truncate">{item.title}</span>
                </div>
                {item.last_comment_body && (
                  <p className="text-[11px] text-gray-500 mt-1 line-clamp-2">{item.last_comment_body}</p>
                )}
              </button>
            ))}
          </div>
        )}
      </section>

      <section data-testid="focus-running">
        <h2 className="text-xs font-semibold text-gray-300 uppercase tracking-wider mb-2">
          Running now
        </h2>
        {running.length === 0 ? (
          <p className="text-xs text-gray-600 italic" data-testid="focus-running-empty">
            No lane actions running right now.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {running.map(track => (
              <button
                key={track.id ?? track.track_number}
                onClick={() => onSelectTrack(track.project_id, track.track_number)}
                data-testid={`focus-running-${track.track_number}`}
                className="text-left rounded-lg border border-blue-800/50 bg-blue-900/10 px-3 py-2.5 min-h-11"
              >
                <div className="flex items-center gap-2 text-xs">
                  <span className="font-mono text-gray-500">#{track.track_number}</span>
                  <span className="text-gray-200 font-medium truncate">{track.title}</span>
                  <span className="ml-auto text-blue-400">{track.lane_status}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </section>

      <section data-testid="focus-pipeline">
        <h2 className="text-xs font-semibold text-gray-300 uppercase tracking-wider mb-2">
          Pipeline
        </h2>
        <div className="flex flex-col gap-1">
          {pipeline.map(lane => (
            <button
              key={lane.id}
              onClick={() => onGoToLane(lane.id)}
              data-testid={`focus-pipeline-${lane.id}`}
              className="flex items-center justify-between px-3 min-h-11 rounded-lg hover:bg-gray-900"
            >
              <span className={`text-xs font-semibold uppercase tracking-wide ${lane.color}`}>{lane.label}</span>
              <span className="text-xs bg-gray-800 px-2 py-0.5 rounded-full text-gray-400">{lane.count}</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
