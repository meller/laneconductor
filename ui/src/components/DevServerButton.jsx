import React, { useState, useEffect } from 'react';

/**
 * DevServerButton — Control a project's dev server from the UI
 * Props:
 *   projectId (number) — Project ID
 *   devUrl (string) — Configured dev server URL (e.g., "http://localhost:3000")
 */
export function DevServerButton({ projectId, devUrl }) {
  const [running, setRunning] = useState(false);
  const [pid, setPid] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [startLoading, setStartLoading] = useState(false);

  // Fetch status on mount and poll every 3 seconds
  const fetchStatus = async () => {
    try {
      const response = await fetch(`/api/projects/${projectId}/dev-server/status`);
      if (!response.ok) throw new Error('Failed to fetch status');
      const data = await response.json();
      setRunning(data.running);
      setPid(data.pid);
      setError(null);
    } catch (err) {
      setError(err.message);
      setRunning(false);
      setPid(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!projectId) return;
    fetchStatus();
    const interval = setInterval(fetchStatus, 3000);
    return () => clearInterval(interval);
  }, [projectId]);

  const handleStart = async () => {
    setStartLoading(true);
    try {
      const response = await fetch(`/api/projects/${projectId}/dev-server/start`, {
        method: 'POST',
      });
      if (response.status === 400) {
        const data = await response.json();
        setError(data.error || 'Dev server not configured');
        return;
      }
      if (!response.ok) throw new Error('Failed to start dev server');
      await fetchStatus();
    } catch (err) {
      setError(err.message);
    } finally {
      setStartLoading(false);
    }
  };

  const handleStop = async () => {
    setStartLoading(true);
    try {
      const response = await fetch(`/api/projects/${projectId}/dev-server/stop`, {
        method: 'POST',
      });
      if (!response.ok) throw new Error('Failed to stop dev server');
      await fetchStatus();
    } catch (err) {
      setError(err.message);
    } finally {
      setStartLoading(false);
    }
  };

  // Show nothing while loading
  if (loading) return null;

  // Show config hint on error (400 = not configured)
  if (error && error.includes('not configured')) {
    return (
      <span className="flex items-center gap-1 text-[10px] text-red-400" title={error}>
        <span>⚙️</span><span>Dev config needed</span>
      </span>
    );
  }

  // Running state: show green dot + clickable URL + Stop button
  if (running) {
    return (
      <div className="flex items-center gap-2 shrink-0">
        <span className="flex items-center gap-1 text-[10px]">
          <span className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse" />
          {devUrl ? (
            <a
              href={devUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-green-400 hover:text-green-300 underline truncate max-w-[100px]"
              title={devUrl}
            >
              {devUrl.replace(/^https?:\/\//, '')}
            </a>
          ) : (
            <span className="text-green-400">Running</span>
          )}
        </span>
        <button
          onClick={handleStop}
          disabled={startLoading}
          className="shrink-0 text-[10px] px-1.5 py-0.5 rounded border border-red-800/70 text-red-400 hover:bg-red-900/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          title="Stop dev server"
        >
          {startLoading ? '⏳' : '⏹'}
        </button>
      </div>
    );
  }

  // Not running: show Start button
  return (
    <button
      onClick={handleStart}
      disabled={startLoading}
      className="shrink-0 text-[10px] px-1.5 py-0.5 rounded border border-green-800/70 text-green-400 hover:bg-green-900/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      title="Start dev server"
    >
      {startLoading ? '⏳' : '▶'} Dev Server
    </button>
  );
}
