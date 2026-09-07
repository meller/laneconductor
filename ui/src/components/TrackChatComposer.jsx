import { useCallback, useEffect, useState } from 'react';
import { useApi } from '../hooks/useApi.js';
import { useWebSocket } from '../hooks/useWebSocket.js';

// Track 10037 Phase 3 Task 3: posts through the SAME endpoint the
// Conversation tab uses (POST .../comments, author: 'human') — not a new
// worker mailbox. The API writes straight into conversation.md, and the
// worker's existing waiting_for_reply/--resume path wakes the agent from
// there; this component has nothing further to do once the POST succeeds.
//
// Track 10069 Phase 6 (REQ-9..REQ-11): queued intervention semantics.
// When sending during a live turn, display queued state naming what it is
// waiting on (REQ-9) rather than an unqualified 'Sending…'. Cleared when
// reply turn picks the message up via WS event (REQ-10). UI wording makes
// clear the message does not interrupt the active turn (REQ-11).
export function TrackChatComposer({
  projectId,
  trackNumber,
  disabled,
  disabledHint,
  placeholder,
  onSent,
  isLiveTurn = false,
  liveAction = null,
}) {
  const { apiFetch } = useApi();
  const [value, setValue] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const [queuedState, setQueuedState] = useState({ isQueued: false, action: null });

  // REQ-10: Clear queued state when the reply turn picks the message up,
  // driven by existing WS events rather than a new poll.
  const onWsMessage = useCallback((msg) => {
    if (msg.event === 'session:event') {
      if (!trackNumber || String(msg.data?.trackNumber) !== String(trackNumber)) return;
      if (queuedState.isQueued) {
        setQueuedState({ isQueued: false, action: null });
      }
    }
  }, [trackNumber, queuedState.isQueued]);
  useWebSocket(onWsMessage);

  // Reset queued state on target switch
  useEffect(() => {
    setQueuedState({ isQueued: false, action: null });
  }, [projectId, trackNumber]);

  const isDisabled = disabled || !projectId || !trackNumber;

  async function handleSubmit(e) {
    e.preventDefault();
    const body = value.trim();
    if (!body || isDisabled || sending) return;
    const wasLiveWhenSent = isLiveTurn;
    const actionWhenSent = liveAction;
    setSending(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/projects/${projectId}/tracks/${trackNumber}/comments`, {
        method: 'POST',
        body: JSON.stringify({ author: 'human', body }),
      });
      if (!res.ok) throw new Error((await res.text()) || 'Failed to send message');
      const comment = await res.json();
      setValue('');
      if (wasLiveWhenSent) {
        setQueuedState({ isQueued: true, action: actionWhenSent || 'turn' });
      }
      onSent?.(comment);
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  }

  let sendButtonLabel = 'Send';
  if (sending) {
    sendButtonLabel = isLiveTurn
      ? (liveAction ? `Queueing (${liveAction})…` : 'Queueing…')
      : 'Sending…';
  }

  return (
    <div className="p-3 border-t border-gray-800 bg-gray-900/50 shrink-0">
      <form onSubmit={handleSubmit} className="flex gap-2 items-center">
        <input
          type="text"
          value={value}
          onChange={e => setValue(e.target.value)}
          placeholder={isDisabled ? (disabledHint || 'No track context to talk about') : (placeholder || 'Message the worker…')}
          disabled={isDisabled || sending}
          data-testid="worker-chat-input"
          className="flex-1 bg-gray-950 border border-gray-800 rounded px-3 py-1.5 text-xs text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={isDisabled || !value.trim() || sending}
          data-testid="worker-chat-send"
          className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-800 text-white rounded text-xs font-medium transition-colors shrink-0"
        >
          {sendButtonLabel}
        </button>
      </form>
      {isDisabled && disabledHint && (
        <p className="text-gray-600 text-[11px] mt-1.5 italic" data-testid="worker-chat-disabled-hint">{disabledHint}</p>
      )}
      {queuedState.isQueued && (
        <p className="text-amber-400 text-xs mt-1.5 flex items-center gap-1.5" data-testid="composer-queued-notice">
          <span>⏳</span>
          <span>Queued — waiting for &quot;{queuedState.action}&quot; to finish. Will not interrupt active turn.</span>
        </p>
      )}
      {!queuedState.isQueued && isLiveTurn && (
        <p className="text-gray-500 text-[11px] mt-1.5 italic" data-testid="composer-live-hint">
          Target is currently running &quot;{liveAction || 'turn'}&quot;. New messages will be queued and answered next.
        </p>
      )}
      {error && <p className="text-red-400 text-xs mt-1.5" data-testid="worker-chat-error">{error}</p>}
    </div>
  );
}
