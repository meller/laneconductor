import React, { useState, useEffect } from 'react';
import { useApi } from '../hooks/useApi.js';

// Track 1091 Phase 5: read-only status view for a manager worker's
// create-project dispatch, shown from WorkerActivityLatch. Deliberately
// not DeployLogView — that endpoint is project-scoped and reads a deploy
// shell log from an existing project's repo_path, neither of which exists
// for a dispatch whose whole point is creating a project. Polls the same
// global GET /api/dispatch/:dispatchId the New Project wizard itself uses.
export function CreateProjectDispatchView({ dispatchId }) {
  const { apiFetch } = useApi();
  const [dispatch, setDispatch] = useState(null);

  useEffect(() => {
    let cancelled = false;
    let interval;

    async function poll() {
      try {
        const r = await apiFetch(`/api/dispatch/${dispatchId}`);
        if (!r.ok || cancelled) return;
        const data = await r.json();
        if (cancelled) return;
        setDispatch(data);
        if (data.status === 'done' || data.status === 'failed') clearInterval(interval);
      } catch { /* transient — retry next tick */ }
    }

    poll();
    interval = setInterval(poll, 2000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [dispatchId, apiFetch]);

  if (!dispatch) return <div className="text-gray-500 text-sm pt-4">Loading…</div>;

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-400">
        Status: <span className="text-gray-200 font-mono">{dispatch.status}</span>
      </p>
      {dispatch.result && (
        <pre className="text-[11px] font-mono text-gray-400 whitespace-pre-wrap leading-relaxed bg-gray-900 border border-gray-800 rounded-lg p-3">
          {dispatch.result}
        </pre>
      )}
    </div>
  );
}
