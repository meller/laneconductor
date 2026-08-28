// ui/src/lib/useTrackTranscript.js
// Track 10037 Phase 3 Task 1: the live-transcript machinery WorkerActivityLatch
// (track 1087 Phase 5) already implements — fetch /transcript on
// (projectId, trackNumber) change, seed the reducer with the historical
// events, then keep it live via WS `session:event` messages scoped to the
// same track. Extracted here so WorkerChatPanel and WorkerActivityLatch
// share one reducer instead of forking it.

import { useCallback, useEffect, useState } from 'react';
import { useApi } from '../hooks/useApi.js';
import { useWebSocket } from '../hooks/useWebSocket.js';
import { createTranscriptState, reduceStreamEvent } from './streamTranscript.js';

export function useTrackTranscript(projectId, trackNumber) {
  const { apiFetch } = useApi();
  const [transcriptState, setTranscriptState] = useState(() => createTranscriptState());
  const [rawLog, setRawLog] = useState(null);

  useEffect(() => {
    setTranscriptState(createTranscriptState());
    setRawLog(null);
    if (!projectId || !trackNumber) return;
    let cancelled = false;
    apiFetch(`/api/projects/${projectId}/tracks/${trackNumber}/transcript`)
      .then(r => r.ok ? r.json() : { events: [], rawLog: null })
      .then(({ events, rawLog }) => {
        if (cancelled) return;
        setTranscriptState((events || []).reduce(reduceStreamEvent, createTranscriptState()));
        setRawLog(rawLog || null);
      })
      .catch(() => { });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, trackNumber]);

  const onWsMessage = useCallback((msg) => {
    if (msg.event !== 'session:event') return;
    if (!trackNumber || String(msg.data?.trackNumber) !== String(trackNumber)) return;
    setTranscriptState(prev => reduceStreamEvent(prev, msg.data.event));
  }, [trackNumber]);
  useWebSocket(onWsMessage);

  return { blocks: transcriptState.blocks, rawLog };
}
