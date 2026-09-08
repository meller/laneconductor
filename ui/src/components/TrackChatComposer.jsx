import { useCallback, useEffect, useRef, useState } from 'react';
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

// liveAction comes through as whatever the underlying signal happened to be
// named with — a lane command ('plan', 'review'), a raw worker status
// ('busy'), or an already-human activity string ('Thinking…'). Capitalizing
// only the ones that need it (an activity string is already capitalized)
// keeps the sentence reading naturally regardless of which one it is.
function formatLiveAction(action) {
  if (!action) return 'Working';
  return action.charAt(0).toUpperCase() + action.slice(1);
}

export function TrackChatComposer({
  projectId,
  trackNumber,
  disabled,
  disabledHint,
  placeholder,
  onSent,
  isLiveTurn = false,
  liveAction = null,
  awaitingReply = false,
}) {
  const { apiFetch } = useApi();
  const [value, setValue] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const [queuedState, setQueuedState] = useState({ isQueued: false, action: null });
  const textareaRef = useRef(null);

  // A single-line <input> made anything longer than a short sentence
  // unusable — found live pasting a multi-page PRD in, which just scrolled
  // off both ends with no way to see or edit it. Auto-grow up to a capped
  // height (then scroll internally) so short messages stay compact but long
  // pastes are actually readable before sending.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, [value]);

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
      if (textareaRef.current) textareaRef.current.style.height = 'auto';
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
      <form onSubmit={handleSubmit} className="flex gap-2 items-end">
        <textarea
          ref={textareaRef}
          rows={3}
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => {
            // Enter sends (matches every chat app users already know);
            // Shift+Enter inserts a newline for anything multi-paragraph.
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
          placeholder={isDisabled ? (disabledHint || 'No track context to talk about') : (placeholder || 'Message the worker… (Shift+Enter for a new line)')}
          disabled={isDisabled || sending}
          data-testid="worker-chat-input"
          className="flex-1 bg-gray-950 border border-gray-800 rounded px-3 py-1.5 text-xs text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500 disabled:opacity-50 resize-none overflow-y-auto leading-relaxed"
          style={{ maxHeight: 240 }}
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
        <p className="text-blue-300 text-xs mt-1.5 flex items-center gap-2 bg-blue-950/30 border border-blue-900/50 rounded px-2 py-1" data-testid="composer-live-hint">
          <span className="relative flex h-2 w-2 shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-400" />
          </span>
          <span>
            <span className="font-semibold">{formatLiveAction(liveAction)}</span> right now — your message will be queued and delivered the moment it finishes, not interrupt it.
          </span>
        </p>
      )}
      {!queuedState.isQueued && !isLiveTurn && awaitingReply && (
        <p className="text-gray-500 text-[11px] mt-1.5 italic flex items-center gap-1.5" data-testid="composer-awaiting-reply-hint">
          <span className="flex gap-0.5">
            <span className="w-1 h-1 rounded-full bg-gray-500 animate-bounce [animation-delay:-0.3s]" />
            <span className="w-1 h-1 rounded-full bg-gray-500 animate-bounce [animation-delay:-0.15s]" />
            <span className="w-1 h-1 rounded-full bg-gray-500 animate-bounce" />
          </span>
          <span>Waiting for a reply — this can take a moment, no need to resend.</span>
        </p>
      )}
      {error && <p className="text-red-400 text-xs mt-1.5" data-testid="worker-chat-error">{error}</p>}
    </div>
  );
}
