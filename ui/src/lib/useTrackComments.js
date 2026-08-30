// ui/src/lib/useTrackComments.js
// Extracted from TrackDetailPanel's Conversation tab (track 1094) so
// WorkerChatPanel (track 10037) can show the same persisted, shared
// conversation history instead of an ephemeral send-only local buffer.
// Same fetch+poll pattern as the original: comments have no dedicated WS
// broadcast event, so a 2s poll (not WS-driven) is what actually keeps
// this current across authors/tabs/panels.

import { useEffect, useRef, useState } from 'react';
import { useApi } from '../hooks/useApi.js';

export function useTrackComments(projectId, trackNumber) {
  const { apiFetch } = useApi();
  const [comments, setComments] = useState([]);
  const pollRef = useRef(null);

  useEffect(() => {
    setComments([]);
    if (!projectId || !trackNumber) return;
    let cancelled = false;

    async function fetchComments() {
      try {
        const r = await apiFetch(`/api/projects/${projectId}/tracks/${trackNumber}/comments`);
        if (!r.ok || cancelled) return;
        const data = await r.json();
        if (!cancelled) setComments(data);
      } catch { }
    }

    fetchComments();
    pollRef.current = setInterval(fetchComments, 2000);
    return () => {
      cancelled = true;
      clearInterval(pollRef.current);
    };
  }, [projectId, trackNumber, apiFetch]);

  return { comments, setComments };
}
