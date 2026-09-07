import React, { useEffect, useState } from 'react';
import { TranscriptView } from './TranscriptView.jsx';
import { TurnStatusBar } from './TurnStatusBar.jsx';
import { TrackChatComposer } from './TrackChatComposer.jsx';
import { CommentBubble } from './CommentBubble.jsx';
import { useTrackTranscript } from '../lib/useTrackTranscript.js';
import { useTrackComments } from '../lib/useTrackComments.js';
import { resolveWorkerChatTarget } from '../lib/workerTaskInfo.js';
import { isWorkerOffline } from '../lib/workerStatus.js';

// Track 10069 Phase 3 (REQ-1..REQ-5): one persistent Chat view with a
// target switcher, reusing every piece WorkerChatPanel/WorkerActivityLatch
// already built — no second renderer (D2, D6). The manager row resolves to
// a usable target once Phase 4's resolver lands; until then it behaves
// exactly like today's WorkerChatPanel (transcript-only, disabled
// composer) rather than a new dead end.

function targetLabel(worker) {
  if (worker.type === 'manager') return 'Manager';
  return worker.hostname || `Worker #${worker.worker_number ?? worker.id}`;
}

export function ChatView({ projectId, workers = [] }) {
  const manager = workers.find(w => w.type === 'manager');
  const nonManagerWorkers = workers.filter(w => w.type !== 'manager');
  const targets = [manager, ...nonManagerWorkers].filter(Boolean);

  const [selectedId, setSelectedId] = useState(null);

  // REQ-3: default target is the manager.
  useEffect(() => {
    if (selectedId != null) return;
    if (manager) setSelectedId(manager.id);
    else if (nonManagerWorkers.length > 0) setSelectedId(nonManagerWorkers[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manager?.id, nonManagerWorkers.length]);

  const selectedWorker = targets.find(w => w.id === selectedId) ?? null;
  const isManager = selectedWorker?.type === 'manager';
  const chatTarget = selectedWorker ? resolveWorkerChatTarget(selectedWorker, projectId) : null;

  const { blocks, turn, rawLog } = useTrackTranscript(chatTarget?.projectId, chatTarget?.trackNumber);
  const { comments, setComments } = useTrackComments(chatTarget?.projectId, chatTarget?.trackNumber);

  return (
    <div className="flex h-full min-h-0" data-testid="chat-view">
      <div className="w-56 shrink-0 border-r border-gray-800 overflow-y-auto" data-testid="chat-target-list">
        {targets.length === 0 ? (
          <p className="text-gray-600 text-sm italic p-4">No workers registered yet.</p>
        ) : targets.map(worker => {
          const online = !isWorkerOffline(worker);
          return (
            <button
              key={worker.id}
              onClick={() => setSelectedId(worker.id)}
              data-testid={`chat-target-${worker.id}`}
              className={`w-full flex items-center gap-2 px-3 py-2 text-left text-sm border-b border-gray-900 ${selectedId === worker.id ? 'bg-gray-800 text-white' : 'text-gray-400 hover:bg-gray-900'
                }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${online ? 'bg-green-500' : 'bg-gray-600'}`} />
              <span className="truncate">{targetLabel(worker)}</span>
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
                {targetLabel(selectedWorker)}
              </span>
            </div>
            <TurnStatusBar turn={turn} />
            <div className="flex-1 overflow-y-auto px-4 py-4">
              {isManager && !chatTarget ? (
                <p className="text-gray-600 text-sm italic pt-4">Managers are transcript-only — no track context to chat about in this pass.</p>
              ) : !chatTarget ? (
                <p className="text-gray-600 text-sm italic pt-4">This worker has no running or recent track — nothing to talk about yet.</p>
              ) : blocks.length > 0 ? (
                <TranscriptView blocks={blocks} />
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
            </div>

            <TrackChatComposer
              projectId={chatTarget?.projectId}
              trackNumber={chatTarget?.trackNumber}
              disabled={(isManager && !chatTarget) || !chatTarget}
              disabledHint={
                isManager
                  ? 'Managers are transcript-only'
                  : 'No track to talk about — this worker has no running or last-context track'
              }
              placeholder={`Message ${targetLabel(selectedWorker)}…`}
              onSent={(comment) => setComments(prev => [...prev, comment])}
            />
          </>
        )}
      </div>
    </div>
  );
}
