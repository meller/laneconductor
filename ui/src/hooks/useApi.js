import { useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';

// Determine API base URL: use Cloud Run for remote, relative path for local
function getApiBaseUrl() {
  const isLocal = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
  if (isLocal) return import.meta.env.VITE_API_URL || '';
  // Use Cloud Run API URL for remote access (works around Firebase Hosting rewrite issues)
  return 'https://api-pu7bcq73zq-uc.a.run.app';
}

export function useApi() {
  const { idToken } = useAuth() ?? {};

  const apiFetch = useCallback(async (path, options = {}) => {
    const apiBase = getApiBaseUrl();
    // Ensure path starts with / if it doesn't and doesn't have a protocol
    const url = path.startsWith('http') ? path : `${apiBase}${path.startsWith('/') ? '' : '/'}${path}`;

    const headers = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    if (idToken) {
      headers['Authorization'] = `Bearer ${idToken}`;
    }

    const fetchOptions = {
      ...options,
      headers,
    };

    const response = await fetch(url, fetchOptions);
    return response;
  }, [idToken]);

  return { apiFetch };
}
