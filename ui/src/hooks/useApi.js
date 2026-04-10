import { useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';

const apiUrl = import.meta.env.VITE_API_URL || '';

export function useApi() {
  const { idToken } = useAuth() ?? {};

  const apiFetch = useCallback(async (path, options = {}) => {
    // Ensure path starts with / if it doesn't and doesn't have a protocol
    const url = path.startsWith('http') ? path : `${apiUrl}${path.startsWith('/') ? '' : '/'}${path}`;

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
