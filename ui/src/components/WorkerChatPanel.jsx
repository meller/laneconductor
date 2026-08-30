import { TranscriptView } from './TranscriptView.jsx';
import { TrackChatComposer } from './TrackChatComposer.jsx';
import { CommentBubble } from './CommentBubble.jsx';
import { useTrackTranscript } from '../lib/useTrackTranscript.js';
import { useTrackComments } from '../lib/useTrackComments.js';
import { resolveWorkerChatTarget } from '../lib/workerTaskInfo.js';

// Track 10037 Phase 3: a chat panel for ONE worker, openable from the
// strip and the Machine Workers view. Reuses the exact Live Transcript
// machinery WorkerActivityLatch (track 1087) already implements — no
// second transcript renderer — but the message input posts into the
// target track's conversation via the same comments endpoint the
// Conversation tab uses (REQ-5), not the dispatch-based worker mailbox.
//
// `forcedTrackNumber` lets the last-track chip (REQ-3) pin the chat to
// that specific track even when resolveWorkerChatTarget would otherwise
// prefer the worker's currently-running track.
export function WorkerChatPanel({ worker, projectId, forcedTrackNumber, onClose, onSelectTrack }) {
  const isManager = worker?.type === 'manager';

  const target = forcedTrackNumber
    ? {
      trackNumber: forcedTrackNumber,
      projectId: worker?.last_track_project_id ?? worker?.project_id ?? projectId,
      source: 'last',
    }
    : resolveWorkerChatTarget(worker, projectId);

  const { blocks, rawLog } = useTrackTranscript(target?.projectId, target?.trackNumber);
  const { comments, setComments } = useTrackComments(target?.projectId, target?.trackNumber);

  const hostname = worker?.hostname || 'worker';

  return (
    <>
      <div className="fixed inset-0 bg-black/60 z-40" onClick={onClose} />
      <div className="fixed top-0 right-0 h-full w-full max-w-2xl bg-gray-950 border-l border-gray-800 z-50 flex flex-col shadow-2xl" data-testid="worker-chat-panel">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 shrink-0">
          <div className="flex flex-col min-w-0">
            <span className="text-xs font-semibold text-gray-300 uppercase tracking-wider truncate">
              Chat with {hostname}
            </span>
            {target ? (
              <button
                onClick={() => onSelectTrack?.(target.projectId, target.trackNumber)}
                className="text-[11px] text-blue-400 hover:text-blue-300 hover:underline text-left mt-0.5 w-fit"
                data-testid="worker-chat-track-link"
              >
                Talking to {hostname} about track #{target.trackNumber} ↗
              </button>
            ) : (
              <span className="text-[11px] text-gray-500 mt-0.5" data-testid="worker-chat-no-target">
                No track context
              </span>
            )}
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-200 text-sm leading-none shrink-0 ml-3">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          {isManager ? (
            <p className="text-gray-600 text-sm italic pt-4">Managers are transcript-only — no track context to chat about in this pass.</p>
          ) : !target ? (
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
          projectId={target?.projectId}
          trackNumber={target?.trackNumber}
          disabled={isManager || !target}
          disabledHint={
            isManager
              ? 'Managers are transcript-only'
              : 'No track to talk about — this worker has no running or last-context track'
          }
          placeholder={`Send a message about track #${target?.trackNumber}…`}
          onSent={(comment) => setComments(prev => [...prev, comment])}
        />
      </div>
    </>
  );
}
