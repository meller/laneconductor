import React, { useState, useEffect } from 'react';
import { useApi } from '../hooks/useApi.js';

// Track 1087 Phase 6 (revised — see spec.md REQ-6): raw-text log viewer for
// a `deploy` dispatch, keyed on worker_dispatch.id. Deliberately plain
// <pre> rendering, not TranscriptView — deploy runs a shell command via
// deploy-runner.mjs, not a claude session, so there are no structured
// events to feed the reducer built for Phase 3.
export function DeployLogView({ projectId, dispatchId }) {
  const { apiFetch } = useApi();
  const [log, setLog] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    apiFetch(`/api/projects/${projectId}/dispatch/${dispatchId}/log`)
      .then(r => r.ok ? r.json() : { log: null })
      .then(({ log }) => { setLog(log); setLoading(false); })
      .catch(() => { setLog(null); setLoading(false); });
  }, [projectId, dispatchId]);

  if (loading) return <div className="text-gray-500 text-sm pt-4">Loading…</div>;
  if (!log) return <p className="text-gray-600 text-sm italic pt-4">No deploy log available yet.</p>;

  return (
    <pre className="text-[11px] font-mono text-gray-400 whitespace-pre-wrap leading-relaxed">
      {log}
    </pre>
  );
}
