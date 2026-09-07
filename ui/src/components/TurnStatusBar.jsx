import React, { useEffect, useState } from 'react';

// Track 10069 Phase 2 (REQ-21..REQ-24): renders the `turn` object
// streamTranscript.js's reducer now derives — elapsed time, running token
// count, a changing activity label. Ticks its own 1s interval while
// `turn.active` (the reducer has no clock of its own); freezes at the last
// value once the turn ends. Renders nothing when there is no live turn and
// no tokens were ever seen, so a non-Claude raw-log run shows no empty
// chrome (REQ-24).

function formatElapsed(ms) {
  if (ms == null || ms < 0) return '0:00';
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function TurnStatusBar({ turn }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!turn?.active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [turn?.active]);

  if (!turn) return null;
  const hasAnything = turn.active || turn.outputTokens > 0 || turn.contextTokens != null;
  if (!hasAnything) return null;

  const elapsedMs = turn.startedAt != null
    ? (turn.active ? now : (turn.lastEventAt ?? turn.startedAt)) - turn.startedAt
    : null;

  return (
    <div className="flex items-center gap-3 px-3 py-1.5 text-xs text-gray-400 border-b border-gray-800 bg-gray-900/40">
      <span className={`w-1.5 h-1.5 rounded-full ${turn.active ? 'bg-green-500 animate-pulse' : 'bg-gray-600'}`} />
      {elapsedMs != null && <span className="font-mono">{formatElapsed(elapsedMs)}</span>}
      {turn.outputTokens > 0 && <span>{turn.outputTokens.toLocaleString()} tokens</span>}
      {turn.activity && <span className="text-gray-300 truncate">{turn.activity}</span>}
    </div>
  );
}
