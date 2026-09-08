import React, { useEffect, useState, useRef } from 'react';
import { TranscriptView } from './TranscriptView.jsx';
import { TurnStatusBar } from './TurnStatusBar.jsx';
import { TrackChatComposer } from './TrackChatComposer.jsx';
import { CommentBubble } from './CommentBubble.jsx';
import { useApi } from '../hooks/useApi.js';
import { useTrackTranscript } from '../lib/useTrackTranscript.js';
import { useTrackComments } from '../lib/useTrackComments.js';
import { parseWorkerTask, resolveWorkerChatTarget, resolveTargetRunLiveness } from '../lib/workerTaskInfo.js';
import { isWorkerOffline } from '../lib/workerStatus.js';

// Track 10069 Phase 3 (REQ-1..REQ-5): one persistent Chat view with a
// target switcher, reusing every piece WorkerChatPanel/WorkerActivityLatch
// already built — no second renderer (D2, D6). Phase 4 (REQ-25) made
// resolveWorkerChatTarget return a usable target for the manager, so this
// view needs no manager-specific branch at all — same path as any worker.
//
// Phase 4b: Worker target labeling with active/last track context &
// ChatView scroll/pagination UX.

export function targetLabel(worker, tracks = []) {
  if (!worker) return '';
  if (worker.type === 'manager') return 'Manager';
  const baseName = worker.hostname || `Worker #${worker.worker_number ?? worker.id}`;

  const task = parseWorkerTask(worker.current_task);
  if (task?.kind === 'track') {
    const t = tracks.find(track => String(track.track_number) === String(task.trackNumber));
    const title = t?.title ? `: ${t.title}` : '';
    return `${baseName} (Track ${task.trackNumber}${title})`;
  }
  if (task?.kind === 'deploy') {
    return `${baseName} (deploy #${task.dispatchId})`;
  }
  if (task?.kind === 'create-project') {
    return `${baseName} (create-project #${task.dispatchId})`;
  }

  if (worker.last_track_number) {
    const t = tracks.find(track => String(track.track_number) === String(worker.last_track_number));
    const title = t?.title ? `: ${t.title}` : (worker.last_track_title ? `: ${worker.last_track_title}` : '');
    return `${baseName} (last: Track ${worker.last_track_number}${title})`;
  }

  return `${baseName} (idle)`;
}

const DEFAULT_PAGE_SIZE = 30;

export function ChatView({ projectId, workers = [], tracks = [] }) {
  const { apiFetch } = useApi();
  const [gaps, setGaps] = useState([]);
  const [advisoryDismissed, setAdvisoryDismissed] = useState(false);

  // Track 10069 Phase 7 (REQ-17..REQ-19): fetch state and setup gaps
  useEffect(() => {
    let cancelled = false;
    const url = projectId ? `/api/state?project_id=${projectId}` : '/api/state';
    apiFetch(url)
      .then(res => res && res.ok ? res.json() : null)
      .then(data => {
        if (!cancelled && data?.gaps) {
          setGaps(data.gaps);
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [projectId, apiFetch]);

  const blockingGaps = gaps.filter(g => g.severity === 'blocking');
  const advisoryGaps = gaps.filter(g => g.severity === 'advisory');

  const manager = workers.find(w => w.type === 'manager');
  const nonManagerWorkers = workers.filter(w => w.type !== 'manager');
  const targets = [manager, ...nonManagerWorkers].filter(Boolean);

  const [selectedId, setSelectedId] = useState(null);
  const [visibleBlocksCount, setVisibleBlocksCount] = useState(DEFAULT_PAGE_SIZE);
  const scrollContainerRef = useRef(null);
  const messagesEndRef = useRef(null);

  // REQ-3: default target is the manager.
  useEffect(() => {
    if (selectedId != null) return;
    if (manager) setSelectedId(manager.id);
    else if (nonManagerWorkers.length > 0) setSelectedId(nonManagerWorkers[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manager?.id, nonManagerWorkers.length]);

  const selectedWorker = targets.find(w => w.id === selectedId) ?? null;
  const chatTarget = selectedWorker ? resolveWorkerChatTarget(selectedWorker, projectId) : null;

  const { blocks, turn, rawLog } = useTrackTranscript(chatTarget?.projectId, chatTarget?.trackNumber);
  const { comments, setComments } = useTrackComments(chatTarget?.projectId, chatTarget?.trackNumber);

  const runLiveness = resolveTargetRunLiveness({
    target: chatTarget,
    workers,
    tracks,
    turn,
  });

  // Track 10079 (REQ-19): the Stop control's liveness comes SOLELY from
  // resolveTargetRunLiveness — the same computation the rest of this view
  // already relies on — never a second liveness check of its own.
  const [aborting, setAborting] = useState(false);
  const [abortError, setAbortError] = useState(null);

  useEffect(() => {
    setAborting(false);
    setAbortError(null);
  }, [selectedId]);

  const handleAbort = async () => {
    if (!chatTarget?.projectId || !chatTarget?.trackNumber) return;
    setAborting(true);
    setAbortError(null);
    try {
      const res = await apiFetch(`/api/projects/${chatTarget.projectId}/tracks/${chatTarget.trackNumber}/abort`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      if (res.status === 409) {
        // REQ-20/AC-9: a 409 means nothing is running — informational, not
        // an error the click itself caused.
        setAbortError('Nothing is running');
      } else if (!res.ok) {
        const data = await res.json().catch(() => null);
        setAbortError(data?.error || `Failed to stop (${res.status})`);
      }
      // 202: no error to surface — the board reflects the park once the
      // worker's own exit handler and the next poll/broadcast land.
    } catch (err) {
      setAbortError(err.message || 'Failed to stop');
    } finally {
      setAborting(false);
    }
  };

  // Reset pagination and scroll to bottom when switching target
  useEffect(() => {
    setVisibleBlocksCount(DEFAULT_PAGE_SIZE);
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
    }
  }, [selectedId]);

  // Auto-scroll to bottom when new content arrives
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [blocks.length, comments.length]);

  const hasOlderBlocks = blocks.length > visibleBlocksCount;
  const displayedBlocks = hasOlderBlocks ? blocks.slice(blocks.length - visibleBlocksCount) : blocks;

  return (
    <div className="flex h-full min-h-0" data-testid="chat-view">
      <div className="w-64 shrink-0 border-r border-gray-800 overflow-y-auto" data-testid="chat-target-list">
        {targets.length === 0 ? (
          <p className="text-gray-600 text-sm italic p-4">No workers registered yet.</p>
        ) : targets.map(worker => {
          const online = !isWorkerOffline(worker);
          const label = targetLabel(worker, tracks);
          return (
            <button
              key={worker.id}
              onClick={() => setSelectedId(worker.id)}
              data-testid={`chat-target-${worker.id}`}
              title={label}
              className={`w-full flex items-center gap-2 px-3 py-2 text-left text-sm border-b border-gray-900 ${selectedId === worker.id ? 'bg-gray-800 text-white' : 'text-gray-400 hover:bg-gray-900'
                }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${online ? 'bg-green-500' : 'bg-gray-600'}`} />
              <span className="truncate">{label}</span>
            </button>
          );
        })}
      </div>

      <div className="flex-1 flex flex-col min-w-0">
        {!selectedWorker ? (
          <p className="text-gray-600 text-sm italic p-4">Select a target to start chatting.</p>
        ) : (
          <>
            <div className="px-4 py-3 border-b border-gray-800 shrink-0">
              <span className="text-xs font-semibold text-gray-300 uppercase tracking-wider">
                {targetLabel(selectedWorker, tracks)}
              </span>
            </div>
            <TurnStatusBar
              turn={turn}
              canAbort={runLiveness.isLive}
              onAbort={handleAbort}
              aborting={aborting}
              abortError={abortError}
            />
            {advisoryGaps.length > 0 && !advisoryDismissed && (
              <div className="bg-blue-950/40 border-b border-blue-900/60 px-4 py-2 flex items-center justify-between text-xs text-blue-200 shrink-0" data-testid="advisory-gaps-note">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <span>ℹ️</span>
                  <span className="truncate">
                    {advisoryGaps.map(g => `${g.subject}: ${g.remedy}`).join(' | ')}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setAdvisoryDismissed(true)}
                  className="text-blue-400 hover:text-blue-200 text-xs ml-3 shrink-0"
                  data-testid="dismiss-advisory-gaps"
                >
                  ✕ Dismiss
                </button>
              </div>
            )}
            <div ref={scrollContainerRef} className="flex-1 overflow-y-auto px-4 py-4" data-testid="chat-scroll-container">
              {blockingGaps.length > 0 && (
                <div className="bg-amber-950/40 border border-amber-800/80 rounded-lg p-4 mb-4" data-testid="wizard-opening-message">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-amber-400 font-semibold text-sm">⚠️ Setup Incomplete</span>
                  </div>
                  <p className="text-gray-300 text-xs mb-3">
                    The following blocking setup gaps were detected. Follow the remedies below to complete setup:
                  </p>
                  <div className="space-y-2">
                    {blockingGaps.map(gap => (
                      <div key={gap.id} className="bg-black/40 border border-amber-900/50 rounded p-2.5 text-xs">
                        <div className="font-medium text-amber-200">{gap.subject}</div>
                        <div className="text-gray-400 mt-0.5">{gap.detail}</div>
                        <div className="text-blue-400 font-mono text-[11px] mt-1.5 bg-gray-950/60 p-1.5 rounded">
                          Remedy: {gap.remedy}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {!chatTarget ? (
                <p className="text-gray-600 text-sm italic pt-4">This worker has no running or recent track — nothing to talk about yet.</p>
              ) : (
                <>
                  {hasOlderBlocks && (
                    <div className="flex justify-center mb-4">
                      <button
                        type="button"
                        onClick={() => setVisibleBlocksCount(prev => prev + DEFAULT_PAGE_SIZE)}
                        className="text-xs text-blue-400 hover:text-blue-300 bg-gray-800 hover:bg-gray-700 px-3 py-1.5 rounded border border-gray-700 transition"
                        data-testid="load-older-messages"
                      >
                        ↑ Load older messages ({blocks.length - visibleBlocksCount} remaining)
                      </button>
                    </div>
                  )}

                  {displayedBlocks.length > 0 ? (
                    <TranscriptView blocks={displayedBlocks} />
                  ) : rawLog ? (
                    <pre className="text-xs font-mono bg-black/30 p-3 rounded border border-gray-800 text-gray-300 whitespace-pre-wrap max-h-[500px] overflow-y-auto">
                      {rawLog}
                    </pre>
                  ) : (
                    <p className="text-gray-600 text-sm italic pt-4">No transcript yet.</p>
                  )}

                  {comments.length > 0 && (
                    <div className="mt-4 space-y-3 border-t border-gray-800 pt-4">
                      {comments.map(c => <CommentBubble key={c.id} comment={c} />)}
                    </div>
                  )}
                  <div ref={messagesEndRef} data-testid="chat-scroll-bottom" />
                </>
              )}
            </div>

            <TrackChatComposer
              projectId={chatTarget?.projectId}
              trackNumber={chatTarget?.trackNumber}
              disabled={!chatTarget}
              disabledHint="No track to talk about — this worker has no running or last-context track"
              placeholder={`Message ${targetLabel(selectedWorker, tracks)}…`}
              onSent={(comment) => setComments(prev => [...prev, comment])}
              isLiveTurn={runLiveness.isLive}
              liveAction={runLiveness.action}
            />
          </>
        )}
      </div>
    </div>
  );
}
