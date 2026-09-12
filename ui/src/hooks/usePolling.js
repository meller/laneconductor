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
  const [projectSummaries, setProjectSummaries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const intervalRef = useRef(null);
  const abortRef = useRef(null);
  // Track 10013: a fetch already in flight used to get aborted by every
  // subsequent trigger (WS message, interval tick, visibility change) —
  // fine in isolation, but with several concurrent sync workers heartbeating
  // (multiple projects, multiple workers per project), WS-triggered
  // debounced calls arrived faster than any single fetch's round trip,
  // so every fetch got cancelled before it could finish and `loading` never
  // cleared (board stuck on "Connecting to LaneConductor DB…" forever).
  // Fix: coalesce instead of cancel — if a fetch is already running, just
  // remember that another one is wanted and let the in-flight one finish;
  // it always runs to completion, so `loading` reliably clears after the
  // very first successful round trip, and a trailing re-fetch afterward
  // picks up whatever changed while it was busy.
  const inFlightRef = useRef(false);
  const pendingRerunRef = useRef(false);

  // Options: { readerUrl, summaryOnly }
  const effectiveApiUrl = options.readerUrl || getApiBaseUrl();
  const summaryOnlyOption = !!options.summaryOnly;

  const fetchData = useCallback(async () => {
    if (document.hidden) return;

    if (inFlightRef.current) {
      pendingRerunRef.current = true;
      return;
    }
    inFlightRef.current = true;

    // Still used to cancel an in-flight request on unmount (see cleanup
    // below) — no longer used to cancel one request in favor of another.
    const controller = new AbortController();
    abortRef.current = controller;
    const { signal } = controller;

    // In remote mode, send the Firebase ID token as Bearer
    const headers = {};
    if (idToken) headers['Authorization'] = `Bearer ${idToken}`;
    const fetchOptions = { signal, headers };

    // Track AM-10094: the All Projects overview only needs per-project
    // aggregates, not one row per track across the whole install — skip the
    // unscoped, expensive /tracks and /tracks/waiting fetches in that mode
    // and fetch the set-based summary endpoint instead. Every other
    // combination (a project selected, or no project but a non-summary
    // view) keeps the exact fetch shape it had before.
    const summaryOnly = !projectId && summaryOnlyOption;

    try {
      const fetchers = [
        fetch(`${effectiveApiUrl}/projects`, fetchOptions),
        summaryOnly
          ? Promise.resolve(null)
          : projectId
            ? fetch(`${effectiveApiUrl}/projects/${projectId}/tracks`, fetchOptions)
            : fetch(`${effectiveApiUrl}/tracks`, fetchOptions),
        summaryOnly
          ? Promise.resolve(null)
          : projectId
            ? fetch(`${effectiveApiUrl}/tracks/waiting?project_id=${projectId}`, fetchOptions)
            : fetch(`${effectiveApiUrl}/tracks/waiting`, fetchOptions),
      ];

      const workersIdx = fetchers.length;
      if (projectId) {
        fetchers.push(fetch(`${effectiveApiUrl}/projects/${projectId}/workers`, fetchOptions));
        fetchers.push(fetch(`${effectiveApiUrl}/projects/${projectId}/providers`, fetchOptions));
      } else {
        fetchers.push(fetch(`${effectiveApiUrl}/workers`, fetchOptions));
      }
      const summaryIdx = fetchers.length;
      if (summaryOnly) {
        fetchers.push(fetch(`${effectiveApiUrl}/projects/summary`, fetchOptions));
      }

      const results = await Promise.all(fetchers);
      if (results.some(r => r && !r.ok)) throw new Error('API error');

      const data = await Promise.all(results.map(r => (r ? r.json() : null)));

      setProjects(data[0]);
      if (!summaryOnly) {
        setTracks(data[1]);
        setWaitingTracks(data[2]);
      }
      if (projectId) {
        setWorkers(data[workersIdx]);
        setProviders(data[workersIdx + 1]);
      } else {
        setWorkers(data[workersIdx] || []);
        setProviders([]);
      }
      if (summaryOnly) {
        setProjectSummaries(data[summaryIdx] || []);
      }

      setLastUpdated(new Date());
      setError(null);
    } catch (err) {
      if (err.name === 'AbortError') return; // unmounted mid-request — ignore
      setError(err.message);
    } finally {
      if (!signal.aborted) setLoading(false);
      inFlightRef.current = false;
      if (pendingRerunRef.current) {
        pendingRerunRef.current = false;
        fetchData();
      }
    }
  }, [projectId, effectiveApiUrl, idToken, summaryOnlyOption]);

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

  return { projects, tracks, workers, providers, waitingTracks, projectSummaries, loading, error, lastUpdated, refetch: fetchData, wsConnected };
}
