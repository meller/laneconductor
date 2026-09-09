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

// Mirrors conductor/services/manager-pseudo-track.mjs's MANAGER_PSEUDO_TRACK
// constant — that module also does Node fs/path I/O elsewhere in the file
// (despite its header claiming "pure, no I/O"), so it can't be imported into
// the browser bundle; resolveWorkerChatTarget already returns this same
// literal as trackNumber for the manager, so this is consistent with what's
// already on the wire, not a second independent definition drifting apart.
const MANAGER_PSEUDO_TRACK = 'manager';

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

export function ChatView({ projectId, workers = [], tracks = [], pendingSeed = null, onSeedConsumed, targetProjectIdOverride = null }) {
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

  // Track 1091 Phase 7: the manager's pseudo-track conversation lives inside
  // ONE fixed repo (the meta project) — the manager itself is a single,
  // project-independent entity (project_id: null), not "per project", so
  // its conversation must be the same regardless of which project happens
  // to be selected in the picker. Originally this fallback only kicked in
  // when NO project was selected at all, which fixed the plain-Chat-tab
  // dead end but left a worse bug: picking Manager while a REAL project was
  // selected silently pointed resolveWorkerChatTarget at that project's own
  // repo (which has no conductor/tracks/manager/ folder at all), showing an
  // empty transcript with no error. Now the meta-project fallback applies
  // whenever the manager is selected, full stop — `projectId` (whatever's
  // selected in the picker) is never used for the manager, only for every
  // other, genuinely per-project worker.
  const [metaFallbackId, setMetaFallbackId] = useState(null);
  const needsMetaFallback = selectedWorker?.type === 'manager' && targetProjectIdOverride == null;
  useEffect(() => {
    if (!needsMetaFallback || metaFallbackId != null) return;
    let cancelled = false;
    apiFetch('/api/meta-project/ensure', { method: 'POST' })
      .then(res => res.ok ? res.json() : null)
      .then(data => { if (!cancelled && data?.id) setMetaFallbackId(data.id); })
      .catch(() => { /* best-effort — falls back to the existing "no track" message */ });
    return () => { cancelled = true; };
  }, [needsMetaFallback, metaFallbackId, apiFetch]);

  // Track 1091 Phase 7: the manager always resolves against the meta
  // project (or an explicit override, e.g. "Create with chat" — which
  // happens to point at the same meta project anyway) regardless of
  // whatever real project is selected in the picker; every other worker
  // keeps using the selected project as before.
  const chatTarget = selectedWorker
    ? resolveWorkerChatTarget(
        selectedWorker,
        selectedWorker.type === 'manager' ? (targetProjectIdOverride ?? metaFallbackId) : (targetProjectIdOverride ?? projectId)
      )
    : null;

  const { blocks, turn, rawLog } = useTrackTranscript(chatTarget?.projectId, chatTarget?.trackNumber);
  const { comments, setComments } = useTrackComments(chatTarget?.projectId, chatTarget?.trackNumber);

  // Track 1091 Phase 7: "Create with chat" seeds an opening message once a
  // target (the manager, by REQ-3's own default-selection effect above) is
  // resolved and ready to receive it. Same endpoint TrackChatComposer posts
  // through — this is not a new send path, just an automatic first send.
  // The sentRef guard is required, not cosmetic: this effect's own deps
  // include chatTarget fields that are ready as soon as the manager is
  // selected (typically render 1-2), so without it a normal re-render
  // would re-fire the POST.
  const seedSentRef = useRef(false);
  useEffect(() => {
    if (!pendingSeed || !chatTarget?.projectId || !chatTarget?.trackNumber) return;
    if (seedSentRef.current) return;
    seedSentRef.current = true;
    apiFetch(`/api/projects/${chatTarget.projectId}/tracks/${chatTarget.trackNumber}/comments`, {
      method: 'POST',
      body: JSON.stringify({ author: 'human', body: pendingSeed }),
    })
      .then(res => res.ok ? res.json() : null)
      .then(comment => { if (comment) setComments(prev => [...prev, comment]); })
      .catch(() => { /* best-effort — the composer remains available to retype it */ })
      .finally(() => onSeedConsumed?.());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingSeed, chatTarget?.projectId, chatTarget?.trackNumber]);

  const runLiveness = resolveTargetRunLiveness({
    target: chatTarget,
    workers,
    tracks,
    turn,
  });

  // A regular user watching an idle-looking chat after sending a message has
  // no way to tell "the target hasn't noticed yet" from "silently broken" —
  // isLiveTurn only covers an in-progress turn, not the gap before one
  // starts. Comparing comment timestamps against the transcript's turn
  // timestamps doesn't work: the manager pseudo-track has no real per-turn
  // clock (conversation.md carries no timestamps at all — the API fabricates
  // one by counting backward from the file's mtime in 1-second steps, purely
  // to keep historical turns from all reading as "just now"), so it can't be
  // compared against the transcript's real wall-clock turn timestamps.
  // Instead, reuse each track type's own authoritative "still needs a
  // response" signal: the manager pseudo-track answers a human message with
  // a new comment on this exact same list (verified live — the CLI posts its
  // reply via `/laneconductor comment manager`), so the last comment's
  // author says it all; a numbered track already tracks this in its own
  // `waiting_for_reply` DB column (Track 10012), flipped by the worker's
  // own resume/reply path.
  const lastComment = comments[comments.length - 1];
  const matchedTrack = chatTarget?.trackNumber !== MANAGER_PSEUDO_TRACK && Array.isArray(tracks)
    ? tracks.find(t => String(t.track_number) === String(chatTarget?.trackNumber))
    : null;
  const awaitingReply = !runLiveness.isLive && (
    chatTarget?.trackNumber === MANAGER_PSEUDO_TRACK
      ? lastComment?.author === 'human'
      : !!matchedTrack?.waiting_for_reply
  );

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
            <TurnStatusBar turn={turn} />
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
              awaitingReply={awaitingReply}
            />
          </>
        )}
      </div>
    </div>
  );
}
