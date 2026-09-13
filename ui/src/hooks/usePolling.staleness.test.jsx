// ui/src/hooks/usePolling.test.jsx
// Track AM-10095 Phase 3/4 (REQ-6/REQ-7/REQ-8): usePolling's connected poll
// interval, its new staleness signal, and a regression guard for track
// 10013's WS-message coalescing (inFlightRef/pendingRerunRef) — this
// track's Phase 1 fix makes claim broadcasts fire more often than before,
// which is exactly the pressure the coalescing guard exists to absorb.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePolling } from './usePolling';

// Controllable useWebSocket double: each test sets `wsConnectedValue` and
// can invoke `capturedOnMessage(...)` directly to simulate an incoming
// broadcast without spinning up a real WebSocket.
let wsConnectedValue = false;
let capturedOnMessage = null;
vi.mock('./useWebSocket', () => ({
  useWebSocket: (onMessage) => {
    capturedOnMessage = onMessage;
    return wsConnectedValue;
  },
}));

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ idToken: null }),
}));

function trackResponse(body = []) {
  return { ok: true, json: async () => body };
}

function jsonResponse(body = []) {
  return Promise.resolve(trackResponse(body));
}

describe('usePolling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    wsConnectedValue = false;
    capturedOnMessage = null;
    global.fetch = vi.fn(() => jsonResponse());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('TC-3.1: with the websocket connected, the poll interval is 10000ms, not 30000ms', async () => {
    wsConnectedValue = true;
    renderHook(() => usePolling(null));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); }); // flush the mount-time fetchData

    const callsAfterMount = global.fetch.mock.calls.length;

    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(global.fetch.mock.calls.length).toBe(callsAfterMount); // nothing yet at 5s

    await act(async () => { await vi.advanceTimersByTimeAsync(5000); }); // total 10s
    expect(global.fetch.mock.calls.length).toBeGreaterThan(callsAfterMount); // fired by 10s
  });

  it('TC-3.2: a board that has fetched recently is not stale', async () => {
    const { result } = renderHook(() => usePolling(null));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.stale).toBe(false);
  });

  it('TC-3.3: staleness flips purely from timer advance, with no new completed fetch', async () => {
    wsConnectedValue = true;
    let allowSuccess = true;
    global.fetch = vi.fn(() =>
      allowSuccess ? jsonResponse() : Promise.resolve({ ok: false, json: async () => ({}) })
    );

    const { result } = renderHook(() => usePolling(null));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.stale).toBe(false);

    // Every fetch from here fails (never calls setLastUpdated), so the only
    // thing that can flip `stale` is the independent 1s re-check timer.
    allowSuccess = false;
    await act(async () => { await vi.advanceTimersByTimeAsync(21000); }); // > STALE_THRESHOLD_MS (20000)
    expect(result.current.stale).toBe(true);
  });

  it('TC-3.4: a successful fetch clears staleness', async () => {
    wsConnectedValue = true;
    let allowSuccess = true;
    global.fetch = vi.fn(() =>
      allowSuccess ? jsonResponse() : Promise.resolve({ ok: false, json: async () => ({}) })
    );

    const { result } = renderHook(() => usePolling(null));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    allowSuccess = false;
    await act(async () => { await vi.advanceTimersByTimeAsync(21000); });
    expect(result.current.stale).toBe(true);

    allowSuccess = true;
    await act(async () => {
      result.current.refetch();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.stale).toBe(false);
  });

  it('TC-3.5: a failed fetch does not refresh the freshness clock', async () => {
    wsConnectedValue = true;
    let allowSuccess = true;
    global.fetch = vi.fn(() =>
      allowSuccess ? jsonResponse() : Promise.resolve({ ok: false, json: async () => ({}) })
    );

    const { result } = renderHook(() => usePolling(null));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); }); // one genuine success
    expect(result.current.error).toBeNull();
    const callsAfterSuccess = global.fetch.mock.calls.length;

    // Every poll from here fails — proves fetches DID keep happening (not
    // just an idle board), but none of them refreshes the freshness clock.
    allowSuccess = false;
    await act(async () => { await vi.advanceTimersByTimeAsync(21000); }); // > STALE_THRESHOLD_MS
    expect(global.fetch.mock.calls.length).toBeGreaterThan(callsAfterSuccess);
    expect(result.current.error).toBeTruthy();
    expect(result.current.stale).toBe(true);
  });

  it('TC-4.1: a burst of track:updated messages inside one debounce window produces one fetch', async () => {
    wsConnectedValue = true;
    renderHook(() => usePolling(null));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    const baseline = global.fetch.mock.calls.length;
    act(() => {
      for (let i = 0; i < 10; i++) {
        capturedOnMessage({ event: 'track:updated', data: {} });
      }
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });

    // One fetchData cycle issues 4 parallel fetch() calls (projectId=null
    // shape) — this must be exactly one cycle's worth, not ten.
    expect(global.fetch.mock.calls.length - baseline).toBe(4);
  });

  it('TC-4.2: a message debounced while an earlier fetch is still in flight yields exactly one follow-up, not a duplicate', async () => {
    wsConnectedValue = true;
    let resolvers = [];
    global.fetch = vi.fn(() => new Promise((resolve) => { resolvers.push(resolve); }));

    renderHook(() => usePolling(null));

    // Resolve the initial mount round.
    await act(async () => {
      resolvers.splice(0).forEach(r => r(trackResponse()));
      await vi.advanceTimersByTimeAsync(0);
    });

    // First WS burst — debounces to one fetchData call 500ms later. Leave
    // its fetch() calls unresolved (simulating a slow network round trip).
    act(() => { capturedOnMessage({ event: 'track:updated', data: {} }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(resolvers.length).toBe(4); // round 2 in flight, unresolved

    // A second WS burst arrives (and debounces) WHILE round 2 is still in
    // flight — the exact overlap track 10013's fix exists to absorb.
    act(() => { capturedOnMessage({ event: 'track:updated', data: {} }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    // No NEW fetch() calls were issued — fetchData() found inFlightRef
    // still true and only set pendingRerunRef.
    expect(resolvers.length).toBe(4);

    // Several more messages during the same in-flight window must not
    // queue more than one follow-up either.
    act(() => {
      capturedOnMessage({ event: 'track:updated', data: {} });
      capturedOnMessage({ event: 'track:updated', data: {} });
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(resolvers.length).toBe(4);

    // Resolve round 2 — exactly one follow-up round (round 3) must fire
    // from the queued pendingRerunRef, not three.
    await act(async () => {
      resolvers.splice(0).forEach(r => r(trackResponse()));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(resolvers.length).toBe(4);
  });
});
