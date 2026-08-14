import { useState, useEffect, useRef, useCallback } from 'react';
import { useWebSocket } from './useWebSocket';
import { useAuth } from '../contexts/AuthContext';

const POLL_INTERVAL_DEFAULT = 2000;
const POLL_INTERVAL_CONNECTED = 30000;

// Determine API base URL: use Cloud Run for remote, relative path for local
function getApiBaseUrl() {
  const hostname = typeof window !== 'undefined' ? window.location.hostname : '';
  const isLocal = hostname === 'localhost' || hostname === '127.0.0.1';
  if (isLocal) return import.meta.env.VITE_API_URL || '/api';
  // Use Cloud Run API URL for remote access (works around Firebase Hosting rewrite issues)
  return 'https://api-pu7bcq73zq-uc.a.run.app/api';
}

export function usePolling(projectId, options = {}) {
  const { idToken } = useAuth() ?? {};
  const [projects, setProjects] = useState([]);
  const [tracks, setTracks] = useState([]);
  const [workers, setWorkers] = useState([]);
  const [providers, setProviders] = useState([]);
  const [waitingTracks, setWaitingTracks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const intervalRef = useRef(null);
  const abortRef = useRef(null);

  // Options: { readerUrl }
  const effectiveApiUrl = options.readerUrl || getApiBaseUrl();

  const fetchData = useCallback(async () => {
    if (document.hidden) return;

    // Cancel any in-flight fetch so stale results don't overwrite new ones
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const { signal } = controller;

    // In remote mode, send the Firebase ID token as Bearer
    const headers = {};
    if (idToken) headers['Authorization'] = `Bearer ${idToken}`;
    const fetchOptions = { signal, headers };

    try {
      const fetchers = [
        fetch(`${effectiveApiUrl}/projects`, fetchOptions),
        projectId
          ? fetch(`${effectiveApiUrl}/projects/${projectId}/tracks`, fetchOptions)
          : fetch(`${effectiveApiUrl}/tracks`, fetchOptions),
        projectId
          ? fetch(`${effectiveApiUrl}/tracks/waiting?project_id=${projectId}`, fetchOptions)
          : fetch(`${effectiveApiUrl}/tracks/waiting`, fetchOptions),
      ];

      if (projectId) {
        fetchers.push(fetch(`${effectiveApiUrl}/projects/${projectId}/workers`, fetchOptions));
        fetchers.push(fetch(`${effectiveApiUrl}/projects/${projectId}/providers`, fetchOptions));
      } else {
        fetchers.push(fetch(`${effectiveApiUrl}/workers`, fetchOptions));
      }

      const results = await Promise.all(fetchers);
      if (results.some(r => !r.ok)) throw new Error('API error');

      const data = await Promise.all(results.map(r => r.json()));

      setProjects(data[0]);
      setTracks(data[1]);
      setWaitingTracks(data[2]);
      if (projectId) {
        setWorkers(data[3]);
        setProviders(data[4]);
      } else {
        setWorkers(data[3] || []);
        setProviders([]);
      }

      setLastUpdated(new Date());
      setError(null);
    } catch (err) {
      if (err.name === 'AbortError') return; // stale request cancelled — ignore
      setError(err.message);
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, [projectId, effectiveApiUrl, idToken]);

  const wsDebounceRef = useRef(null);

  const onWSMessage = useCallback((msg) => {
    const { event, data } = msg;
    if (event === 'track:updated' || event === 'conductor:updated' || event === 'worker:updated') {
      // If message is for another project, we still refetch if we are in "all projects" view (projectId null)
      if (!projectId || data.projectId === projectId) {
        // Debounce: bursts of WS events (e.g. many active workers heartbeating
        // in "All Projects" view) were each aborting the prior in-flight fetch,
        // so under sustained load no fetch ever completed and loading never
        // cleared. Collapse bursts into a single trailing fetch instead.
        if (wsDebounceRef.current) clearTimeout(wsDebounceRef.current);
        wsDebounceRef.current = setTimeout(() => {
          console.log(`[polling] Refreshing due to ${event} for project ${data.projectId}`);
          fetchData();
        }, 500);
      }
    }
  }, [projectId, fetchData]);

  const wsConnected = useWebSocket(onWSMessage);

  useEffect(() => {
    fetchData();
    const interval = wsConnected ? POLL_INTERVAL_CONNECTED : POLL_INTERVAL_DEFAULT;

    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(fetchData, interval);

    const onVisibility = () => {
      if (!document.hidden) fetchData();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      clearInterval(intervalRef.current);
      document.removeEventListener('visibilitychange', onVisibility);
      if (wsDebounceRef.current) clearTimeout(wsDebounceRef.current);
    };
  }, [fetchData, wsConnected]);

  return { projects, tracks, workers, providers, waitingTracks, loading, error, lastUpdated, refetch: fetchData, wsConnected };
}
