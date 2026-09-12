// Track AM-10094 Phase 3 (Task 5, AC-4): the All Projects overview must not
// pay for the unscoped, full row-per-track /api/tracks fetch — it only
// needs the set-based /api/projects/summary endpoint. This locks that
// contract in at the hook level so a future change can't silently
// reintroduce the unscoped fetch for that view.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { usePolling } from './usePolling.js';

function jsonResponse(body) {
  return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
}

describe('usePolling — summaryOnly mode', () => {
  let fetchMock;

  beforeEach(() => {
    fetchMock = vi.fn((url) => {
      if (url.includes('/projects/summary')) return jsonResponse([{ id: 1, total: 5, unreplied_total: 2 }]);
      if (url.endsWith('/projects')) return jsonResponse([{ id: 1, name: 'Alpha' }]);
      if (url.endsWith('/workers')) return jsonResponse([]);
      if (url.endsWith('/tracks')) return jsonResponse([{ id: 99, project_id: 1 }]);
      if (url.includes('/tracks/waiting')) return jsonResponse([]);
      return jsonResponse([]);
    });
    vi.stubGlobal('fetch', fetchMock);
    // usePolling's useWebSocket sub-hook opens a real `new WebSocket(...)` at
    // mount, independent of this test's concern — without stubbing it, this
    // test would open (and leak) a genuine connection to whatever happens to
    // be listening on localhost:8091, which is nondeterministic outside this
    // one dev machine. A no-op stub keeps the test hermetic; onWSMessage's
    // own debounced-refetch behavior is exercised elsewhere.
    vi.stubGlobal('WebSocket', class {
      constructor() { /* never connects */ }
      close() {}
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('AC-4: issues no /api/tracks or /api/tracks/waiting request when summaryOnly is set and no project is selected', async () => {
    const { result } = renderHook(() => usePolling(null, { summaryOnly: true }));

    await waitFor(() => expect(result.current.loading).toBe(false));

    const calledUrls = fetchMock.mock.calls.map(c => c[0]);
    expect(calledUrls.some(u => u.endsWith('/tracks'))).toBe(false);
    expect(calledUrls.some(u => u.includes('/tracks/waiting'))).toBe(false);
    expect(calledUrls.some(u => u.includes('/projects/summary'))).toBe(true);
    expect(result.current.projectSummaries).toEqual([{ id: 1, total: 5, unreplied_total: 2 }]);
  });

  it('leaves the project-scoped fetch shape untouched when a project is selected, even with summaryOnly set', async () => {
    const { result } = renderHook(() => usePolling(1, { summaryOnly: true }));

    await waitFor(() => expect(result.current.loading).toBe(false));

    const calledUrls = fetchMock.mock.calls.map(c => c[0]);
    expect(calledUrls.some(u => u.includes('/projects/summary'))).toBe(false);
    expect(calledUrls.some(u => u.endsWith('/projects/1/tracks'))).toBe(true);
  });

  it('falls back to the unscoped /api/tracks fetch when summaryOnly is not set', async () => {
    const { result } = renderHook(() => usePolling(null, {}));

    await waitFor(() => expect(result.current.loading).toBe(false));

    const calledUrls = fetchMock.mock.calls.map(c => c[0]);
    expect(calledUrls.some(u => u.endsWith('/tracks'))).toBe(true);
    expect(result.current.tracks).toEqual([{ id: 99, project_id: 1 }]);
  });
});
