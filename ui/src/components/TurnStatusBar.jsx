import React, { useEffect, useState } from 'react';

// Track 10069 Phase 2 (REQ-21..REQ-24): renders the `turn` object
// streamTranscript.js's reducer now derives — elapsed time, running token
// count, a changing activity label. Ticks its own 1s interval while
// `turn.active` (the reducer has no clock of its own); freezes at the last
// value once the turn ends. Renders nothing when there is no live turn, no
// tokens were ever seen, AND nothing is abortable, so a non-Claude raw-log
// run shows no empty chrome (REQ-24).
//
// Track 10079 (REQ-18, REQ-20): `canAbort` is a SEPARATE signal from `turn`
// — a run can be live (there's a process to stop) before the first
// stream-json event ever arrives, or for a non-claude CLI that never
// produces one at all. The old `if (!turn) return null` hid the bar
// entirely in exactly that window; `canAbort` alone now keeps it rendered
// so the Stop control is reachable regardless of whether turn data exists.

function formatElapsed(ms) {
  if (ms == null || ms < 0) return '0:00';
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function TurnStatusBar({ turn, canAbort = false, onAbort, aborting = false, abortError = null }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!turn?.active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [turn?.active]);

  const hasTurnData = !!turn && (turn.active || turn.outputTokens > 0 || turn.contextTokens != null);
  if (!hasTurnData && !canAbort) return null;

  const elapsedMs = turn?.startedAt != null
    ? (turn.active ? now : (turn.lastEventAt ?? turn.startedAt)) - turn.startedAt
    : null;

  return (
    <div className="flex items-center gap-3 px-3 py-1.5 text-xs text-gray-400 border-b border-gray-800 bg-gray-900/40">
      {hasTurnData && (
        <span className={`w-1.5 h-1.5 rounded-full ${turn.active ? 'bg-green-500 animate-pulse' : 'bg-gray-600'}`} />
      )}
      {elapsedMs != null && <span className="font-mono">{formatElapsed(elapsedMs)}</span>}
      {turn?.outputTokens > 0 && <span>{turn.outputTokens.toLocaleString()} tokens</span>}
      {turn?.activity && <span className="text-gray-300 truncate">{turn.activity}</span>}
      <div className="ml-auto flex items-center gap-3">
        {turn?.sessionId && (
          <span className="font-mono text-gray-500" data-testid="turn-session-id" title={`Session ID: ${turn.sessionId}`}>
            session: {turn.sessionId.slice(0, 8)}
          </span>
        )}
        {abortError && <span className="text-amber-400" data-testid="abort-error">{abortError}</span>}
        {canAbort && (
          <button
            type="button"
            onClick={onAbort}
            disabled={aborting}
            data-testid="abort-turn-button"
            title="Stop the running turn — the worktree and session are preserved"
            className="px-2 py-0.5 rounded border border-amber-700/60 text-amber-400 hover:bg-amber-900/30 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent"
          >
            {aborting ? 'Stopping…' : '■ Stop'}
          </button>
        )}
      </div>
    </div>
  );
}
